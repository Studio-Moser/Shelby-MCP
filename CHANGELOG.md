# Changelog

All notable changes to ShelbyMCP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Canonical immutable project UUIDs, alias-aware project resolution, and additive `project_id` inputs and outputs for project-scoped MCP tools.
- Curated `get_brief` policy with trusted exact-project/shared eligibility, sensitivity and prompt-injection filtering, consolidation/refutation handling, deterministic role lanes, summary deduplication, an 800-token default budget, structured items, and omission diagnostics. The MCP schema now exposes `include_shared`; `select_context` reuses the same curated essentials policy.
- Claim-scoped refutation. A `refuted_by` edge whose `metadata` carries a non-empty string `claim` now supersedes **only that claim**: the source thought stays brief-eligible and renders as `- <summary> (superseded: <claim>)`. `get_brief` items gain a `refuted_claims` array. Previously refutation was all-or-nothing, so correcting one claim in a multi-claim thought dropped every still-valid claim it carried out of every brief. See [ADR 0001 §5a](https://github.com/Studio-Moser/Shelby-Docs/blob/main/docs/adr/0001-memory-server-architecture-contract.md).

### Changed

- **Breaking (output shape):** `get_brief` items now always include a `refuted_claims` array, and a thought carrying a scoped refutation renders with a `(superseded: …)` caveat appended to its line. Consumers that parse brief markdown or item objects should tolerate both. `policy_version` bumped 1 → 2 to signal the change; the canonical cross-codebase fixture is at `fixture_version` 2.
- A `refuted_by` edge with no `claim`, a blank `claim`, or a non-string `claim` continues to refute the whole thought. Existing edges carry no `metadata`, so stored data and current behaviour are unaffected.
- Claim text passes the same normalization, prompt-injection and PII gate as summaries before reaching a brief; a claim that fails the gate is dropped without affecting its thought's eligibility.

- Project-scoped reads and updates now use UUID identity while retaining current slugs as compatibility fields.
- Schema version stamp bumped from 4 → 5 to align with Shelby-MacOS's Swift memory implementation, per [ADR 0001 §8](https://github.com/Studio-Moser/Shelby-Docs/blob/main/docs/adr/0001-memory-server-architecture-contract.md). No actual schema change — the v5 migration is a no-op version stamp. Both codebases now advance through the same migration sequence so cross-codebase tooling and conformance tests can rely on a single number.
- Logged server version constant updated from `0.1.0` → `0.3.0` to match `package.json`. Comment added to keep them in sync.

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
