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

1. **Smart agent, dumb server.** The server runs zero inference. Agents provide structured metadata AND summaries at capture time. The Forage skill uses the user's AI subscription for enrichment.
2. **Knowledge graph is the differentiator.** Typed edges (refines, cites, refuted_by, tags, related, follows) between thoughts. This is what sets ShelbyMCP apart from Engram, Cipher, and Basic Memory.
3. **Search returns summaries, not content.** The `summary` column stores agent-provided one-liners. Search/list tools return summaries + IDs. The agent calls `get_thought` for full content. This prevents 40K+ token blowups on search results.
4. **Static tool descriptions.** Tool definitions are in the system prompt on every message. Dynamic data in descriptions breaks prompt caching (10x cost). Put dynamic info in tool responses, never descriptions.
5. **Result limits everywhere.** Every list/search tool has a `limit` param (default 20, max 100). No unbounded queries.
6. **better-sqlite3 for synchronous DB access.** MCP tools are request/response — no need for async DB operations. Synchronous is simpler and faster for this workload.
7. **Official MCP SDK.** Uses `@modelcontextprotocol/sdk` for protocol compliance. Don't reimplement JSON-RPC.
8. **WAL mode.** Concurrent reads during writes. Important when Forage skill and MCP server share the DB.
9. **UUID primary keys.** Avoids collisions from concurrent captures across multiple AI tools.
10. **Visibility column (future-ready).** `visibility TEXT DEFAULT 'personal'` exists in the schema but isn't enforced yet. When team/multi-user support comes, the column is already there — no migration needed.

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
Use `McpServer` + `registerTool()`, NOT the older `Server` + `setRequestHandler()`:
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
- Error handling: throw descriptive errors, let the MCP SDK format the response
- Tests: Vitest, table-driven where appropriate
- JSON metadata fields for flexibility (topics, people, metadata columns)
- better-sqlite3 synchronous API (no async needed for DB ops)

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
