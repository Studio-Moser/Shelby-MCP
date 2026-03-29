# ShelbyMCP

Open-source MCP memory server with a knowledge graph. Gives AI tools persistent memory that understands how thoughts are related.

## Tech Stack

- TypeScript (ESM), Node.js 20+
- better-sqlite3 (synchronous SQLite with FTS5)
- @modelcontextprotocol/sdk (official MCP SDK)
- Zod for input validation
- Vitest for testing

## Build & Test

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

## Project Structure

- `src/index.ts` — Entry point, CLI flags, MCP server startup
- `src/db/` — All SQLite operations (thoughts, edges, FTS, vectors, migrations)
- `src/mcp/` — MCP server setup and tool definitions
- `src/tools/` — MCP tool implementations (one file per tool group)
- `src/config.ts` — Configuration
- `skills/shelby-forage/` — Shipped scheduled skill for memory enrichment
- `tests/` — Unit and integration tests
- `docs/` — Architecture, agent setup, development guide

## Key Design Decisions

1. **Smart agent, dumb server.** The server runs zero inference. Agents provide structured metadata AND summaries at capture time. The Forage skill uses the user's AI subscription for enrichment.
2. **Knowledge graph is the differentiator.** Typed edges (refines, cites, refuted_by, tags, related, follows) between thoughts.
3. **Search returns summaries, not content.** The `summary` column stores agent-provided one-liners. Search/list tools return summaries + IDs. The agent calls `get_thought` for full content. This prevents 40K+ token blowups on search results.
4. **Static tool descriptions.** Tool definitions are in the system prompt on every message. Dynamic data in descriptions breaks prompt caching (10x cost). Put dynamic info in tool responses, never descriptions.
5. **Result limits everywhere.** Every list/search tool has a `limit` param (default 20, max 100) and `offset` for pagination. Responses include `total_count` and `has_more`. No unbounded queries.
6. **better-sqlite3 for synchronous DB access.** MCP tools are request/response — no need for async DB operations. Synchronous is simpler and faster for this workload.
7. **Official MCP SDK.** Uses `@modelcontextprotocol/sdk` for protocol compliance. Don't reimplement JSON-RPC.
8. **WAL mode.** Concurrent reads during writes. Important when Forage skill and MCP server share the DB.
9. **UUID primary keys.** Avoids collisions from concurrent captures across multiple AI tools.
10. **Visibility column (future-ready).** `visibility TEXT DEFAULT 'personal'` exists in the schema but isn't enforced yet. When team/multi-user support comes, the column is already there — no migration needed.
11. **Focused tool surface (9 tools).** Research from Block, Phil Schmid, and Docker shows 5-8 tools per server is the sweet spot. Above 15, agent accuracy drops. We consolidate related operations (link/unlink/capture_edge → `manage_edges`, connections/graph → `explore_graph`, search/embedding → `search_thoughts`) to stay in the optimal range.
12. **Errors are instructions.** Tool errors use `isError: true` with semantic categories (`not_found`, `invalid_input`, `duplicate`, etc.) and actionable messages that tell the agent what to try next. See ARCHITECTURE.md for the full pattern.
13. **Tool annotations on every tool.** MCP spec 2025-11-25 annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) signal behavior to clients. Every registered tool MUST include them.

## Critical Implementation Patterns

These patterns are derived from the official @modelcontextprotocol/servers repo and MUST be followed:

### Entry point shebang
`src/index.ts` MUST start with `#!/usr/bin/env node` as its very first line. The build script (`tsc && shx chmod +x dist/*.js`) makes the compiled output executable. Without this, `npx shelbymcp` fails on Unix.

### Import paths use .js extension
All relative imports MUST use `.js` extension (ESM + Node16 module resolution):
```typescript
import { ThoughtDatabase } from "./db/database.js";  // NOT "./db/database"
```

### MCP SDK usage (current pattern)
Use `McpServer` + `registerTool()`, NOT the older `Server` + `setRequestHandler()`. Every tool MUST include annotations:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "shelbymcp",
  version: "0.1.0",
});

server.registerTool(
  "capture_thought",
  {
    title: "Capture Thought",
    description: "Store a thought with metadata and relationships",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      content: z.string().describe("The thought content"),
      type: z.enum(["note", "decision", "task", "question", "reference", "insight"]).optional(),
      // ... more fields
    },
  },
  async ({ content, type }) => {
    // handler receives parsed args directly
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);
```

### Logging
ALL logging to `console.error` (stderr). NEVER `console.log` — stdout is the MCP JSON-RPC channel.

### Server startup
```typescript
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ShelbyMCP running on stdio");
}
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

## Conventions

- TypeScript strict mode
- ESM modules (type: "module" in package.json)
- Zod schemas for all tool inputs (passed as shapes to registerTool's inputSchema, not full z.object())
- Error handling: return `{ isError: true, content: [...] }` with semantic error categories and actionable messages. Log full traces to stderr, return sanitized messages to agents. See `toolError()` helper in DEVELOPMENT.md.
- Tool annotations: every `registerTool` call MUST include `annotations` with `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`
- Tests: Vitest, table-driven where appropriate. Integration tests use `InMemoryTransport` from the SDK.
- JSON metadata fields for flexibility (topics, people, metadata columns)
- better-sqlite3 synchronous API (no async needed for DB ops)
- Pagination: all list/search responses include `{ results, total_count, has_more, offset }`

## Relationship to Shelby Mac App

This repo is the standalone open-source memory server. The Shelby Mac app (separate repo) wraps the same database schema with a native macOS UI, CloudKit sync, always-on embedding pipeline, and heartbeat system.

The databases are interoperable — same schema, same file.

