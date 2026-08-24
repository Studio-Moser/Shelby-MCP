# shelby-mcp

The Shelby memory server as a single Rust binary: the 12-tool MCP surface from ADR 0001 over `shelby-memory`, served on stdio (default) or streamable HTTP.

```bash
cargo run -p shelby-mcp -- --db ~/.shelbymcp/memory.db            # stdio
cargo run -p shelby-mcp -- --transport http --port 3100           # http://0.0.0.0:3100/mcp
```

Flags and environment mirror the TypeScript server: `--db` / `SHELBY_DB_PATH`, `--transport` / `SHELBY_TRANSPORT`, `--port` / `PORT`, `--host` / `HOST`, `SHELBY_API_KEY` (bearer token on `/mcp`). `--db :memory:` runs against an in-memory database.

HTTP endpoints: `/mcp` (MCP streamable HTTP), `/health`, `/.well-known/mcp.json`, `/.well-known/mcp/server.json`; with `SHELBY_API_KEY` set, OAuth 2.1 (dynamic client registration, authorization code + PKCE, HMAC-derived access/refresh tokens) is served on `/.well-known/oauth-authorization-server`, `/register`, `/authorize`, `/token`; without it those answer 503.

Project scope follows the client's MCP `roots` (memoized, refreshed on `roots/list_changed`); with no roots, personal captures are rejected and reads fail safe to shared-only, exactly as the TypeScript server does.

Not yet ported from `npx shelbymcp`: `setup`, `uninstall`, `protocol`, `forage`, `onboard`, `migrate`, `repair-projects`, and server-side Gemini auto-embedding.

Tests: `cargo test -p shelby-mcp` (unit tests plus a JSON-RPC-over-stdio integration test that spawns the binary).
