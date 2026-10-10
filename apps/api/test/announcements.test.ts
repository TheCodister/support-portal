import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Database } from "@supportdesk/database";
import { buildApp } from "../src/app.js";

describe("announcement permissions", () => {
  let app: FastifyInstance;
  let role = "admin";
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const announcement = { id: crypto.randomUUID(), organization_id: organizationId, kind: "maintenance", title: "Database upgrade", body: "Expect a short outage.", ends_at: null, version: 1 };
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT s.user_id, m.role")) return { rows: [{ user_id: userId, role }] };
    if (sql.startsWith("INSERT INTO announcements")) return { rows: [announcement] };
    if (sql.startsWith("DELETE FROM announcements")) return { rows: [announcement], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const db = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Database;
  const s3 = { config: {} } as unknown as S3Client;
  const headers = { cookie: "supportdesk_session=session; supportdesk_csrf=csrf", "x-csrf-token": "csrf", "x-organization-id": organizationId };
  const payload = { kind: "maintenance", title: "Database upgrade", body: "Expect a short outage." };

  beforeAll(async () => { app = await buildApp({ db, s3 }); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { role = "admin"; query.mockClear(); });

  it.each(["requester", "agent"])("rejects announcements from a %s", async (value) => {
    role = value;
    const created = await app.inject({ method: "POST", url: "/v1/announcements", headers, payload });
    expect(created.statusCode).toBe(403);
    const edited = await app.inject({ method: "PATCH", url: `/v1/announcements/${announcement.id}`, headers, payload: { ...payload, version: 1 } });
    expect(edited.statusCode).toBe(403);
    const deleted = await app.inject({ method: "DELETE", url: `/v1/announcements/${announcement.id}`, headers });
    expect(deleted.statusCode).toBe(403);
  });

  it("lets an admin post an announcement and records an audit event", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/announcements", headers, payload });
    expect(response.statusCode).toBe(201);
    expect(response.json().id).toBe(announcement.id);
    expect(query.mock.calls.some(([sql]) => sql.includes("'announcement.created'"))).toBe(true);
  });

  it("rejects an unknown kind and an end time without a timezone", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/announcements", headers, payload: { ...payload, kind: "party" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/announcements", headers, payload: { ...payload, endsAt: "2026-10-10T10:00" } })).statusCode).toBe(400);
  });

  it("lets an admin delete an announcement and records an audit event", async () => {
    const response = await app.inject({ method: "DELETE", url: `/v1/announcements/${announcement.id}`, headers });
    expect(response.statusCode).toBe(204);
    expect(query.mock.calls.some(([sql]) => sql.includes("'announcement.deleted'"))).toBe(true);
  });

  it("filters to unexpired announcements for the banners", async () => {
    role = "requester";
    const response = await app.inject({ method: "GET", url: "/v1/announcements?active=true", headers });
    expect(response.statusCode).toBe(200);
    expect(query.mock.calls.some(([sql]) => sql.includes("FROM announcements") && sql.includes("n.ends_at>now()"))).toBe(true);
  });
});
