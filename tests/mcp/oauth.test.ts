import { describe, it, expect } from "vitest";
import {
  deriveAccessToken,
  deriveRefreshToken,
  verifyPkce,
  verifyBearerToken,
} from "../../src/mcp/oauth.js";

const API_KEY = "test-api-key-abc123";

describe("deriveAccessToken", () => {
  it("returns a hex string", () => {
    const token = deriveAccessToken(API_KEY);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same key", () => {
    expect(deriveAccessToken(API_KEY)).toBe(deriveAccessToken(API_KEY));
  });

  it("differs from refresh token", () => {
    expect(deriveAccessToken(API_KEY)).not.toBe(deriveRefreshToken(API_KEY));
  });

  it("changes when API key changes", () => {
    expect(deriveAccessToken(API_KEY)).not.toBe(deriveAccessToken("other-key"));
  });
});

describe("deriveRefreshToken", () => {
  it("returns a hex string", () => {
    expect(deriveRefreshToken(API_KEY)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifyPkce", () => {
  it("accepts a valid S256 code verifier", async () => {
    const { createHash } = await import("node:crypto");
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it("rejects a tampered code verifier", async () => {
    const { createHash } = await import("node:crypto");
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(verifyPkce("tampered-verifier", challenge)).toBe(false);
  });
});

describe("verifyBearerToken", () => {
  it("accepts the raw SHELBY_API_KEY (legacy)", () => {
    expect(verifyBearerToken(API_KEY, API_KEY)).toBe(true);
  });

  it("accepts a valid HMAC-derived access token", () => {
    const token = deriveAccessToken(API_KEY);
    expect(verifyBearerToken(token, API_KEY)).toBe(true);
  });

  it("rejects an unknown token", () => {
    expect(verifyBearerToken("garbage-token", API_KEY)).toBe(false);
  });

  it("rejects a token from a different API key", () => {
    const token = deriveAccessToken("other-key");
    expect(verifyBearerToken(token, API_KEY)).toBe(false);
  });
});
