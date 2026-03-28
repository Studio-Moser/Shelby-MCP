# ShelbyMCP

Knowledge-graph memory server for AI tools via MCP.

## Overview

ShelbyMCP gives AI agents persistent memory with a knowledge graph. Thoughts are stored in SQLite with FTS5 full-text search and typed relationship edges (refines, cites, refuted_by, tags, related, follows).

## Tech Stack

- TypeScript, ESM modules
- better-sqlite3 (synchronous SQLite with FTS5)
- @modelcontextprotocol/sdk (official MCP SDK)
- Zod for input validation
- Vitest for testing

## Project Structure

- `src/index.ts` — Entry point, CLI flags, MCP server startup
- `src/db/` — SQLite operations (thoughts, edges, FTS, vectors, migrations)
- `src/mcp/` — MCP server setup via official SDK (McpServer + registerTool)
- `src/tools/` — Tool handler implementations
- `src/config.ts` — Configuration
- `tests/` — Unit and integration tests
- `skills/shelby-forage/` — Shipped scheduled skill for memory enrichment

## Key Patterns

- All imports use `.js` extensions (ESM + Node16 module resolution)
- McpServer + registerTool() pattern (not the older Server + setRequestHandler)
- All logging to stderr (console.error), never stdout (MCP JSON-RPC channel)
- better-sqlite3 synchronous API (no async DB operations)
- WAL mode for concurrent access
- UUID v4 primary keys

## Building

```bash
npm install
npm run build
npm test
```
