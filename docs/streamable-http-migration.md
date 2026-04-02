# Streamable HTTP Transport — Migration Plan

> **Status**: Largely complete. Streamable HTTP is already the production transport in Shelby-MCP.
> **Last updated**: 2026-04-02

---

## Background

The MCP 2025-11-25 spec revision replaced the older HTTP+SSE transport with **Streamable HTTP** as the standard for remote MCP access. The key differences:

| Feature | Old HTTP+SSE | Streamable HTTP |
|---|---|---|
| Connection model | Persistent SSE stream | Per-request or session-based |
| Session tracking | None | Optional `mcp-session-id` header |
| Single responses | Returned as SSE events | Returned as plain JSON |
| Streaming responses | SSE stream | SSE stream (still used for streaming) |
| Backward compat | n/a | SSE clients can still connect during transition |

The `@modelcontextprotocol/sdk` TypeScript package exposes this as `StreamableHTTPServerTransport` (imported from `@modelcontextprotocol/sdk/server/streamableHttp.js`).

---

## Current State

### What's implemented

Shelby-MCP already uses `StreamableHTTPServerTransport` as its HTTP transport. The implementation is in `src/mcp/http-transport.ts`.

**Transport selection:**

```
shelbymcp --transport stdio   # default — JSON-RPC over stdin/stdout
shelbymcp --transport http    # Streamable HTTP on http://<host>:<port>/mcp
```

Environment variable alternative: `SHELBY_TRANSPORT=http`.

**HTTP server endpoints:**

| Path | Method | Purpose |
|---|---|---|
| `/mcp` | `POST` | Streamable HTTP MCP requests |
| `/health` | `GET` | Health check — returns `{"status":"ok"}` |
| `/.well-known/oauth-authorization-server` | `GET` | OAuth metadata (requires `SHELBY_API_KEY`) |
| `/register` | `POST` | OAuth Dynamic Client Registration |
| `/authorize` | `GET/POST` | OAuth authorization |
| `/token` | `POST` | OAuth token exchange |

**Session mode**: The transport is configured in **stateless mode** (`sessionIdGenerator: undefined`). Each POST creates a fresh `McpServer` instance and `StreamableHTTPServerTransport`, processes the request, and closes. This is correct for the majority of MCP use cases (tool calls are stateless) and avoids session memory management complexity.

**Authentication**: Optional Bearer token auth via `SHELBY_API_KEY`. If set, all `/mcp` requests must include `Authorization: Bearer <token>`. OAuth 2.1 (with PKCE, Dynamic Client Registration) is implemented on top of this — clients that complete the OAuth flow receive a derived access token.

**Transport flags:**

```bash
shelbymcp --transport http          # enable HTTP mode
shelbymcp --transport http --port 3100 --host 127.0.0.1
# or via env:
PORT=3100 HOST=0.0.0.0 SHELBY_TRANSPORT=http shelbymcp
```

Default port is `3100`. Default host in HTTP mode is `0.0.0.0` (container-friendly), `127.0.0.1` for stdio.

---

## What Streamable HTTP Means for Shelby-MCP

### Session management (`mcp-session-id`)

The MCP spec allows servers to assign session IDs via the `mcp-session-id` response header, which clients send back on subsequent requests. Shelby-MCP currently operates in **stateless mode** — sessions are explicitly disabled by passing `sessionIdGenerator: undefined` to `StreamableHTTPServerTransport`.

**Current behavior**: Correct for Shelby-MCP's use case. All tool calls (`capture_thought`, `search_thoughts`, etc.) are inherently stateless — they read from or write to SQLite and return. There is no in-memory server state to preserve across requests. Stateless mode is the right choice.

**If sessions are needed in the future**: Pass a `sessionIdGenerator` function (e.g., `() => randomUUID()`) to enable session-based connections. The SDK handles the `mcp-session-id` header automatically. This would be needed if Shelby-MCP ever adds subscription-style tools that need to push notifications back to a long-lived client.

### JSON responses vs. SSE streams

The SDK handles this automatically. For single-response requests (all current Shelby-MCP tools), the transport returns plain JSON. If a tool returned a streaming response, the SDK would switch to SSE. No code changes are needed.

### Backward compatibility with SSE clients

The spec requires servers to accept connections from older SSE clients during the transition period. The `StreamableHTTPServerTransport` from the SDK handles this — it detects the client's `Accept` header and responds appropriately. Shelby-MCP inherits this compatibility automatically.

### GET and DELETE on `/mcp`

The Streamable HTTP spec defines behavior for `GET /mcp` (for clients that need a persistent SSE channel) and `DELETE /mcp` (session teardown). Current implementation returns `405 Method Not Allowed` for both. This is acceptable for stateless mode — there are no sessions to establish or tear down.

---

## Gaps and Remaining Work

### Gap 1: GET `/mcp` not supported (low priority)

The spec allows `GET /mcp` for clients that need persistent SSE subscriptions. Current response is `405`. This means clients that require a persistent channel (vs. polling) cannot connect.

**Impact**: Low. Claude Desktop, Claude Code, Cursor, and Codex all use POST-based request/response. GET-based persistent channels are rarely needed for tool-call-only servers.

**Recommendation**: Implement if a real client use case requires it. The SDK's `StreamableHTTPServerTransport` supports it — enable by accepting GET requests and passing `req`/`res` to `transport.handleRequest()`.

### Gap 2: Session-based connections not supported (currently by design)

Stateless mode means each request creates a new server+transport pair. If the MCP spec eventually requires session support for certain capability negotiation flows (e.g., per-session tool registration), this would be a breaking change.

**Impact**: Theoretical. No current client requires session-based connections for the tools Shelby-MCP exposes.

**Recommendation**: Monitor the MCP spec. If session requirements appear in finalized 2026 spec, add `sessionIdGenerator` and a session store (in-memory map is sufficient for single-node deployment).

### Gap 3: `--transport` flag not in README (documentation)

The `--transport http` flag and its environment variable (`SHELBY_TRANSPORT=http`) are not prominently documented in the README. Users may not discover the HTTP transport mode.

**Recommendation**: Add a "Remote access" or "HTTP transport" section to the README documenting the flag, required env vars, and how to connect Claude Desktop/Cursor to the HTTP endpoint.

---

## Recommended Migration Steps

Since Streamable HTTP is already implemented, these steps complete the migration:

1. **[Done]** Use `StreamableHTTPServerTransport` from the official SDK — not a custom SSE implementation.
2. **[Done]** Implement Bearer token auth + OAuth 2.1 for secure remote access.
3. **[Done]** Health check endpoint at `/health`.
4. **[Done]** `--transport` CLI flag and `SHELBY_TRANSPORT` env var.
5. **[Backlog]** Document HTTP transport in README with connection examples for major clients.
6. **[Backlog]** Evaluate GET `/mcp` support if a persistent-channel client use case emerges.
7. **[Monitor]** Watch MCP spec finalization in 2026 for any session-management requirements that would change the stateless architecture.

---

## Testing HTTP Transport

```bash
# Start in HTTP mode (no auth for local testing)
shelbymcp --transport http --port 3100

# Health check
curl http://localhost:3100/health
# → {"status":"ok"}

# MCP initialize request
curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}'
```

With auth enabled (`SHELBY_API_KEY=secret`):

```bash
SHELBY_API_KEY=secret shelbymcp --transport http --port 3100

curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(echo -n 'secret' | openssl dgst -hmac 'access' -sha256 | awk '{print $2}')" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

---

## References

- [MCP Spec 2025-11-25 — Streamable HTTP](https://spec.modelcontextprotocol.io/specification/2025-11-05/basic/transports/#streamable-http)
- [`@modelcontextprotocol/sdk` StreamableHTTPServerTransport](https://github.com/modelcontextprotocol/typescript-sdk)
- `src/mcp/http-transport.ts` — Shelby-MCP HTTP transport implementation
- `src/config.ts` — `--transport`, `--port`, `--host` flag parsing
