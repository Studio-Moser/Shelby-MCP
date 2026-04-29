# Architecture

> **Status**: Design document — implementation in progress
> **Language**: TypeScript
> **Database**: SQLite (better-sqlite3) + FTS5
> **Protocol**: MCP (official @modelcontextprotocol/sdk)

---

## Design Principles

1. **Minimal dependencies.** `npx shelbymcp` and you're running. Single SQLite file. No Docker, no Python, no cloud accounts.
2. **Smart agent, dumb server.** The MCP server runs zero inference. The AI tools calling the tools are already LLMs — they provide structured metadata at capture time. The Forage skill is run by the user in their own Claude Code (or Codex / Gemini CLI) session — it executes on the user's subscription, not via ShelbyMCP authenticating on their behalf — so the server stays zero-cost and zero-cloud.
3. **Knowledge graph as a first-class citizen.** Thoughts aren't isolated. Typed edges (refines, cites, refuted_by, tags, related, follows) connect memories into a navigable graph.
4. **Single file for portability.** The entire database is one SQLite file. Easy to back up, sync (CloudKit, Dropbox, git), or move between machines.
5. **Native to the MCP ecosystem.** Built with the official MCP TypeScript SDK and better-sqlite3 — the same tools the MCP community already uses.
6. **Focused tool surface.** Keep the tool count between 8-10. Research from Block, Phil Schmid, and Docker shows 5-8 tools per server is the sweet spot — above 15, agent selection accuracy drops. Consolidate related operations into single tools with action parameters rather than adding more endpoints.
7. **Errors are instructions.** Tool error responses should tell the agent what went wrong and what to try next. "Thought not found. Try searching by topic instead" — not "404 Not Found".

---

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                    AI Tool                           │
│            (Claude Code, Cursor, Codex, etc.)        │
└──────────────────────┬──────────────────────────────┘
                       │ MCP (stdio JSON-RPC)
                       │
┌──────────────────────▼──────────────────────────────┐
│                    ShelbyMCP                          │
│                                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐ │
│  │  Protocol    │  │ Tool Router │  │  DB Layer    │ │
│  │  Handler     │──│             │──│              │ │
│  │  (JSON-RPC)  │  │  9 tools    │  │  SQLite      │ │
│  └─────────────┘  └─────────────┘  │  + FTS5      │ │
│                                     │  + edges     │ │
│                                     └──────────────┘ │
└──────────────────────────────────────────────────────┘
                       │
                       ▼
              ~/.shelbymcp/memory.db
```

---

## Database Schema

### thoughts

The core table. Each row is a captured thought/memory.

```sql
CREATE TABLE thoughts (
    id          TEXT PRIMARY KEY,       -- UUID
    content     TEXT NOT NULL,          -- Raw thought content
    summary     TEXT,                   -- Agent-provided one-line summary (for search results)
    type        TEXT DEFAULT 'note',    -- note, decision, task, question, reference, insight
    source      TEXT DEFAULT 'unknown', -- claude-code, cursor, codex, quick-capture, forage
    project     TEXT,                   -- Optional project association
    topics      TEXT,                   -- JSON array of topic strings
    people      TEXT,                   -- JSON array of people mentioned
    visibility  TEXT DEFAULT 'personal', -- personal, project, team, agent_only (future: enforced at query layer)
    metadata    TEXT,                   -- Arbitrary JSON metadata
    embedding   BLOB,                  -- Optional: 1536-dim float32 vector (6KB)
    created_at  TEXT NOT NULL,         -- ISO 8601 timestamp
    updated_at  TEXT NOT NULL,         -- ISO 8601 timestamp
    consolidated_into TEXT,            -- If merged, points to the consolidated thought ID
    reinforcement_count INTEGER DEFAULT 0  -- Times this thought has been re-captured
);
```

### thoughts_fts

FTS5 virtual table for full-text search over thought content.

```sql
CREATE VIRTUAL TABLE thoughts_fts USING fts5(
    content,
    content=thoughts,
    content_rowid=rowid
);
```

### edges

Knowledge graph relationships between thoughts.

```sql
CREATE TABLE edges (
    id          TEXT PRIMARY KEY,       -- UUID
    source_id   TEXT NOT NULL,          -- Source thought ID
    target_id   TEXT NOT NULL,          -- Target thought ID
    edge_type   TEXT NOT NULL,          -- refines, cites, refuted_by, tags, related, follows
    metadata    TEXT,                   -- Optional JSON metadata about the relationship
    created_at  TEXT NOT NULL,         -- ISO 8601 timestamp
    FOREIGN KEY (source_id) REFERENCES thoughts(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES thoughts(id) ON DELETE CASCADE,
    UNIQUE(source_id, target_id, edge_type)
);
```

### Indexes

```sql
CREATE INDEX idx_thoughts_type ON thoughts(type);
CREATE INDEX idx_thoughts_project ON thoughts(project);
CREATE INDEX idx_thoughts_created ON thoughts(created_at);
CREATE INDEX idx_thoughts_updated ON thoughts(updated_at);
CREATE INDEX idx_thoughts_consolidated ON thoughts(consolidated_into);
CREATE INDEX idx_edges_source ON edges(source_id);
CREATE INDEX idx_edges_target ON edges(target_id);
CREATE INDEX idx_edges_type ON edges(edge_type);
```

---

## Token Efficiency Patterns

These patterns are learned from production agent systems and are critical for ShelbyMCP's usability. An MCP server that wastes tokens on every call will get disabled by users.

### Static Tool Descriptions (Priority: Critical)

Tool definitions from MCP servers become part of the agent's system prompt. If definitions contain dynamic data (e.g., "you have 1,247 thoughts"), they break prompt caching — costing 10x more tokens on every message.

**Rule: Tool descriptions MUST be static.** No dynamic counts, no timestamps, no user-specific data in `registerTool` descriptions. Dynamic stats are returned via the `thought_stats` tool, never baked into descriptions.

```typescript
// GOOD — static, cacheable
server.registerTool("thought_stats", {
  description: "Get aggregate statistics about your memory database",
  // ...
});

// BAD — breaks prompt cache on every change
server.registerTool("thought_stats", {
  description: "Get stats about your 1,247 thoughts across 5 projects",
  // ...
});
```

### Pre-Computed Summaries (Priority: High)

Search results should not return full thought content — a single search hitting 20 thoughts at 2,000 words each would consume 40K+ tokens. Instead, search returns **agent-provided summaries**.

The `capture_thought` tool accepts an optional `summary` field (one-line description). The capturing agent is already an LLM — providing a summary costs it nothing. The Forage skill backfills summaries for thoughts that don't have them.

Search results return: `id`, `summary`, `type`, `topics`, `created_at`. The agent calls `get_thought` with a specific ID to retrieve full content when needed.

### Result Limits (Priority: High)

All list/search tools enforce limits to prevent context blowup:

- `limit` param on every list/search tool (default: 20, max: 100)
- `offset` param for cursor-based pagination
- Results sorted by relevance (search) or recency (list) so the most useful results come first
- Response includes `total_count`, `has_more` (boolean), and `offset` so the agent can paginate intelligently

### Concise Tool Descriptions (Priority: Medium)

Keep `registerTool` descriptions short. Don't explain the full schema in every tool description. The agent will learn the tool's behavior through use. Long descriptions waste tokens on every message.

### Bulk Operations (Priority: Medium)

The Forage skill needs to update many thoughts per run (backfill summaries, update metadata, create edges). Individual tool calls are expensive — each one is a full MCP round-trip. Provide bulk operations:

- `bulk_capture` — Capture multiple thoughts in one call
- `bulk_update` — Update metadata on multiple thoughts in one call

---

## Tool Annotations

The MCP spec (2025-11-25) introduced tool annotations that signal tool behavior to clients without changing execution semantics. Every registered tool MUST include annotations.

| Annotation | Type | Purpose |
|---|---|---|
| `readOnlyHint` | boolean | Tool only reads data, never modifies state |
| `destructiveHint` | boolean | Tool deletes or irreversibly modifies data |
| `idempotentHint` | boolean | Calling the tool twice with the same args produces the same result |
| `openWorldHint` | boolean | Tool interacts with external systems beyond the server |

**Example annotations for ShelbyMCP tools:**

| Tool | readOnly | destructive | idempotent | openWorld |
|---|---|---|---|---|
| `capture_thought` | false | false | false | false |
| `search_thoughts` | true | false | true | false |
| `get_thought` | true | false | true | false |
| `update_thought` | false | false | true | false |
| `delete_thought` | false | true | true | false |
| `manage_edges` | false | varies | true | false |
| `explore_graph` | true | false | true | false |
| `thought_stats` | true | false | true | false |

```typescript
server.registerTool(
  "search_thoughts",
  {
    title: "Search Thoughts",
    description: "Full-text search with knowledge graph expansion",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: { /* ... */ },
  },
  handler
);
```

---

## Error Handling

### Error Response Pattern

All tool errors MUST use the `isError` flag so agents can distinguish failures from successful results. Without this flag, agents may interpret error text as a valid response and proceed incorrectly.

```typescript
// GOOD — agent knows this is an error and can self-correct
return {
  isError: true,
  content: [{ type: "text" as const, text: JSON.stringify({
    error: "not_found",
    message: "No thought found with ID abc123. Try search_thoughts to find it by content.",
  }) }],
};

// BAD — agent may treat this as a successful result
return {
  content: [{ type: "text" as const, text: "Error: thought not found" }],
};
```

### Semantic Error Categories

Use consistent error category strings across all tools:

| Category | When to use |
|---|---|
| `not_found` | Thought or edge ID doesn't exist |
| `invalid_input` | Zod validation failed, or args are semantically wrong |
| `duplicate` | Edge already exists, thought already captured |
| `limit_exceeded` | Requested limit above max (100) |
| `temporary_failure` | DB locked, write conflict — retryable |
| `constraint_violation` | Foreign key failure, schema violation |

### Actionable Messages

Error messages are instructions to the agent. Always include what to do next:

| Bad | Good |
|---|---|
| "Not found" | "No thought found with ID abc123. Try search_thoughts to find it by content." |
| "Invalid input" | "Edge type must be one of: refines, cites, refuted_by, tags, related, follows." |
| "Duplicate" | "Edge already exists between abc123 and def456 with type 'related'. Use update_thought to modify metadata instead." |

### Internal errors

Log full stack traces to stderr (`console.error`). Return sanitized, agent-safe messages in tool responses. Never expose SQLite errors, file paths, or internal state.

---

## Tool Consolidation

The original design had 15 tools. Research consensus (Block, Phil Schmid, Docker) recommends 5-8 tools per server, with 8-12 as the upper bound for mature servers. We consolidate to **9 core tools**:

### Consolidated tool map

| Tool | Replaces | Rationale |
|---|---|---|
| `capture_thought` | (same) | Core operation, unchanged |
| `search_thoughts` | `search_thoughts` + `search_by_embedding` | Single search tool auto-detects mode. If query is text → FTS5. If `embedding` param provided → cosine similarity. Simpler agent decision-making. |
| `list_thoughts` | (same) | Browse/filter, unchanged |
| `get_thought` | (same) | Fetch full content by ID, unchanged |
| `update_thought` | `update_thought` + `bulk_update` | Add optional `ids` array param. Single ID = single update. Array of IDs = bulk update. Eliminates a dedicated bulk tool. |
| `delete_thought` | (same) | Remove a thought, unchanged |
| `manage_edges` | `link_thoughts` + `unlink_thoughts` + `capture_edge` | Single tool with `action` param: `"link"`, `"unlink"`. Captures metadata on link. Reduces 3 tools to 1. |
| `explore_graph` | `get_connections` + `get_graph` | Single tool with `depth` param. Depth 1 = get_connections behavior. Depth 2+ = graph traversal. |
| `thought_stats` | (same) | Aggregate stats, unchanged |

### Removed from public surface

| Tool | Disposition |
|---|---|
| `bulk_capture` | Moved to internal Forage-only operation via `capture_thought` with an array `thoughts` param |
| `search_by_embedding` | Merged into `search_thoughts` |
| `get_connections` | Merged into `explore_graph` |
| `link_thoughts` | Merged into `manage_edges` |
| `unlink_thoughts` | Merged into `manage_edges` |
| `capture_edge` | Merged into `manage_edges` |
| `get_graph` | Merged into `explore_graph` |
| `bulk_update` | Merged into `update_thought` |

### Tool naming convention

All tools use the pattern `{action}_{resource}` without a service prefix for now. If multi-server disambiguation becomes a problem (user reports), we add a `shelby_` prefix in a future version.

---

## Progress Reporting

For long-running operations, emit MCP progress notifications to prevent client timeouts and provide feedback.

**Tools that should report progress:**
- `update_thought` with bulk `ids` array (many updates)
- `explore_graph` with depth > 2 (deep traversal)
- `capture_thought` with array `thoughts` param (bulk capture)

```typescript
// Progress notification pattern
await ctx.reportProgress({
  progress: currentItem,
  total: totalItems,
});
```

---

## Structured Logging

### Development

All diagnostic output to `console.error` (stderr). This is non-negotiable — stdout is the JSON-RPC channel.

### Production

For production diagnostics beyond stderr, support an optional `--log-file` flag that enables structured JSON logging to a file:

- Default: stderr only (no file logging)
- `--log-file ~/.shelbymcp/server.log`: enables file logging
- `--verbose`: sets log level to debug (default is info)
- Log format: JSON lines with ISO 8601 timestamps, level, message, and optional context fields
- Log rotation: not built-in — users can use `logrotate` or similar

```typescript
// Logging levels
console.error("[INFO] ShelbyMCP running on stdio");
console.error("[DEBUG] search_thoughts query='sync' limit=20 results=5");
console.error("[ERROR] Database write failed", { error: e.message });
```

---

## Health Check

A `server_status` resource (NOT a tool — resources don't cost tool-description tokens) exposes server health:

```
URI: shelby://status
```

Returns:
```json
{
  "version": "0.1.0",
  "uptime_seconds": 3600,
  "db_size_bytes": 1048576,
  "thought_count": 247,
  "edge_count": 89,
  "db_path": "~/.shelbymcp/memory.db"
}
```

This is a resource, not a tool, because:
1. It doesn't cost tool-description tokens in the system prompt
2. It's read-only metadata about the server itself
3. Clients can poll it without agent involvement

---

## MCP Tool Design

### Capture Flow

When an AI tool calls `capture_thought`, the agent (not the server) provides structured metadata including an optional summary:

```json
{
  "tool": "capture_thought",
  "arguments": {
    "content": "We decided to use CloudKit for sync instead of Firebase because CloudKit is free for our scale, works offline, and doesn't add a third-party dependency. Firebase would require a Google Cloud account and has per-read pricing that could get expensive with cross-device sync.",
    "summary": "Chose CloudKit over Firebase for sync — free, offline-capable, no third-party dependency",
    "type": "decision",
    "project": "shelby",
    "topics": ["sync", "cloud", "infrastructure"],
    "people": [],
    "related_to": ["thought_abc123"]
  }
}
```

The server:
1. Generates a UUID
2. Stores the thought (content + summary) in SQLite
3. Updates the FTS5 index
4. Creates edge records for `related_to` references
5. Returns the new thought ID

**No inference happens in the server.** The agent is an LLM — it classifies, extracts topics, provides a summary, and identifies relationships as part of its normal reasoning.

### Search Flow

`search_thoughts` combines FTS5 keyword search with knowledge graph expansion:

1. FTS5 query finds matching thoughts
2. For each match, traverse edges to find connected thoughts (1 hop by default)
3. Return matches + connected thoughts, ranked by relevance
4. If embeddings exist, optionally rerank by cosine similarity
5. **Results return summaries, not full content** — agent calls `get_thought` for full content when needed

### Graph Traversal

`get_graph` does a breadth-first traversal from a starting thought:

```json
{
  "tool": "get_graph",
  "arguments": {
    "thought_id": "thought_abc123",
    "max_depth": 2,
    "edge_types": ["refines", "cites", "related"]
  }
}
```

Returns a tree of connected thoughts up to the specified depth, filtered by edge type.

---

## The Forage Skill

The Forage skill (`skills/shelby-forage/SKILL.md`) runs on the user's AI subscription via Claude Code's scheduler. It calls ShelbyMCP's own MCP tools to enrich the database.

```
Claude Code Scheduler
    │
    │ Reads SKILL.md, runs daily
    │
    ▼
┌──────────────────────────┐
│      Forage Skill         │
│                            │
│  Uses ShelbyMCP tools:     │
│  - list_thoughts           │
│  - search_thoughts         │
│  - update_thought (bulk)   │
│  - manage_edges            │
│  - capture_thought (bulk)  │
│  - explore_graph           │
└──────────────────────────┘
    │
    │ MCP (stdio)
    │
    ▼
┌──────────────────────────┐
│       ShelbyMCP           │
│                            │
│  Same server, same DB     │
└──────────────────────────┘
```

The skill:
1. Lists recent thoughts without embeddings → generates embeddings → updates thoughts
2. Lists poorly classified thoughts → reclassifies → updates metadata
3. Searches for similar thoughts → merges duplicates → captures consolidated version
4. Compares recent thoughts against existing → flags contradictions
5. Cross-searches across projects → creates relationship edges
6. Queries old action items → generates stale sweep report
7. Summarizes the week → captures digest thought

---

## Project Structure

```
shelbymcp/
├── src/
│   ├── index.ts               # Entry point, CLI flags, server startup
│   ├── db/
│   │   ├── database.ts        # SQLite connection, migrations, WAL mode
│   │   ├── thoughts.ts        # Thought CRUD operations
│   │   ├── edges.ts           # Knowledge graph edge operations
│   │   ├── fts.ts             # FTS5 search operations
│   │   ├── vectors.ts         # Vector storage and cosine similarity
│   │   └── migrations.ts      # Schema versioning
│   ├── mcp/
│   │   ├── server.ts          # MCP server via @modelcontextprotocol/sdk
│   │   └── tools.ts           # Tool definitions and routing
│   ├── tools/
│   │   ├── capture.ts         # capture_thought (single + bulk via array param)
│   │   ├── search.ts          # search_thoughts (FTS5 + embedding auto-detect)
│   │   ├── list.ts            # list_thoughts
│   │   ├── get.ts             # get_thought
│   │   ├── update.ts          # update_thought (single + bulk via ids array)
│   │   ├── delete.ts          # delete_thought
│   │   ├── graph.ts           # manage_edges, explore_graph
│   │   └── stats.ts           # thought_stats
│   └── config.ts              # CLI flags, env vars, defaults
├── tests/
│   ├── db/                    # Database layer tests
│   ├── tools/                 # Tool handler tests
│   └── mcp/                   # Protocol tests
├── skills/
│   └── shelby-forage/
│       └── SKILL.md           # Scheduled Forage skill for Claude Code
├── docs/
│   ├── ARCHITECTURE.md        # This file
│   ├── AGENT-SETUP.md         # Per-tool setup guides
│   ├── DEVELOPMENT.md         # Contributing, building, testing
│   └── assets/                # Images for README
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   ���   └── feature_request.md
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── workflows/
│       ├── ci.yml             # Tests on PR
│       └── release.yml        # Build + publish to npm
├── README.md
├── LICENSE                    # MIT
├── CONTRIBUTING.md
├── CHANGELOG.md
├── SECURITY.md
├── CODE_OF_CONDUCT.md
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## Compatibility with Shelby for Mac

ShelbyMCP (TypeScript) and the Shelby Mac app (Swift) are **separate implementations of the same schema**. They share no code but are fully interoperable at the database level.

A user can:

1. Start with ShelbyMCP standalone (any platform)
2. Build up a memory database
3. Download Shelby for Mac
4. Point it at the same `memory.db` file
5. Instantly get: native UI, always-on embeddings, CloudKit sync, Heartbeat

Zero migration. Same file, different runtimes.

### Schema as Contract

The database schema defined in this document (thoughts, edges, thoughts_fts tables with all columns and indexes) is the **canonical contract** between ShelbyMCP and the Shelby Mac app. Both projects implement this schema independently.

**If the schema needs to change:**
1. The change is proposed and documented here in ARCHITECTURE.md first
2. Both implementations (TypeScript + Swift) update their migrations
3. Both must handle reading databases written by the other (forward and backward compatibility)
4. Schema version is tracked in a `schema_version` table — both projects check it on startup

**What each project owns:**

| | ShelbyMCP (TypeScript) | Shelby Mac App (Swift) |
|---|---|---|
| **DB access** | better-sqlite3 (synchronous) | SQLite C API (direct) |
| **MCP server** | @modelcontextprotocol/sdk | Custom stdio JSON-RPC |
| **Embeddings** | None (Forage skill backfills) | OpenAI API / on-device |
| **Classification** | Agent provides at capture | App pipeline auto-classifies |
| **Sync** | None (single file) | CloudKit |
| **Heartbeat** | None (Forage skill via scheduler) | Native Pulse/Tidyup/Forage |
| **UI** | None (CLI/MCP only) | SwiftUI menu bar + main window |

---

## Retrieval Architecture

ShelbyMCP implements a three-mode retrieval system that maps to the GraphRAG pattern used by LightRAG, Microsoft GraphRAG, and similar systems — but with a key philosophical difference.

### Three Retrieval Modes

| Mode | Implementation | When to use |
|---|---|---|
| **Full-text search (FTS5)** | `searchThoughts()` in `fts.ts`. BM25 ranking over content. Porter tokenizer handles stemming + Unicode. | Default. Fast, zero-cost, works without embeddings. |
| **Vector search** | `searchByEmbedding()` in `vectors.ts`. Cosine similarity over 1536-dim float32 vectors. Linear scan. | When semantic similarity matters more than keyword matching. Requires embeddings to be populated. |
| **Hybrid** | FTS first (3x pool), reranked by embedding cosine similarity. Implemented in `search.ts`. | Best quality when embeddings are available. Falls back gracefully to FTS-only. |

All three modes are exposed through a single `search_thoughts` tool. The mode is auto-detected: text query → FTS, embedding param → vector, both → hybrid.

### Graph Traversal (Separate)

`explore_graph` in `graph.ts` does breadth-first traversal from a starting thought, up to depth 5, with optional edge type filtering. This is currently a **separate tool call** from search.

**Known gap**: In GraphRAG systems (LightRAG, Microsoft GraphRAG), a single query combines vector/FTS retrieval with graph traversal. Shelby requires two tool calls to get relationship-aware results. A future `graph_depth` parameter on `search_thoughts` could close this gap.

### How This Differs from GraphRAG

GraphRAG systems (LightRAG, Microsoft GraphRAG, Cognee) are "smart server" architectures — the server runs LLM inference to extract entities and relationships from raw documents at ingest time. This is expensive but automatic.

ShelbyMCP is "smart agent, dumb server" — the server runs zero inference. Agents provide structured metadata, summaries, and explicit edge relationships at capture time. The Forage skill backfills embeddings using the user's existing AI subscription.

| | GraphRAG Systems | ShelbyMCP |
|---|---|---|
| Entity extraction | Server-side LLM inference at ingest | Agent provides at capture time |
| Relationship discovery | Automatic (LLM-inferred) | Manual (agent calls `manage_edges`) |
| Embedding generation | Always, at ingest | Optional, Forage backfills |
| Infrastructure | Docker + API keys | Single SQLite file |
| Ongoing cost | Per-document embedding + inference | Zero |

This is a deliberate tradeoff: ShelbyMCP sacrifices automatic relationship discovery for zero infrastructure, zero cost, and higher-quality metadata. The agent doing the capturing is already an LLM — it classifies, summarizes, and identifies relationships as part of its normal reasoning.

### Embedding Strategy

Embeddings are **optional by design**. The system works without them (FTS-only). When present, they enable vector and hybrid search modes.

**Current embedding sources:**
- **Forage skill**: Scheduled enrichment that lists thoughts without embeddings, generates them, and backfills via `update_thought`. Uses the user's AI subscription.
- **Shelby for Mac**: `EmbeddingService.swift` generates embeddings at capture time via API or on-device models.
- **Direct API**: Any MCP client can pass an `embedding` param to `search_thoughts` for vector search, or provide embeddings via `capture_thought` metadata.

**Future consideration**: On-device embedding generation via Apple Foundation Models or ONNX in-process (see the [knowledge-rag](https://github.com/lyonzin/knowledge-rag) MCP server for a reference implementation of the ONNX approach). This would eliminate API dependency entirely.

### Future Retrieval Improvements

1. **Graph-aware search**: Add optional `graph_depth` param to `search_thoughts`. After FTS/vector retrieval, traverse N hops of graph edges from each result and include related thoughts. Reduces agent tool calls and surfaces relationship-aware results in one step.
2. **Auto-edge suggestions**: Return suggested relationships in `capture_thought` responses based on content similarity to existing thoughts. Agent confirms or dismisses via `manage_edges`.
3. **Temporal edges**: Add `valid_from`/`valid_until` to the edge schema for temporal fact resolution (Zep Graphiti pattern). Enables reasoning about knowledge evolution.
4. **sqlite-vec**: When the npm package matures, replace custom cosine similarity with sqlite-vec's optimized implementation for faster vector search at scale.

For the full ecosystem analysis, see [RAG Ecosystem & Graph Retrieval](../../Shelby-Strategy/Research/RAG%20Ecosystem%20%26%20Graph%20Retrieval.md) in Shelby-Strategy.

---

## Future Considerations

- **Streamable HTTP transport**: The MCP spec (2025-11-25) introduced Streamable HTTP transport replacing the older SSE transport. This is the standard path for remote MCP access — use `NodeStreamableHTTPServerTransport` from the SDK (with `createMcpExpressApp()` or `createMcpHonoApp()` for DNS rebinding protection) rather than building a custom REST API. Enables remote clients, web UIs, and multi-machine setups.
- **Plugin system**: Allow community-built Forage tasks
- **Multi-user**: Scoped memory access for team scenarios
- **Dynamic tool loading**: For users who find 9 tools too many, support a `--tools` CLI flag to load only specified tools. Speakeasy demonstrated 96%+ input token reduction with dynamic tool loading. Low priority — 9 tools is within the recommended range.
