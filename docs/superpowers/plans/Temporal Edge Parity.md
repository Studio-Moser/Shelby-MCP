# Temporal Edge Parity Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline, task by task, after root releases implementation following independent review. No nested agents. This document is the review target; no source edits are authorized yet.

**Goal:** Make canonical graph, brief and paginated edge readers agree on `valid_from <= explicit instant < valid_until`, preserving schema-v18 data and existing source APIs.

**Architecture:** One pure Chrono predicate parses bounds and compares instants. A connection-local SQLite scalar function invokes that predicate in the existing graph and brief queries; a bounded candidate-page reader invokes the same predicate directly. Existing graph functions capture one current instant and delegate to additive explicit-time variants. No stored timestamps are converted.

**Tech Stack:** Existing Rust, Chrono 0.4 and rusqlite 0.40.2; enable rusqlite's existing `functions` feature. No new dependency or inference.

**Spec:** App worktree `.superpowers/sdd/Replacement Completion/contradictions-brief.md` and `contradictions-plan-review.md`, under `/Volumes/wrkn/Projects/Studio Moser Products/Shelby/Apps/.worktrees/Daily Use Parity`. Root accepted prerequisite-first release and chose explicit errors for malformed legacy bounds; null bounds are open and empty/reversed intervals inactive.

## Global Constraints

- Worktree: `/Volumes/wrkn/Projects/Studio Moser Products/Shelby/MCP/.worktrees/Temporal Edge Parity`; branch `feature/temporal-edge-parity`; base `252529d803513174334ceb30d48f872d1b2bc0c9`.
- The main checkout was clean; `.worktrees` is ignored; branch/path did not exist before creation. MCP is a workspace submodule with its own main checkout, not an already-linked worktree. No native worktree tool was available, so `git worktree add` created the requested isolation.
- Preserve schema version 18 and the immutable TypeScript-v18 fixture. No migration, backfill, edge deletion, reversal, endpoint change or metadata normalization.
- Preserve existing public function signatures and the historical/raw meaning of `get_edge`, `get_edges_between`, and `traverse_graph(..., include_expired=true)`.
- Malformed legacy bounds cause an explicit active-read error. Never silently suppress a malformed refutation and make its source eligible. Empty/reversed intervals have no active instants; expiration before a future start remains supported.
- No App dependency pin, Cargo checkout edits, remote push/merge, personal profile/database access, provider calls, new MCP tool or widened endpoint authorization.
- Root owns the source-release decision, independent review, eventual merge/pin decision and app integration. Do not commit or widen this plan while awaiting review.

## D1 — File Ownership and Interfaces

| File | Necessary change |
| --- | --- |
| `Cargo.toml` | Add `functions` to existing workspace rusqlite features; keep version and bundled SQLite. |
| `Cargo.lock` | Only changes Cargo actually requires for that feature; no update command or dependency upgrades. A feature-only edit may leave it unchanged. |
| `crates/shelby-memory/src/temporal.rs` | New private module: bounded strict timestamp parsing, interval predicate, SQL-function registration and focused tests. |
| `crates/shelby-memory/src/lib.rs` | Add private `mod temporal;`. Preserve exports and `now_iso()`. |
| `crates/shelby-memory/src/edges.rs` | Validate supplied bounds, expose `is_active_at`, additive explicit-time graph variants, replace ACTIVE SQL, bounded page reader and tests. |
| `crates/shelby-memory/src/brief.rs` | Reuse the same SQL predicate for whole and scoped refutations; validate explicit `now`; add temporal consistency tests. Preserve scope, trust, candidate limits and `SCOPED_CLAIM`. |
| `crates/shelby-memory/src/tools.rs` | Preserve actionable date errors from `manage_edges` and replace the old far-past-only temporal regression. No new tool or argument. |
| `crates/shelby-memory/tests/cross_engine.rs` | Add read/expiration compatibility assertions on a copied fixture only if existing tests do not cover the new predicate; never alter the fixture. |

No `db.rs` initializer or schema change is needed: public readers accept caller-owned Connections, so registration belongs at their query entry points rather than only Memory::open.

Proposed private interfaces:

```rust
pub(crate) fn parse_bound(value: &str) -> crate::Result<chrono::DateTime<chrono::Utc>>;
pub(crate) fn parse_now(value: &str) -> crate::Result<chrono::DateTime<chrono::Utc>>;
pub(crate) fn active_at(
    valid_from: Option<&str>, valid_until: Option<&str>, now: &str,
) -> crate::Result<bool>;
pub(crate) fn ensure_sql_function(conn: &rusqlite::Connection) -> crate::Result<()>;
pub(crate) const ACTIVE_SQL: &str =
    "shelby_edge_active_v1(e.valid_from, e.valid_until, @edge_now)";
```

Additive public interfaces in `edges.rs`:

```rust
pub fn is_active_at(edge: &EdgeRecord, now: &str) -> Result<bool>;
pub fn get_connections_at(conn: &Connection, thought_id: &str,
    edge_types: Option<&[String]>, now: &str) -> Result<Vec<ConnectedThought>>;
pub fn fetch_graph_related_at(conn: &Connection, result_ids: &[String],
    graph_depth: i64, now: &str) -> Result<Vec<GraphRelatedThought>>;
pub fn traverse_graph_at(conn: &Connection, thought_id: &str, max_depth: i64,
    edge_types: Option<&[String]>, include_expired: bool, now: &str) -> Result<Vec<GraphNode>>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ActiveEdgePage {
    pub edges: Vec<EdgeRecord>,
    pub next_after_id: Option<String>,
}
pub fn active_edges_page(conn: &Connection, edge_type: &str, now: &str,
    after_id: Option<&str>, page_size: usize) -> Result<ActiveEdgePage>;
```

## D2 — Parsing, Error and Registration Contract

Supported validity bounds: RFC3339 with an explicit offset (`Z` included), seconds and up to nine fractional digits; or the explicit legacy UTC form `YYYY-MM-DD HH:MM:SS` with optional one-to-nine-digit fractional seconds. Legacy space-separated bounds have no timezone suffix and are interpreted as UTC, matching SQLite's historical UTC output. Do not claim generic ISO-8601 acceptance. Restrict years to four digits, seconds to 00–59, and fractional precision to at most nine digits; reject date-only values, leap seconds, relative dates, missing zones on T-separated values, trailing data and surrounding whitespace. Use Chrono to reject invalid calendar dates; do not normalize February 30 or hour 24. Bound input to 64 UTF-8 bytes before parsing. New writes preserve the validated original spelling, avoiding lossy normalization of offsets or fractions.

Explicit `now` must be RFC3339 (the existing `now_iso()` output qualifies), with the same calendar/precision restrictions. It is validated even for an empty result set. No fallback to wall-clock time on parse failure. Comparisons use Chrono instants, preserving sub-millisecond bounds; no julianday floats, lexical ordering, datetime truncation or integer-millisecond truncation.

Parse **both** present bounds before evaluating the interval. A valid future start must not short-circuit and conceal a malformed end. Parse errors identify the field using constant, bounded messages, never echo arbitrary stored values. The pure predicate returns `Error::InvalidInput`; the SQLite bridge returns an explicit `rusqlite::Error::UserFunctionError`. Query execution must propagate that failure; no `COALESCE(..., false)` or catch-and-skip behavior. An existing valid active refutation must not conceal a malformed sibling bound through SQL short-circuiting. For every considered brief candidate, evaluate every relevant outgoing whole-refutation bound before returning its actively_refuted value. Scoped-refutation aggregation must likewise consume every relevant scoped bound. This requirement applies regardless of insertion order or whether another edge already establishes refutation.

Registration is per Connection and contains no clock or database state. Before preparing an active graph/brief query, `ensure_sql_function` checks SQLite's `pragma_function_list` for the reserved name and arity 3. Function metadata does not authenticate the identity of a deliberately substituted callback on a caller-owned Connection; the name is reserved. Register only when absent, using `SQLITE_UTF8 | SQLITE_DETERMINISTIC | SQLITE_INNOCUOUS`. Reject an incompatible existing reserved name/arity rather than silently overwrite it. Skip re-registration on later calls, including calls while another statement is active: replacing an in-use function can return SQLITE_BUSY. Bundled SQLite supports the pragma and these flags; no separate extension loading is introduced.

The scalar callback takes optional text bounds plus required text `now`, invokes only the pure predicate and returns bool. It does not query the Connection, acquire locks, log record data or retain closures over a Runtime/Memory. No global OnceLock: multiple and reopened Connections each need registration. Transactions/savepoints stay owned by callers; helpers neither start nor commit them. Registration errors fail the read explicitly. First registration and repeated reads with an outstanding unrelated SQLite cursor are required tests, not assumptions.

## Task 1 — Shared Temporal Predicate and Date Validation

- [x] Write pure fixed-instant tests first, importing the proposed private helper. A representative matrix is:

```rust
let now = "2026-09-06T12:00:00.500Z";
assert!(active_at(None, None, now).unwrap());
assert!(active_at(Some(now), None, now).unwrap());
assert!(!active_at(None, Some(now), now).unwrap());
assert!(!active_at(Some("2026-09-06T12:00:00.501Z"), None, now).unwrap());
assert!(active_at(None, Some("2026-09-06T12:00:00.501Z"), now).unwrap());
assert!(!active_at(Some(now), Some(now), now).unwrap());
assert!(!active_at(Some("2027-01-01T00:00:00Z"), Some(now), now).unwrap());
assert!(active_at(Some("2026-09-06 12:00:00.500"), None, now).unwrap());
assert!(active_at(Some("2026-09-06T05:00:00.500-07:00"), None, now).unwrap());
assert!(active_at(Some("2027-01-01T00:00:00Z"), Some("invalid"), now).is_err());
assert!(active_at(Some("2026-02-30T00:00:00Z"), None, now).is_err());
assert!(active_at(None, None, "invalid").is_err());
```

- [x] Run `cargo test -p shelby-memory temporal::tests`; observe the missing-helper failure, then implement the parser and pure predicate with both bounds validated before comparison.
- [x] Add ±1 ns and ±1 ms boundaries, positive/negative offsets crossing dates, malformed/overlong inputs, all unsupported forms above, and whitespace/empty strings. Preserve null distinct from empty text.
- [x] Add function-registration tests on two raw in-memory Connections and a reopened temporary file Connection. Run the predicate through SQL, including a transaction/savepoint and a live unrelated cursor. Call registration twice and assert no replacement/failure. Test reserved-name/arity collision handling.
- [x] Enable only rusqlite's functions feature, implement registration, and rerun the targeted tests.
- [x] Validate `EdgeInput.valid_from`, `EdgeInput.valid_until` and explicit `expire_edge` dates before mutation. Keep missing-bound/default-now behavior and allow empty intervals. Assert invalid input leaves rows byte-identical and no edge is inserted/expired.
- [x] In `manage_edges_tool`, remove the existing catch-all conversion of every `Error::InvalidInput` into an edge-type message. Return the actual safe engine invalid-input reason through `from_engine`, preserving the MCP error code. Test invalid type and invalid timestamp separately.

## Task 2 — Consistent Graph and Brief Readers

- [x] Add explicit-time reader tests that demonstrate same-day expiration and future-start failures in the old code; test all three graph paths, not only traversal.
- [x] Existing public graph wrappers capture `let now = crate::now_iso();` once and call the additive `_at` variant. Explicit-time variants validate now once before any early return. `neighbors` receives the same instant for every direction/hop and binds `@edge_now` only when the temporal clause is present. Keep existing type filters bound, never interpolate caller date/type values.
- [x] Before query preparation call `ensure_sql_function`, then insert the shared ACTIVE_SQL predicate into active graph queries. Inactive historical traversal remains unfiltered and does not parse stored bounds.
- [x] Replace the whole-refutation EXISTS with a non-short-circuit aggregate that invokes the shared predicate for every relevant whole-refutation row, including rows after one valid active result. Bind the same validated explicit instant as `@edge_now`. A concrete SQL shape is:

```sql
COALESCE((
  SELECT SUM(CASE
    WHEN shelby_edge_active_v1(e.valid_from, e.valid_until, @edge_now)
    THEN 1 ELSE 0 END)
  FROM edges e
  WHERE e.source_id = t.id AND e.edge_type = 'refuted_by'
    AND (CASE WHEN json_valid(e.metadata) AND json_type(e.metadata, '$.claim') = 'text'
      AND trim(json_extract(e.metadata, '$.claim')) != ''
      THEN trim(json_extract(e.metadata, '$.claim')) END) IS NULL
), 0) > 0 AS actively_refuted
```

Implement the repeated claim expression by interpolating the unchanged SCOPED_CLAIM constant; no alternate claim policy is introduced. COALESCE handles only the aggregate's empty-row result: malformed bounds raise an error inside the scalar function and must propagate, never become a false result. Do not retain EXISTS, LIMIT 1, MAX-based early-exit assumptions, or a guard that skips validation once an active refutation is known.

- [x] Keep scoped refutations as an exhaustive JSON aggregation using the shared ACTIVE_SQL predicate, not an EXISTS or early-return loop. Leave SCOPED_CLAIM, scope ranking, candidate limit and unrelated recency policy unchanged.
- [x] Add public `edges::is_active_at` as a thin adapter over the same pure predicate for future atomic app revalidation; it does not load records or provide authorization.
- [x] Construct whole and claim-scoped refutations via `link_thoughts` in tests. At the same fixed instant, assert matching active state in `is_active_at`, connections, graph expansion, traversal and brief candidates. After expiration, source eligibility changes only if other refutations/policy allow it; retained claims and remaining whole refutations still apply.
- [x] Add a parameterized same-source regression with two whole-refutation edges to different targets: one valid active edge and one malformed bound. Insert valid then malformed, and malformed then valid. Both `load_brief_candidates` and the production `get_brief_tool` path must report an error in both orders, never a successful suppressed candidate list. Repeat with malformed start versus end and with a malformed bound paired with a future valid bound to prove both bounds are parsed. Exercise the graph/active-page paths on the same fixture as well, so no consumer returns a successful partial result after encountering the valid edge first.
- [x] Inject malformed legacy bounds directly into a synthetic test database and assert every affected active read errors, while raw get_edge and historical traversal remain readable. Put malformed bounds on both whole and scoped refutations. Verify no partial candidate/graph result is returned as success.
- [x] Replace the `tools.rs` regression comment/workaround that expires only to year 2000. Assert default expiration now removes the edge from active tools immediately, without sleeping or changing stored edge identity/metadata/endpoints.
- [x] Run `cargo test -p shelby-memory edges::tests`, `cargo test -p shelby-memory brief::tests`, and `cargo test -p shelby-memory tools::tests`.

## Task 3 — Bounded Canonical Active-Edge Page

- [x] Write page tests before implementation: create edges with stable explicit IDs in a synthetic database, mixing active, future, expired and multiple edge types. Assert the proposed API is missing, then implement it.
- [x] Reject page_size outside 1..=200; validate edge type using `is_valid_edge_type`, validate explicit now and bound a supplied after-ID to 256 bytes. Cursor values are bound SQL strings and need not reference an existing row; do not require UUID syntax for legacy IDs.
- [x] Fetch at most page_size candidates using `WHERE edge_type = ? AND id > ? ORDER BY id COLLATE BINARY LIMIT ?` (omit the cursor condition for the first page). Iterate the rows and call the shared pure predicate; return full EdgeRecords only for active candidates. Retain the last **scanned** ID, not the last visible ID.
- [x] Use a separate bounded EXISTS query after the last scanned ID to decide continuation; it does not load metadata. Return next_after_id only when more matching-type rows exist. A malformed candidate bound aborts that page with an error; do not skip it or return a misleading complete empty list.
- [x] Document that page_size bounds materialized candidate rows and Rust predicate evaluations, not SQLite scan/sort work or bytes of arbitrary historic metadata. No metadata truncation, allocation ceiling claim, total count or silent partial EdgeRecord. Existing metadata storage limits are unchanged.
- [x] Document fixed-instant continuation: caller retains identical type/now/scope across pages. UUID lexical order is stable but not creation order. Concurrent insertions before the cursor appear on refresh; this is not snapshot isolation. App-level both-endpoint authorization and per-version acknowledgment suppression occur before filling its visible limit and must retain continuation when scanning stops.
- [x] Test page sizes 0/1/200/201, unknown type, overlong/injection-like cursor strings, empty active pages with continuation, no duplicates/omissions in a static dataset, metadata/claim exactness, and malformed bounds in a scanned page. Prove a malformed row beyond the current candidate page does not get loaded early.
- [x] Run `cargo test -p shelby-memory active_edges_page` and the full memory crate tests.

## D6 — Baseline, Required Gates and Release

- [x] Before source edits after review, run baseline `cargo test -p shelby-memory` in this worktree; record results separately from changed-source verification. Baseline subsequently passed: 70 unit tests and one copied-fixture test; recorded in /tmp/Temporal-Baseline.log.
- [x] Set `CARGO_TARGET_DIR` to an isolated temporary build directory, e.g. `/tmp/Shelby Temporal Edge Target`, so generated build output stays outside the repository. Test databases use unique temporary locations or memory Connections; never use a personal profile.
- [x] Run the mandatory copied-fixture compatibility test: `cargo test -p shelby-memory --test cross_engine`. Assert schema stays 18 and opening/reading does not normalize stored edge timestamps. Never modify `tests/fixtures/TypeScript-v18.sqlite`.
- [x] Run every MCP AGENTS gate from this worktree:

```sh
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm ci
npm test
npm audit
```

- [x] Preserve the current main deterministic memory-evaluation tests included in `cargo test --workspace`; do not regenerate goldens merely to hide a temporal change. No distribution artifact changes are planned, so the distribution-only binary/package gates do not apply unless scope changes and root approves them.
- [x] Inspect Cargo.lock and git diff for unintended upgrades, generated artifacts, fixture edits, migrations and App pin changes. Run `git diff --check`.
- [x] Freeze the source diff, exact commit base, targeted/full gate evidence and implementation report for independent review. Stop on actual failures and report their cause; do not label the prerequisite ready without passing required gates and review.

## Plan Self-Review

D1 files and APIs, D2 strict parsed instants/registration, graph and brief parity, canonical mutation validation, bounded page semantics, malformed-data policy and the MCP gates are explicitly assigned above. No unresolved product choice remains after root's malformed-bound decision. The reviewed non-short-circuit whole-refutation requirement is mandatory and covered by mixed-edge insertion-order tests. Two engineering assumptions require early executable proof: registering on caller-owned Connections while another cursor is active, and preserving exact mixed-format/sub-millisecond semantics across the SQL and pure-Rust paths. If either fails, revise this plan with root before substituting a different temporal policy or schema change.


Implementation completed and frozen for independent source review; no local commit, upstream merge or App pin change has been performed. Full evidence is in Temporal Edge Parity Implementation Report.md.
