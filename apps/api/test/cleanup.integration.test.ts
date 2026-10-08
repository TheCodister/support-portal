import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createPool, type Database } from "@supportdesk/database";
import { cleanupUnusedUploads } from "../src/cleanup.js";

describe.runIf(process.env.RUN_INTEGRATION_TESTS === "true")("unused upload cleanup", () => {
  const bucket = process.env.ATTACHMENTS_BUCKET ?? "supportdesk-local";
  const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1", endpoint: process.env.S3_ENDPOINT || undefined, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true" });
  let db: Database; let org = ""; let user = ""; let ticket = "";

  async function exists(key: string) { try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); return true; } catch { return false; } }
  async function upload(table: string, options: { daysOld: number; ticketId?: string; state?: string }) {
    const id = crypto.randomUUID(); const key = `${org}/cleanup-test/${id}`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: "x", ContentType: "image/png" }));
    const created = `now() - interval '${options.daysOld} days'`;
    if (table === "attachments") await db.query(`INSERT INTO attachments(id,organization_id,ticket_id,uploader_id,object_key,file_name,content_type,size_bytes,state,created_at) VALUES($1,$2,$3,$4,$5,'f.png','image/png',1,$6,${created})`, [id, org, ticket, user, key, options.state ?? "pending"]);
    else if (table === "ticket_images") await db.query(`INSERT INTO ticket_images(id,organization_id,ticket_id,uploader_id,object_key,file_name,content_type,size_bytes,state,created_at) VALUES($1,$2,$3,$4,$5,'f.png','image/png',1,'available',${created})`, [id, org, options.ticketId ?? null, user, key]);
    else await db.query(`INSERT INTO knowledge_images(id,organization_id,uploader_id,object_key,file_name,content_type,size_bytes,state,created_at) VALUES($1,$2,$3,$4,'f.png','image/png',1,'available',${created})`, [id, org, user, key]);
    return { id, key, table };
  }
  async function kept(item: { id: string; key: string; table: string }) { return (await db.query(`SELECT 1 FROM ${item.table} WHERE id=$1`, [item.id])).rowCount === 1 && await exists(item.key); }
  async function removed(item: { id: string; key: string; table: string }) { return (await db.query(`SELECT 1 FROM ${item.table} WHERE id=$1`, [item.id])).rowCount === 0 && !(await exists(item.key)); }

  beforeAll(async () => {
    db = createPool();
    const member = (await db.query("SELECT m.organization_id, m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email='admin@acme.test'")).rows[0];
    org = member.organization_id; user = member.user_id;
    ticket = (await db.query("INSERT INTO tickets(organization_id,requester_id,title,description) VALUES($1,$2,'Cleanup test','Body') RETURNING id", [org, user])).rows[0].id;
  });
  afterAll(async () => { await db.end(); });

  it("deletes only uploads that are unused and older than the cutoff", async () => {
    const orphanTicketImage = await upload("ticket_images", { daysOld: 61 });
    const recentTicketImage = await upload("ticket_images", { daysOld: 10 });
    const attachedTicketImage = await upload("ticket_images", { daysOld: 61, ticketId: ticket });
    const unusedKnowledgeImage = await upload("knowledge_images", { daysOld: 61 });
    const usedKnowledgeImage = await upload("knowledge_images", { daysOld: 61 });
    await db.query("INSERT INTO knowledge_articles(organization_id,title,body,author_id,updated_by) VALUES($1,'Cleanup test article',$2,$3,$3)", [org, `![x](kb-image:${usedKnowledgeImage.id})`, user]);
    const unfinishedAttachment = await upload("attachments", { daysOld: 61, state: "pending" });
    const completedAttachment = await upload("attachments", { daysOld: 61, state: "available" });

    const result = await cleanupUnusedUploads({ db, s3, bucket, olderThanDays: 60 });

    expect(result.ticketImages).toBeGreaterThanOrEqual(1);
    expect(await removed(orphanTicketImage)).toBe(true);
    expect(await kept(recentTicketImage)).toBe(true);
    expect(await kept(attachedTicketImage)).toBe(true);
    expect(await removed(unusedKnowledgeImage)).toBe(true);
    expect(await kept(usedKnowledgeImage)).toBe(true);
    expect(await removed(unfinishedAttachment)).toBe(true);
    expect(await kept(completedAttachment)).toBe(true);
  });

  it("refuses a cutoff that would delete fresh uploads", async () => {
    await expect(cleanupUnusedUploads({ db, s3, bucket, olderThanDays: 0 })).rejects.toThrow("positive whole number");
  });
});
