# ShelbyMCP — AI Development Context

## What This Is

ShelbyMCP is an open-source MCP memory server with a knowledge graph. It gives AI tools (Claude Code, Cursor, Codex, etc.) persistent memory that understands how thoughts are related.

## Tech Stack

- **Language**: Go (1.22+)
- **Database**: SQLite via `modernc.org/sqlite` (pure Go, no CGO)
- **Protocol**: MCP (Model Context Protocol) over stdio JSON-RPC
- **Search**: FTS5 (full-text), custom cosine similarity (vector)
- **Zero dependencies**: Single binary, single SQLite file

## Architecture

- `cmd/shelbymcp/` — Entry point, CLI flags
- `internal/db/` — All SQLite operations (thoughts, edges, FTS, vectors, migrations)
- `internal/mcp/` — MCP stdio server and protocol handling
- `internal/tools/` — MCP tool implementations (one file per tool group)
- `internal/config/` — Configuration
- `skills/shelby-forage/` — Shipped scheduled skill for memory enrichment
- `docs/` — Architecture, agent setup, development guide

## Key Design Decisions

1. **Smart agent, dumb server.** The server runs zero inference. Agents provide structured metadata at capture time. The Forage skill uses the user's AI subscription.
2. **Knowledge graph is the differentiator.** Typed edges (refines, cites, refuted_by, tags, related, follows) between thoughts. This is what sets ShelbyMCP apart from Engram, Cipher, and Basic Memory.
3. **Pure Go SQLite.** Uses `modernc.org/sqlite` (no CGO) so `go build` works on any platform without a C toolchain.
4. **WAL mode.** Concurrent reads during writes. Important when Forage skill and MCP server share the DB.
5. **UUID primary keys.** Avoids collisions from concurrent captures across multiple AI tools.

## Conventions

- Standard Go formatting (`gofmt`)
- Error wrapping with context: `fmt.Errorf("capturing thought: %w", err)`
- Table-driven tests
- No global state — pass DB handle explicitly
- JSON metadata fields for flexibility (topics, people, metadata columns)

## Relationship to Shelby Mac App

This repo is the standalone open-source memory server. The Shelby Mac app (separate repo, GPLv3) wraps the same database schema with:
- Native macOS UI
- CloudKit sync
- Always-on embedding pipeline
- Heartbeat system (Pulse/Tidyup/Forage)

The databases are interoperable — same schema, same file.

## Building and Testing

```bash
go build -o shelbymcp ./cmd/shelbymcp
go test ./...
go vet ./...
```
