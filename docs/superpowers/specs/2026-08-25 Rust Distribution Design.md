# Rust Distribution and TypeScript Retirement Design

**Date:** 2026-08-25
**Status:** Proposed for implementation
**Scope:** A1–A3 of the Rust migration initiative

## Outcome

ShelbyMCP ships one Rust implementation of the memory engine and MCP server. Existing users keep the `npx shelbymcp` command, current databases, transports, OAuth, and supported CLI workflows, while client-native packages become the preferred installation path. The TypeScript server, database engine, installer implementation, tests, and runtime dependency tree are removed.

This initiative produces two review boundaries:

1. Existing PR #63 is hardened and made review-ready without adding distribution work to its 10,000-line engine port.
2. `feature/rust-distribution` is a stacked PR based on `feat/rust-memory-crate`; after PR #63 merges, it is retargeted to `main` without changing its implementation commits.

## Context

PR #63 already contains:

- `shelby-memory`, including schema migrations v1–v18, storage, reconciliation, project scope, briefs, and tool handlers.
- `shelby-mcp`, including stdio, Streamable HTTP, bearer authentication, and OAuth 2.1.
- Database and tool parity tests derived from the TypeScript implementation.

The remaining TypeScript surface owns CLI installers, static prompt printers, `repair-projects`, Gemini server-side auto-embedding, npm distribution, and the old test suite. The current GitHub workflow tests only Node 20 and 22. Its Cargo test currently reports the cross-engine test as passing when `SHELBY_TS_DB` is absent even though the body skips, so CI does not yet prove cross-engine compatibility.

The existing npm dependency tree reports 17 vulnerabilities on a clean install, including two critical findings. Removing that dependency tree is an acceptance condition of the cutover.

Current client ecosystems favor installable packages over global config mutation:

- ChatGPT and Codex use one universal plugin directory. Local Codex clients share MCP configuration, consume MCP server `instructions`, and support stdio and Streamable HTTP.
- Claude Code plugins, target-specific Claude Desktop MCP Bundles, Cursor Agent Plugins, Gemini extensions, Antigravity plugins, and Devin marketplace metadata each provide a native distribution surface.

## Goals

1. Add CI that proves the Rust workspace, the existing TypeScript baseline while it remains, and a real TypeScript-v18 database compatibility fixture.
2. Make the Rust CLI feature-complete for all currently documented commands.
3. Preserve `npx shelbymcp` with a small JavaScript launcher that selects a platform-specific Rust binary package.
4. Publish reproducible Rust binaries for supported desktop/server targets.
5. Replace bespoke installer-first documentation with client-native integration packages and retain a safe Rust fallback for manual CLI setup.
6. Expose `shelby-mcp` as a library plus binary so the later Shelby-App initiative can embed the same server.
7. Remove the TypeScript engine and all TypeScript runtime and development dependencies.

## Non-goals

- Wiring `shelby-memory` or the MCP router into Shelby-App. That is A4 and will branch from Shelby-App `main` after this initiative.
- Porting the agent runtime.
- Publishing marketplace listings or production releases from this PR. The PR builds and validates release artifacts; maintainers retain the release approval step.
- Migrating data from `~/.shelbymcp` into `~/.shelby-app`.
- Adding a replacement server-side embedding provider. Standalone embeddings continue to come from callers or Forage; the later app owns its embedding pipeline.

## Approaches Considered

### O1 — Port the seven TypeScript installers line-for-line

This preserves exact mutation behavior but encodes paths and command syntax that the clients are replacing with plugins, extensions, bundles, and registries. It also makes the future app inherit an obsolete installer model. Rejected.

### O2 — Ship native packages only and remove `setup`/`uninstall`

This is the smallest implementation, but it breaks existing documented commands and leaves unsupported or enterprise-managed clients without a fallback. Rejected.

### O3 — Package-first distribution plus a shared Rust fallback catalog

Native packages are the primary path. A small `shelby-integrations` crate owns supported-client metadata, status detection, and idempotent fallback install/uninstall operations. The Rust CLI consumes it now; Shelby-App can consume the same public API later. Selected because it preserves compatibility without making config mutation the product architecture.

## Architecture

### Rust workspace

The workspace contains three library boundaries and one binary:

- `shelby-memory`: database and tool contract; unchanged ownership.
- `shelby-integrations`: supported-client catalog, installation status, and fallback config operations. It has no Tauri dependency and never contacts a marketplace.
- `shelby-mcp` library: MCP handler, prompts, OAuth, HTTP router construction, and reusable server startup primitives.
- `shelby-mcp` binary: argument parsing, database opening, command dispatch, stdio lifecycle, and HTTP lifecycle.

`shelby-mcp` continues to expose one package with both `[lib]` and `[[bin]]`; a fourth server crate would add no useful boundary.

### CLI contract

The Rust binary supports:

- Server mode and existing flags: `--db`, `--transport`, `--port`, `--host`, `--verbose`, `--version`, and the accepted compatibility flag `--log-file`.
- `setup <agent> [--forage] [--onboard]`
- `uninstall <agent>`
- `protocol`
- `forage`
- `onboard`
- `migrate`
- `repair-projects [--apply]`

Static prompt commands use `include_str!` over canonical repository assets. `repair-projects` calls the Rust engine. Setup and uninstall use `shelby-integrations` and remain idempotent.

Native integration packages are the documented default. CLI fallback setup may use a stable client CLI when installed; otherwise it performs a tested atomic config merge. It does not append the Memory Protocol to global `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor rules, or Windsurf rules. The MCP initialization `instructions` field carries server-wide guidance, while packaged skills carry Forage and onboarding workflows.

Fallback config writes follow four rules:

1. Resolve the exact user-scoped target before writing.
2. Preserve unrelated keys and formatting where the format permits.
3. Write through a sibling temporary file and atomically rename it.
4. Return a structured result describing changed, already configured, manual action required, or failure.

Tests inject a temporary home directory and a command runner; they never modify the developer's live client configuration.

### Integration packages

Committed sources under `integrations/` describe:

- A Codex/ChatGPT plugin with `.codex-plugin/plugin.json`, MCP configuration, and the canonical Shelby skills.
- A Claude Code plugin with `.claude-plugin/plugin.json` and `.mcp.json`.
- A Cursor Agent Plugin with root `plugin.json` and `mcp.json`.
- A Gemini extension with `gemini-extension.json`.
- An Antigravity plugin using its current manifest and MCP configuration.
- A Claude Desktop MCP Bundle manifest assembled with the target binary.
- Devin marketplace metadata plus a separate legacy Windsurf CLI fallback.

The source tree has one canonical copy of each skill. A packaging script assembles per-client archives into `target/integrations/`; generated archives are not committed. Manifests launch `npx -y shelbymcp` when the client expects a portable stdio command. The MCP Bundle release artifact embeds the platform binary and needs no separate Node installation.

The Codex plugin is scaffolded and validated with the repository's `plugin-creator` workflow. Other formats are validated against their official schemas or, where no machine-readable validator exists, focused JSON contract tests.

### npm distribution

The public package remains named `shelbymcp` and advances to version `0.4.0`, matching the Cargo workspace. It contains:

- A small ESM launcher under `bin/`.
- The integration/skill assets needed by fallback commands.
- Optional dependencies on platform packages whose versions exactly equal the wrapper version.

The launcher maps `process.platform` and `process.arch` to a supported package, resolves its binary without a shell, spawns it with inherited stdio, forwards arguments and termination status, and prints an actionable unsupported-platform or missing-package error. It contains no server logic.

Initial release targets are:

- `aarch64-apple-darwin`
- `x86_64-apple-darwin`
- `x86_64-unknown-linux-gnu`
- `aarch64-unknown-linux-gnu`
- `x86_64-pc-windows-msvc`

The release workflow builds and tests each available native target, uploads checksummed GitHub Release archives, assembles the npm platform packages, and leaves npm/crates.io publication behind protected release secrets and environment approval.

### TypeScript compatibility fixture

Before removing TypeScript, a deterministic TypeScript-v18 database is generated from the shipping engine and committed as a small fixture. The Rust compatibility test copies that fixture to a temporary path, opens it without migration, verifies registry aliases, canonical topics, FTS triggers, and existing rows, then writes and reads a Rust row.

The test fails if the fixture is missing; absence is never reported as a pass. A one-time pre-cutover check also opens the Rust-written database with the TypeScript engine. After cutover, the immutable fixture remains the regression seam.

Shared JSON policy and identity fixtures remain canonical and continue to run in Rust.

### Server instructions

`ShelbyServer::get_info` returns concise initialization instructions. The first 512 characters state the scope and capture rules needed for safe default use. The full text is derived from the Memory Protocol asset so it cannot drift independently.

This replaces installer edits to global agent instruction files and follows current Codex behavior, while registered MCP prompts remain available to clients that expose prompts explicitly.

## Error handling and safety

- HTTP remains authenticated when `SHELBY_API_KEY` is configured; OAuth behavior from PR #63 is unchanged.
- The launcher never builds a shell command from user arguments.
- Config mutations parse and validate the existing document before replacing it; malformed files are left untouched with a manual-action result.
- Uninstall removes only the Shelby-owned server entry and packaged Shelby files. It never deletes a whole user config or instruction file.
- Release jobs never print registry tokens and run publication only in protected environments.
- The pre-commit check must find no credentials, disabled security controls, swallowed errors, or unvalidated trust-boundary input.

## Testing and acceptance

### PR #63 foundation gate

- `cargo fmt --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`
- Real TypeScript-v18 compatibility fixture test
- Existing Node 20 and 22 checks while TypeScript remains on that branch
- PR body accurately states OAuth is complete
- Independent review has no unresolved critical or important findings

### Distribution PR gate

- Every new Rust behavior follows red-green-refactor tests.
- CLI integration tests spawn the built binary for every command and confirm stdout/stderr discipline.
- Installer tests operate only against temporary homes and fake client executables.
- Node's built-in test runner covers platform resolution, argument forwarding, exit propagation, missing packages, and unsupported platforms.
- Integration manifest assembly and validation run in CI.
- Release workflow syntax and package contents are checked without publishing.
- `npm install` of the final wrapper reports no runtime or development dependency vulnerabilities because the TypeScript dependency tree is gone.
- `cargo test --workspace`, fmt, clippy, npm launcher tests, package smoke tests, and documentation link checks pass from a clean checkout.
- `rg` finds no runtime imports or documentation that direct users to the removed TypeScript engine or Gemini auto-embedding environment variables.

## Rollout

1. Harden PR #63 and keep it focused on the engine/server foundation.
2. Implement and review the stacked distribution PR.
3. Merge PR #63.
4. Retarget the distribution PR to `main`, rebase if necessary, and rerun all gates.
5. Merge without publishing.
6. Publish `0.4.0` from its exact tag through the protected workflow, verify `npx shelbymcp --version`, stdio initialization, HTTP OAuth, and an existing database.
7. Promote the same artifacts after manual release approval.

## Deferred app reuse

The later Shelby-App initiative depends on the published `shelby-memory`, `shelby-integrations`, and `shelby-mcp` library APIs. It will branch from Shelby-App `main`, replace the temporary loopback endpoint with the shared router on port 7891, and use the integration catalog for its connections UI. No app file changes belong in this initiative.
