import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

describe.runIf(process.env.RUN_INTEGRATION_TESTS === "true")("tenant and visibility boundaries", () => {
  let app: FastifyInstance;
  let acmeCookie = "", acmeCsrf = "", acmeOrg = "", globexCookie = "", globexCsrf = "", globexOrg = "", ticketId = "";
  async function login(email: string) {
    const response = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: "supportdesk-demo" } });
    expect(response.statusCode).toBe(200);
    const cookies = response.cookies;
    expect(cookies.find((value) => value.name === "supportdesk_csrf")?.httpOnly).toBe(true);
    expect(response.json().csrfToken).toBe(cookies.find((value) => value.name === "supportdesk_csrf")?.value);
    return { cookie: cookies.map((value) => `${value.name}=${value.value}`).join("; "), csrf: cookies.find((value) => value.name === "supportdesk_csrf")!.value, body: response.json() };
  }
  beforeAll(async () => {
    app = await buildApp();
    const acme = await login("requester@acme.test"); acmeCookie = acme.cookie; acmeCsrf = acme.csrf; acmeOrg = acme.body.memberships[0].organization_id;
    const globex = await login("admin@globex.test"); globexCookie = globex.cookie; globexCsrf = globex.csrf; globexOrg = globex.body.memberships[0].organization_id;
  });
  afterAll(async () => { await app.close(); });
  it("creates a ticket only inside the selected membership", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/tickets", headers: { cookie: acmeCookie, "x-csrf-token": acmeCsrf, "x-organization-id": acmeOrg }, payload: { title: "Integration boundary check", description: "This ticket belongs only to Acme.", priority: "normal" } });
    expect(response.statusCode).toBe(201); ticketId = response.json().id;
    const hidden = await app.inject({ method: "GET", url: `/v1/tickets/${ticketId}`, headers: { cookie: globexCookie, "x-csrf-token": globexCsrf, "x-organization-id": globexOrg } });
    expect(hidden.statusCode).toBe(404);
  });
  it("does not allow a requester to create an internal note", async () => {
    const response = await app.inject({ method: "POST", url: `/v1/tickets/${ticketId}/comments`, headers: { cookie: acmeCookie, "x-csrf-token": acmeCsrf, "x-organization-id": acmeOrg }, payload: { body: "Should not be accepted", visibility: "internal" } });
    expect(response.statusCode).toBe(403);
  });
  it("rejects a valid session paired with an unowned organization", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/tickets", headers: { cookie: acmeCookie, "x-organization-id": globexOrg } });
    expect(response.statusCode).toBe(403);
  });
  it("returns the CSRF token when restoring a session", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: acmeCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().csrfToken).toBe(acmeCsrf);
  });
  it("returns every matching ticket exactly once across cursor pages", async () => {
    const marker = `pagination${crypto.randomUUID().replaceAll("-", "")}`;
    const headers = { cookie: acmeCookie, "x-csrf-token": acmeCsrf, "x-organization-id": acmeOrg };
    const created: string[] = [];
    for (let index = 0; index < 3; index++) {
      const response = await app.inject({ method: "POST", url: "/v1/tickets", headers, payload: { title: `${marker} ticket ${index}`, description: "Cursor pagination test", priority: "normal" } });
      expect(response.statusCode).toBe(201);
      created.push(response.json().id);
    }
    const first = await app.inject({ method: "GET", url: `/v1/tickets?search=${marker}&limit=2`, headers });
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(2);
    expect(first.json().nextCursor).toBeTruthy();
    const second = await app.inject({ method: "GET", url: `/v1/tickets?search=${marker}&limit=2&cursor=${encodeURIComponent(first.json().nextCursor)}`, headers });
    expect(second.statusCode).toBe(200);
    expect(second.json().items).toHaveLength(1);
    expect(second.json().nextCursor).toBeNull();
    expect(new Set([...first.json().items, ...second.json().items].map((item: { id: string }) => item.id))).toEqual(new Set(created));
  });
});
