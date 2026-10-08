import { DeleteObjectsCommand, type S3Client } from "@aws-sdk/client-s3";
import type { Database } from "@supportdesk/database";

const BATCH_SIZE = 500;

// Each query selects uploads nothing will ever show: never attached, never referenced, or never finished.
// Rows are locked so an upload being attached at the same moment is either kept (attach wins) or rejected (cleanup wins).
const TARGETS = [
  {
    name: "ticketImages",
    select: "SELECT id, object_key FROM ticket_images WHERE ticket_id IS NULL AND created_at < now() - make_interval(days => $1) ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED",
    remove: "DELETE FROM ticket_images WHERE id = ANY($1::uuid[])"
  },
  {
    name: "knowledgeImages",
    select: "SELECT i.id, i.object_key FROM knowledge_images i WHERE i.created_at < now() - make_interval(days => $1) AND NOT EXISTS (SELECT 1 FROM knowledge_articles a WHERE a.organization_id = i.organization_id AND strpos(a.body, 'kb-image:' || i.id::text) > 0) ORDER BY i.created_at LIMIT $2 FOR UPDATE OF i SKIP LOCKED",
    remove: "DELETE FROM knowledge_images WHERE id = ANY($1::uuid[])"
  },
  {
    name: "attachments",
    select: "SELECT id, object_key FROM attachments WHERE state <> 'available' AND created_at < now() - make_interval(days => $1) ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED",
    remove: "DELETE FROM attachments WHERE id = ANY($1::uuid[])"
  }
] as const;

export type CleanupResult = Record<(typeof TARGETS)[number]["name"], number>;

/** Deletes unused uploads older than `olderThanDays` from S3 and the database. Objects go first, so a failed S3 call keeps the rows for the next run. */
export async function cleanupUnusedUploads({ db, s3, bucket, olderThanDays }: { db: Database; s3: S3Client; bucket: string; olderThanDays: number }): Promise<CleanupResult> {
  if (!Number.isInteger(olderThanDays) || olderThanDays < 1) throw new Error("olderThanDays must be a positive whole number");
  const result = { ticketImages: 0, knowledgeImages: 0, attachments: 0 } satisfies CleanupResult;
  for (const target of TARGETS) {
    for (;;) {
      const client = await db.connect();
      let deleted = 0;
      try {
        await client.query("BEGIN");
        const rows = (await client.query<{ id: string; object_key: string }>(target.select, [olderThanDays, BATCH_SIZE])).rows;
        if (rows.length) {
          const response = await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: rows.map((row) => ({ Key: row.object_key })), Quiet: true } }));
          if (response.Errors?.length) throw new Error(`S3 refused to delete ${response.Errors.length} ${target.name} object(s): ${response.Errors[0]?.Code ?? "unknown"}`);
          await client.query(target.remove, [rows.map((row) => row.id)]);
        }
        await client.query("COMMIT");
        deleted = rows.length;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
      result[target.name] += deleted;
      if (deleted < BATCH_SIZE) break;
    }
  }
  return result;
}
