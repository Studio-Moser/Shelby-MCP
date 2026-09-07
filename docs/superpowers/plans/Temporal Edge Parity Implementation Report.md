# Temporal Edge Parity Implementation Report

Implemented the accepted canonical temporal prerequisite on `feature/temporal-edge-parity`, based on `252529d803513174334ceb30d48f872d1b2bc0c9`, in the isolated MCP worktree. No local commit, push/merge, App pin change, Cargo checkout edit, personal profile, live memory or provider access.

## D1 — Canonical Contract

The private temporal module compares parsed Chrono instants using start <= now < end. Null bounds are open; empty/reversed intervals inactive. Both present bounds are validated before the Boolean comparison, so a future start cannot conceal a malformed end. RFC3339 offsets/fractions and the explicitly supported legacy UTC space-separated form retain nanosecond comparison precision. Four-digit years, seconds 00–59, fractions up to nine digits and inputs up to 64 UTF-8 bytes are enforced before Chrono calendar validation. Date-only/missing-zone/relative/whitespace/trailing/invalid-calendar/leap-second forms fail explicitly. New writes preserve valid original strings; no storage normalization or schema conversion occurs.

New bounds are validated in link_thoughts and expire_edge before mutation. manage_edges now preserves the actual safe engine invalid-input reason instead of misreporting all failures as an invalid edge type. Default expiration takes effect immediately through canonical active readers.

## D2 — Shared Reads and Registration

Existing get_connections, fetch_graph_related and traverse_graph signatures remain. They capture one now_iso instant and delegate to additive `_at` variants. Every direction/hop uses the same bound instant. Public is_active_at lets a future app revalidate an already loaded EdgeRecord with that same policy; it does not authorize endpoints.

Connection-local `shelby_edge_active_v1` invokes the pure predicate in graph and brief SQL. SQLite strings are borrowed and oversized/non-text values rejected without copying their contents into Rust Strings. Registration happens at active query entry points, covering raw caller-owned Connections. It is deterministic/innocuous, has no DB/clock callback state, does not acquire global/runtime locks, and does not replace a compatible existing registration while a cursor is active. Incompatible name/arity/flags fail explicitly. The reserved name and metadata check are not authentication against deliberate callback replacement on an already caller-owned Connection.

Brief whole refutations use exhaustive SUM(CASE predicate THEN 1 ELSE 0 END), not short-circuit EXISTS. Scoped refutations retain the unchanged claim expression and exhaustive JSON aggregation. Malformed relevant bounds fail the read even when another valid active whole refutation already exists. No successful partial result or silent promotion of a refuted source is returned. Raw get_edge/get_edges_between and include_expired historical traversal remain available without interpreting stored bounds.

## D3 — Bounded Reader

`active_edges_page` accepts a valid edge type, explicit RFC3339 instant, optional after-ID and page size 1–200. It materializes at most that many candidate rows in binary edge-ID order, filters with the same pure predicate, and returns full active records plus continuation after the last scanned candidate. A separate EXISTS only checks whether further matching-type IDs exist; it does not inspect their bounds/metadata. Thus an empty active page can have continuation, and a malformed row beyond the current candidate page is not evaluated early.

The bound covers materialized rows and Rust predicate evaluations, not arbitrary historic metadata bytes or SQLite scan/sort work. The caller must preserve type/instant/scope while paging, authorize both endpoints before exposure, and continue past filtered/acknowledged rows when filling a visible limit. This is not snapshot isolation: concurrent inserts before the cursor appear on refresh. No total count, additional index, migration, MCP tool or app authorization shortcut was introduced.

## Verification

All Rust commands used `CARGO_TARGET_DIR=/tmp/Shelby Temporal Edge Target`; generated Rust build output stayed outside the repository.

| Check | Result | Evidence |
| --- | --- | --- |
| Baseline cargo test -p shelby-memory | 70 unit + 1 compatibility passed | /tmp/Temporal-Baseline.log |
| Changed cargo test -p shelby-memory | 78 unit + 1 compatibility passed | /tmp/Temporal-Memory-Final.log |
| cargo fmt --check | Passed | /tmp/Temporal-Fmt.log |
| cargo clippy --workspace --all-targets -- -D warnings | Passed | /tmp/Temporal-Clippy.log |
| cargo test --workspace | 149 passed, 1 pre-existing ignored | /tmp/Temporal-Workspace-Test.log |
| npm ci | Passed | /tmp/Temporal-Npm-Ci.log |
| npm test | 14 passed; documentation links passed | /tmp/Temporal-Npm-Test.log |
| npm audit | 0 vulnerabilities | /tmp/Temporal-Npm-Audit.log |
| git diff --check | Passed | Final worktree check |

TDD red runs were recorded for missing temporal helpers and explicit-time/page reader APIs. The final tests cover ±1 ns/±1 ms and equal boundaries, offsets crossing dates, legacy formats, malformed/future bounds, raw/reopened Connections, first/repeated registration with a live cursor, transactions/savepoints, incompatible registration, immediate default expiration, exact immutable history and partial claims, remaining whole refutations and a refuted target. Mixed valid-active plus malformed whole/scoped siblings are exercised in both insertion orders, malformed start/end and future-start/malformed-end combinations, across graph/page/brief and the production get_brief_tool path. Error output does not echo malformed stored text.

The copied immutable TypeScript-v18 fixture additionally verifies schema 18, mixed legacy/offset/nanosecond strings unchanged after reopening, and exact endpoint activity. The tracked fixture bytes were not edited. Existing deterministic memory-evaluation workspace tests passed without changing goldens. Cargo.lock remained unchanged; only the existing rusqlite functions feature was enabled.

## Release Scope

Seven changed code/config files: new temporal.rs; edges.rs; brief.rs; lib.rs; tools.rs; copied-fixture cross_engine.rs; the dependency feature line. Tests reside alongside their owning code; shared reader/brief/tool consistency tests live in edges.rs. The accepted plan and this report document the implementation. db.rs, migrations, App source and pins are unchanged. The plan-review document is root/reviewer-owned and preserved.

The frozen source/diff is for independent review before a local commit. Invalid legacy bounds intentionally make affected active reads unavailable until their data is repaired; this task neither scans private data nor adds a repair/reversal workflow. The app's acknowledgment/withdrawal UI, scope binding, stable review versions and new dependency pin remain separate work.
