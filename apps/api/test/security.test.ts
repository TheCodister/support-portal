import { describe, expect, it } from "vitest";
import { token, tokenHash, verifyPassword } from "../src/security.js";

describe("credential security", () => {
  it("hashes session tokens deterministically without storing the bearer token", () => {
    const session = token();
    expect(session).not.toEqual(tokenHash(session));
    expect(tokenHash(session)).toHaveLength(64);
    expect(tokenHash(session)).toEqual(tokenHash(session));
  });
  it("rejects malformed and incorrect password encodings", () => {
    expect(verifyPassword("anything", "bad-value")).toBe(false);
    expect(verifyPassword("wrong", "00:00")).toBe(false);
  });
});
