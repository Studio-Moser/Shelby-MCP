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
  project?: string;
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

  const project = a.project;

  const essentials: ThoughtSummary[] =
    scope === "essentials" || scope === "full"
      ? fetchEssentials(db, project)
      : [];
  const recent: ThoughtSummary[] =
    scope === "recent" || scope === "full" ? fetchRecent(db, project) : [];

  // Deduplicate across the two sections for the total count so thoughts that
  // appear in both (e.g. a recent decision) are only counted once.
  const uniqueIds = new Set<string>();
  for (const t of essentials) uniqueIds.add(t.id);
  for (const t of recent) uniqueIds.add(t.id);

  const lastActivity = newestCreatedAt([...essentials, ...recent]);

  const essentialsSection = formatEssentials(essentials);
  const recentSection = formatRecent(recent);

  // Build the human-readable brief document. Markdown matches the Mac app's
  // output so the format is identical across transports.
  const lines: string[] = [];
  const title = project ? `# Project Brief — ${projectLabel(project)}` : "# Project Brief";
  lines.push(title);
  lines.push(
    `Scope: ${scope} | Thoughts: ${uniqueIds.size}${lastActivity ? ` | Last activity: ${lastActivity}` : ""}`,
  );
  lines.push("");

  if (essentialsSection) lines.push(essentialsSection, "");
  if (recentSection) lines.push(recentSection, "");
  if (uniqueIds.size === 0) {
    lines.push("No memories found for this project yet.");
  }

  return toolSuccess({
    project: project ?? null,
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
  project: string | undefined,
): ThoughtSummary[] {
  // Fetch each essential type in a separate list call so we can guarantee
  // per-type coverage even when one type would otherwise dominate the limit.
  const collected: ThoughtSummary[] = [];
  for (const type of ESSENTIAL_TYPES) {
    const result = listThoughts(db.db, {
      type,
      project,
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
  project: string | undefined,
): ThoughtSummary[] {
  const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
  const result = listThoughts(db.db, {
    since,
    project,
    limit: RECENT_LIMIT,
  });
  return result.results;
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

function projectLabel(project: string): string {
  // Mirror the Mac app's behavior: show the last path component instead of the
  // full absolute path so the brief header isn't dominated by the prefix.
  const parts = project.split("/").filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? project;
}
