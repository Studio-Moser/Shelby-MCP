# Source Field Expectations

This fixture was emitted by the production `SourceExporter.prepare` through `WireFixtureTests.testEmittedSyntheticWireHasExactSourceFields`; it is not hand-authored wire JSON. The source is a generated SQLite schema-18 fixture, never a user profile. The source schema adapter is pinned to frozen MacOS commit `9322ac1a5e64ae2b8a9eddacddd10eddae198edd`, `Sources/ShelbyCore/Memory/ThoughtDatabase.swift` and `ThoughtRecord.swift`.

## Exact Expectations

- One project: UUID `33333333-3333-4333-8333-333333333333`, legacy key `33333333-3333-4333-8333-333333333333`, current slug `lantern`, display name `Lantern`, local_only source identity, pinned true, archived/provisional false. Its tentative alias retains `2026-01-01T00:00:00Z` and null retirement. Source updated timestamp is exactly `2026-01-02 00:00:00`.
- Memory `11111111-1111-4111-8111-111111111111`: exact content `Lantern meets Thursday.` followed by one newline then `The access phrase is KESTREL-702000. 雪`; null summary/sourceAgent/lastConfirmedAt/consolidatedInto; source `manual`; sourceTrust `trusted`; visibility `shared`; project UUID and alias as above; reinforcementCount 0. createdAt exactly `2026-01-01T00:00:00.123456789Z`, updatedAt exactly `2026-01-01 00:00:00`.
- Its metadata type is `task`, topics `["Launch"]`, people `[]`, actionItems `["Review the agenda"]`, dates `["Thursday"]`; extra status `done`, sensitivity `normal`, archived `false`. One brief-authority field and one unsupported extra field are named by fixed omission-category codes/counts. Their original values are absent; `MUST-NOT-EXPORT` must not appear in wire bytes. Source brief eligibility does not become active target authority.
- Memory `22222222-2222-4222-8222-222222222222`: exact content `Earlier Lantern meetings were on Tuesday.`; metadata type `note`; topics/people/actionItems/dates null; extra empty; same shared project scope and original timestamp spellings.
- One `refuted_by` edge from the second memory to the first. Exact legacy stable source ID `22222222-2222-4222-8222-222222222222_11111111-1111-4111-8111-111111111111_refuted_by`. `sourceWeight` 7.5 is co-access strength, not confidence. createdAt `2026-01-01T00:00:00Z`, updatedAt `2026-01-02T00:00:00Z`, validFrom `2026-01-01 00:00:00`, validUntil null. Claim exactly `Meeting weekday`, preserving partial-refutation semantics. Edge project UUID and compatibility alias remain explicit.
- Counts: one project, two memories, one edge; tasks and conversations `notSelected`, count 0. `sourceAppVersion` is null; the adapter reference does not assert the selected user's installed app version. ExportId/exportedAt are per-operation values, not stable dedup authority.

## Regeneration

Run from the App worktree, choosing a temporary fixture output explicitly:

```sh
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer \
SHELBY_EXPORT_FIXTURE_DIR='/tmp/Shelby Swift Exporter Proof' \
swift test --package-path 'apple/Migration Exporter' --filter WireFixtureTests
```

The test writes actual emitted JSON plus `Synthetic Source.sqlite` to that selected directory. The latter is solely a synthetic native-picker proof source. Re-export changes operation UUID/time; compare stable record fields independently. Tests use direct SQLite fixture DDL; they do not call the frozen app's writable opener. Schema setup contains the supported read columns and mandated keys, not unrelated product tables, FTS or sync infrastructure.

## Import Boundary

This is a reviewed source projection, not portable shared-note import v1. `sourceId` identifies each project/memory/edge; `projectId` references project identity, aliases live in the separate `aliases` array, and thought fields type/topics/people remain nested in exported `metadata` as they are on source disk. The canonical importer must validate its tighter UUID/slug limits and supported metadata policy, retain sourceWeight as inert provenance, and apply its own trust/eligibility semantics. No importer acceptance is claimed by these Swift tests.
