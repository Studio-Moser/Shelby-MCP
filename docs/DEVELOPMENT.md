# Development Guide

## Prerequisites

- Node.js 20+
- npm or pnpm

## Setup

```bash
git clone https://github.com/Studio-Moser/shelbymcp.git
cd shelbymcp
npm install
```

## Key Dependencies

| Package | Purpose |
|---|---|
| `@modelcontextprotocol/sdk` | Official MCP TypeScript SDK — server, protocol types, tool definitions |
| `better-sqlite3` | Synchronous SQLite bindings with FTS5 support. Battle-tested, fast. |
| `zod` | Schema validation for tool inputs |
| `uuid` | UUID v4 generation for thought/edge IDs |

## Building

```bash
# Compile TypeScript
npm run build

# Run in development (ts-node/tsx)
npm run dev

# Run compiled
node dist/index.js --db ~/.shelbymcp/memory.db
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- tests/db/thoughts.test.ts

# Watch mode
npm run test:watch
```

### Test Layers

Tests are organized in three layers:

**1. Unit tests** (`tests/db/`, `tests/tools/`)
Database operations and tool handler logic tested in isolation with an in-memory SQLite database.

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { ThoughtDatabase } from "../../src/db/database.js";

describe("ThoughtDatabase", () => {
  let db: ThoughtDatabase;

  beforeEach(() => {
    db = new ThoughtDatabase(":memory:");
  });

  it("captures and retrieves a thought", () => {
    const id = db.capture({ content: "test thought", type: "note" });
    const thought = db.get(id);
    expect(thought.content).toBe("test thought");
  });
});
```

**2. Integration tests** (`tests/mcp/`)
Full MCP client-server flows using `InMemoryTransport` from the SDK. This is the recommended pattern — no subprocess management, fast, reliable.

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";

describe("MCP integration", () => {
  let client: Client;

  beforeEach(async () => {
    const server = createServer({ db: ":memory:" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
  });

  it("capture and retrieve via MCP protocol", async () => {
    const captureResult = await client.callTool("capture_thought", {
      content: "Integration test thought",
      type: "note",
    });
    // Parse result, extract ID, verify retrieval
    expect(captureResult.isError).toBeFalsy();
  });
});
```

**3. Error scenario tests**
Every tool should have tests for: missing required params, invalid IDs, empty results, duplicate operations, and boundary conditions (limit=0, limit=101, empty content).

### What to test

| Layer | Focus | Location |
|---|---|---|
| DB unit tests | CRUD operations, FTS5 queries, edge traversal, WAL concurrency | `tests/db/` |
| Tool handler tests | Input validation, response format, error categories, pagination | `tests/tools/` |
| MCP integration tests | End-to-end protocol flows via InMemoryTransport, tool listing, error propagation | `tests/mcp/` |

## Project Structure

```
src/
  index.ts          # Entry point — parse CLI flags, start MCP server
  config.ts         # Configuration (CLI args, env vars, defaults)
  db/
    database.ts     # SQLite connection, WAL mode, migrations
    thoughts.ts     # Thought CRUD (insert, get, update, delete, list, count)
    edges.ts        # Knowledge graph edges (link, unlink, traverse)
    fts.ts          # FTS5 full-text search
    vectors.ts      # Embedding storage and cosine similarity
    migrations.ts   # Schema versioning (create tables, indexes)
  mcp/
    server.ts       # MCP server setup via @modelcontextprotocol/sdk
    tools.ts        # Tool definitions (names, descriptions, input schemas)
  tools/
    capture.ts      # capture_thought (single + bulk via array param)
    search.ts       # search_thoughts (FTS5 + embedding auto-detect)
    list.ts         # list_thoughts
    get.ts          # get_thought
    update.ts       # update_thought (single + bulk via ids array)
    delete.ts       # delete_thought
    graph.ts        # manage_edges, explore_graph
    stats.ts        # thought_stats
tests/
  db/               # Database layer unit tests
  tools/            # Tool handler tests
  mcp/              # Protocol integration tests
```

## Key Design Decisions

### better-sqlite3 (not node-sqlite3)

We use `better-sqlite3` for synchronous SQLite access. This is deliberate:

- **Synchronous API** — No callback/promise overhead for simple DB operations. MCP tool handlers are request/response, not streaming.
- **FTS5 built-in** — Full-text search works out of the box.
- **WAL mode** — Concurrent reads during writes. Important when the Forage skill and MCP server share the DB.
- **Prebuilt binaries** — Available for macOS (x64/arm64), Linux (x64/arm64), and Windows (x64). `npm install` just works on common platforms.

### Official MCP SDK

We use `@modelcontextprotocol/sdk` (the official Anthropic MCP SDK) rather than implementing JSON-RPC ourselves. This ensures protocol compliance and reduces maintenance burden as the MCP spec evolves.

### UUID Primary Keys

Thought and edge IDs are UUID v4, generated server-side. This avoids collisions when thoughts are captured from multiple AI tools simultaneously and makes future cross-database merging possible.

### JSON Metadata Fields

`topics`, `people`, and `metadata` are stored as JSON text in SQLite. This keeps the schema simple while allowing flexible metadata. Agents provide this data at capture time.

## Error Handling Convention

All tool handlers follow the same error pattern:

1. **Validate with Zod** — the SDK handles this automatically via `inputSchema`
2. **Catch application errors** — wrap DB operations in try/catch
3. **Return `isError: true`** — so agents can distinguish failures from results
4. **Use semantic error categories** — `not_found`, `invalid_input`, `duplicate`, `limit_exceeded`, `temporary_failure`, `constraint_violation`
5. **Include actionable messages** — tell the agent what to try next
6. **Log internals to stderr** — full stack traces for debugging, never in tool responses

```typescript
// Standard error response helper
function toolError(category: string, message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify({ error: category, message }) }],
  };
}

// Usage in a tool handler
const thought = db.get(id);
if (!thought) {
  return toolError("not_found", `No thought found with ID ${id}. Try search_thoughts to find it by content.`);
}
```

See [Architecture: Error Handling](ARCHITECTURE.md#error-handling) for the full pattern.

## Structured Logging

- **Always**: `console.error` for all diagnostic output. Never `console.log`.
- **Optional**: `--log-file <path>` flag enables JSON-line file logging for production debugging.
- **Optional**: `--verbose` flag sets log level to debug (default is info).
- **Format**: `[LEVEL] message` for stderr, JSON lines for file output.

```typescript
// stderr output (always)
console.error("[INFO] ShelbyMCP running on stdio");
console.error("[ERROR] Database write failed", e.message);

// File logging (when --log-file is set)
// {"ts":"2026-03-27T10:00:00Z","level":"debug","msg":"search_thoughts","query":"sync","limit":20,"results":5}
```

---

## Adding a New MCP Tool

1. Create a handler in `src/tools/`
2. Define the tool schema in `src/mcp/tools.ts` (name, description, inputSchema with Zod)
3. Register the handler in the server's tool router
4. Write tests in `tests/tools/`
5. Update README.md tool table
6. Update CHANGELOG.md

## Adding a New Forage Task

1. Update `skills/shelby-forage/SKILL.md` with the new task description
2. The task should use existing MCP tools (list, search, update, link, capture)
3. Document the task in README.md's Forage section
4. Update CHANGELOG.md

## Publishing to npm

```bash
npm run build
npm publish
```

After publishing, users can run: `npx shelbymcp --db ~/.shelbymcp/memory.db`
