<p align="center">
  <img src="docs/assets/shelby-mcp-header.png" alt="ShelbyMCP" width="720" />
</p>

<p align="center">
  <strong>The knowledge-graph memory server for AI tools.</strong><br/>
  Mem0-grade intelligence. Engram-grade simplicity.
</p>

<p align="center">
  <a href="#quick-start"><strong>Quick Start</strong></a> ·
  <a href="docs/ARCHITECTURE.md"><strong>Architecture</strong></a> ·
  <a href="docs/AGENT-SETUP.md"><strong>Agent Setup</strong></a> ·
  <a href="#contributing"><strong>Contributing</strong></a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <a href="https://github.com/Studio-Moser/shelbymcp/stargazers"><img src="https://img.shields.io/github/stars/Studio-Moser/shelbymcp?style=flat" alt="Stars" /></a>
</p>

---

## What is ShelbyMCP?

Every AI memory server is a bag of embeddings. **ShelbyMCP connects your thoughts.**

ShelbyMCP is a zero-dependency MCP memory server with a built-in knowledge graph. It gives Claude Code, Cursor, Codex, Windsurf, and any MCP-compatible AI tool persistent memory that understands how your thoughts are related — not just what they contain.

Ship it with the **Forage skill**, a scheduled task that runs on your existing AI subscription to continuously enrich, consolidate, and connect your memories. No Docker. No Python. No cloud accounts. Just a binary and a database file.

### Why ShelbyMCP?

| Problem | ShelbyMCP's answer |
|---|---|
| Every conversation starts from zero | Persistent memory across sessions |
| Memories are a flat pile of text | Knowledge graph with typed relationships (refines, cites, refuted_by, tags) |
| Search results blow up your context window | Pre-computed summaries — search returns one-liners, fetch full content on demand |
| No memory maintenance | Forage skill auto-consolidates, deduplicates, and connects |
| Vector search requires heavy infra | Forage skill backfills embeddings using your existing AI subscription |
| Requires Docker/Python/Cloud | `npx shelbymcp`, single SQLite file |

---

## Quick Start

### Install

```bash
# npx (no install needed)
npx shelbymcp

# Or install globally
npm install -g shelbymcp

# Or build from source
git clone https://github.com/Studio-Moser/shelbymcp.git
cd shelbymcp
npm install && npm run build
```

### Connect to Claude Code

Add to your `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["shelbymcp", "--db", "~/.shelbymcp/memory.db"]
    }
  }
}
```

### (Optional) Install the Forage Skill

The Forage skill runs on Claude Code's scheduler to continuously improve your memories:

```bash
cp -r skills/shelby-forage ~/.claude/scheduled-tasks/shelby-forage
```

That's it. Your AI now remembers.

---

## How It Works

```
You (in Claude Code): "We decided to use CloudKit for sync instead of Firebase"

Claude Code → capture_thought tool → ShelbyMCP:
  1. Stores thought in SQLite
  2. Agent provides metadata (type: decision, topics: [sync, cloud])
  3. Agent suggests relationships to existing thoughts
  4. FTS5 indexes content for keyword search

Later:
You: "What did we decide about our sync strategy?"

Claude Code → search_thoughts tool → ShelbyMCP:
  1. FTS5 keyword search for "sync strategy"
  2. Returns thought + all connected thoughts via knowledge graph
  3. Agent has full context of decisions, alternatives considered, and related work
```

### With the Forage Skill (scheduled, daily):

```
Forage runs on Claude Code's scheduler:
  1. Backfills embeddings for thoughts that don't have them
  2. Re-classifies poorly tagged thoughts
  3. Finds duplicate thoughts and merges them
  4. Detects contradictions ("we said PostgreSQL last month but SQLite this week")
  5. Discovers connections between thoughts across projects
  6. Sweeps for stale action items that fell through the cracks
  7. Generates a weekly digest of your thinking
```

---

## MCP Tools

| Tool | Description |
|---|---|
| `capture_thought` | Store a thought with summary, metadata, topics, and relationships |
| `search_thoughts` | Full-text search with knowledge graph expansion (returns summaries, not full content) |
| `list_thoughts` | Browse/filter by type, topic, person, project, date range |
| `get_thought` | Retrieve a specific thought by ID |
| `update_thought` | Update content or metadata |
| `delete_thought` | Remove a thought |
| `link_thoughts` | Create a typed relationship between two thoughts |
| `unlink_thoughts` | Remove a relationship |
| `get_connections` | Get all thoughts connected to a given thought |
| `thought_stats` | Aggregate statistics about your memory |
| `search_by_embedding` | Vector similarity search (requires embeddings) |
| `capture_edge` | Create a knowledge graph edge with metadata |
| `get_graph` | Traverse the knowledge graph from a starting thought |
| `bulk_capture` | Capture multiple thoughts in one call |
| `bulk_update` | Update metadata on multiple thoughts in one call (for Forage efficiency) |

---

## Knowledge Graph

What makes ShelbyMCP different from every other memory server is the knowledge graph. Thoughts aren't isolated — they're connected.

### Edge Types

| Edge Type | Meaning | Example |
|---|---|---|
| `refines` | A thought that adds detail to another | "Use CloudKit" → "Configure change tokens for sync" |
| `cites` | A thought that references another as evidence | "Decision doc" → "Performance benchmark results" |
| `refuted_by` | A thought that contradicts another | "Use Firebase" ← "Switch to CloudKit" |
| `tags` | A thought that categorizes another | "Architecture" → "CloudKit sync design" |
| `related` | General association | "Auth system" ↔ "User migration plan" |
| `follows` | Sequential relationship | "Phase 1 plan" → "Phase 2 plan" |

Agents create edges at capture time ("this decision relates to thought X") and the Forage skill discovers additional connections over time.

---

## The Forage Skill

ShelbyMCP ships with `shelby-forage`, a scheduled skill that runs on your existing AI subscription (Claude Code, Codex, etc.) to continuously improve your memory. The server stays zero-dependency — the intelligence comes from tools you're already paying for.

| Task | Frequency | What it does |
|---|---|---|
| **Embed backfill** | Daily | Generate embeddings for thoughts that don't have them |
| **Auto-classify** | Daily | Re-scan poorly tagged thoughts, improve metadata |
| **Consolidation** | Daily | Find duplicate/similar thoughts, merge into rich summaries |
| **Contradiction detection** | Daily | Flag conflicting memories for user resolution |
| **Connection discovery** | Daily | Find related thoughts, create knowledge graph edges |
| **Stale sweep** | Weekly | Flag old action items that fell through the cracks |
| **Digest** | Weekly | Generate a summary of the week's thinking |

### Install

```bash
cp -r skills/shelby-forage ~/.claude/scheduled-tasks/shelby-forage
```

The skill runs daily by default. Edit the SKILL.md frontmatter to adjust the schedule.

### Without the Forage Skill

ShelbyMCP works fine without it — you get persistent storage, FTS5 search, and knowledge graph. The Forage skill adds the intelligence layer that makes memories smarter over time. Think of it as optional but recommended.

---

## Agent Setup

ShelbyMCP works with any MCP-compatible AI tool. See [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md) for setup guides:

- Claude Code
- Cursor
- Codex
- Windsurf
- Gemini CLI
- OpenCode
- Any MCP-compatible client

---

## Architecture

ShelbyMCP is a single binary that communicates via MCP (stdio JSON-RPC) and stores everything in a single SQLite file.

```
AI Tool (Claude Code, Cursor, etc.)
    │
    │ MCP (stdio JSON-RPC)
    │
    ▼
┌──────────────────────┐
│      ShelbyMCP        │
│                        │
│  ┌──────────────────┐ │
│  │   MCP Protocol    │ │  ← JSON-RPC request/response
│  │   (stdio)         │ │
│  └────────┬─────────┘ │
│           │            │
│  ┌────────▼─────────��� │
│  │   Tool Router     │ │  ← Routes to capture/search/link/etc.
│  └────────┬─────────┘ │
│           │            │
│  ┌────────▼─────────┐ │
│  │    SQLite DB      │ │
│  │  ┌─────────────┐ │ │
│  │  │  thoughts    │ │ │  ← Content, metadata, embeddings
│  │  │  thought_fts │ │ │  ← FTS5 full-text index
│  │  │  edges       │ │ │  ← Knowledge graph relationships
│  │  └─────────────┘ │ │
│  └──────────────────┘ │
└──────────────────────┘
         │
         ▼
    ~/.shelbymcp/memory.db  (single file)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full technical design.

---

## Comparison

| | ShelbyMCP | Engram | Mem0 | Basic Memory | Cipher |
|---|---|---|---|---|---|
| **Dependencies** | Zero | Zero | Docker+Qdrant+Neo4j | Python+pip | Node.js |
| **Storage** | SQLite | SQLite | Qdrant+Neo4j+SQLite | Markdown+SQLite | Files |
| **Knowledge graph** | Native (typed edges) | No | Neo4j (separate service) | Derived from Markdown | No |
| **Full-text search** | FTS5 | FTS5 | Limited | FTS5 | No |
| **Vector search** | Via Forage skill | No | Built-in | Optional | No |
| **Memory maintenance** | Forage skill (daily) | No | Built-in | No | No |
| **Contradiction detection** | Forage skill | No | No | No | No |
| **Zero-install** | `npx shelbymcp` | `go install` | No | `pip install` | `npm install` |
| **Single file DB** | Yes | Yes | No | No (Markdown files) | No |

---

## Part of the Shelby Ecosystem

ShelbyMCP is the open-source memory server. **[Shelby for Mac](https://github.com/Studio-Moser/Shelby)** is the native macOS app that adds:

- Always-on embedding pipeline (no scheduled skill needed)
- Instant auto-classification at capture time
- Semantic vector search
- CloudKit sync across all your Macs
- Heartbeat system (Pulse / Tidyup / Forage)
- Native menu bar + global hotkey quick capture
- Extension discovery and management

ShelbyMCP and Shelby for Mac use the same SQLite database. Start with the MCP server, upgrade to the Mac app when you want more.

---

## Design Principles for Contributors

These are non-negotiable. They exist because MCP servers directly impact token costs for every user on every message.

1. **Tool descriptions MUST be static.** Tool definitions become part of the agent's system prompt and are sent on every message. Dynamic data (counts, timestamps, user-specific info) in descriptions breaks prompt caching — costing 10x more tokens. Put dynamic data in tool *responses*, not descriptions. See [Architecture: Token Efficiency Patterns](docs/ARCHITECTURE.md#token-efficiency-patterns).

2. **Search returns summaries, not full content.** A search hitting 20 thoughts at 2,000 words each = 40K wasted tokens. Search results return the agent-provided `summary` field (one line). The agent calls `get_thought` for full content when it needs it.

3. **All list/search tools have a `limit` parameter.** Default 20, max 100. No unbounded queries.

4. **The server runs zero inference.** Agents provide metadata (type, topics, summary, relationships) at capture time. The Forage skill handles enrichment. The server is pure storage + retrieval.

5. **All logging to stderr.** `console.error` only. stdout is the MCP JSON-RPC channel. A single `console.log` breaks everything.

---

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run in development
npm run dev -- --db ./test.db --verbose
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the full development guide.

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

- **Issues first** — Open an issue before starting work
- **PRs welcome** — Bug fixes, new MCP tools, documentation improvements
- **Forage tasks** — Propose new Forage skill tasks for memory enrichment

---

## License

MIT - see [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>Built by <a href="https://github.com/Studio-Moser">Studio Moser</a>. Your AI deserves a memory that connects the dots.</sub>
</p>
