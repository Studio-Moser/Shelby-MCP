# Changelog

All notable changes to ShelbyMCP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-28

### Added
- MCP server with stdio JSON-RPC protocol via `@modelcontextprotocol/sdk`
- SQLite database with WAL mode, FTS5 full-text search, and vector similarity
- Knowledge graph with typed edges (refines, cites, refuted_by, tags, related, follows)
- 9 focused MCP tools: capture_thought, search_thoughts, list_thoughts, get_thought, update_thought, delete_thought, manage_edges, explore_graph, thought_stats
- Forage scheduled skill with 8 tasks (summary backfill, auto-classify, consolidation, contradiction detection, connection discovery, stale sweep, digest, forage log)
- CLI commands: `setup <agent>`, `uninstall <agent>`, `protocol`, `forage`, `help`
- Auto-setup for 6 agents: Claude Code CLI, Claude Desktop, Cursor, Codex, Windsurf, Gemini CLI
- `--forage` flag on setup to install the Forage skill alongside the MCP server
- Memory Protocol — copy-paste instructions that tell agents when to save/search
- Agent setup docs with per-agent config paths, formats, and gotchas
- Forage platform compatibility table with scheduling support per agent
- 134 tests across 3 layers (database, tools, MCP integration)
