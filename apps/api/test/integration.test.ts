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
  it("lets only admins publish knowledge articles that stay inside the organization", async () => {
    const requesterHeaders = { cookie: acmeCookie, "x-csrf-token": acmeCsrf, "x-organization-id": acmeOrg };
    const denied = await app.inject({ method: "POST", url: "/v1/knowledge/articles", headers: requesterHeaders, payload: { title: "Requester article", body: "Not allowed" } });
    expect(denied.statusCode).toBe(403);
    const admin = await login("admin@acme.test");
    const adminHeaders = { cookie: admin.cookie, "x-csrf-token": admin.csrf, "x-organization-id": acmeOrg };
    const created = await app.inject({ method: "POST", url: "/v1/knowledge/articles", headers: adminHeaders, payload: { title: "Integration knowledge", body: "# Heading\n\nBody text" } });
    expect(created.statusCode).toBe(201);
    const { id, version } = created.json();
    const viewed = await app.inject({ method: "GET", url: `/v1/knowledge/articles/${id}`, headers: requesterHeaders });
    expect(viewed.statusCode).toBe(200);
    expect(viewed.json().body).toBe("# Heading\n\nBody text");
    const updated = await app.inject({ method: "PATCH", url: `/v1/knowledge/articles/${id}`, headers: adminHeaders, payload: { title: "Integration knowledge", body: "Updated", version } });
    expect(updated.statusCode).toBe(200);
    const stale = await app.inject({ method: "PATCH", url: `/v1/knowledge/articles/${id}`, headers: adminHeaders, payload: { title: "Integration knowledge", body: "Stale", version } });
    expect(stale.statusCode).toBe(409);
    const hidden = await app.inject({ method: "GET", url: `/v1/knowledge/articles/${id}`, headers: { cookie: globexCookie, "x-organization-id": globexOrg } });
    expect(hidden.statusCode).toBe(404);
  });
  it("lets only admins post announcements, hides ended ones from the banners, and keeps them inside the organization", async () => {
    const requesterHeaders = { cookie: acmeCookie, "x-csrf-token": acmeCsrf, "x-organization-id": acmeOrg };
    const payload = { kind: "incident", title: `Login outage ${crypto.randomUUID()}`, body: "We are investigating." };
    expect((await app.inject({ method: "POST", url: "/v1/announcements", headers: requesterHeaders, payload })).statusCode).toBe(403);
    const admin = await login("admin@acme.test");
    const adminHeaders = { cookie: admin.cookie, "x-csrf-token": admin.csrf, "x-organization-id": acmeOrg };
    const created = await app.inject({ method: "POST", url: "/v1/announcements", headers: adminHeaders, payload });
    expect(created.statusCode).toBe(201);
    const { id, version } = created.json();
    const active = async () => (await app.inject({ method: "GET", url: "/v1/announcements?active=true&limit=100", headers: requesterHeaders })).json().items.map((item: { id: string }) => item.id);
    expect(await active()).toContain(id);
    const ended = await app.inject({ method: "PATCH", url: `/v1/announcements/${id}`, headers: adminHeaders, payload: { ...payload, endsAt: new Date(Date.now() - 60_000).toISOString(), version } });
    expect(ended.statusCode).toBe(200);
    expect(await active()).not.toContain(id);
    const stale = await app.inject({ method: "PATCH", url: `/v1/announcements/${id}`, headers: adminHeaders, payload: { ...payload, version } });
    expect(stale.statusCode).toBe(409);
    const globex = (await app.inject({ method: "GET", url: "/v1/announcements?limit=100", headers: { cookie: globexCookie, "x-organization-id": globexOrg } })).json().items.map((item: { id: string }) => item.id);
    expect(globex).not.toContain(id);
    expect((await app.inject({ method: "DELETE", url: `/v1/announcements/${id}`, headers: { cookie: globexCookie, "x-csrf-token": globexCsrf, "x-organization-id": globexOrg } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/v1/announcements/${id}`, headers: adminHeaders })).statusCode).toBe(204);
  });
  it("counts tickets by status, only a requester's own for a requester", async () => {
    const requesterHeaders = { cookie: acmeCookie, "x-csrf-token": acmeCsrf, "x-organization-id": acmeOrg };
    const agent = await login("agent@acme.test");
    const agentHeaders = { cookie: agent.cookie, "x-organization-id": acmeOrg };
    const summary = async (headers: Record<string, string>) => (await app.inject({ method: "GET", url: "/v1/tickets/summary", headers })).json();
    const before = await summary(requesterHeaders);
    await app.inject({ method: "POST", url: "/v1/tickets", headers: requesterHeaders, payload: { title: "Summary count check", description: "Counts as open" } });
    const after = await summary(requesterHeaders);
    expect(after.total).toBe(before.total + 1);
    expect(after.byStatus.open).toBe(before.byStatus.open + 1);
    expect((await summary(agentHeaders)).total).toBeGreaterThanOrEqual(after.total);
  });
  it("keeps one homepage notice per organization that only admins can set or clear", async () => {
    const requesterHeaders = { cookie: acmeCookie, "x-csrf-token": acmeCsrf, "x-organization-id": acmeOrg };
    const admin = await login("admin@acme.test");
    const adminHeaders = { cookie: admin.cookie, "x-csrf-token": admin.csrf, "x-organization-id": acmeOrg };
    const read = async (headers: Record<string, string>) => (await app.inject({ method: "GET", url: "/v1/notice", headers })).json().notice;
    // The notice is a per-organization singleton, so keep whatever a developer has set locally and restore it afterwards.
    const existing = await read(adminHeaders);
    await app.inject({ method: "DELETE", url: "/v1/notice", headers: adminHeaders });
    expect(await read(requesterHeaders)).toBeNull();
    expect((await app.inject({ method: "PUT", url: "/v1/notice", headers: requesterHeaders, payload: { kind: "incident", message: "Not allowed" } })).statusCode).toBe(403);
    const created = await app.inject({ method: "PUT", url: "/v1/notice", headers: adminHeaders, payload: { kind: "incident", message: "Sign-in is failing" } });
    expect(created.statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: "/v1/notice", headers: adminHeaders, payload: { kind: "maintenance", message: "Second notice" } })).statusCode).toBe(409);
    const updated = await app.inject({ method: "PUT", url: "/v1/notice", headers: adminHeaders, payload: { kind: "released", message: "Fixed and released", version: created.json().version } });
    expect(updated.statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: "/v1/notice", headers: adminHeaders, payload: { kind: "incident", message: "Stale", version: created.json().version } })).statusCode).toBe(409);
    expect(await read(requesterHeaders)).toMatchObject({ kind: "released", message: "Fixed and released", updated_by_name: "Acme Admin" });
    expect(await read({ cookie: globexCookie, "x-organization-id": globexOrg })).toBeNull();
    expect((await app.inject({ method: "DELETE", url: "/v1/notice", headers: requesterHeaders })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: "/v1/notice", headers: adminHeaders })).statusCode).toBe(204);
    expect(await read(requesterHeaders)).toBeNull();
    if (existing) await app.inject({ method: "PUT", url: "/v1/notice", headers: adminHeaders, payload: { kind: existing.kind, message: existing.message } });
  });
  it("links ticket images to the new ticket and limits who can view them", async () => {
    const requesterHeaders = { cookie: acmeCookie, "x-csrf-token": acmeCsrf, "x-organization-id": acmeOrg };
    const db = (app as unknown as { db: { query: (sql: string, values: unknown[]) => Promise<unknown> } }).db;
    async function uploadedImage() {
      const allocated = await app.inject({ method: "POST", url: "/v1/ticket-images", headers: requesterHeaders, payload: { fileName: "screen.png", contentType: "image/png", sizeBytes: 1024 } });
      expect(allocated.statusCode).toBe(201);
      const { imageId } = allocated.json();
      // Stands in for the browser's direct S3 upload and the HeadObject check in /complete.
      await db.query("UPDATE ticket_images SET state='available' WHERE id=$1", [imageId]);
      return imageId as string;
    }
    const imageId = await uploadedImage();
    expect((await app.inject({ method: "GET", url: `/v1/ticket-images/${imageId}`, headers: { cookie: acmeCookie } })).statusCode).toBe(302);
    const agent = await login("agent@acme.test");
    expect((await app.inject({ method: "GET", url: `/v1/ticket-images/${imageId}`, headers: { cookie: agent.cookie } })).statusCode).toBe(404);

    const external = await app.inject({ method: "POST", url: "/v1/tickets", headers: requesterHeaders, payload: { title: "Tracking pixel", description: "![x](https://tracker.example/p.png)", descriptionFormat: "markdown" } });
    expect(external.statusCode).toBe(400);
    const created = await app.inject({ method: "POST", url: "/v1/tickets", headers: requesterHeaders, payload: { title: "Printer screenshot", description: `# Printer\n\n![screen](ticket-image:${imageId})`, descriptionFormat: "markdown" } });
    expect(created.statusCode).toBe(201);
    expect(created.json().description_format).toBe("markdown");
    expect((await app.inject({ method: "GET", url: `/v1/ticket-images/${imageId}`, headers: { cookie: agent.cookie } })).statusCode).toBe(302);
    expect((await app.inject({ method: "GET", url: `/v1/ticket-images/${imageId}`, headers: { cookie: globexCookie } })).statusCode).toBe(404);
    const reused = await app.inject({ method: "POST", url: "/v1/tickets", headers: requesterHeaders, payload: { title: "Reused image", description: `![screen](ticket-image:${imageId})`, descriptionFormat: "markdown" } });
    expect(reused.statusCode).toBe(400);
    const agentImage = await app.inject({ method: "POST", url: "/v1/tickets", headers: { cookie: agent.cookie, "x-csrf-token": agent.csrf, "x-organization-id": acmeOrg }, payload: { title: "Someone else's upload", description: `![screen](ticket-image:${await uploadedImage()})`, descriptionFormat: "markdown" } });
    expect(agentImage.statusCode).toBe(400);
    const plain = await app.inject({ method: "POST", url: "/v1/tickets", headers: requesterHeaders, payload: { title: "Plain text ticket", description: "Line one\nLine two" } });
    expect(plain.json().description_format).toBe("text");
  });
  it("keeps images in internal notes away from the requester", async () => {
    const requesterHeaders = { cookie: acmeCookie, "x-csrf-token": acmeCsrf, "x-organization-id": acmeOrg };
    const agent = await login("agent@acme.test");
    const agentHeaders = { cookie: agent.cookie, "x-csrf-token": agent.csrf, "x-organization-id": acmeOrg };
    const db = (app as unknown as { db: { query: (sql: string, values: unknown[]) => Promise<unknown> } }).db;
    async function uploadedImage(headers: Record<string, string>) {
      const allocated = await app.inject({ method: "POST", url: "/v1/ticket-images", headers, payload: { fileName: "shot.png", contentType: "image/png", sizeBytes: 512 } });
      const { imageId } = allocated.json();
      await db.query("UPDATE ticket_images SET state='available' WHERE id=$1", [imageId]);
      return imageId as string;
    }
    const ticket = (await app.inject({ method: "POST", url: "/v1/tickets", headers: requesterHeaders, payload: { title: "Reply images", description: "Body" } })).json();
    const noteImage = await uploadedImage(agentHeaders);
    const note = await app.inject({ method: "POST", url: `/v1/tickets/${ticket.id}/comments`, headers: agentHeaders, payload: { body: `Internal **note**\n\n![log](ticket-image:${noteImage})`, bodyFormat: "markdown", visibility: "internal" } });
    expect(note.statusCode).toBe(201);
    expect(note.json().body_format).toBe("markdown");
    expect((await app.inject({ method: "GET", url: `/v1/ticket-images/${noteImage}`, headers: { cookie: agent.cookie } })).statusCode).toBe(302);
    expect((await app.inject({ method: "GET", url: `/v1/ticket-images/${noteImage}`, headers: { cookie: acmeCookie } })).statusCode).toBe(404);
    const replyImage = await uploadedImage(requesterHeaders);
    const reply = await app.inject({ method: "POST", url: `/v1/tickets/${ticket.id}/comments`, headers: requesterHeaders, payload: { body: `![screen](ticket-image:${replyImage})`, bodyFormat: "markdown" } });
    expect(reply.statusCode).toBe(201);
    expect((await app.inject({ method: "GET", url: `/v1/ticket-images/${replyImage}`, headers: { cookie: agent.cookie } })).statusCode).toBe(302);
    expect((await app.inject({ method: "GET", url: `/v1/ticket-images/${replyImage}`, headers: { cookie: acmeCookie } })).statusCode).toBe(302);
    const external = await app.inject({ method: "POST", url: `/v1/tickets/${ticket.id}/comments`, headers: requesterHeaders, payload: { body: "![x](https://tracker.example/p.png)", bodyFormat: "markdown" } });
    expect(external.statusCode).toBe(400);
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
