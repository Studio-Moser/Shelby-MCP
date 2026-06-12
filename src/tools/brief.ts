import type { ThoughtDatabase } from "../db/database.js";
import { listThoughts, type ThoughtSummary } from "../db/thoughts.js";
import { toolSuccess, toolError, type ToolResult } from "./helpers.js";

// ---------------------------------------------------------------------------
// get_brief
// ---------------------------------------------------------------------------
//
// Generates a high-level project context brief for session orientation. Call
// this at the start of a new session to recover the key decisions, facts, and
// recent activity for a project without having to issue multiple
// search_thoughts / list_thoughts calls.
//
// Ported from Shelby-MacOS's `BriefGenerator.swift`. Kept as a pure read over
// the existing `listThoughts` API — no new DB helpers required.
//
// Scopes:
//   - `essentials` — Key decisions, facts, and preferences (types: decision,
//     reference, insight). Deduped, sorted by recency, capped at 20.
//   - `recent`     — Everything created in the last 7 days, up to 15.
//   - `full`       — Both sections (default).

export type BriefScope = "essentials" | "recent" | "full";

export interface BriefArgs {
  scope?: BriefScope;
  project_identifier?: string;
  shared_only?: boolean;
}

// "Essentials" are the thought types that represent durable, reusable context.
// Kept aligned with the Mac app's BriefGenerator — using canonical ShelbyMCP
// type names (`decision`, `reference`, `insight`) rather than the historical
// `fact`/`preference` names the Mac app uses so we don't reintroduce legacy
// vocabulary on the npm side.
const ESSENTIAL_TYPES: readonly string[] = ["decision", "reference", "insight"];
const ESSENTIALS_LIMIT = 20;
const RECENT_LIMIT = 15;
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function handleGetBrief(
  db: ThoughtDatabase,
  args: Record<string, unknown>,
): ToolResult {
  const a = args as unknown as BriefArgs;
  const scope: BriefScope = a.scope ?? "full";

  if (scope !== "essentials" && scope !== "recent" && scope !== "full") {
    return toolError(
      "invalid_input",
      'scope must be one of: "essentials", "recent", "full"',
    );
  }

  const slug = a.project_identifier;
  // When shared_only is set (and no explicit project_identifier), all reads are
  // restricted to visibility='shared' thoughts — the fail-safe path that prevents
  // cross-project contamination when no project slug can be resolved.
  const sharedOnly = a.shared_only === true && slug === undefined;

  const essentials: ThoughtSummary[] =
    scope === "essentials" || scope === "full"
      ? sharedOnly ? fetchShared(db) : fetchEssentials(db, slug)
      : [];
  const recent: ThoughtSummary[] =
    scope === "recent" || scope === "full"
      ? fetchRecent(db, slug, sharedOnly)
      : [];

  // Shared section: visibility='shared' thoughts across all projects.
  // Fetch before deduplication so we can filter shared ids out of the other sections.
  // In shared-only mode, essentials already == fetchShared, so skip the separate fetch
  // to avoid double-counting — we'll reuse the essentials array as the shared set.
  const shared: ThoughtSummary[] =
    scope === "essentials" || scope === "full"
      ? sharedOnly ? [] : fetchShared(db)
      : [];

  // Remove any thought that appears in the Shared section from Essentials and
  // Recent so each thought renders exactly once.
  const sharedIds = new Set(shared.map((t) => t.id));
  const essentialsShown = essentials.filter((t) => !sharedIds.has(t.id));
  const recentShown = recent.filter((t) => !sharedIds.has(t.id));

  // Deduplicate across all three sections for the total count.
  const uniqueIds = new Set<string>();
  for (const t of essentialsShown) uniqueIds.add(t.id);
  for (const t of recentShown) uniqueIds.add(t.id);
  for (const t of shared) uniqueIds.add(t.id);

  const lastActivity = newestCreatedAt([...essentialsShown, ...recentShown, ...shared]);

  const essentialsSection = formatEssentials(essentialsShown);
  const recentSection = formatRecent(recentShown);

  // Build the human-readable brief document. Markdown matches the Mac app's
  // output so the format is identical across transports.
  const lines: string[] = [];
  const title = slug ? `# Project Brief — ${slug}` : "# Project Brief";
  lines.push(title);
  lines.push(
    `Scope: ${scope} | Thoughts: ${uniqueIds.size}${lastActivity ? ` | Last activity: ${lastActivity}` : ""}`,
  );
  lines.push("");

  if (essentialsSection) lines.push(essentialsSection, "");

  // Shared section: visibility='shared' thoughts (already fetched and deduped above).
  if (scope === "essentials" || scope === "full") {
    const sharedSection = formatShared(shared);
    if (sharedSection) lines.push(sharedSection, "");
  }

  if (recentSection) lines.push(recentSection, "");
  if (uniqueIds.size === 0) {
    lines.push("No memories found for this project yet.");
  }

  return toolSuccess({
    project_identifier: slug ?? null,
    scope,
    thought_count: uniqueIds.size,
    last_activity: lastActivity,
    brief: lines.join("\n").trimEnd(),
  });
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

function fetchEssentials(
  db: ThoughtDatabase,
  slug: string | undefined,
): ThoughtSummary[] {
  // Fetch each essential type in a separate list call so we can guarantee
  // per-type coverage even when one type would otherwise dominate the limit.
  // include_shared is false here — the Shared section owns shared rows so they
  // don't appear in both sections.
  const collected: ThoughtSummary[] = [];
  for (const type of ESSENTIAL_TYPES) {
    const result = listThoughts(db.db, {
      type,
      project_identifier: slug,
      include_shared: false,
      limit: ESSENTIALS_LIMIT,
    });
    collected.push(...result.results);
  }
  // Dedupe by id, preserving the newest-first sort.
  const seen = new Set<string>();
  const deduped: ThoughtSummary[] = [];
  const sorted = [...collected].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  for (const t of sorted) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    deduped.push(t);
    if (deduped.length >= ESSENTIALS_LIMIT) break;
  }
  return deduped;
}

function fetchRecent(
  db: ThoughtDatabase,
  slug: string | undefined,
  sharedOnly = false,
): ThoughtSummary[] {
  const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
  if (sharedOnly) {
    // Shared-only fail-safe path: only return visibility='shared' thoughts.
    const result = listThoughts(db.db, {
      since,
      shared_only: true,
      limit: RECENT_LIMIT,
    });
    return result.results;
  }
  // include_shared is false here — the Shared section owns shared rows so they
  // don't appear in both sections.
  const result = listThoughts(db.db, {
    since,
    project_identifier: slug,
    include_shared: false,
    limit: RECENT_LIMIT,
  });
  return result.results;
}

// Returns visibility='shared' durable-context thoughts regardless of project.
function fetchShared(db: ThoughtDatabase): ThoughtSummary[] {
  const collected: ThoughtSummary[] = [];
  for (const type of ESSENTIAL_TYPES) {
    const result = listThoughts(db.db, {
      type,
      shared_only: true,
      limit: ESSENTIALS_LIMIT,
    });
    for (const t of result.results) {
      if (!collected.some((c) => c.id === t.id)) collected.push(t);
    }
  }
  return collected.slice(0, ESSENTIALS_LIMIT);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatEssentials(thoughts: ThoughtSummary[]): string {
  if (thoughts.length === 0) return "";
  const lines = ["## Essentials", ""];
  for (const t of thoughts) {
    lines.push(`- **[${dateOnly(t.created_at)}]** ${summaryOrType(t)}`);
  }
  return lines.join("\n");
}

function formatShared(thoughts: ThoughtSummary[]): string {
  if (thoughts.length === 0) return "";
  const lines = ["## Shared", ""];
  for (const t of thoughts) {
    lines.push(`- **[${dateOnly(t.created_at)}]** ${summaryOrType(t)}`);
  }
  return lines.join("\n");
}

function formatRecent(thoughts: ThoughtSummary[]): string {
  if (thoughts.length === 0) return "";
  const lines = ["## Recent (last 7 days)", ""];
  for (const t of thoughts) {
    const bullet = t.type === "task" ? "- [ ]" : "-";
    lines.push(`${bullet} **[${dateOnly(t.created_at)}]** ${summaryOrType(t)}`);
  }
  return lines.join("\n");
}

function summaryOrType(t: ThoughtSummary): string {
  if (t.summary && t.summary.trim().length > 0) return t.summary;
  // When a thought has no summary, fall back to the type so the line isn't
  // empty. Callers should prefer to supply a summary — this is a safety net.
  return `(${t.type}, no summary)`;
}

function dateOnly(iso: string): string {
  // Trim to YYYY-MM-DD for the markdown bullet prefix.
  return iso.slice(0, 10);
}

function newestCreatedAt(thoughts: ThoughtSummary[]): string | null {
  if (thoughts.length === 0) return null;
  let max = thoughts[0]!.created_at;
  for (const t of thoughts) {
    if (t.created_at > max) max = t.created_at;
  }
  return max;
}
