import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { HeadObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z, ZodError } from "zod";
import { attachmentRequestSchema, createArticleSchema, createCommentSchema, createTicketSchema, imageUploadSchema, loginSchema, updateArticleSchema, updateTicketSchema, type Role } from "@supportdesk/contracts";
import { createPool, transaction, type Database } from "@supportdesk/database";
import { ticketImageIds } from "./markdown.js";
import { token, tokenHash, verifyPassword } from "./security.js";

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "supportdesk_session";
const CSRF_COOKIE = "supportdesk_csrf";
const MAX_PAGE = 100;
const bucket = process.env.ATTACHMENTS_BUCKET ?? "supportdesk-local";
const idSchema = z.uuid();

type Dependencies = { db?: Database; s3?: S3Client };
const cookieOptions = () => ({
  path: "/", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const,
  domain: process.env.COOKIE_DOMAIN || undefined, maxAge: 60 * 60 * 24 * 7
});

function httpError(statusCode: number, message: string, code = "request_error") {
  return Object.assign(new Error(message), { statusCode, code });
}
function parseCursor(cursor?: string) {
  if (!cursor) return undefined;
  try { const value = JSON.parse(Buffer.from(cursor, "base64url").toString()); if (typeof value.createdAt !== "string" || typeof value.id !== "string") throw new Error(); return value as { createdAt: string; id: string }; }
  catch { throw httpError(400, "Invalid cursor", "invalid_cursor"); }
}
function makeCursor(row: { created_at: Date | string; id: string }) {
  return Buffer.from(JSON.stringify({ createdAt: new Date(row.created_at).toISOString(), id: row.id })).toString("base64url");
}

export async function buildApp(deps: Dependencies = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", trustProxy: true, requestIdHeader: "x-request-id" });
  const db = deps.db ?? createPool();
  const s3 = deps.s3 ?? new S3Client({
    region: process.env.AWS_REGION ?? "us-east-1", endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true"
  });
  app.decorate("db", db);
  await app.register(cookie);
  await app.register(cors, { origin: (origin, cb) => cb(null, !origin || origin === (process.env.WEB_ORIGIN ?? "http://localhost:3000")), credentials: true, methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["content-type", "x-csrf-token", "x-organization-id", "x-request-id"] });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: Number(process.env.RATE_LIMIT_MAX ?? 300), timeWindow: "1 minute" });

  app.addHook("onClose", async () => { if (!deps.db) await db.end(); });
  app.addHook("onRequest", async (request) => {
    if (["POST", "PATCH", "DELETE"].includes(request.method) && request.url !== "/v1/auth/login") {
      const header = request.headers["x-csrf-token"];
      if (!header || header !== request.cookies[CSRF_COOKIE]) throw httpError(403, "Invalid CSRF token", "csrf_invalid");
    }
  });
  app.setErrorHandler((error, request, reply) => {
    const status = error instanceof ZodError ? 400 : ((error as { statusCode?: number }).statusCode ?? 500);
    if (status >= 500) request.log.error({ err: error }, "request failed");
    reply.status(status).send({ error: (error as { code?: string }).code ?? (error instanceof ZodError ? "validation_error" : "internal_error"), message: status >= 500 ? "Internal server error" : (error as Error).message, requestId: request.id });
  });

  async function authenticate(request: FastifyRequest) {
    const raw = request.cookies[SESSION_COOKIE];
    const organizationHeader = request.headers["x-organization-id"];
    if (!raw || typeof organizationHeader !== "string") throw httpError(401, "Authentication and organization are required", "unauthorized");
    const organizationId = idSchema.parse(organizationHeader);
    const result = await db.query<{ user_id: string; role: Role }>(`SELECT s.user_id, m.role FROM sessions s JOIN memberships m ON m.user_id=s.user_id AND m.organization_id=$2 WHERE s.token_hash=$1 AND s.expires_at>now()`, [tokenHash(raw), organizationId]);
    const membership = result.rows[0];
    if (!membership) throw httpError(403, "Organization access denied", "forbidden");
    request.auth = { userId: membership.user_id, organizationId, role: membership.role };
  }
  const requireAgent = (request: FastifyRequest) => { if (request.auth.role === "requester") throw httpError(403, "Agent role required", "forbidden"); };
  const requireAdmin = (request: FastifyRequest) => { if (request.auth.role !== "admin") throw httpError(403, "Admin role required", "forbidden"); };

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => { try { await db.query("SELECT 1"); return { status: "ready" }; } catch { return reply.status(503).send({ status: "unavailable" }); } });

  app.post("/v1/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const result = await db.query("SELECT id,email,display_name,password_hash FROM users WHERE lower(email)=lower($1)", [input.email]);
    const user = result.rows[0];
    if (!user || !verifyPassword(input.password, user.password_hash)) throw httpError(401, "Invalid email or password", "invalid_credentials");
    const sessionToken = token(); const csrfToken = token();
    await db.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '7 days')", [user.id, tokenHash(sessionToken)]);
    const memberships = await db.query("SELECT m.organization_id,o.name,m.role FROM memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=$1 ORDER BY o.name", [user.id]);
    reply.setCookie(SESSION_COOKIE, sessionToken, cookieOptions());
    reply.setCookie(CSRF_COOKIE, csrfToken, cookieOptions());
    return { user: { id: user.id, email: user.email, displayName: user.display_name }, memberships: memberships.rows, csrfToken };
  });
  app.post("/v1/auth/logout", async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE]; if (raw) await db.query("DELETE FROM sessions WHERE token_hash=$1", [tokenHash(raw)]);
    reply.clearCookie(SESSION_COOKIE, cookieOptions()); reply.clearCookie(CSRF_COOKIE, cookieOptions()); return reply.status(204).send();
  });
  app.get("/v1/auth/me", async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE]; if (!raw) throw httpError(401, "Not signed in", "unauthorized");
    const userResult = await db.query("SELECT u.id,u.email,u.display_name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()", [tokenHash(raw)]);
    const user = userResult.rows[0]; if (!user) throw httpError(401, "Session expired", "unauthorized");
    const memberships = await db.query("SELECT m.organization_id,o.name,m.role FROM memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=$1 ORDER BY o.name", [user.id]);
    const csrfToken = request.cookies[CSRF_COOKIE] ?? token();
    if (!request.cookies[CSRF_COOKIE]) reply.setCookie(CSRF_COOKIE, csrfToken, cookieOptions());
    return { user: { id: user.id, email: user.email, displayName: user.display_name }, memberships: memberships.rows, csrfToken };
  });

  app.get("/v1/members", { preHandler: authenticate }, async (request) => {
    requireAgent(request); return (await db.query("SELECT u.id,u.email,u.display_name,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 ORDER BY u.display_name", [request.auth.organizationId])).rows;
  });
  app.get("/v1/tickets", { preHandler: authenticate }, async (request) => {
    const q = request.query as Record<string, string | undefined>; const limit = Math.min(Math.max(Number(q.limit) || 25, 1), MAX_PAGE); const cursor = parseCursor(q.cursor);
    if (q.status && !["open", "in_progress", "waiting", "closed"].includes(q.status)) throw httpError(400, "Invalid status filter", "validation_error");
    if (q.priority && !["low", "normal", "high", "urgent"].includes(q.priority)) throw httpError(400, "Invalid priority filter", "validation_error");
    if (q.search && q.search.length > 200) throw httpError(400, "Search is too long", "validation_error");
    const values: unknown[] = [request.auth.organizationId]; const conditions = ["t.organization_id=$1"];
    if (request.auth.role === "requester") { values.push(request.auth.userId); conditions.push(`t.requester_id=$${values.length}`); }
    if (q.status) { values.push(q.status); conditions.push(`t.status=$${values.length}`); }
    if (q.priority) { values.push(q.priority); conditions.push(`t.priority=$${values.length}`); }
    if (q.assigneeId) { values.push(q.assigneeId); conditions.push(`t.assignee_id=$${values.length}`); }
    if (q.search) { values.push(q.search); conditions.push(`to_tsvector('english',t.title||' '||t.description) @@ plainto_tsquery('english',$${values.length})`); }
    if (cursor) { values.push(cursor.createdAt, cursor.id); conditions.push(`(t.created_at,t.id)<($${values.length - 1},$${values.length})`); }
    values.push(limit + 1);
    const result = await db.query(`SELECT t.*,r.display_name requester_name,a.display_name assignee_name FROM tickets t JOIN users r ON r.id=t.requester_id LEFT JOIN users a ON a.id=t.assignee_id WHERE ${conditions.join(" AND ")} ORDER BY t.created_at DESC,t.id DESC LIMIT $${values.length}`, values);
    const hasMore = result.rows.length > limit; const items = result.rows.slice(0, limit); return { items, nextCursor: hasMore ? makeCursor(items.at(-1)) : null };
  });
  app.post("/v1/tickets", { preHandler: authenticate }, async (request, reply) => {
    const input = createTicketSchema.parse(request.body); const auth = request.auth;
    const imageIds = input.descriptionFormat === "markdown" ? ticketImageIds(input.description) : [];
    if (!imageIds) throw httpError(400, "Ticket images must be uploaded with the editor", "invalid_image");
    const ticket = await transaction(db, async (client) => {
      const result = await client.query("INSERT INTO tickets(organization_id,requester_id,title,description,priority,description_format) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [auth.organizationId, auth.userId, input.title, input.description, input.priority, input.descriptionFormat]); const row = result.rows[0];
      if (imageIds.length) {
        const linked = await client.query("UPDATE ticket_images SET ticket_id=$1 WHERE organization_id=$2 AND uploader_id=$3 AND id=ANY($4::uuid[]) AND ticket_id IS NULL AND state='available'", [row.id, auth.organizationId, auth.userId, imageIds]);
        if (linked.rowCount !== imageIds.length) throw httpError(400, "An image in the description is missing or already used", "invalid_image");
      }
      await client.query("INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data) VALUES($1,$2,'ticket.created','ticket',$3,$4)", [auth.organizationId, auth.userId, row.id, JSON.stringify({ title: row.title })]);
      await client.query("INSERT INTO outbox_events(organization_id,event_type,aggregate_id,payload) VALUES($1,'ticket.created',$2,$3)", [auth.organizationId, row.id, JSON.stringify({ ticketId: row.id, requesterId: auth.userId })]); return row;
    }); return reply.status(201).send(ticket);
  });
  app.get("/v1/tickets/:id", { preHandler: authenticate }, async (request) => {
    const id = idSchema.parse((request.params as { id: string }).id); const auth = request.auth;
    const values: unknown[] = [auth.organizationId, id]; const access = auth.role === "requester" ? "AND t.requester_id=$3" : ""; if (auth.role === "requester") values.push(auth.userId);
    const result = await db.query(`SELECT t.*,r.display_name requester_name,a.display_name assignee_name FROM tickets t JOIN users r ON r.id=t.requester_id LEFT JOIN users a ON a.id=t.assignee_id WHERE t.organization_id=$1 AND t.id=$2 ${access}`, values);
    const ticket = result.rows[0]; if (!ticket) throw httpError(404, "Ticket not found", "not_found");
    const comments = await db.query(`SELECT c.*,u.display_name author_name FROM comments c JOIN users u ON u.id=c.author_id WHERE c.organization_id=$1 AND c.ticket_id=$2 ${auth.role === "requester" ? "AND c.visibility='public'" : ""} ORDER BY c.created_at,c.id`, [auth.organizationId, id]);
    const attachments = await db.query(`SELECT a.id,a.comment_id,a.file_name,a.content_type,a.size_bytes,a.state,a.created_at FROM attachments a LEFT JOIN comments c ON c.id=a.comment_id AND c.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.ticket_id=$2 AND a.state='available' ${auth.role === "requester" ? "AND (a.comment_id IS NULL OR c.visibility='public')" : ""} ORDER BY a.created_at`, [auth.organizationId, id]);
    const activity = auth.role === "requester" ? [] : (await db.query("SELECT ae.*,u.display_name actor_name FROM audit_events ae LEFT JOIN users u ON u.id=ae.actor_id WHERE ae.organization_id=$1 AND ae.entity_type='ticket' AND ae.entity_id=$2 ORDER BY ae.created_at DESC LIMIT 100", [auth.organizationId, id])).rows;
    return { ...ticket, comments: comments.rows, attachments: attachments.rows, activity };
  });
  app.patch("/v1/tickets/:id", { preHandler: authenticate }, async (request) => {
    requireAgent(request); const id = idSchema.parse((request.params as { id: string }).id); const input = updateTicketSchema.parse(request.body); const auth = request.auth;
    if (input.assigneeId) { const eligible = await db.query("SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2 AND role IN ('agent','admin')", [auth.organizationId, input.assigneeId]); if (!eligible.rowCount) throw httpError(400, "Assignee must be an agent in this organization", "invalid_assignee"); }
    const fields: string[] = []; const values: unknown[] = [auth.organizationId, id, input.version];
    for (const [column, value] of [["status", input.status], ["priority", input.priority], ["assignee_id", input.assigneeId]] as const) if (value !== undefined) { values.push(value); fields.push(`${column}=$${values.length}`); }
    const updated = await transaction(db, async (client) => {
      const result = await client.query(`UPDATE tickets SET ${fields.join(",")},version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND version=$3 RETURNING *`, values); const row = result.rows[0];
      if (!row) { const exists = await client.query("SELECT 1 FROM tickets WHERE organization_id=$1 AND id=$2", [auth.organizationId, id]); throw httpError(exists.rowCount ? 409 : 404, exists.rowCount ? "Ticket was changed by another user" : "Ticket not found", exists.rowCount ? "version_conflict" : "not_found"); }
      await client.query("INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data) VALUES($1,$2,'ticket.updated','ticket',$3,$4)", [auth.organizationId, auth.userId, id, JSON.stringify(input)]);
      await client.query("INSERT INTO outbox_events(organization_id,event_type,aggregate_id,payload) VALUES($1,'ticket.updated',$2,$3)", [auth.organizationId, id, JSON.stringify({ ticketId: id, version: row.version })]); return row;
    }); return updated;
  });
  app.post("/v1/tickets/:id/comments", { preHandler: authenticate }, async (request, reply) => {
    const id = idSchema.parse((request.params as { id: string }).id); const input = createCommentSchema.parse(request.body); const auth = request.auth;
    if (input.visibility === "internal") requireAgent(request);
    const imageIds = input.bodyFormat === "markdown" ? ticketImageIds(input.body) : [];
    if (!imageIds) throw httpError(400, "Reply images must be uploaded with the editor", "invalid_image");
    const comment = await transaction(db, async (client) => {
      const ticket = await client.query("SELECT requester_id FROM tickets WHERE organization_id=$1 AND id=$2", [auth.organizationId, id]); if (!ticket.rows[0] || (auth.role === "requester" && ticket.rows[0].requester_id !== auth.userId)) throw httpError(404, "Ticket not found", "not_found");
      const result = await client.query("INSERT INTO comments(organization_id,ticket_id,author_id,visibility,body,body_format) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [auth.organizationId, id, auth.userId, input.visibility, input.body, input.bodyFormat]); const row = result.rows[0];
      if (imageIds.length) {
        const linked = await client.query("UPDATE ticket_images SET ticket_id=$1,comment_id=$2 WHERE organization_id=$3 AND uploader_id=$4 AND id=ANY($5::uuid[]) AND ticket_id IS NULL AND state='available'", [id, row.id, auth.organizationId, auth.userId, imageIds]);
        if (linked.rowCount !== imageIds.length) throw httpError(400, "An image in the reply is missing or already used", "invalid_image");
      }
      await client.query("INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data) VALUES($1,$2,'comment.created','ticket',$3,$4)", [auth.organizationId, auth.userId, id, JSON.stringify({ commentId: row.id, visibility: input.visibility })]);
      await client.query("INSERT INTO outbox_events(organization_id,event_type,aggregate_id,payload) VALUES($1,'comment.created',$2,$3)", [auth.organizationId, id, JSON.stringify({ ticketId: id, commentId: row.id, visibility: input.visibility })]); return row;
    }); return reply.status(201).send(comment);
  });
  app.post("/v1/tickets/:id/attachments", { preHandler: authenticate }, async (request, reply) => {
    const id = idSchema.parse((request.params as { id: string }).id); const input = attachmentRequestSchema.parse(request.body); const auth = request.auth;
    const ticket = await db.query("SELECT requester_id FROM tickets WHERE organization_id=$1 AND id=$2", [auth.organizationId, id]); if (!ticket.rows[0] || (auth.role === "requester" && ticket.rows[0].requester_id !== auth.userId)) throw httpError(404, "Ticket not found", "not_found");
    if (input.commentId) { const comment = await db.query("SELECT visibility FROM comments WHERE organization_id=$1 AND ticket_id=$2 AND id=$3", [auth.organizationId, id, input.commentId]); if (!comment.rows[0] || (auth.role === "requester" && comment.rows[0].visibility === "internal")) throw httpError(400, "Invalid comment", "invalid_comment"); }
    const attachmentId = crypto.randomUUID(); const objectKey = `${auth.organizationId}/${id}/${attachmentId}`;
    await db.query("INSERT INTO attachments(id,organization_id,ticket_id,comment_id,uploader_id,object_key,file_name,content_type,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [attachmentId, auth.organizationId, id, input.commentId ?? null, auth.userId, objectKey, input.fileName, input.contentType, input.sizeBytes]);
    const upload = await createPresignedPost(s3, { Bucket: bucket, Key: objectKey, Expires: 600, Conditions: [["content-length-range", input.sizeBytes, input.sizeBytes], ["eq", "$Content-Type", input.contentType]], Fields: { "Content-Type": input.contentType } });
    return reply.status(201).send({ attachmentId, upload });
  });
  app.post("/v1/attachments/:id/complete", { preHandler: authenticate }, async (request) => {
    const id = idSchema.parse((request.params as { id: string }).id); const auth = request.auth;
    const result = await db.query(`SELECT a.* FROM attachments a JOIN tickets t ON t.id=a.ticket_id AND t.organization_id=a.organization_id LEFT JOIN comments c ON c.id=a.comment_id AND c.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.id=$2 ${auth.role === "requester" ? "AND a.uploader_id=$3 AND t.requester_id=$3 AND (a.comment_id IS NULL OR c.visibility='public')" : ""}`, auth.role === "requester" ? [auth.organizationId, id, auth.userId] : [auth.organizationId, id]);
    const attachment = result.rows[0]; if (!attachment) throw httpError(404, "Attachment not found", "not_found");
    let head; try { head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: attachment.object_key })); } catch { throw httpError(409, "Upload is not present", "upload_incomplete"); }
    if (Number(head.ContentLength) !== Number(attachment.size_bytes) || head.ContentType !== attachment.content_type) throw httpError(409, "Uploaded object does not match allocation", "upload_mismatch");
    await db.query("UPDATE attachments SET state='available' WHERE organization_id=$1 AND id=$2", [auth.organizationId, id]); return { state: "available" };
  });
  app.get("/v1/attachments/:id/download", { preHandler: authenticate }, async (request) => {
    const id = idSchema.parse((request.params as { id: string }).id); const auth = request.auth;
    const result = await db.query(`SELECT a.* FROM attachments a JOIN tickets t ON t.id=a.ticket_id AND t.organization_id=a.organization_id LEFT JOIN comments c ON c.id=a.comment_id AND c.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.id=$2 AND a.state='available' ${auth.role === "requester" ? "AND t.requester_id=$3 AND (a.comment_id IS NULL OR c.visibility='public')" : ""}`, auth.role === "requester" ? [auth.organizationId, id, auth.userId] : [auth.organizationId, id]);
    const attachment = result.rows[0]; if (!attachment) throw httpError(404, "Attachment not found", "not_found");
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: attachment.object_key, ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}` }), { expiresIn: 300 }); return { url, expiresIn: 300 };
  });

  app.post("/v1/ticket-images", { preHandler: authenticate }, async (request, reply) => {
    const input = imageUploadSchema.parse(request.body); const auth = request.auth;
    const imageId = crypto.randomUUID(); const objectKey = `${auth.organizationId}/ticket-images/${imageId}`;
    await db.query("INSERT INTO ticket_images(id,organization_id,uploader_id,object_key,file_name,content_type,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)", [imageId, auth.organizationId, auth.userId, objectKey, input.fileName, input.contentType, input.sizeBytes]);
    const upload = await createPresignedPost(s3, { Bucket: bucket, Key: objectKey, Expires: 600, Conditions: [["content-length-range", input.sizeBytes, input.sizeBytes], ["eq", "$Content-Type", input.contentType]], Fields: { "Content-Type": input.contentType } });
    return reply.status(201).send({ imageId, upload });
  });
  app.post("/v1/ticket-images/:id/complete", { preHandler: authenticate }, async (request) => {
    const id = idSchema.parse((request.params as { id: string }).id); const auth = request.auth;
    const image = (await db.query("SELECT * FROM ticket_images WHERE organization_id=$1 AND id=$2 AND uploader_id=$3", [auth.organizationId, id, auth.userId])).rows[0]; if (!image) throw httpError(404, "Image not found", "not_found");
    let head; try { head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: image.object_key })); } catch { throw httpError(409, "Upload is not present", "upload_incomplete"); }
    if (Number(head.ContentLength) !== Number(image.size_bytes) || head.ContentType !== image.content_type) throw httpError(409, "Uploaded object does not match allocation", "upload_mismatch");
    await db.query("UPDATE ticket_images SET state='available' WHERE organization_id=$1 AND id=$2", [auth.organizationId, id]); return { state: "available" };
  });
  // Like knowledge images, checked from the session alone. Before its ticket or reply is saved only the uploader may
  // view it; afterwards anyone who can see the ticket may, except that images in internal notes stay with agents and admins.
  app.get("/v1/ticket-images/:id", async (request, reply) => {
    const id = idSchema.parse((request.params as { id: string }).id); const raw = request.cookies[SESSION_COOKIE]; if (!raw) throw httpError(401, "Not signed in", "unauthorized");
    const result = await db.query(`SELECT i.object_key,i.content_type FROM ticket_images i JOIN sessions s ON s.token_hash=$2 AND s.expires_at>now() JOIN memberships m ON m.organization_id=i.organization_id AND m.user_id=s.user_id LEFT JOIN tickets t ON t.organization_id=i.organization_id AND t.id=i.ticket_id LEFT JOIN comments c ON c.organization_id=i.organization_id AND c.id=i.comment_id WHERE i.id=$1 AND i.state='available' AND ((i.ticket_id IS NULL AND i.uploader_id=s.user_id) OR (t.id IS NOT NULL AND (m.role IN ('agent','admin') OR (t.requester_id=s.user_id AND (i.comment_id IS NULL OR c.visibility='public')))))`, [id, tokenHash(raw)]);
    const image = result.rows[0]; if (!image) throw httpError(404, "Image not found", "not_found");
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: image.object_key, ResponseContentType: image.content_type }), { expiresIn: 300 });
    return reply.header("cache-control", "private, max-age=240").header("cross-origin-resource-policy", "same-site").redirect(url, 302);
  });

  app.get("/v1/knowledge/articles", { preHandler: authenticate }, async (request) => {
    const q = request.query as Record<string, string | undefined>; const limit = Math.min(Math.max(Number(q.limit) || 25, 1), MAX_PAGE); const cursor = parseCursor(q.cursor);
    if (q.search && q.search.length > 200) throw httpError(400, "Search is too long", "validation_error");
    const values: unknown[] = [request.auth.organizationId]; const conditions = ["k.organization_id=$1"];
    if (q.search) { values.push(q.search); conditions.push(`to_tsvector('english',k.title||' '||k.body) @@ plainto_tsquery('english',$${values.length})`); }
    if (cursor) { values.push(cursor.createdAt, cursor.id); conditions.push(`(k.updated_at,k.id)<($${values.length - 1},$${values.length})`); }
    values.push(limit + 1);
    const result = await db.query(`SELECT k.id,k.title,left(k.body,300) excerpt,k.updated_at,u.display_name updated_by_name FROM knowledge_articles k JOIN users u ON u.id=k.updated_by WHERE ${conditions.join(" AND ")} ORDER BY k.updated_at DESC,k.id DESC LIMIT $${values.length}`, values);
    const hasMore = result.rows.length > limit; const items = result.rows.slice(0, limit); const last = items.at(-1);
    return { items, nextCursor: hasMore ? makeCursor({ created_at: last.updated_at, id: last.id }) : null };
  });
  app.get("/v1/knowledge/articles/:id", { preHandler: authenticate }, async (request) => {
    const id = idSchema.parse((request.params as { id: string }).id);
    const result = await db.query("SELECT k.*,a.display_name author_name,u.display_name updated_by_name FROM knowledge_articles k JOIN users a ON a.id=k.author_id JOIN users u ON u.id=k.updated_by WHERE k.organization_id=$1 AND k.id=$2", [request.auth.organizationId, id]);
    const article = result.rows[0]; if (!article) throw httpError(404, "Article not found", "not_found"); return article;
  });
  app.post("/v1/knowledge/articles", { preHandler: authenticate }, async (request, reply) => {
    requireAdmin(request); const input = createArticleSchema.parse(request.body); const auth = request.auth;
    const article = await transaction(db, async (client) => {
      const result = await client.query("INSERT INTO knowledge_articles(organization_id,title,body,author_id,updated_by) VALUES($1,$2,$3,$4,$4) RETURNING *", [auth.organizationId, input.title, input.body, auth.userId]); const row = result.rows[0];
      await client.query("INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data) VALUES($1,$2,'article.created','knowledge_article',$3,$4)", [auth.organizationId, auth.userId, row.id, JSON.stringify({ title: row.title })]); return row;
    }); return reply.status(201).send(article);
  });
  app.patch("/v1/knowledge/articles/:id", { preHandler: authenticate }, async (request) => {
    requireAdmin(request); const id = idSchema.parse((request.params as { id: string }).id); const input = updateArticleSchema.parse(request.body); const auth = request.auth;
    return transaction(db, async (client) => {
      const result = await client.query("UPDATE knowledge_articles SET title=$4,body=$5,updated_by=$6,version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND version=$3 RETURNING *", [auth.organizationId, id, input.version, input.title, input.body, auth.userId]); const row = result.rows[0];
      if (!row) { const exists = await client.query("SELECT 1 FROM knowledge_articles WHERE organization_id=$1 AND id=$2", [auth.organizationId, id]); throw httpError(exists.rowCount ? 409 : 404, exists.rowCount ? "Article was changed by another user" : "Article not found", exists.rowCount ? "version_conflict" : "not_found"); }
      await client.query("INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data) VALUES($1,$2,'article.updated','knowledge_article',$3,$4)", [auth.organizationId, auth.userId, id, JSON.stringify({ title: row.title, version: row.version })]); return row;
    });
  });
  app.post("/v1/knowledge/images", { preHandler: authenticate }, async (request, reply) => {
    requireAdmin(request); const input = imageUploadSchema.parse(request.body); const auth = request.auth;
    const imageId = crypto.randomUUID(); const objectKey = `${auth.organizationId}/knowledge/${imageId}`;
    await db.query("INSERT INTO knowledge_images(id,organization_id,uploader_id,object_key,file_name,content_type,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)", [imageId, auth.organizationId, auth.userId, objectKey, input.fileName, input.contentType, input.sizeBytes]);
    const upload = await createPresignedPost(s3, { Bucket: bucket, Key: objectKey, Expires: 600, Conditions: [["content-length-range", input.sizeBytes, input.sizeBytes], ["eq", "$Content-Type", input.contentType]], Fields: { "Content-Type": input.contentType } });
    return reply.status(201).send({ imageId, upload });
  });
  app.post("/v1/knowledge/images/:id/complete", { preHandler: authenticate }, async (request) => {
    requireAdmin(request); const id = idSchema.parse((request.params as { id: string }).id); const auth = request.auth;
    const image = (await db.query("SELECT * FROM knowledge_images WHERE organization_id=$1 AND id=$2", [auth.organizationId, id])).rows[0]; if (!image) throw httpError(404, "Image not found", "not_found");
    let head; try { head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: image.object_key })); } catch { throw httpError(409, "Upload is not present", "upload_incomplete"); }
    if (Number(head.ContentLength) !== Number(image.size_bytes) || head.ContentType !== image.content_type) throw httpError(409, "Uploaded object does not match allocation", "upload_mismatch");
    await db.query("UPDATE knowledge_images SET state='available' WHERE organization_id=$1 AND id=$2", [auth.organizationId, id]); return { state: "available" };
  });
  // <img> tags cannot send the organization header, so access is checked against the image's own organization.
  app.get("/v1/knowledge/images/:id", async (request, reply) => {
    const id = idSchema.parse((request.params as { id: string }).id); const raw = request.cookies[SESSION_COOKIE]; if (!raw) throw httpError(401, "Not signed in", "unauthorized");
    const result = await db.query("SELECT i.object_key,i.content_type FROM knowledge_images i JOIN memberships m ON m.organization_id=i.organization_id JOIN sessions s ON s.user_id=m.user_id WHERE i.id=$1 AND i.state='available' AND s.token_hash=$2 AND s.expires_at>now()", [id, tokenHash(raw)]);
    const image = result.rows[0]; if (!image) throw httpError(404, "Image not found", "not_found");
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: image.object_key, ResponseContentType: image.content_type }), { expiresIn: 300 });
    return reply.header("cache-control", "private, max-age=240").header("cross-origin-resource-policy", "same-site").redirect(url, 302);
  });
  return app;
}
