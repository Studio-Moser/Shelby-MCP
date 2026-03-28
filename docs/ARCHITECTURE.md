# Architecture

> **Status**: Design document — implementation in progress
> **Language**: Go
> **Database**: SQLite + FTS5
> **Protocol**: MCP (stdio JSON-RPC)

---

## Design Principles

1. **Zero dependencies.** Single binary, single SQLite file. No Docker, no Python, no Node.js, no cloud accounts.
2. **Smart agent, dumb server.** The MCP server runs zero inference. The AI tools calling the tools are already LLMs — they provide structured metadata at capture time. The Forage skill uses the user's existing AI subscription for enrichment.
3. **Knowledge graph as a first-class citizen.** Thoughts aren't isolated. Typed edges (refines, cites, refuted_by, tags, related, follows) connect memories into a navigable graph.
4. **Single file for portability.** The entire database is one SQLite file. Easy to back up, sync (CloudKit, Dropbox, git), or move between machines.
5. **Cross-platform from day one.** Go compiles to macOS, Linux, and Windows. The same binary works everywhere.

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
    type        TEXT DEFAULT 'note',    -- note, decision, task, question, reference, insight
    source      TEXT DEFAULT 'unknown', -- claude-code, cursor, codex, quick-capture, forage
    project     TEXT,                   -- Optional project association
    topics      TEXT,                   -- JSON array of topic strings
    people      TEXT,                   -- JSON array of people mentioned
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

## MCP Tool Design

### Capture Flow

When an AI tool calls `capture_thought`, the agent (not the server) provides structured metadata:

```json
{
  "tool": "capture_thought",
  "arguments": {
    "content": "We decided to use CloudKit for sync instead of Firebase",
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
2. Stores the thought in SQLite
3. Updates the FTS5 index
4. Creates edge records for `related_to` references
5. Returns the new thought ID

**No inference happens in the server.** The agent is an LLM — it classifies, extracts topics, and identifies relationships as part of its normal reasoning.

### Search Flow

`search_thoughts` combines FTS5 keyword search with knowledge graph expansion:

1. FTS5 query finds matching thoughts
2. For each match, traverse edges to find connected thoughts (1 hop by default)
3. Return matches + connected thoughts, ranked by relevance
4. If embeddings exist, optionally rerank by cosine similarity

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
├── cmd/
│   └── shelbymcp/
│       └── main.go            # Entry point, CLI flags, server startup
├── internal/
│   ├── db/
│   │   ├── db.go              # SQLite connection, migrations, WAL mode
│   │   ├── thoughts.go        # Thought CRUD operations
│   │   ├── edges.go           # Knowledge graph edge operations
│   │   ├── fts.go             # FTS5 search operations
│   │   ├── vectors.go         # Vector storage and cosine similarity
│   │   └── migrations.go      # Schema versioning
│   ├── mcp/
│   │   ├── server.go          # MCP stdio JSON-RPC server
│   │   ├── protocol.go        # MCP protocol types
│   │   └── tools.go           # Tool definitions and routing
│   ├── tools/
│   │   ├── capture.go         # capture_thought, bulk_capture
│   │   ├── search.go          # search_thoughts, search_by_embedding
│   │   ├── list.go            # list_thoughts
│   │   ├── get.go             # get_thought
│   │   ├── update.go          # update_thought
│   │   ├── delete.go          # delete_thought
│   │   ├── graph.go           # link_thoughts, unlink_thoughts, get_connections, get_graph, capture_edge
│   │   └── stats.go           # thought_stats
│   └── config/
│       └── config.go          # CLI flags, env vars, defaults
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
│       └── release.yml        # Build + publish
├── README.md
├── LICENSE                    # MIT
├── CONTRIBUTING.md
├── CHANGELOG.md
├── SECURITY.md
├── CODE_OF_CONDUCT.md
├── go.mod
├── go.sum
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
- **TUI**: Terminal UI for browsing and managing memories (Engram has one, users love it)
- **sqlite-vec integration**: When the Go bindings mature, replace custom cosine similarity with sqlite-vec's optimized implementation
- **Plugin system**: Allow community-built Forage tasks
- **Multi-user**: Scoped memory access for team scenarios
