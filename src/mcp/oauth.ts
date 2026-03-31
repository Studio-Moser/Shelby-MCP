import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ThoughtDatabase } from "../db/database.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthCode {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  state: string;
  expiresAt: number;
}

interface OAuthClient {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
}

// ---------------------------------------------------------------------------
// Pure functions (exported for testing)
// ---------------------------------------------------------------------------

export function deriveAccessToken(apiKey: string): string {
  return createHmac("sha256", apiKey).update("access").digest("hex");
}

export function deriveRefreshToken(apiKey: string): string {
  return createHmac("sha256", apiKey).update("refresh").digest("hex");
}

export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  return computed === codeChallenge;
}

export function verifyBearerToken(token: string, apiKey: string): boolean {
  return safeEqual(token, apiKey) || safeEqual(token, deriveAccessToken(apiKey));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function renderAuthorizeForm(params: {
  clientName: string;
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  state: string;
  error?: string;
}): string {
  const { clientName, clientId, codeChallenge, redirectUri, state, error } = params;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shelby — Authorize</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d0d0d; color: #e5e5e5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
    }
    .card {
      background: #161616; border: 1px solid #272727; border-radius: 16px;
      padding: 40px; width: 100%; max-width: 420px;
    }
    .wordmark { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 6px; }
    .tagline { color: #666; font-size: 13px; margin-bottom: 32px; }
    .client { font-weight: 600; color: #e5e5e5; }
    label { display: block; font-size: 12px; font-weight: 500; color: #888; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
    input[type="password"] {
      display: block; width: 100%; background: #0d0d0d; border: 1px solid #2a2a2a;
      border-radius: 10px; padding: 12px 16px; color: #e5e5e5; font-size: 15px; outline: none;
    }
    input[type="password"]:focus { border-color: #444; }
    .error { color: #f87171; font-size: 13px; margin-top: 10px; }
    button {
      display: block; width: 100%; margin-top: 24px; background: #e5e5e5; color: #0d0d0d;
      border: none; border-radius: 10px; padding: 13px; font-size: 15px; font-weight: 600; cursor: pointer;
    }
    button:hover { background: #d0d0d0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="wordmark">Shelby</div>
    <div class="tagline">
      <span class="client">${escHtml(clientName)}</span> is requesting access to your memory.
    </div>
    <form method="POST">
      <input type="hidden" name="client_id" value="${escHtml(clientId)}">
      <input type="hidden" name="code_challenge" value="${escHtml(codeChallenge)}">
      <input type="hidden" name="redirect_uri" value="${escHtml(redirectUri)}">
      <input type="hidden" name="state" value="${escHtml(state)}">
      <label for="api_key">API Key</label>
      <input type="password" id="api_key" name="api_key"
        placeholder="Enter your Shelby API key" autofocus required>
      ${error ? `<div class="error">${escHtml(error)}</div>` : ""}
      <button type="submit">Approve</button>
    </form>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function getClient(db: ThoughtDatabase, clientId: string): OAuthClient | null {
  const row = db.db
    .prepare("SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = ?")
    .get(clientId) as { client_id: string; client_name: string | null; redirect_uris: string } | undefined;
  if (!row) return null;
  return {
    client_id: row.client_id,
    client_name: row.client_name,
    redirect_uris: JSON.parse(row.redirect_uris) as string[],
  };
}

function saveClient(db: ThoughtDatabase, client: OAuthClient): void {
  db.db
    .prepare(
      "INSERT INTO oauth_clients (client_id, client_name, redirect_uris, registered_at) VALUES (?, ?, ?, ?)",
    )
    .run(client.client_id, client.client_name, JSON.stringify(client.redirect_uris), Date.now());
}

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

function checkRateLimit(rateLimiter: Map<string, { attempts: number; resetAt: number }>, ip: string): boolean {
  const now = Date.now();
  const entry = rateLimiter.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimiter.set(ip, { attempts: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.attempts >= RATE_LIMIT_MAX) return false;
  entry.attempts++;
  return true;
}

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function parseFormBody(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body).entries());
}

function getBaseUrl(req: IncomingMessage): string {
  const proto = (req.headers["x-forwarded-proto"] as string) ?? "http";
  const host = req.headers.host ?? "localhost";
  return `${proto}://${host}`;
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createOAuthHandlers(
  db: ThoughtDatabase,
  apiKey: string,
): {
  handleMetadata: (req: IncomingMessage, res: ServerResponse) => void;
  handleRegister: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  handleAuthorize: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  handleToken: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} {
  // Per-instance state (avoids test bleed)
  const authCodes = new Map<string, AuthCode>();
  const rateLimiter = new Map<string, { attempts: number; resetAt: number }>();

  // -- handleMetadata --
  function handleMetadata(req: IncomingMessage, res: ServerResponse): void {
    const base = getBaseUrl(req);
    const metadata = {
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(metadata));
  }

  // -- handleRegister --
  async function handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_request", error_description: "Invalid JSON" }));
      return;
    }

    const redirectUris = parsed.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_request", error_description: "redirect_uris required" }));
      return;
    }

    const client: OAuthClient = {
      client_id: randomUUID(),
      client_name: typeof parsed.client_name === "string" ? parsed.client_name : null,
      redirect_uris: redirectUris as string[],
    };
    saveClient(db, client);

    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }));
  }

  // -- handleAuthorize --
  async function handleAuthorize(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "GET") {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const clientId = url.searchParams.get("client_id") ?? "";
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      const codeChallenge = url.searchParams.get("code_challenge") ?? "";
      const state = url.searchParams.get("state") ?? "";

      const client = getClient(db, clientId);
      if (!client) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_client", error_description: "Unknown client_id" }));
        return;
      }
      if (!client.redirect_uris.includes(redirectUri)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request", error_description: "redirect_uri mismatch" }));
        return;
      }

      const html = renderAuthorizeForm({
        clientName: client.client_name ?? "Unknown Client",
        clientId,
        codeChallenge,
        redirectUri,
        state,
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "POST") {
      const ip = req.socket.remoteAddress ?? "unknown";
      if (!checkRateLimit(rateLimiter, ip)) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "too_many_requests", error_description: "Too many failed attempts" }));
        return;
      }

      const rawBody = await readBody(req);
      const form = parseFormBody(rawBody);
      const clientId = form.client_id ?? "";
      const redirectUri = form.redirect_uri ?? "";
      const codeChallenge = form.code_challenge ?? "";
      const state = form.state ?? "";
      const submittedKey = form.api_key ?? "";

      const client = getClient(db, clientId);
      if (!client || !client.redirect_uris.includes(redirectUri)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
        return;
      }

      if (submittedKey !== apiKey) {
        const html = renderAuthorizeForm({
          clientName: client.client_name ?? "Unknown Client",
          clientId,
          codeChallenge,
          redirectUri,
          state,
          error: "Incorrect API key",
        });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      const code = randomUUID();
      authCodes.set(code, {
        clientId,
        codeChallenge,
        redirectUri,
        state,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set("code", code);
      callbackUrl.searchParams.set("state", state);

      res.writeHead(302, { Location: callbackUrl.toString() });
      res.end();
      return;
    }

    res.writeHead(405);
    res.end();
  }

  // -- handleToken --
  async function handleToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawBody = await readBody(req);
    const form = parseFormBody(rawBody);
    const grantType = form.grant_type;

    if (grantType === "authorization_code") {
      const code = form.code ?? "";
      const clientId = form.client_id ?? "";
      const codeVerifier = form.code_verifier ?? "";
      const redirectUri = form.redirect_uri ?? "";

      const stored = authCodes.get(code);
      if (!stored || stored.clientId !== clientId || stored.redirectUri !== redirectUri) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant", error_description: "Invalid or expired code" }));
        return;
      }
      if (Date.now() > stored.expiresAt) {
        authCodes.delete(code);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant", error_description: "Code expired" }));
        return;
      }
      if (!verifyPkce(codeVerifier, stored.codeChallenge)) {
        authCodes.delete(code);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant", error_description: "PKCE verification failed" }));
        return;
      }

      authCodes.delete(code);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        access_token: deriveAccessToken(apiKey),
        token_type: "Bearer",
        refresh_token: deriveRefreshToken(apiKey),
      }));
      return;
    }

    if (grantType === "refresh_token") {
      const refreshToken = form.refresh_token ?? "";
      const clientId = form.client_id ?? "";
      const expectedRefresh = deriveRefreshToken(apiKey);

      if (!safeEqual(refreshToken, expectedRefresh)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant", error_description: "Invalid refresh token" }));
        return;
      }

      const client = getClient(db, clientId);
      if (!client) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_client" }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        access_token: deriveAccessToken(apiKey),
        token_type: "Bearer",
        refresh_token: deriveRefreshToken(apiKey),
      }));
      return;
    }

    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unsupported_grant_type" }));
  }

  return { handleMetadata, handleRegister, handleAuthorize, handleToken };
}
