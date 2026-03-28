# ShelbyMCP — AI Development Context

## What This Is

ShelbyMCP is an open-source MCP memory server with a knowledge graph. It gives AI tools (Claude Code, Cursor, Codex, etc.) persistent memory that understands how thoughts are related.

## Tech Stack

- **Language**: TypeScript (ESM)
- **Database**: SQLite via `better-sqlite3` (synchronous, with FTS5)
- **Protocol**: MCP via `@modelcontextprotocol/sdk` (official Anthropic SDK)
- **Validation**: Zod for tool input schemas
- **Testing**: Vitest
- **No runtime dependencies** beyond Node.js 20+

## Architecture

- `src/index.ts` — Entry point, CLI flags, MCP server startup
- `src/db/` — All SQLite operations (thoughts, edges, FTS, vectors, migrations)
- `src/mcp/` — MCP server setup and tool definitions
- `src/tools/` �� MCP tool implementations (one file per tool group)
- `src/config.ts` — Configuration
- `skills/shelby-forage/` — Shipped scheduled skill for memory enrichment
- `tests/` — Unit and integration tests
- `docs/` — Architecture, agent setup, development guide

## Key Design Decisions

1. **Smart agent, dumb server.** The server runs zero inference. Agents provide structured metadata at capture time. The Forage skill uses the user's AI subscription.
2. **Knowledge graph is the differentiator.** Typed edges (refines, cites, refuted_by, tags, related, follows) between thoughts. This is what sets ShelbyMCP apart from Engram, Cipher, and Basic Memory.
3. **better-sqlite3 for synchronous DB access.** MCP tools are request/response — no need for async DB operations. Synchronous is simpler and faster for this workload.
4. **Official MCP SDK.** Uses `@modelcontextprotocol/sdk` for protocol compliance. Don't reimplement JSON-RPC.
5. **WAL mode.** Concurrent reads during writes. Important when Forage skill and MCP server share the DB.
6. **UUID primary keys.** Avoids collisions from concurrent captures across multiple AI tools.

## Conventions

- TypeScript strict mode
- ESM modules (type: "module" in package.json)
- Zod schemas for all tool inputs
- Error handling: throw descriptive errors, let the MCP SDK format the response
- Tests: Vitest, table-driven where appropriate
- JSON metadata fields for flexibility (topics, people, metadata columns)

## Relationship to Shelby Mac App

This repo is the standalone open-source memory server. The Shelby Mac app (separate repo, GPLv3) wraps the same database schema with:
- Native macOS UI
- CloudKit sync
- Always-on embedding pipeline
- Heartbeat system (Pulse/Tidyup/Forage)

The databases are interoperable — same schema, same file.

## Building and Testing

```bash
npm install
npm run build
npm test
```

## Publishing

```bash
npm run build
npm publish
# Users run: npx shelbymcp
```
