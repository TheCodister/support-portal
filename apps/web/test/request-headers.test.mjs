import assert from "node:assert/strict";
import test from "node:test";
import { requestOptions } from "../app/request-headers.ts";

test("bodyless POSTs send an explicit empty JSON object", () => {
  assert.deepEqual(requestOptions({ method: "POST" }, "csrf", "org"), {
    method: "POST",
    body: "{}",
    headers: { "content-type": "application/json", "x-organization-id": "org", "x-csrf-token": "csrf" }
  });
});

test("bodyless DELETEs also send an explicit empty JSON object", () => {
  assert.deepEqual(requestOptions({ method: "DELETE" }, "csrf", "org"), {
    method: "DELETE",
    body: "{}",
    headers: { "content-type": "application/json", "x-organization-id": "org", "x-csrf-token": "csrf" }
  });
});

test("GET requests stay bodyless", () => {
  assert.deepEqual(requestOptions({}, "csrf", "org"), { body: undefined, headers: { "x-organization-id": "org" } });
});

test("JSON mutations declare their content type and retain caller headers", () => {
  assert.deepEqual(requestOptions({ method: "POST", body: "{}", headers: { "x-request-id": "test" } }, "csrf"), {
    method: "POST",
    body: "{}",
    headers: { "content-type": "application/json", "x-csrf-token": "csrf", "x-request-id": "test" }
  });
});
