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
    capture.ts      # capture_thought, bulk_capture handlers
    search.ts       # search_thoughts, search_by_embedding
    list.ts         # list_thoughts
    get.ts          # get_thought
    update.ts       # update_thought
    delete.ts       # delete_thought
    graph.ts        # link_thoughts, unlink_thoughts, get_connections, get_graph, capture_edge
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
