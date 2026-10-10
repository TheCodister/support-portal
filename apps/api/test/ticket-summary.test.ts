import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Database } from "@supportdesk/database";
import { buildApp } from "../src/app.js";

describe("ticket summary", () => {
  let app: FastifyInstance;
  let role = "agent";
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (sql.startsWith("SELECT s.user_id, m.role")) return { rows: [{ user_id: userId, role }] };
    if (sql.startsWith("SELECT status,count(*)")) return { rows: [{ status: "open", count: 3 }, { status: "waiting", count: 9 }, { status: "closed", count: 2 }] };
    return { rows: [], rowCount: 0 };
  });
  const db = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Database;
  const s3 = { config: {} } as unknown as S3Client;
  const headers = { cookie: "supportdesk_session=session", "x-organization-id": organizationId };

  beforeAll(async () => { app = await buildApp({ db, s3 }); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { role = "agent"; query.mockClear(); });

  it("totals every status, including ones with no tickets", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/tickets/summary", headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ total: 14, byStatus: { open: 3, in_progress: 0, waiting: 9, closed: 2 } });
  });

  it("counts only a requester's own tickets", async () => {
    role = "requester";
    await app.inject({ method: "GET", url: "/v1/tickets/summary", headers });
    const call = query.mock.calls.find(([sql]) => sql.startsWith("SELECT status,count(*)"));
    expect(call?.[0]).toContain("requester_id=$2");
    expect(call?.[1]).toEqual([organizationId, userId]);
  });
});
