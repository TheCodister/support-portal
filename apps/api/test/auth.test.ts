import { scryptSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Database } from "@supportdesk/database";
import { buildApp } from "../src/app.js";

describe("cross-origin authentication contract", () => {
  let app: FastifyInstance;
  const password = "supportdesk-demo";
  const salt = "test-salt";
  const passwordHash = `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
  const user = { id: crypto.randomUUID(), email: "admin@acme.test", display_name: "Acme Admin", password_hash: passwordHash };
  const membership = { organization_id: crypto.randomUUID(), name: "Acme", role: "admin" };
  const db = { query: vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT id,email,display_name,password_hash")) return { rows: [user] };
    if (sql.startsWith("SELECT u.id,u.email,u.display_name")) return { rows: [user] };
    if (sql.startsWith("SELECT m.organization_id,o.name,m.role")) return { rows: [membership] };
    return { rows: [], rowCount: 1 };
  }) } as unknown as Database;

  beforeAll(async () => { app = await buildApp({ db }); });
  afterAll(async () => { await app.close(); });

  it("returns a CSRF token in the login body while keeping its cookie HttpOnly", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: user.email, password } });
    expect(response.statusCode).toBe(200);
    const csrfCookie = response.cookies.find((cookie) => cookie.name === "supportdesk_csrf");
    expect(csrfCookie?.httpOnly).toBe(true);
    expect(response.json().csrfToken).toBe(csrfCookie?.value);
  });

  it("returns the cookie token on session restoration and can replace a missing CSRF cookie", async () => {
    const sessionCookie = "supportdesk_session=existing-session";
    const existing = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: `${sessionCookie}; supportdesk_csrf=existing-csrf` } });
    expect(existing.statusCode).toBe(200);
    expect(existing.json().csrfToken).toBe("existing-csrf");
    const missing = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: sessionCookie } });
    expect(missing.statusCode).toBe(200);
    expect(missing.cookies.find((cookie) => cookie.name === "supportdesk_csrf")?.httpOnly).toBe(true);
    expect(missing.json().csrfToken).toBe(missing.cookies.find((cookie) => cookie.name === "supportdesk_csrf")?.value);
  });
});
