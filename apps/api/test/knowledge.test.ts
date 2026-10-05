import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Database } from "@supportdesk/database";
import { buildApp } from "../src/app.js";

describe("knowledge article permissions", () => {
  let app: FastifyInstance;
  let role = "admin";
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const article = { id: crypto.randomUUID(), organization_id: organizationId, title: "Reset a password", body: "# Reset\n\nSteps", version: 1 };
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT s.user_id, m.role")) return { rows: [{ user_id: userId, role }] };
    if (sql.startsWith("INSERT INTO knowledge_articles")) return { rows: [article] };
    if (sql.startsWith("SELECT i.object_key")) return { rows: [{ object_key: `${organizationId}/knowledge/image`, content_type: "image/png" }] };
    return { rows: [], rowCount: 1 };
  });
  const db = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Database;
  const s3 = { config: {} } as unknown as S3Client;
  const headers = { cookie: "supportdesk_session=session; supportdesk_csrf=csrf", "x-csrf-token": "csrf", "x-organization-id": organizationId };

  beforeAll(async () => { app = await buildApp({ db, s3 }); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { role = "admin"; });

  it.each(["requester", "agent"])("rejects article creation by a %s", async (value) => {
    role = value;
    const response = await app.inject({ method: "POST", url: "/v1/knowledge/articles", headers, payload: { title: "Reset a password", body: "Steps" } });
    expect(response.statusCode).toBe(403);
  });

  it("lets an admin create an article and records an audit event", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/knowledge/articles", headers, payload: { title: "Reset a password", body: "# Reset\n\nSteps" } });
    expect(response.statusCode).toBe(201);
    expect(response.json().id).toBe(article.id);
    expect(query.mock.calls.some(([sql]) => sql.includes("'article.created'"))).toBe(true);
  });

  it("rejects article edits by non-admins before touching the article", async () => {
    role = "agent";
    const response = await app.inject({ method: "PATCH", url: `/v1/knowledge/articles/${article.id}`, headers, payload: { title: "Changed", body: "", version: 1 } });
    expect(response.statusCode).toBe(403);
  });

  it("only accepts raster image uploads", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/knowledge/images", headers, payload: { fileName: "logo.svg", contentType: "image/svg+xml", sizeBytes: 100 } });
    expect(response.statusCode).toBe(400);
  });

  it("requires a session to view an image", async () => {
    const response = await app.inject({ method: "GET", url: `/v1/knowledge/images/${crypto.randomUUID()}` });
    expect(response.statusCode).toBe(401);
  });
});
