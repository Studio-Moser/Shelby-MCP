# Changelog

All notable changes to ShelbyMCP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial MCP server with stdio JSON-RPC protocol
- SQLite database with FTS5 full-text search
- Knowledge graph with typed edges (refines, cites, refuted_by, tags, related, follows)
- 14 MCP tools: capture, search, list, get, update, delete, link, unlink, connections, stats, embedding search, edge capture, graph traversal, bulk capture
- Forage scheduled skill for Claude Code (embed backfill, auto-classify, consolidation, contradiction detection, connection discovery, stale sweep, digest)
- Agent setup documentation for Claude Code, Cursor, Codex, Windsurf
