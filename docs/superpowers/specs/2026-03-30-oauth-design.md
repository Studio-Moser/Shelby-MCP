# OAuth 2.1 Authorization Code + PKCE — Design Spec

**Date:** 2026-03-30
**Status:** Approved
**Goal:** Enable Claude Desktop (and any OAuth 2.1 client) to connect to a cloud-hosted ShelbyMCP instance without manually configuring Bearer tokens.

---

## Problem

Claude Desktop's "Add custom connector" dialog drives an OAuth 2.1 Authorization Code + PKCE flow. ShelbyMCP currently only supports static Bearer token auth (`SHELBY_API_KEY`), which Claude Desktop has no way to send. Claude Code users are unaffected — they pass the token via `--header`.

---

## Approach

Implement a self-contained OAuth 2.1 authorization server inside ShelbyMCP. No external dependencies. The `SHELBY_API_KEY` remains the root credential — the OAuth flow is a standardized handshake that proves the user knows it and exchanges it for a client-specific access token.

Access tokens are **deterministic HMAC-SHA256 derivations** of the API key — no token storage required, instant revocation on key rotation.

---

## OAuth Flow (Claude Desktop)

1. Claude Desktop hits `GET /.well-known/oauth-authorization-server` to discover endpoints
2. Claude Desktop registers itself at `POST /register` (dynamic client registration, RFC 7591) — gets back a `client_id`
3. Claude Desktop opens a browser to `GET /authorize?client_id=...&code_challenge=...&redirect_uri=https://claude.ai/api/mcp/auth_callback&state=...`
4. User sees a branded HTML page, enters their `SHELBY_API_KEY` to approve
5. Server validates key, generates a one-time auth code, redirects to `https://claude.ai/api/mcp/auth_callback?code=...&state=...`
6. Claude Desktop exchanges code + PKCE verifier at `POST /token`, receives access token + refresh token
7. All subsequent MCP requests use `Authorization: Bearer <access_token>`

---

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/.well-known/oauth-authorization-server` | None | RFC 8414 metadata discovery |
| `POST` | `/register` | None | Dynamic client registration (RFC 7591) |
| `GET` | `/authorize` | None | Branded consent page (render form) |
| `POST` | `/authorize` | None | Form submission — validate API key, issue auth code, redirect |
| `POST` | `/token` | None (PKCE + code or refresh token) | Token exchange |
| `GET` | `/health` | None | Health check (unchanged) |
| `POST` | `/mcp` | Bearer token | MCP requests (unchanged) |

---

## Data & Storage

### SQLite: `oauth_clients` table (new migration)

```sql
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id    TEXT PRIMARY KEY,
  client_name  TEXT,
  redirect_uris TEXT NOT NULL,  -- JSON array
  registered_at INTEGER NOT NULL
);
```

Stores dynamically registered clients so they survive server restarts. No client secrets stored — Claude Desktop uses `token_endpoint_auth_method: "none"` (public client; PKCE provides the proof of possession).

### In-memory: authorization codes

```
Map<string, { clientId, codeChallenge, redirectUri, expiresAt }>
```

10-minute TTL. Cleared on use (single-use). Never persisted — if the server restarts mid-flow the user re-authorizes (rare; flow takes seconds).

### Tokens: deterministic HMAC (no storage)

```
access_token  = HMAC-SHA256(SHELBY_API_KEY, "access:"  + clientId)  // hex
refresh_token = HMAC-SHA256(SHELBY_API_KEY, "refresh:" + clientId)  // hex
```

- Unique per client
- Long-lived (no expiration)
- Instantly invalidated by rotating `SHELBY_API_KEY`
- Validated by recomputation — no DB lookup

### In-memory: rate limit tracker

```
Map<string, { attempts: number, resetAt: number }>  // keyed by IP
```

5 failed `/authorize` submissions per IP per 15 minutes. Prevents API key brute-force.

---

## Components

### New: `src/mcp/oauth.ts`

Owns all OAuth logic. Exports:

- `createOAuthHandlers(db, apiKey)` — returns `{ handleMetadata, handleRegister, handleAuthorize, handleToken }`
- `verifyBearerToken(token, apiKey)` — validates both legacy raw `SHELBY_API_KEY` tokens and HMAC-derived OAuth tokens. Used by `http-transport.ts`.

Internal responsibilities:
- RFC 8414 metadata object construction
- DCR client storage/lookup via `db`
- Auth code Map management + expiry
- PKCE S256 verification (`crypto.createHash('sha256')`)
- HMAC token derivation (`crypto.createHmac('sha256', ...)`)
- Branded `/authorize` HTML rendering
- Rate limiting Map

### Modified: `src/mcp/http-transport.ts`

- Add four new routes: `/.well-known/oauth-authorization-server`, `/register`, `/authorize`, `/token`
- Replace inline `verifyAuth()` with `verifyBearerToken()` from `oauth.ts`
- Pass `db` into `startHttpTransport` so OAuth handlers can access `oauth_clients`
- If `apiKey` is null, OAuth endpoints return `503 { "error": "oauth_not_configured", "error_description": "Set SHELBY_API_KEY to enable OAuth" }`

### Modified: `src/db/migrations.ts`

- Add migration for `oauth_clients` table

### No changes to: `src/config.ts`, `src/index.ts`, any tool files

---

## Authorization Page

Shelby-branded, dark theme. Server-rendered HTML, no external assets or CDN calls (air-gap safe).

Content:
- Shelby logo/wordmark
- "**[Client Name]** is requesting access to your Shelby memory."
- Password input labeled "API Key"
- "Approve" button
- On wrong key: re-render with inline error ("Incorrect API key") — no redirect, error never leaves the server

---

## RFC 8414 Metadata Response

All URLs are derived at request time from the `Host` header and protocol (e.g. `https://shelby-production.up.railway.app`). Never hardcoded.

```json
{
  "issuer": "{baseUrl}",
  "authorization_endpoint": "{baseUrl}/authorize",
  "token_endpoint": "{baseUrl}/token",
  "registration_endpoint": "{baseUrl}/register",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"]
}
```

Note: `registration_endpoint` must be a string (not `null`) — Claude Code has a Zod bug that crashes on `null`.

## Token Exchange (`POST /token`)

Supports two grant types:

**`grant_type=authorization_code`**
- Required params: `code`, `client_id`, `code_verifier`, `redirect_uri`
- Validates: code exists + not expired, `redirect_uri` matches registration, PKCE S256 check
- Returns: `{ access_token, token_type: "Bearer", refresh_token }`

**`grant_type=refresh_token`**
- Required params: `refresh_token`, `client_id`
- Validates: refresh token is the expected HMAC for that `client_id`
- Returns: `{ access_token, token_type: "Bearer", refresh_token }` (same tokens — deterministic)

---

## Error Handling

OAuth error responses follow RFC 6749: `{ "error": "...", "error_description": "..." }`

| Scenario | Response |
|----------|----------|
| Invalid PKCE verifier | `400 invalid_grant` |
| Unknown `client_id` | `400 invalid_client` |
| Expired auth code | `400 invalid_grant` |
| Already-used auth code | `400 invalid_grant` |
| Wrong API key on `/authorize` | Re-render page with error (no redirect) |
| `SHELBY_API_KEY` not set | `503 oauth_not_configured` |
| Rate limit exceeded | `429 { "error": "too_many_requests" }` |
| Invalid Bearer on `/mcp` | `401` with `WWW-Authenticate: Bearer` (unchanged) |

---

## Backward Compatibility

- Raw `SHELBY_API_KEY` as a Bearer token continues to work on `/mcp` — Claude Code users unaffected
- `verifyBearerToken()` accepts both: raw API key OR HMAC-derived access token

---

## Tests (`tests/oauth.test.ts`)

- DCR: registration stores client in DB, returns valid `client_id`
- `/authorize`: rejects wrong API key, accepts correct key and returns redirect with code
- PKCE: valid S256 challenge passes, tampered verifier fails
- Auth code: single-use (second exchange returns `invalid_grant`)
- Auth code: expires after 10 minutes
- Access token: valid token accepted on `/mcp`, invalid token rejected
- Refresh token: exchanges for new access token without re-authorization
- Rate limiting: blocks after 5 failed `/authorize` attempts from same IP
- Backward compat: raw `SHELBY_API_KEY` Bearer token still accepted on `/mcp`

---

## Files Changed

| File | Change |
|------|--------|
| `src/mcp/oauth.ts` | **New** — all OAuth logic |
| `src/mcp/http-transport.ts` | Add OAuth routes, swap auth check |
| `src/db/migrations.ts` | Add `oauth_clients` migration |
| `tests/oauth.test.ts` | **New** — OAuth test suite |
