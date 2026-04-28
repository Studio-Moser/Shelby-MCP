<p align="center">
  <img src="docs/assets/shelby-mcp-header.png" alt="ShelbyMCP" width="720" />
</p>

<p align="center">
  <strong>The memory backbone for Shelby — and a standalone knowledge-graph memory server for any MCP-compatible AI tool.</strong><br/>
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

ShelbyMCP is the open-source memory backbone of [Shelby](https://shelbybot.com) — your AI coworker on Mac — and a zero-dependency MCP memory server you can run standalone with any MCP-compatible AI tool. It gives Claude Code, Cursor, Codex, Windsurf, Gemini, Antigravity, and others persistent memory that understands how your thoughts are related — not just what they contain.

Ship it with the **Forage skill**, a scheduled task that runs on your existing AI subscription to continuously enrich, consolidate, and connect your memories. No Docker. No Python. No cloud accounts. Just a binary and a database file.

> **Where this fits in Shelby**: Shelby is an AI coworker built on three layers — companion (the experience), harness (the runtime that carries context, enforces governance, holds history), and memory (this server). If you want the full coworker experience, install Shelby for Mac. If you only want the memory backbone for your existing AI tools, ShelbyMCP standalone is what you want.

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

### 1. Install

```bash
# npx (no install needed)
npx shelbymcp

# Or install globally
npm install -g shelbymcp

# Or build from source
git clone https://github.com/Studio-Moser/shelbymcp.git
cd shelbymcp && npm install && npm run build
```

### 2. Set Up Your Agent

The CLI auto-configures everything — MCP server registration, Memory Protocol, and optional Forage skill:

```bash
shelbymcp setup claude-code --forage    # Claude Code CLI
shelbymcp setup claude-desktop --forage # Claude Desktop app
shelbymcp setup cursor --forage         # Cursor IDE
shelbymcp setup codex --forage          # OpenAI Codex
shelbymcp setup windsurf --forage       # Windsurf (Codeium)
shelbymcp setup gemini --forage         # Gemini CLI
shelbymcp setup antigravity --forage    # Antigravity (Google)
```

Drop `--forage` if you just want the MCP server without the scheduled enrichment skill.

That's it. The CLI registers the MCP server, adds the Memory Protocol to the right place, and installs the Forage skill. See [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md) for manual config and platform-specific details.

### 3. Add the Memory Protocol

Most agents get the Memory Protocol added automatically during setup. For agents that require manual steps, the CLI will tell you exactly what to do. Here's where it goes:

```bash
shelbymcp protocol >> ~/.claude/CLAUDE.md                              # Claude Code (auto)
shelbymcp protocol >> ~/.codex/AGENTS.md                               # Codex (auto)
shelbymcp protocol >> ~/.codeium/windsurf/memories/global_rules.md     # Windsurf (auto)
shelbymcp protocol >> ~/.gemini/GEMINI.md                              # Gemini CLI / Antigravity (auto)
```

For Cursor, paste into **Settings > Rules > User Rules**. For Claude Desktop, paste into **Settings > General > "What personal preferences should Claude consider in responses?"**. The Memory Protocol tells your agent *when* to save and search — without it, the tools are available but won't be used proactively.

### 4. Seed Your Memory

Your database is empty after install. There are three ways to make it useful immediately:

```bash
# Option A: Run the onboarding interview (recommended)
# Paste this into a conversation — it asks a few questions and saves 15-30 memories
shelbymcp onboard

# Option B: Import from another AI tool
# Paste this prompt into ChatGPT/Claude/Gemini, copy the response back
shelbymcp migrate

# Option C: Just start working — memories accumulate naturally over time
```

The **onboard** skill runs a conversational interview covering who you are, what you're building, your team, preferences, and anti-patterns. Takes about 5 minutes. The **migrate** prompt tells your other AI tools to export everything they know about you in a structured format that ShelbyMCP can import.

### 5. Verify

Ask your agent: *"What memory tools do you have available?"*

It should list 9 tools. Then test: *"Remember that I prefer dark mode in all my apps."* — and in a new session: *"What do you know about my preferences?"*

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

9 focused tools — research shows 5-8 tools per server is the sweet spot for agent accuracy.

| Tool | Description |
|---|---|
| `capture_thought` | Store a thought with summary, metadata, topics, and relationships. Accepts an array for bulk capture. |
| `search_thoughts` | Full-text search with knowledge graph expansion. Auto-detects FTS5 vs. vector mode. Returns summaries, not full content. |
| `list_thoughts` | Browse/filter by type, topic, person, project, date range |
| `get_thought` | Retrieve a specific thought by ID (full content) |
| `update_thought` | Update content or metadata. Accepts `ids` array for bulk updates. |
| `delete_thought` | Remove a thought |
| `manage_edges` | Create or remove typed relationships between thoughts (link, unlink) |
| `explore_graph` | Traverse the knowledge graph from a starting thought. Depth 1 = direct connections, 2+ = full traversal. |
| `thought_stats` | Aggregate statistics about your memory |

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
| **Summary backfill** | Daily | Generate one-liners for thoughts missing summaries |
| **Auto-classify** | Daily | Improve type/topics/people on poorly tagged thoughts |
| **Consolidation** | Daily | Find and merge duplicate thoughts |
| **Contradiction detection** | Daily | Flag conflicting memories (tagged `needs-attention`) |
| **Connection discovery** | Daily | Create edges between related thoughts |
| **Stale sweep** | Weekly (Mon) | Flag forgotten action items (tagged `needs-attention`) |
| **Digest** | Weekly (Mon) | Summary of the week's thinking by project/topic |
| **Forage log** | Every run | Audit trail for continuity between runs |

### Setup

See [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md#3-forage-skill-optional) for full setup instructions, platform compatibility table, and gotchas for each agent.

### Without the Forage Skill

ShelbyMCP works fine without it — you get persistent storage, FTS5 search, and knowledge graph. The Forage skill adds the intelligence layer that makes memories smarter over time. Think of it as optional but recommended.

---

## Getting Started: Onboard & Migrate

An empty memory database is a cold start problem — your AI tools can't personalize until they know something about you. ShelbyMCP ships with two tools to solve this:

### The Onboard Skill (recommended)

A one-time conversational interview that seeds 15-30 foundational memories. Paste the prompt into a conversation with your primary AI tool:

```bash
shelbymcp onboard
```

It covers:
- **Who you are** — name, role, expertise
- **What you're building** — projects, goals, tech stack
- **Who you work with** — team, roles, stakeholders
- **How you like to work** — communication style, coding preferences, AI interaction style
- **What to avoid** — anti-patterns, pet peeves, past frustrations

Takes about 5 minutes. The skill adapts its questions based on your answers — if you're a solo founder, it won't ask about team structure. Memories are saved after each round so you can see them accumulate in real time.

### The Migrate Prompt

Already have context stored in ChatGPT, Claude, Gemini, or another AI? Export it:

```bash
shelbymcp migrate
```

This prints a prompt you paste into your other AI tool. That tool dumps everything it knows about you in a structured format. Copy the response back into your ShelbyMCP-connected agent — the onboard skill will parse and import it, or you can just paste it into any conversation and ask the agent to import it.

Works with any AI that has memory or conversation history about you. Run it once per tool you're migrating from.

---

## CLI Reference

```
shelbymcp                          Start the MCP server (stdio)
shelbymcp --transport http         Start as HTTP server (Streamable HTTP)
shelbymcp setup <agent>            Set up ShelbyMCP for an agent
shelbymcp setup <agent> --forage   ...and install the Forage skill
shelbymcp uninstall <agent>        Remove ShelbyMCP from an agent
shelbymcp protocol                 Print the Memory Protocol
shelbymcp forage                   Print the Forage skill prompt
shelbymcp onboard                  Print the onboarding interview prompt
shelbymcp migrate                  Print the migration prompt for other AI tools
shelbymcp help                     Show help
shelbymcp --version                Print version
```

**Supported agents:** `claude-code`, `claude-desktop`, `cursor`, `codex`, `windsurf`, `gemini`, `antigravity`

**Server flags:**

| Flag | Default | Description |
|---|---|---|
| `--db <path>` | `~/.shelbymcp/memory.db` | Custom database path |
| `--verbose` | off | Debug logging |
| `--transport <stdio\|http>` | `stdio` | Transport mode |
| `--port <number>` | `3100` | HTTP port (only with `--transport http`) |
| `--host <address>` | `127.0.0.1` | HTTP bind address (only with `--transport http`) |

**Remote server example (Streamable HTTP):**

```bash
# Start ShelbyMCP as an HTTP server
shelbymcp --transport http --port 3100

# Connect from Claude Code
claude mcp add --transport http shelby http://localhost:3100/mcp
```

See [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md) for manual config, platform-specific details, and setup for other MCP-compatible clients.

---

## Cloud Deployment

ShelbyMCP can run as a remote HTTP server, letting you share one memory database across multiple machines. All configuration is via environment variables:

| Variable | Default | Description |
|---|---|---|
| `SHELBY_TRANSPORT` | `stdio` | Set to `http` for remote server mode |
| `PORT` | `3100` | HTTP port (most cloud platforms inject this) |
| `HOST` | `0.0.0.0` (http) / `127.0.0.1` (stdio) | Bind address |
| `SHELBY_DB_PATH` | `~/.shelbymcp/memory.db` | SQLite database path (use a persistent volume) |
| `SHELBY_API_KEY` | *(none)* | Bearer token for auth — **set this for any internet-facing deployment** |

CLI flags (`--transport`, `--port`, `--host`, `--db`) override env vars when both are set.

### Docker

```bash
docker build -t shelbymcp .
docker run -d \
  -e SHELBY_TRANSPORT=http \
  -e SHELBY_API_KEY=your-secret-key \
  -v shelby-data:/data \
  -e SHELBY_DB_PATH=/data/memory.db \
  -p 3100:3100 \
  shelbymcp
```

### Connect from Claude Code

```bash
claude mcp add --transport http shelby-cloud https://your-server.example.com/mcp \
  --header "Authorization: Bearer your-secret-key"
```

### Health Check

`GET /health` returns `200 {"status": "ok"}` (unauthenticated). Configure this as your platform's health check endpoint.

### Auth

When `SHELBY_API_KEY` is set, all requests to `/mcp` require an `Authorization: Bearer <key>` header. Without the key, requests return `401`. If `SHELBY_API_KEY` is not set, auth is disabled (suitable for local-only use).

---

## Architecture

ShelbyMCP is a single binary that communicates via MCP and stores everything in a single SQLite file. Supports both **stdio** (local, default) and **Streamable HTTP** (remote/multi-client) transports.

```
AI Tool (Claude Code, Cursor, etc.)
    │
    │ MCP (stdio or Streamable HTTP)
    │
    ▼
┌──────────────────────┐
│      ShelbyMCP        │
│                        │
│  ┌──────────────────┐ │
│  │   MCP Protocol    │ │  ← JSON-RPC request/response
│  │ (stdio or HTTP)   │ │
│  └────────┬─────────┘ │
│           │            │
│  ┌────────▼─────────┐ │
│  │   Tool Router    │ │  ← Routes to capture/search/link/etc.
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

ShelbyMCP is the open-source memory server. **Shelby for Mac** (coming soon) is the native macOS app that adds:

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

3. **All list/search tools have a `limit` parameter.** Default 20, max 100. Responses include `total_count` and `has_more`. No unbounded queries.

4. **The server runs zero inference.** Agents provide metadata (type, topics, summary, relationships) at capture time. The Forage skill handles enrichment. The server is pure storage + retrieval.

5. **All logging to stderr.** `console.error` only. stdout is the MCP JSON-RPC channel. A single `console.log` breaks everything.

6. **Keep the tool count focused.** 9 tools. Research (Block, Phil Schmid, Docker) shows 5-8 per server is optimal. Consolidate related operations into single tools with action parameters.

7. **Errors are instructions.** Return `isError: true` with actionable messages. "Not found" is useless. "No thought with ID abc123. Try search_thoughts to find it by content." helps the agent self-correct.

8. **Every tool gets annotations.** MCP spec annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) on every registered tool. See [Architecture: Tool Annotations](docs/ARCHITECTURE.md#tool-annotations).

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
