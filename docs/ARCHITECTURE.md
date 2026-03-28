# Architecture

> **Status**: Design document — implementation in progress
> **Language**: TypeScript
> **Database**: SQLite (better-sqlite3) + FTS5
> **Protocol**: MCP (official @modelcontextprotocol/sdk)

---

## Design Principles

1. **Minimal dependencies.** `npx shelbymcp` and you're running. Single SQLite file. No Docker, no Python, no cloud accounts.
2. **Smart agent, dumb server.** The MCP server runs zero inference. The AI tools calling the tools are already LLMs — they provide structured metadata at capture time. The Forage skill uses the user's existing AI subscription for enrichment.
3. **Knowledge graph as a first-class citizen.** Thoughts aren't isolated. Typed edges (refines, cites, refuted_by, tags, related, follows) connect memories into a navigable graph.
4. **Single file for portability.** The entire database is one SQLite file. Easy to back up, sync (CloudKit, Dropbox, git), or move between machines.
5. **Native to the MCP ecosystem.** Built with the official MCP TypeScript SDK and better-sqlite3 — the same tools the MCP community already uses.

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
│  │  (JSON-RPC)  │  │  14 tools   │  │  SQLite      │ │
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
- Results sorted by relevance (search) or recency (list) so the most useful results come first
- Response includes `total_count` so the agent knows if there are more results

### Concise Tool Descriptions (Priority: Medium)

Keep `registerTool` descriptions short. Don't explain the full schema in every tool description. The agent will learn the tool's behavior through use. Long descriptions waste tokens on every message.

### Bulk Operations (Priority: Medium)

The Forage skill needs to update many thoughts per run (backfill summaries, update metadata, create edges). Individual tool calls are expensive — each one is a full MCP round-trip. Provide bulk operations:

- `bulk_capture` — Capture multiple thoughts in one call
- `bulk_update` — Update metadata on multiple thoughts in one call

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
│  - update_thought          │
│  - link_thoughts           │
│  - capture_thought         │
│  - bulk_capture            │
│  - search_by_embedding     │
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
│   │   ├── capture.ts         # capture_thought, bulk_capture
│   │   ├── search.ts          # search_thoughts, search_by_embedding
│   │   ├── list.ts            # list_thoughts
│   │   ├── get.ts             # get_thought
│   │   ├── update.ts          # update_thought
│   │   ├── delete.ts          # delete_thought
│   │   ├── graph.ts           # link_thoughts, unlink_thoughts, get_connections, get_graph, capture_edge
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

ShelbyMCP and the Shelby Mac app use the **same SQLite database schema**. A user can:

1. Start with ShelbyMCP standalone (any platform)
2. Build up a memory database
3. Download Shelby for Mac
4. Point it at the same `memory.db` file
5. Instantly get: native UI, always-on embeddings, CloudKit sync, Heartbeat

Zero migration. The Mac app reads and writes the same tables.

---

## Future Considerations

- **HTTP API**: Optional REST endpoint alongside MCP stdio (for non-MCP clients)
- **sqlite-vec integration**: When the npm package matures, replace custom cosine similarity with sqlite-vec's optimized implementation
- **Plugin system**: Allow community-built Forage tasks
- **Multi-user**: Scoped memory access for team scenarios
