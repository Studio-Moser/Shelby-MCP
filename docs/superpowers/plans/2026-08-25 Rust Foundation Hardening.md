# Rust Foundation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PR #63 prove TypeScript-database compatibility and Rust server quality in CI, expose initialization guidance, and become review-ready.

**Architecture:** Keep this work on `feat/rust-memory-crate` so PR #63 remains the engine/server foundation. Generate one immutable v18 SQLite fixture with the shipping TypeScript engine, make Rust consume it without an optional skip, and add a two-way parity driver while TypeScript still exists. The server returns one canonical Memory Protocol asset through both MCP prompts and initialization instructions.

**Tech Stack:** Rust 2024, `rusqlite`, `rmcp` 3.1, Node.js 20/22, TypeScript, Vitest, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-08-25 Rust Distribution Design.md`

## Global Constraints

- Existing `~/.shelbymcp/memory.db` files must open unchanged at schema version 18.
- OAuth 2.1 and bearer authentication behavior from PR #63 must remain enabled.
- The compatibility test must fail when its committed fixture is missing.
- The first 512 initialization-instruction characters must contain the safe scope and capture rules.
- PR #63 stays focused on the Rust engine/server foundation; npm distribution and installer packages remain in the stacked PR.
- Before each commit run Cargo fmt, clippy, workspace tests, `npm test`, and `npm run check`.

---

### Task 1: Make cross-engine compatibility mandatory and reproducible

**Files:**
- Create: `scripts/Create TypeScript Fixture.mjs`
- Create: `scripts/Verify Cross Engine.mjs`
- Create: `tests/fixtures/TypeScript-v18.sqlite`
- Modify: `package.json`
- Modify: `crates/shelby-memory/tests/cross_engine.rs`

**Interfaces:**
- Consumes: TypeScript `ThoughtDatabase`, `upsertProject`, `insertThought`, and Rust `Memory::open`.
- Produces: `tests/fixtures/TypeScript-v18.sqlite`; package scripts `fixture:typescript` and `test:cross-engine`; the environment override `SHELBY_TS_DB` for the two-way driver only.

- [ ] **Step 1: Replace the optional Rust test with a failing committed-fixture contract**

Use the repository fixture by default, copy it before writing, and retain `SHELBY_TS_DB` only so the two-way driver can inspect the Rust-written row:

```rust
fn fixture_path() -> PathBuf {
    std::env::var_os("SHELBY_TS_DB").map(PathBuf::from).unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/TypeScript-v18.sqlite")
    })
}

#[test]
fn reads_and_extends_a_typescript_created_database() {
    let source = fixture_path();
    assert!(source.is_file(), "missing TypeScript-v18 compatibility fixture: {}", source.display());
    // Copy the repository fixture unless the parity driver supplied a disposable database.
}
```

Assert the fixed seed thought ID, schema version 18, `shelby` alias resolution, `knowledge-graph` topic, FTS result, and the inserted Rust row ID printed as `RUST_ROW_ID=<uuid>`.

- [ ] **Step 2: Run the Rust test and verify the missing fixture is a real failure**

Run: `cargo test -p shelby-memory --test cross_engine -- --nocapture`

Expected: FAIL with `missing TypeScript-v18 compatibility fixture`, not a reported pass or skip.

- [ ] **Step 3: Add the TypeScript fixture generator**

`scripts/Create TypeScript Fixture.mjs` must:

```javascript
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { ThoughtDatabase } from "../dist/db/database.js";
import { upsertProject } from "../dist/db/projects.js";
import { insertThought } from "../dist/db/thoughts.js";

export const FIXTURE = resolve("tests/fixtures/TypeScript-v18.sqlite");
export const SEED_ID = "018f4c66-7c4e-7a4d-8e7a-6a74af7fd001";
export const FIXED_TIME = "2026-08-25T00:00:00.000Z";
```

Create the database through `ThoughtDatabase`, insert a `shelby` registry row and one thought through the TypeScript APIs, then normalize the generated thought ID and all timestamps to the constants above. Run `wal_checkpoint(TRUNCATE)` and `VACUUM`, close the database, and remove any `-wal`/`-shm` siblings. Never overwrite a path outside `tests/fixtures` unless an explicit output path argument was provided by the parity driver.

- [ ] **Step 4: Generate the fixture and make the Rust contract pass**

Run:

```bash
npm run build
node "scripts/Create TypeScript Fixture.mjs"
cargo test -p shelby-memory --test cross_engine -- --nocapture
```

Expected: PASS; output contains one `RUST_ROW_ID=` line and `git status --short` shows only the intended fixture/script/test changes.

- [ ] **Step 5: Add automated Rust-to-TypeScript readback**

`scripts/Verify Cross Engine.mjs` must create a disposable copy, spawn the Rust test with `SHELBY_TS_DB` pointing to it, parse exactly one `RUST_ROW_ID`, open the same database through `ThoughtDatabase`, and assert:

```javascript
const row = db.db.prepare("SELECT project_id, project_identifier, topics FROM thoughts WHERE id = ?").get(rustRowId);
assert.equal(row.project_identifier, "shelby");
assert.ok(row.project_id);
assert.deepEqual(JSON.parse(row.topics), ["cross-engine"]);
```

Clean up the database and SQLite sidecars in `finally`. Exit nonzero if spawning Cargo fails, the row marker is absent/duplicated, or any assertion fails.

- [ ] **Step 6: Wire package scripts and run both directions**

Add:

```json
{
  "scripts": {
    "fixture:typescript": "npm run build && node \"scripts/Create TypeScript Fixture.mjs\"",
    "test:cross-engine": "npm run build && node \"scripts/Verify Cross Engine.mjs\""
  }
}
```

Run: `npm run fixture:typescript && npm run test:cross-engine`

Expected: PASS with a TypeScript-created row read by Rust and a Rust-created row read by TypeScript.

- [ ] **Step 7: Run the full commit gate and commit**

```bash
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm test
npm run check
git diff --check
git add package.json package-lock.json "scripts/Create TypeScript Fixture.mjs" "scripts/Verify Cross Engine.mjs" tests/fixtures/TypeScript-v18.sqlite crates/shelby-memory/tests/cross_engine.rs
git commit -m "test: require TypeScript database compatibility"
```

Expected: all commands pass and the commit contains no credentials or unrelated files.

### Task 2: Serve canonical initialization instructions

**Files:**
- Create: `assets/Memory Protocol.md`
- Modify: `crates/shelby-mcp/src/prompts.rs`
- Modify: `crates/shelby-mcp/src/server.rs`
- Modify: `crates/shelby-mcp/tests/stdio.rs`

**Interfaces:**
- Consumes: the Memory Protocol currently embedded in `PROMPTS[0]`.
- Produces: `prompts::MEMORY_PROTOCOL: &str`, `prompts::INITIALIZATION_INSTRUCTIONS: &str`, and MCP `ServerInfo.instructions`.

- [ ] **Step 1: Add a failing initialization contract to the real stdio test**

After `initialize`, assert:

```rust
let instructions = init["instructions"].as_str().expect("server instructions");
assert!(instructions.len() > 512);
let prefix: String = instructions.chars().take(512).collect();
assert!(prefix.contains("project scope"));
assert!(prefix.contains("capture_thought"));
assert!(instructions.contains("search_thoughts"));
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run: `cargo test -p shelby-mcp --test stdio full_handshake_tools_prompts_and_scoped_capture -- --nocapture`

Expected: FAIL because `initialize` has no `instructions` string.

- [ ] **Step 3: Extract and expose the canonical Memory Protocol**

Move the exact protocol text from `PROMPTS[0].text` into `assets/Memory Protocol.md`. In `prompts.rs` define:

```rust
pub const MEMORY_PROTOCOL: &str = include_str!("../../../assets/Memory Protocol.md");
pub const INITIALIZATION_INSTRUCTIONS: &str = concat!(
    "ShelbyMCP provides persistent memory. Resolve project scope before personal captures; ",
    "if scope is unresolved, capture only with visibility=shared or ask for a registered project. ",
    "Use capture_thought for durable decisions, preferences, people, constraints, fixes, and insights. ",
    "Search with search_thoughts or list_thoughts before starting work or making related decisions.\n\n",
    include_str!("../../../assets/Memory Protocol.md")
);
```

Set the `memory-protocol` prompt text to `MEMORY_PROTOCOL` so prompt and initialization guidance cannot drift.

- [ ] **Step 4: Populate MCP server instructions**

In `ShelbyServer::get_info`:

```rust
info.instructions = Some(crate::prompts::INITIALIZATION_INSTRUCTIONS.into());
```

Keep tool descriptions static and do not place database state in initialization metadata.

- [ ] **Step 5: Run targeted and full commit gates, then commit**

```bash
cargo test -p shelby-mcp --test stdio full_handshake_tools_prompts_and_scoped_capture -- --nocapture
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm test
npm run check
git diff --check
git add "assets/Memory Protocol.md" crates/shelby-mcp/src/prompts.rs crates/shelby-mcp/src/server.rs crates/shelby-mcp/tests/stdio.rs
git commit -m "feat: initialize agents with memory guidance"
```

Expected: the real stdio handshake returns instructions and every gate passes.

### Task 3: Add Rust CI and make PR #63 review-ready

**Files:**
- Modify: `.github/workflows/test.yml`
- Modify: `crates/shelby-mcp/README.md`
- External update: GitHub PR #63 title/body/draft state

**Interfaces:**
- Consumes: `npm run test:cross-engine` and the Cargo workspace gates from Tasks 1–2.
- Produces: independent `node` and `rust` GitHub Actions jobs; accurate PR #63 review metadata.

- [ ] **Step 1: Add a local workflow contract that initially fails**

Run:

```bash
rg -n '^  rust:|cargo fmt --check|cargo clippy|cargo test --workspace|npm run test:cross-engine' .github/workflows/test.yml
```

Expected: FAIL because the workflow only defines the Node matrix.

- [ ] **Step 2: Split the workflow into Node and Rust jobs**

Retain Node 20/22 checks. Add one Ubuntu Rust job with:

```yaml
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: npm
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - uses: Swatinem/rust-cache@v2
      - run: npm ci
      - run: cargo fmt --check
      - run: cargo clippy --workspace --all-targets -- -D warnings
      - run: cargo test --workspace
      - run: npm run test:cross-engine
```

Do not publish artifacts or packages from this workflow.

- [ ] **Step 3: Remove stale “not ported” claims from the crate README**

State that OAuth is implemented in PR #63. Keep setup/uninstall, static CLI commands, npm distribution, and TypeScript deletion explicitly assigned to the stacked distribution PR.

- [ ] **Step 4: Validate workflow structure and run the full commit gate**

```bash
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/test.yml")'
rg -n '^  rust:|cargo fmt --check|cargo clippy|cargo test --workspace|npm run test:cross-engine' .github/workflows/test.yml
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm test
npm run check
git diff --check
git add .github/workflows/test.yml crates/shelby-mcp/README.md
git commit -m "ci: verify the Rust server and parity"
```

Expected: YAML parses, required commands are present, and all local gates pass.

- [ ] **Step 5: Push PR #63 and update its review surface**

Push `feat/rust-memory-crate`, then edit PR #63 so its `## What`, `## Why`, and `## Testing` sections state that OAuth is complete, cross-engine compatibility is mandatory, and the stacked distribution PR owns remaining TypeScript retirement. Mark it ready:

```bash
git push origin feat/rust-memory-crate
gh pr edit 63 --title "Port Shelby memory and MCP server to Rust"
gh pr ready 63
gh pr checks 63 --watch
```

Expected: all required checks succeed and the PR is no longer a draft.

- [ ] **Step 6: Rebase the stacked distribution branch onto the hardened foundation**

In `.worktrees/rust-distribution`:

```bash
git status --short
git rebase feat/rust-memory-crate
git log --oneline --decorate -5
```

Expected: clean worktree; the design commit sits above all PR #63 hardening commits.
