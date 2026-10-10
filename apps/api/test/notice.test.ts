import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Database } from "@supportdesk/database";
import { buildApp } from "../src/app.js";

describe("homepage notice", () => {
  let app: FastifyInstance;
  let role = "admin";
  let written: Record<string, unknown> | undefined;
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const notice = { organization_id: organizationId, kind: "incident", message: "Sign-in is failing for some users.", version: 1 };
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT s.user_id, m.role")) return { rows: [{ user_id: userId, role }] };
    if (sql.startsWith("INSERT INTO organization_notices") || sql.startsWith("UPDATE organization_notices")) return { rows: written ? [written] : [] };
    if (sql.startsWith("DELETE FROM organization_notices")) return { rows: written ? [written] : [] };
    return { rows: [], rowCount: 1 };
  });
  const db = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Database;
  const s3 = { config: {} } as unknown as S3Client;
  const headers = { cookie: "supportdesk_session=session; supportdesk_csrf=csrf", "x-csrf-token": "csrf", "x-organization-id": organizationId };
  const payload = { kind: "incident", message: "Sign-in is failing for some users." };

  beforeAll(async () => { app = await buildApp({ db, s3 }); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { role = "admin"; written = notice; query.mockClear(); });

  it.each(["requester", "agent"])("does not let a %s set or clear the notice", async (value) => {
    role = value;
    expect((await app.inject({ method: "PUT", url: "/v1/notice", headers, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: "/v1/notice", headers })).statusCode).toBe(403);
  });

  it("requires a CSRF token to set the notice", async () => {
    const response = await app.inject({ method: "PUT", url: "/v1/notice", headers: { ...headers, "x-csrf-token": "wrong" }, payload });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("csrf_invalid");
  });

  it("lets an admin set the notice and records an audit event", async () => {
    const response = await app.inject({ method: "PUT", url: "/v1/notice", headers, payload });
    expect(response.statusCode).toBe(200);
    expect(response.json().kind).toBe("incident");
    expect(query.mock.calls.some(([sql]) => sql.includes("'notice.set'"))).toBe(true);
  });

  it("returns 409 when the notice changed since it was loaded", async () => {
    written = undefined;
    const response = await app.inject({ method: "PUT", url: "/v1/notice", headers, payload: { ...payload, version: 1 } });
    expect(response.statusCode).toBe(409);
  });

  it("rejects announcement kinds that notices do not use", async () => {
    expect((await app.inject({ method: "PUT", url: "/v1/notice", headers, payload: { ...payload, kind: "news" } })).statusCode).toBe(400);
  });

  it("lets an admin clear the notice", async () => {
    expect((await app.inject({ method: "DELETE", url: "/v1/notice", headers })).statusCode).toBe(204);
    expect(query.mock.calls.some(([sql]) => sql.includes("'notice.cleared'"))).toBe(true);
    written = undefined;
    expect((await app.inject({ method: "DELETE", url: "/v1/notice", headers })).statusCode).toBe(404);
  });
});
