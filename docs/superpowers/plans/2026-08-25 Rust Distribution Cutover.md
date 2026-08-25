# Rust Distribution Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship ShelbyMCP as a reusable Rust library/server with complete CLI workflows, native client packages, and a dependency-free npm launcher, then remove the TypeScript implementation.

**Architecture:** Add `shelby-integrations` beside `shelby-memory`, expose `shelby-mcp` as a library plus binary, and keep the binary as the only command dispatcher. Native client packages are assembled from canonical skills and per-client manifests; `setup`/`uninstall` call the same integration catalog the future Shelby app can use. npm becomes a small platform selector over five native workspace packages and contains no memory or server logic.

**Tech Stack:** Rust 2024, `rusqlite`, `rmcp` 3.1, `axum` 0.8, `serde`, `serde_json`, Node.js built-in modules/tests, npm workspaces, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-08-25 Rust Distribution Design.md`

## Global Constraints

- Public package and Cargo workspace version is exactly `0.4.0`.
- Existing `npx shelbymcp` invocations and `~/.shelbymcp/memory.db` files continue to work.
- Supported binary targets are `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, and `x86_64-pc-windows-msvc`.
- OAuth and bearer authentication remain unchanged.
- Server-side Gemini auto-embedding is removed without replacement; callers or Forage supply embeddings and the Shelby app will own its embedding pipeline.
- No setup path appends to `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor rules, or Windsurf/Devin rules.
- Config tests use temporary homes and fake command execution only.
- Generated integration archives live under `target/integrations/` and are not committed.
- Publishing requires a protected release environment and is never triggered by a pull request.
- Before each commit run Cargo fmt, clippy, workspace tests, current npm tests/checks, and the pre-commit security scan.

---

### Task 1: Port project-identity repair into `shelby-memory`

**Files:**
- Create: `crates/shelby-memory/src/repair.rs`
- Modify: `crates/shelby-memory/src/lib.rs`
- Test source: `tests/integrity/project-repair.test.ts`

**Interfaces:**
- Consumes: `seed::Seed`, `seed::ensure_seed_projects`, `seed::source_alias_map`, `projects::list_projects`, `projects::get_project_by_alias`, `thoughts::get_thought`, and `thoughts::update_thought`.
- Produces: `RepairConfidence`, `RepairItem`, `RepairReport`, `plan_project_repairs(&Connection, &Seed)`, and `repair_projects(&mut Connection, &Seed, bool)`.

- [ ] **Step 1: Write Rust tests for every TypeScript repair contract**

In `repair.rs`, add tests covering path inference, a single topic cluster, conflicting topic clusters, longest source alias, empty seed behavior, dry-run immutability, applied high-confidence assignment, metadata merging, null/empty `repaired_from`, low-confidence `needs_project_review`, and transaction rollback. Use fixed thought IDs and an in-memory `Memory`.

The core assertion shape is:

```rust
let report = repair_projects(&mut m.conn, &seed, true).unwrap();
assert_eq!(report.applied, 1);
let thought = get_thought(&m.conn, id).unwrap().unwrap();
assert_eq!(thought.project_identifier.as_deref(), Some("shelby"));
assert_eq!(thought.metadata.unwrap()["repaired_by"], "integrity-project-v1");
```

- [ ] **Step 2: Run the new module test target and verify it fails to compile**

Run: `cargo test -p shelby-memory repair::tests -- --nocapture`

Expected: FAIL because the `repair` module and public types do not exist.

- [ ] **Step 3: Implement deterministic classification and transactional apply**

Define:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepairConfidence { High, Low }

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepairItem {
    pub id: String,
    pub suggested_slug: Option<String>,
    pub confidence: RepairConfidence,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RepairReport {
    pub scanned: usize,
    pub high_confidence: Vec<RepairItem>,
    pub flagged: Vec<RepairItem>,
    pub applied: usize,
}
```

Query candidates once with `project_id IS NULL AND (project_identifier IS NULL OR project_identifier = '')`. Classify in this order: longest matching registered member path, exactly one configured topic cluster, longest source alias then lexicographic tie-break, otherwise low confidence. Seed configured projects before planning. Apply all changes inside one transaction; merge metadata and never set `ai_reviewed`.

- [ ] **Step 4: Run targeted tests, the TypeScript parity tests, and the full commit gate**

```bash
cargo test -p shelby-memory repair::tests -- --nocapture
npm test -- --run tests/integrity/project-repair.test.ts tests/cli/repair-projects.test.ts
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm test
npm run check
git diff --check
git add crates/shelby-memory/src/repair.rs crates/shelby-memory/src/lib.rs
git commit -m "feat: repair project identity in Rust"
```

Expected: Rust and TypeScript contracts agree and all gates pass.

### Task 2: Add the reusable client integration catalog

**Files:**
- Create: `crates/shelby-integrations/Cargo.toml`
- Create: `crates/shelby-integrations/src/lib.rs`
- Create: `crates/shelby-integrations/src/catalog.rs`
- Create: `crates/shelby-integrations/src/config.rs`
- Create: `crates/shelby-integrations/src/install.rs`
- Modify: `Cargo.toml`
- Modify: `Cargo.lock`

**Interfaces:**
- Consumes: filesystem paths, JSON client configs, stable client CLIs, and the portable command `npx -y shelbymcp`.
- Produces: `Client`, `ClientInfo`, `CLIENTS`, `IntegrationPaths`, `IntegrationStatus`, `Change`, `IntegrationError`, `CommandRunner`, `setup`, `uninstall`, and `status`.

- [ ] **Step 1: Add failing catalog/status/config tests**

Tests must assert:

```rust
assert_eq!(Client::parse("windsurf"), Some(Client::Devin));
assert_eq!(Client::parse("devin"), Some(Client::Devin));
assert_eq!(CLIENTS.len(), 7);
assert!(matches!(status(Client::Cursor, &paths).unwrap(), IntegrationStatus::NotConfigured { .. }));
```

Also test JSON merge/remove preserving unrelated servers, malformed JSON returning `ManualAction` without changing bytes, idempotent setup, idempotent uninstall, CLI success/failure with a fake runner, and no instruction-file writes anywhere under the temporary home.

- [ ] **Step 2: Run the crate tests and verify the workspace member is absent**

Run: `cargo test -p shelby-integrations -- --nocapture`

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Implement the client catalog**

Define:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Client { ClaudeCode, ClaudeDesktop, Cursor, Codex, Devin, Gemini, Antigravity }

pub struct ClientInfo {
    pub client: Client,
    pub slug: &'static str,
    pub display_name: &'static str,
    pub package_kind: &'static str,
}

pub const CLIENTS: [ClientInfo; 7] = [
    ClientInfo { client: Client::ClaudeCode, slug: "claude-code", display_name: "Claude Code", package_kind: "Claude Code plugin" },
    ClientInfo { client: Client::ClaudeDesktop, slug: "claude-desktop", display_name: "Claude Desktop", package_kind: "MCP Bundle" },
    ClientInfo { client: Client::Cursor, slug: "cursor", display_name: "Cursor", package_kind: "Agent Plugin" },
    ClientInfo { client: Client::Codex, slug: "codex", display_name: "ChatGPT and Codex", package_kind: "Codex plugin" },
    ClientInfo { client: Client::Devin, slug: "devin", display_name: "Devin Desktop", package_kind: "MCP plugin" },
    ClientInfo { client: Client::Gemini, slug: "gemini", display_name: "Gemini CLI", package_kind: "Gemini extension" },
    ClientInfo { client: Client::Antigravity, slug: "antigravity", display_name: "Antigravity", package_kind: "Antigravity plugin" },
];
```

`Client::parse("windsurf")` maps to `Devin` for command compatibility. The catalog contains current package names and documentation labels but makes no marketplace network calls.

- [ ] **Step 4: Implement safe JSON mutation and command execution**

Define:

```rust
pub trait CommandRunner {
    fn available(&self, program: &str) -> bool;
    fn run(&self, program: &str, args: &[&str]) -> std::io::Result<bool>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change {
    Changed { path: PathBuf, message: String },
    AlreadyConfigured { path: PathBuf },
    AlreadyAbsent { path: PathBuf },
    ManualAction { message: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntegrationPaths {
    pub home_dir: PathBuf,
    pub app_data_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IntegrationStatus {
    Configured { path: PathBuf },
    NotConfigured { path: PathBuf },
    ManualAction { message: String },
}

pub fn status(client: Client, paths: &IntegrationPaths) -> Result<IntegrationStatus>;
pub fn setup(client: Client, paths: &IntegrationPaths, runner: &dyn CommandRunner) -> Result<Change>;
pub fn uninstall(client: Client, paths: &IntegrationPaths, runner: &dyn CommandRunner) -> Result<Change>;
```

Define `IntegrationError` with `thiserror` variants for filesystem, JSON, and command failures, plus a crate-local `Result<T>` alias. Use client CLIs for Claude Code, Codex, and Gemini when present. Use atomic JSON merge/remove for Claude Desktop, Cursor, Devin, Gemini fallback, and Antigravity. Parse before writing, keep malformed files byte-identical, write a sibling temporary file, flush it, then persist it over the target. Uninstall removes only `mcpServers.shelbymcp`; it leaves the database and unrelated keys untouched.

- [ ] **Step 5: Run targeted tests and the full commit gate**

```bash
cargo test -p shelby-integrations -- --nocapture
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm test
npm run check
git diff --check
git add Cargo.toml Cargo.lock crates/shelby-integrations
git commit -m "feat: add reusable client integrations"
```

Expected: all client operations are proven against temporary homes and fake commands.

### Task 3: Complete the Rust CLI and expose `shelby-mcp` as a library

**Files:**
- Create: `assets/Migration Prompt.md`
- Create: `crates/shelby-mcp/src/lib.rs`
- Create: `crates/shelby-mcp/src/commands.rs`
- Modify: `crates/shelby-mcp/Cargo.toml`
- Modify: `crates/shelby-mcp/src/config.rs`
- Modify: `crates/shelby-mcp/src/http.rs`
- Modify: `crates/shelby-mcp/src/main.rs`
- Modify: `crates/shelby-mcp/tests/stdio.rs`
- Create: `crates/shelby-mcp/tests/cli.rs`

**Interfaces:**
- Consumes: `shelby_memory::repair`, `shelby_integrations`, `assets/Memory Protocol.md`, `assets/Migration Prompt.md`, and canonical `skills/*/SKILL.md`.
- Produces: `shelby_mcp::open_memory`, `shelby_mcp::http::router`, `shelby_mcp::server::ShelbyServer`, all CLI variants, and binary exit codes `0` success, `1` invalid/runtime failure, `2` manual action required.

- [ ] **Step 1: Add failing parser and spawned-binary tests for every command**

Replace `Cli::NotPorted` assertions with exact variants:

```rust
Cli::Setup { client: Some("cursor".into()), forage: true, onboard: false }
Cli::Uninstall { client: Some("cursor".into()) }
Cli::Protocol
Cli::Forage
Cli::Onboard
Cli::Migrate
Cli::RepairProjects { apply: true }
```

`tests/cli.rs` spawns `env!("CARGO_BIN_EXE_shelby-mcp")` and asserts usage for missing/unknown clients, static command output, `repair-projects` dry-run/apply against a temporary database, `--version`, and stdout/stderr discipline.

- [ ] **Step 2: Run parser and CLI tests and verify failure**

Run: `cargo test -p shelby-mcp --test cli -- --nocapture`

Expected: FAIL because commands still resolve to `NotPorted` and no CLI integration test exists.

- [ ] **Step 3: Extract the reusable library boundary**

Create `lib.rs`:

```rust
pub mod config;
pub mod http;
pub mod oauth;
pub mod prompts;
pub mod schemas;
pub mod server;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn open_memory(path: &str) -> shelby_memory::Result<shelby_memory::Memory> {
    if path == ":memory:" { shelby_memory::Memory::open_in_memory() } else { shelby_memory::Memory::open(path) }
}
```

Move HTTP router construction into `pub fn router(memory: SharedMemory, cfg: &ServeConfig) -> axum::Router`; `serve` only binds and serves that router. Reduce `main.rs` to parse, dispatch, and map errors to process exit codes.

- [ ] **Step 4: Implement canonical static commands and repair formatting**

`commands.rs` exposes:

```rust
pub fn strip_frontmatter(markdown: &str) -> &str;
pub fn format_repair_report(report: &RepairReport, apply: bool) -> String;
pub fn protocol() -> &'static str;
pub fn forage() -> &'static str;
pub fn onboard() -> &'static str;
pub fn migrate() -> &'static str;
```

Use `include_str!` for all assets. `forage` and `onboard` strip YAML frontmatter from the canonical skill files. Port the exact migration prompt into `assets/Migration Prompt.md`. `repair-projects` loads the per-user seed and uses the new Rust repair API.

- [ ] **Step 5: Implement setup/uninstall command dispatch**

Validate agents through `Client::parse`, call `shelby_integrations::setup`/`uninstall`, print structured outcomes, and keep the database untouched. `--forage` explains the package-native skill path; `--onboard` prints the onboarding body after a successful or already-configured setup. Manual-action results exit `2` with an actionable instruction.

- [ ] **Step 6: Run command parity and the full commit gate**

```bash
cargo test -p shelby-mcp --test cli -- --nocapture
cargo test -p shelby-mcp --test stdio -- --nocapture
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm test
npm run check
git diff --check
git add "assets/Migration Prompt.md" crates/shelby-mcp
git commit -m "feat: complete the Rust command line"
```

Expected: every documented command is handled by Rust and library consumers can build a handler/router without the binary.

### Task 4: Replace the npm server with a native-binary launcher

**Files:**
- Create: `bin/shelbymcp.js`
- Create: `tests/launcher.test.js`
- Create: `scripts/Build Native Packages.mjs`
- Create: `scripts/Verify Package.mjs`
- Create: `npm/darwin-arm64/package.json`
- Create: `npm/darwin-x64/package.json`
- Create: `npm/linux-arm64/package.json`
- Create: `npm/linux-x64/package.json`
- Create: `npm/win32-x64/package.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: platform packages `shelbymcp-{platform}-{arch}@0.4.0` containing `bin/shelby-mcp` or `bin/shelby-mcp.exe`.
- Produces: `selectPackage(platform, arch)`, `resolveBinary(packageName, require)`, `launch(argv, dependencies)`, npm workspaces, and packed platform tarballs.

- [ ] **Step 1: Write failing launcher tests with injected resolution/spawn functions**

Cover all five mappings, unsupported combinations, missing optional packages, argument forwarding without a shell, signal/exit propagation, and Windows `.exe` selection:

```javascript
assert.equal(selectPackage("darwin", "arm64"), "shelbymcp-darwin-arm64");
assert.throws(() => selectPackage("freebsd", "x64"), /Unsupported platform/);
assert.deepEqual(spawnCall.options, { stdio: "inherit", shell: false });
```

- [ ] **Step 2: Run the launcher tests and verify failure**

Run: `node --test tests/launcher.test.js`

Expected: FAIL because `bin/shelbymcp.js` does not exist.

- [ ] **Step 3: Implement the dependency-free ESM launcher**

Use only `node:child_process`, `node:module`, `node:path`, `node:process`, and `node:url`. Export pure mapping/resolution helpers. Execute only when the module is the process entry point. Resolve `<package>/package.json`, join its `bin` directory, call `spawnSync(binary, argv, { stdio: "inherit", shell: false })`, report spawn errors to stderr, and exit with `status` or `128 + signalNumber`.

- [ ] **Step 4: Define the npm workspace packages**

Set root `package.json` to `0.4.0`, `bin.shelbymcp = "bin/shelbymcp.js"`, and workspaces `npm/*`. Remove all third-party dependencies/devDependencies. Add exact optional dependencies:

```json
{
  "optionalDependencies": {
    "shelbymcp-darwin-arm64": "0.4.0",
    "shelbymcp-darwin-x64": "0.4.0",
    "shelbymcp-linux-arm64": "0.4.0",
    "shelbymcp-linux-x64": "0.4.0",
    "shelbymcp-win32-x64": "0.4.0"
  }
}
```

Each workspace package declares matching `os`/`cpu`, contains only its native binary and license metadata, and has version `0.4.0`.

- [ ] **Step 5: Implement package assembly and smoke verification**

`Build Native Packages.mjs` accepts `--target`, `--binary`, and `--output`, validates the target against a closed map, copies the binary into a disposable package directory, preserves executable mode on Unix, runs `npm pack`, and emits the tarball path. `Verify Package.mjs` installs a packed wrapper plus current-platform package into a temporary prefix and asserts `shelbymcp --version` returns `shelby-mcp v0.4.0`.

- [ ] **Step 6: Run launcher/package tests and the full commit gate**

```bash
npm install
npm test
npm audit
cargo build -p shelby-mcp
node "scripts/Build Native Packages.mjs" --target aarch64-apple-darwin --binary target/debug/shelby-mcp --output target/npm
node "scripts/Verify Package.mjs" --binary target/debug/shelby-mcp
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
git diff --check
git add package.json package-lock.json .gitignore bin tests/launcher.test.js "scripts/Build Native Packages.mjs" "scripts/Verify Package.mjs" npm
git commit -m "feat: launch native binaries from npm"
```

Expected: npm reports zero vulnerabilities and the current Rust binary runs through the packed wrapper.

### Task 5: Assemble and validate current client packages

**Files:**
- Create: `integrations/agent-plugin/plugin.json`
- Create: `integrations/agent-plugin/mcp.json`
- Create: `integrations/codex/.codex-plugin/plugin.json`
- Create: `integrations/codex/mcp.json`
- Create: `integrations/claude-code/.claude-plugin/plugin.json`
- Create: `integrations/claude-code/.mcp.json`
- Create: `integrations/gemini/gemini-extension.json`
- Create: `integrations/antigravity/plugin.json`
- Create: `integrations/antigravity/mcp_config.json`
- Create: `integrations/claude-desktop/manifest.json`
- Create: `integrations/devin/registry.json`
- Create: `scripts/Build Integration Packages.mjs`
- Create: `tests/integrations.test.js`

**Interfaces:**
- Consumes: canonical `skills/shelby-forage`, canonical `skills/shelby-onboard`, `npx -y shelbymcp`, and a target-native binary for MCPB assembly.
- Produces: portable Agent Plugins 1.0 output for Cursor-compatible clients, Codex/ChatGPT plugin output, Claude Code plugin output, Gemini extension output, Antigravity plugin output, Claude Desktop MCPB source, and Devin registry metadata under `target/integrations/`.

- [ ] **Step 1: Use the `plugin-creator` workflow to scaffold the Codex source manifest**

Create a repository plugin named `shelbymcp` with MCP and skills directories but no personal marketplace entry. Keep only source manifest/config files under `integrations/codex`; the assembly script copies canonical skills into generated output.

- [ ] **Step 2: Write failing manifest and assembly tests**

Tests parse every JSON file, assert version `0.4.0`, assert every stdio command is one executable token with args `[-y, shelbymcp]`, validate Agent Plugins schema URLs `1.0.0`, assert Antigravity uses `mcp_config.json`, assert Gemini uses `gemini-extension.json`, assert MCPB uses manifest version `0.4` and `server.type = binary`, and assert assembled packages contain both canonical skills byte-for-byte.

- [ ] **Step 3: Run tests and verify failure**

Run: `node --test tests/integrations.test.js`

Expected: FAIL because integration source manifests are absent.

- [ ] **Step 4: Add package manifests from current primary specifications**

Use these exact portable formats:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "shelbymcp",
  "version": "0.4.0"
}
```

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "shelbymcp": { "type": "stdio", "command": "npx", "args": ["-y", "shelbymcp"] }
  }
}
```

Claude Code uses `.claude-plugin/plugin.json` plus root `.mcp.json`; Gemini uses `gemini-extension.json`; Antigravity uses root `plugin.json` plus `mcp_config.json`; Codex uses `.codex-plugin/plugin.json`; Claude Desktop uses MCPB `manifest_version: "0.4"` and a bundle-relative binary; Devin metadata documents the current plugin-store/default configuration and retains `windsurf` as a CLI alias only.

- [ ] **Step 5: Implement deterministic package assembly**

`Build Integration Packages.mjs` clears only `target/integrations`, copies source manifests, copies the two canonical skill directories, and for MCPB requires an explicit target binary path. It must not follow symlinks outside the repository and must reject unknown client names.

- [ ] **Step 6: Validate assembled packages and commit**

```bash
node "scripts/Build Integration Packages.mjs" --all --binary target/debug/shelby-mcp
node --test tests/integrations.test.js
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm test
npm audit
git diff --check
git add integrations "scripts/Build Integration Packages.mjs" tests/integrations.test.js
git commit -m "feat: package Shelby for current AI clients"
```

Expected: all assembled packages validate, canonical skills match byte-for-byte, and no generated archive is staged.

### Task 6: Build protected release artifacts

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `scripts/Verify Release Workflow.mjs`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the five Rust targets, npm package builder, integration builder, and GitHub Release tag `v0.4.0-*`.
- Produces: checksummed native archives, npm wrapper/platform tarballs, integration archives/MCPBs, and optional protected publication.

- [ ] **Step 1: Write a failing release-workflow contract**

The verifier asserts all five Rust targets, `workflow_dispatch`, a boolean `publish` input defaulting to false, SHA-256 generation, artifact upload, an environment named `release` on publication, and no `pull_request` publication trigger.

- [ ] **Step 2: Run the verifier and confirm failure**

Run: `node "scripts/Verify Release Workflow.mjs"`

Expected: FAIL because `.github/workflows/release.yml` does not exist.

- [ ] **Step 3: Add matrix binary builds and dry-run packaging**

Use native runners for each target, run target-specific Cargo tests where runnable, build `--release --locked`, archive the binary with `LICENSE`, calculate SHA-256, and upload artifacts. A packaging job downloads all binaries, builds the five npm packages, packs the root wrapper, assembles client packages, validates contents, and uploads everything without publishing.

- [ ] **Step 4: Gate publication behind the protected environment**

Only when `inputs.publish == true` and the ref is a `v0.4.0-*` tag may a job with `environment: release` publish platform packages first, the wrapper second, and create/update the GitHub prerelease. Tokens are read from secrets and never echoed. crates.io publication remains an explicit step in the same protected job.

- [ ] **Step 5: Verify workflow and run the full commit gate**

```bash
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/release.yml")'
node "scripts/Verify Release Workflow.mjs"
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm test
npm audit
git diff --check
git add .github/workflows/release.yml "scripts/Verify Release Workflow.mjs" CHANGELOG.md
git commit -m "ci: build protected native releases"
```

Expected: workflow syntax and policy contracts pass locally; nothing is published.

### Task 7: Delete TypeScript and make Rust the documented product

**Files:**
- Delete: `src/`
- Delete: TypeScript test files under `tests/` while retaining JSON/SQLite fixtures and Node launcher/integration tests
- Delete: `tsconfig.json`
- Delete: `vitest.config.ts`
- Delete: TypeScript-only fixture/parity scripts after the immutable SQLite fixture is established
- Modify: `.github/workflows/test.yml`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/AGENT-SETUP.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `SECURITY.md`
- Modify: `server.json`
- Create: `scripts/Check Documentation Links.mjs`

**Interfaces:**
- Consumes: completed Rust CLI, npm launcher, integration manifests, immutable TypeScript-v18 fixture, and release workflow.
- Produces: a Rust-only source tree, clean dependency graph, current installation guide, and CI for Cargo/npm/package contracts.

- [ ] **Step 1: Add failing cutover assertions**

Run before deletion:

```bash
test ! -d src
test ! -f tsconfig.json
test ! -f vitest.config.ts
rg -n 'better-sqlite3|@modelcontextprotocol/sdk|Gemini auto-embed|GEMINI_API_KEY|Not yet ported' . --glob '!target/**' --glob '!node_modules/**' --glob '!docs/superpowers/**' --glob '!CHANGELOG.md'
```

Expected: FAIL and/or matches from the TypeScript engine and stale documentation.

- [ ] **Step 2: Remove TypeScript runtime, tooling, and obsolete parity generator**

Delete `src/`, TypeScript tests/configuration, and scripts that import the removed `dist/` engine. Keep `tests/fixtures/TypeScript-v18.sqlite` and the shared JSON fixtures used by Rust. Regenerate `package-lock.json` from the dependency-free workspace package graph.

- [ ] **Step 3: Replace CI with final product gates**

The test workflow runs:

```yaml
- run: cargo fmt --check
- run: cargo clippy --workspace --all-targets -- -D warnings
- run: cargo test --workspace
- run: npm ci
- run: npm test
- run: npm audit
- run: cargo build -p shelby-mcp
- run: node "scripts/Verify Package.mjs" --binary target/debug/shelby-mcp
- run: node "scripts/Build Integration Packages.mjs" --all --binary target/debug/shelby-mcp
- run: node "scripts/Check Documentation Links.mjs"
```

The Rust cross-engine test continues opening the committed TypeScript fixture and cannot skip.

- [ ] **Step 4: Rewrite docs around Rust, packages, and app reuse**

Document package-first installation for Codex/ChatGPT, Claude Code, Cursor/Agent Plugins, Gemini, Antigravity, Claude Desktop MCPB, and Devin Desktop. Keep `npx shelbymcp setup <client>` as fallback. State that the server performs no inference or auto-embedding, OAuth remains available for hosted HTTP, and `shelby-memory`, `shelby-integrations`, and `shelby-mcp` are reusable by Shelby-App. Remove instructions that append the protocol to global rule files.

- [ ] **Step 5: Add a local Markdown-link checker**

`Check Documentation Links.mjs` scans tracked Markdown files, ignores fenced code and HTTP links, resolves repository-relative links and anchors, and fails with file/line for missing targets. Add it to `npm test` after launcher/integration tests.

- [ ] **Step 6: Run final cutover searches and a clean-install gate**

```bash
rg -n 'better-sqlite3|@modelcontextprotocol/sdk|Gemini auto-embed|GEMINI_API_KEY|Not yet ported' . --glob '!target/**' --glob '!node_modules/**' --glob '!docs/superpowers/**' --glob '!CHANGELOG.md'
npm ci
npm test
npm audit
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build -p shelby-mcp
node "scripts/Verify Package.mjs" --binary target/debug/shelby-mcp
node "scripts/Build Integration Packages.mjs" --all --binary target/debug/shelby-mcp
node "scripts/Check Documentation Links.mjs"
git diff --check
```

Expected: the search returns no stale runtime/docs matches, npm reports zero vulnerabilities, and all product gates pass.

- [ ] **Step 7: Commit the cutover**

```bash
git status --short
git add .github/workflows/test.yml package.json package-lock.json AGENTS.md README.md CONTRIBUTING.md docs SECURITY.md server.json "scripts/Check Documentation Links.mjs" tests crates assets skills integrations npm bin .gitignore Cargo.toml Cargo.lock
git add -u src tests tsconfig.json vitest.config.ts scripts
git diff --cached --check
git commit -m "refactor: retire the TypeScript server"
```

Expected: only reviewed cutover files are staged; no credentials, disabled security controls, swallowed errors, or unrelated changes are present.

### Task 8: Freeze, review, and open the stacked distribution PR

**Files:**
- Modify only if review finds an issue: files already named in Tasks 1–7
- External update: GitHub branch and pull request

**Interfaces:**
- Consumes: a clean `feature/rust-distribution` branch and hardened PR #63 base.
- Produces: one review-ready stacked PR targeting `feat/rust-memory-crate`, with retarget instructions for `main` after PR #63 merges.

- [ ] **Step 1: Run final verification from a clean dependency state**

```bash
git status --short
npm ci
npm audit
npm test
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build -p shelby-mcp
node "scripts/Verify Package.mjs" --binary target/debug/shelby-mcp
node "scripts/Build Integration Packages.mjs" --all --binary target/debug/shelby-mcp
node "scripts/Verify Release Workflow.mjs"
node "scripts/Check Documentation Links.mjs"
git diff feat/rust-memory-crate...HEAD --check
```

Expected: every command passes with fresh output and the worktree is clean afterward.

- [ ] **Step 2: Run the pre-push security review**

Inspect `git diff feat/rust-memory-crate...HEAD` for credentials, shell construction from user input, path traversal, unsafe config replacement, disabled authentication, publication on pull requests, and swallowed errors. Confirm SQL remains parameterized and installer tests never address the live home directory.

- [ ] **Step 3: Request an independent frozen-commit review**

Freeze `git rev-parse HEAD` and run the configured Harness review route against `feat/rust-memory-crate...<HEAD>`. Resolve every critical/important finding with evidence, rerun affected tests, and commit each correction conventionally.

- [ ] **Step 4: Push and open the stacked PR**

```bash
git push -u origin feature/rust-distribution
gh pr create --base feat/rust-memory-crate --head feature/rust-distribution --title "Ship ShelbyMCP as native Rust binaries" --body "## What

- completes the Rust CLI and reusable integration catalog
- ships native binaries through npm and current client packages
- removes the TypeScript server and dependency tree

## Why

ShelbyMCP still publishes and installs the old TypeScript server even though the shared memory engine and MCP server now live in Rust. This makes Rust the single implementation while preserving npx, existing databases, OAuth, and supported workflows.

## Testing

- cargo fmt, clippy, and workspace tests
- npm launcher, package, integration, release-policy, audit, and documentation checks
- immutable TypeScript-v18 database compatibility fixture
- independent frozen-commit review"
gh pr checks --watch
```

Expected: PR targets `feat/rust-memory-crate`, all checks pass, and its body clearly says to retarget `main` after PR #63 merges.
