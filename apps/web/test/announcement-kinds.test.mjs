import assert from "node:assert/strict";
import test from "node:test";
import { dismissalKey, fromLocalInput, toLocalInput, visibleBanners } from "../app/announcement-kinds.ts";

const now = Date.parse("2026-10-10T12:00:00Z");
const item = (id, kind, extra = {}) => ({ id, kind, version: 1, ends_at: null, ...extra });

test("banners put incidents first, then maintenance, then news", () => {
  const items = [item("a", "news"), item("b", "maintenance"), item("c", "incident"), item("d", "news")];
  assert.deepEqual(visibleBanners(items, new Set(), now).map((value) => value.id), ["c", "b", "a", "d"]);
});

test("banners drop ended and dismissed announcements", () => {
  const items = [item("a", "news", { ends_at: "2026-10-10T11:59:00Z" }), item("b", "incident", { ends_at: "2026-10-10T13:00:00Z" }), item("c", "maintenance")];
  assert.deepEqual(visibleBanners(items, new Set([dismissalKey(items[2])]), now).map((value) => value.id), ["b"]);
});

test("an edited announcement shows again after being dismissed", () => {
  const dismissed = new Set([dismissalKey(item("a", "news"))]);
  assert.equal(visibleBanners([item("a", "news", { version: 2 })], dismissed, now).length, 1);
});

test("end times round-trip through the local datetime input", () => {
  const iso = new Date(2026, 9, 10, 18, 30).toISOString();
  assert.equal(toLocalInput(iso), "2026-10-10T18:30");
  assert.equal(fromLocalInput("2026-10-10T18:30"), iso);
  assert.equal(toLocalInput(null), "");
  assert.equal(fromLocalInput(""), null);
});
