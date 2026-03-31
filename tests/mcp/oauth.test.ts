import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  deriveAccessToken,
  deriveRefreshToken,
  verifyPkce,
  verifyBearerToken,
} from "../../src/mcp/oauth.js";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ThoughtDatabase } from "../../src/db/database.js";
import { startHttpTransport } from "../../src/mcp/http-transport.js";

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

// =============================================================================
// HTTP Integration Tests
// =============================================================================

// ---- HTTP integration helpers ----

async function startTestServer(apiKey: string | null = "test-key-xyz") {
  const db = new ThoughtDatabase(":memory:");
  const server = await startHttpTransport(db, "127.0.0.1", 0, apiKey);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  return { db, server, base, port };
}

function stopServer(server: Server, db: ThoughtDatabase): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      db.close();
      resolve();
    });
  });
}

// ---- OAuth metadata ----

describe("GET /.well-known/oauth-authorization-server", () => {
  let server: Server;
  let db: ThoughtDatabase;
  let base: string;

  beforeEach(async () => {
    ({ server, db, base } = await startTestServer());
  });
  afterEach(() => stopServer(server, db));

  it("returns RFC 8414 metadata with correct shape", async () => {
    const res = await fetch(`${base}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.issuer).toBe(base);
    expect(body.authorization_endpoint).toBe(`${base}/authorize`);
    expect(body.token_endpoint).toBe(`${base}/token`);
    expect(body.registration_endpoint).toBe(`${base}/register`);
    expect(body.code_challenge_methods_supported).toContain("S256");
    expect(body.grant_types_supported).toContain("authorization_code");
    expect(body.grant_types_supported).toContain("refresh_token");
  });

  it("returns 503 when SHELBY_API_KEY is not set", async () => {
    const { server: s2, db: db2, base: base2 } = await startTestServer(null);
    const res = await fetch(`${base2}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(503);
    await stopServer(s2, db2);
  });
});

// ---- Dynamic client registration ----

describe("POST /register", () => {
  let server: Server;
  let db: ThoughtDatabase;
  let base: string;

  beforeEach(async () => {
    ({ server, db, base } = await startTestServer());
  });
  afterEach(() => stopServer(server, db));

  it("registers a client and returns client_id", async () => {
    const res = await fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.client_id).toBe("string");
    expect(body.redirect_uris).toContain("https://claude.ai/api/mcp/auth_callback");
  });

  it("persists client in DB", async () => {
    await fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "TestClient",
        redirect_uris: ["https://example.com/callback"],
      }),
    });
    const row = db.db
      .prepare("SELECT COUNT(*) as n FROM oauth_clients")
      .get() as { n: number };
    expect(row.n).toBe(1);
  });

  it("returns 400 if redirect_uris is missing", async () => {
    const res = await fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Bad" }),
    });
    expect(res.status).toBe(400);
  });
});

// ---- /authorize (GET renders form) ----

describe("GET /authorize", () => {
  let server: Server;
  let db: ThoughtDatabase;
  let base: string;
  let clientId: string;

  beforeEach(async () => {
    ({ server, db, base } = await startTestServer());
    const reg = await fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      }),
    });
    clientId = ((await reg.json()) as Record<string, string>).client_id;
  });
  afterEach(() => stopServer(server, db));

  function authorizeUrl(overrides: Record<string, string> = {}) {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_challenge: "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
      code_challenge_method: "S256",
      state: "csrf-state-abc",
      ...overrides,
    });
    return `${base}/authorize?${params}`;
  }

  it("renders an HTML form", async () => {
    const res = await fetch(authorizeUrl());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<form");
    expect(html).toContain("api_key");
  });

  it("returns 400 for unknown client_id", async () => {
    const res = await fetch(authorizeUrl({ client_id: "unknown-client" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for mismatched redirect_uri", async () => {
    const res = await fetch(authorizeUrl({ redirect_uri: "https://evil.com/cb" }));
    expect(res.status).toBe(400);
  });
});

// ---- /authorize (POST — form submission) ----

describe("POST /authorize", () => {
  let server: Server;
  let db: ThoughtDatabase;
  let base: string;
  let clientId: string;

  beforeEach(async () => {
    ({ server, db, base } = await startTestServer("my-secret-key"));
    const reg = await fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      }),
    });
    clientId = ((await reg.json()) as Record<string, string>).client_id;
  });
  afterEach(() => stopServer(server, db));

  async function submitAuthorize(apiKey: string) {
    const body = new URLSearchParams({
      client_id: clientId,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_challenge: "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
      state: "csrf-xyz",
      api_key: apiKey,
    });
    return fetch(`${base}/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      redirect: "manual",
    });
  }

  it("redirects to callback with code on correct API key", async () => {
    const res = await submitAuthorize("my-secret-key");
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("https://claude.ai/api/mcp/auth_callback");
    expect(location).toContain("code=");
    expect(location).toContain("state=csrf-xyz");
  });

  it("re-renders form with error on wrong API key", async () => {
    const res = await submitAuthorize("wrong-key");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Incorrect API key");
  });
});

// ---- /token ----

describe("POST /token", () => {
  let server: Server;
  let db: ThoughtDatabase;
  let base: string;
  let clientId: string;

  const API_KEY = "my-secret-key";
  const CODE_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

  async function getCodeChallenge() {
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(CODE_VERIFIER).digest("base64url");
  }

  async function getAuthCode(): Promise<string> {
    const codeChallenge = await getCodeChallenge();
    const body = new URLSearchParams({
      client_id: clientId,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_challenge: codeChallenge,
      state: "s",
      api_key: API_KEY,
    });
    const res = await fetch(`${base}/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      redirect: "manual",
    });
    const location = res.headers.get("location") ?? "";
    const url = new URL(location);
    return url.searchParams.get("code") ?? "";
  }

  beforeEach(async () => {
    ({ server, db, base } = await startTestServer(API_KEY));
    const reg = await fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      }),
    });
    clientId = ((await reg.json()) as Record<string, string>).client_id;
  });
  afterEach(() => stopServer(server, db));

  it("exchanges authorization_code for tokens", async () => {
    const code = await getAuthCode();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      code_verifier: CODE_VERIFIER,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    });
    const res = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.token_type).toBe("Bearer");
    expect(typeof json.access_token).toBe("string");
    expect(typeof json.refresh_token).toBe("string");
  });

  it("rejects an already-used authorization code", async () => {
    const code = await getAuthCode();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      code_verifier: CODE_VERIFIER,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    });
    const bodyStr = body.toString();
    await fetch(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: bodyStr,
    });
    const res2 = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: bodyStr,
    });
    expect(res2.status).toBe(400);
    const json = await res2.json() as Record<string, unknown>;
    expect(json.error).toBe("invalid_grant");
  });

  it("rejects a tampered PKCE verifier", async () => {
    const code = await getAuthCode();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      code_verifier: "tampered-verifier-string",
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    });
    const res = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe("invalid_grant");
  });

  it("exchanges refresh_token for new access token", async () => {
    const code = await getAuthCode();
    const codeBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      code_verifier: CODE_VERIFIER,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    });
    const codeRes = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: codeBody.toString(),
    });
    const { refresh_token } = await codeRes.json() as { refresh_token: string };

    const refreshBody = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token,
      client_id: clientId,
    });
    const res = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: refreshBody.toString(),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.token_type).toBe("Bearer");
    expect(typeof json.access_token).toBe("string");
  });
});

// ---- Backward compat: raw SHELBY_API_KEY ----

describe("Bearer token backward compat", () => {
  let server: Server;
  let db: ThoughtDatabase;
  let base: string;

  beforeEach(async () => {
    ({ server, db, base } = await startTestServer("raw-api-key"));
  });
  afterEach(() => stopServer(server, db));

  it("accepts raw SHELBY_API_KEY as Bearer token on /mcp", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer raw-api-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
        id: 1,
      }),
    });
    expect(res.status).not.toBe(401);
  });

  it("rejects unknown Bearer token on /mcp", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer wrong-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", params: {}, id: 1 }),
    });
    expect(res.status).toBe(401);
  });
});

// ---- Rate limiting ----

describe("Rate limiting on POST /authorize", () => {
  let server: Server;
  let db: ThoughtDatabase;
  let base: string;
  let clientId: string;

  beforeEach(async () => {
    ({ server, db, base } = await startTestServer("rate-limit-key"));
    const reg = await fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Test",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      }),
    });
    clientId = ((await reg.json()) as Record<string, string>).client_id;
  });
  afterEach(() => stopServer(server, db));

  it("blocks after 5 failed attempts", async () => {
    const body = new URLSearchParams({
      client_id: clientId,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_challenge: "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
      state: "s",
      api_key: "wrong-key",
    });
    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    };
    for (let i = 0; i < 5; i++) {
      await fetch(`${base}/authorize`, opts);
    }
    const res = await fetch(`${base}/authorize`, opts);
    expect(res.status).toBe(429);
  });
});
