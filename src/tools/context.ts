import type { ThoughtDatabase } from "../db/database.js";
import { listThoughts, getThought, type ThoughtSummary } from "../db/thoughts.js";
import { countThoughts } from "../db/thoughts.js";
import { toolSuccess, toolError, clampLimit, type ToolResult } from "./helpers.js";
import { handleGetBrief } from "./brief.js";

// ---------------------------------------------------------------------------
// select_context
// ---------------------------------------------------------------------------
//
// Compose a targeted context payload by filtering thoughts by type, topic,
// person, or date, with optional brief/stats headers. Returns a formatted
// markdown document ready for the agent to paste into its working context.
//
// Ported from Shelby-MacOS's `ToolHandlers.selectContext`. Unlike the Mac app
// version which returned a bare string, this version wraps the output in the
// standard `toolSuccess` envelope so it matches the shape of every other
// npm tool response.
//
// Use this instead of `get_brief` when you need a narrower slice (e.g. "all
// decisions about auth from the last 30 days" or "everything mentioning
// Sarah") rather than a full project overview.

export interface SelectContextArgs {
  types?: string[];
  topics?: string[];
  people?: string[];
  since?: string;
  project?: string;
  include_brief?: boolean;
  include_stats?: boolean;
  limit?: number;
}

export function handleSelectContext(
  db: ThoughtDatabase,
  args: Record<string, unknown>,
): ToolResult {
  const a = args as unknown as SelectContextArgs;

  // Basic input validation — string arrays only.
  if (a.types !== undefined && !isStringArray(a.types)) {
    return toolError("invalid_input", "types must be an array of strings");
  }
  if (a.topics !== undefined && !isStringArray(a.topics)) {
    return toolError("invalid_input", "topics must be an array of strings");
  }
  if (a.people !== undefined && !isStringArray(a.people)) {
    return toolError("invalid_input", "people must be an array of strings");
  }
  if (a.since !== undefined && typeof a.since !== "string") {
    return toolError("invalid_input", "since must be an ISO 8601 string");
  }

  const limit = clampLimit(a.limit);
  const sections: string[] = [];

  // Optional brief header. We reuse get_brief to avoid forking the essentials
  // formatting logic; extract just the rendered markdown so we can splice it
  // into the combined output.
  if (a.include_brief === true) {
    const briefResult = handleGetBrief(db, {
      scope: "essentials",
      project: a.project,
    });
    if (!briefResult.isError) {
      try {
        const parsed = JSON.parse(briefResult.content[0]?.text ?? "{}") as {
          brief?: string;
        };
        if (parsed.brief && parsed.brief.trim().length > 0) {
          sections.push(parsed.brief);
        }
      } catch {
        // Non-fatal — a malformed brief shouldn't break the whole response.
      }
    }
  }

  // Fetch filtered thoughts. The Mac app applies topic/person as the FIRST
  // element of their arrays because `listThoughts` only supports a single
  // topic/person filter. We preserve that behaviour.
  const thoughts = collectThoughts(db, {
    types: a.types,
    topicFilter: a.topics?.[0],
    personFilter: a.people?.[0],
    since: a.since,
    project: a.project,
    limit,
  });

  if (thoughts.length > 0) {
    const formatted = thoughts
      .map((t) => formatThought(db, t))
      .join("\n---\n");
    sections.push(
      `## Selected Context (${thoughts.length} thought${thoughts.length === 1 ? "" : "s"})\n${formatted}`,
    );
  } else {
    sections.push("## Selected Context\nNo thoughts matched the given filters.");
  }

  // Optional stats footer.
  if (a.include_stats === true) {
    const total = countThoughts(db.db);
    sections.push(`## Memory Stats\nTotal: ${total} thought${total === 1 ? "" : "s"}`);
  }

  const document = sections.join("\n\n");
  return toolSuccess({
    matched_count: thoughts.length,
    project: a.project ?? null,
    document,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

interface CollectArgs {
  types: string[] | undefined;
  topicFilter: string | undefined;
  personFilter: string | undefined;
  since: string | undefined;
  project: string | undefined;
  limit: number;
}

function collectThoughts(
  db: ThoughtDatabase,
  args: CollectArgs,
): ThoughtSummary[] {
  // Fan out across types when multiple are supplied so every type is
  // represented up to `limit` results; then dedupe + truncate to the final cap.
  const pool: ThoughtSummary[] = [];
  if (args.types && args.types.length > 0) {
    for (const type of args.types) {
      const result = listThoughts(db.db, {
        type,
        topic: args.topicFilter,
        person: args.personFilter,
        since: args.since,
        project: args.project,
        limit: args.limit,
      });
      pool.push(...result.results);
    }
  } else {
    const result = listThoughts(db.db, {
      topic: args.topicFilter,
      person: args.personFilter,
      since: args.since,
      project: args.project,
      limit: args.limit,
    });
    pool.push(...result.results);
  }

  const seen = new Set<string>();
  const deduped: ThoughtSummary[] = [];
  for (const t of pool) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    deduped.push(t);
    if (deduped.length >= args.limit) break;
  }
  return deduped;
}

function formatThought(db: ThoughtDatabase, summary: ThoughtSummary): string {
  // Fetch the full record for the body. This is one extra query per thought;
  // for the default limit of 20 that's well within the sub-millisecond budget
  // of better-sqlite3 but keeps each line meaningful.
  const full = getThought(db.db, summary.id);
  const content = full?.content ?? summary.summary ?? "(no content)";
  const lines: string[] = [];
  lines.push(`Content: ${content}`);
  if (summary.summary) lines.push(`Summary: ${summary.summary}`);
  lines.push(`Created: ${summary.created_at}`);
  lines.push(`Type: ${summary.type}`);
  if (summary.topics.length > 0) {
    lines.push(`Topics: ${summary.topics.join(", ")}`);
  }
  if (full?.people && full.people.length > 0) {
    lines.push(`People: ${full.people.join(", ")}`);
  }
  return lines.join("\n");
}
