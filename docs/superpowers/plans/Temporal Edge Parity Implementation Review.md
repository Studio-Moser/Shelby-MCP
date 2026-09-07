# Temporal Edge Parity Implementation Review

Accepted. Reviewed frozen patch c84eb8a0118d44447b18ae4f964174feae04d70d97d7cca8feed69acefa14f09 against base 252529d803513174334ceb30d48f872d1b2bc0c9 and the accepted plan. No blocking source findings.

- R1: Graph and brief share parsed start-inclusive/end-exclusive instant semantics. Both bounds are parsed before comparison; malformed legacy bounds propagate errors. Whole-refutation aggregation exhaustively checks relevant siblings, including an already-active sibling; scoped claim interpretation is unchanged. Historical reads remain raw.
- R2: Connection-local registration covers caller-owned connections without callback database access or re-registering active functions. Page limits bound candidate materialization, preserve continuation through empty active pages and do not imply authorization or a global total. Callers still authorize both endpoints. Reserved function metadata is not authentication against a caller controlling its own SQLite connection.
- R3: New writes validate before mutation; no schema, stored timestamp or immutable fixture conversion. Scope and trust selection remain unchanged. The same-day default-expiry regression and mixed malformed sibling tests exercise production readers/tool paths.

Independent check: cargo test -p shelby-memory passed 78 unit tests plus one compatibility test using the implementation worktree and external target directory; evidence /tmp/Shelby Temporal Independent Check.log. Checked frozen full-gate logs: 149 Rust tests passed, one existing ignored; npm 14 tests and documentation links passed; formatting, Clippy and audit passed. git diff --check passed.

Release limit: this is the canonical temporal/read prerequisite. App pin adoption, review authorization/versioning and acknowledgment/withdrawal UI are separate work. No real profile, live provider or remote publication was used by this review.
