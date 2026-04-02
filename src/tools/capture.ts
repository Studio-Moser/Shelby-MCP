import type { ThoughtDatabase } from "../db/database.js";
import { insertThought, getThought } from "../db/thoughts.js";
import { linkThoughts } from "../db/edges.js";
import { searchThoughts, sanitizeFTSQuery } from "../db/fts.js";
import { toolSuccess, toolError, type ToolResult } from "./helpers.js";

const SUGGESTION_LIMIT = 5;
const SUGGESTION_MIN_RANK = 0.5; // BM25 rank threshold (higher = more relevant)

interface SuggestedConnection {
  id: string;
  summary: string | null;
  similarity_reason: string;
}

/**
 * Run a quick FTS search against existing thoughts to find potential connections.
 * Returns up to SUGGESTION_LIMIT results above the rank threshold, excluding
 * the newly captured thought itself.
 */
function findSuggestedConnections(
  db: ThoughtDatabase,
  content: string,
  summary: string | undefined,
  excludeId: string,
): SuggestedConnection[] {
  // Build a search query from the summary (preferred, more focused) or first 200 chars of content
  const searchText = summary ?? content.slice(0, 200);
  if (!searchText.trim()) return [];

  const sanitized = sanitizeFTSQuery(searchText);
  if (!sanitized) return [];

  const ftsResult = searchThoughts(db.db, {
    query: searchText,
    limit: SUGGESTION_LIMIT + 1, // +1 to account for possible self-match
    offset: 0,
  });

  const suggestions: SuggestedConnection[] = [];
  for (const r of ftsResult.results) {
    if (r.id === excludeId) continue;
    if (r.rank < SUGGESTION_MIN_RANK) continue;
    suggestions.push({
      id: r.id,
      summary: r.summary,
      similarity_reason: `FTS match (relevance: ${r.rank.toFixed(2)})`,
    });
    if (suggestions.length >= SUGGESTION_LIMIT) break;
  }

  return suggestions;
}

interface CaptureArgs {
  content?: string;
  summary?: string;
  type?: string;
  source?: string;
  project?: string;
  topics?: string[];
  people?: string[];
  metadata?: Record<string, unknown>;
  related_to?: string[];
  thoughts?: Array<{
    content: string;
    summary?: string;
    type?: string;
    source?: string;
    project?: string;
    topics?: string[];
    people?: string[];
    metadata?: Record<string, unknown>;
    related_to?: string[];
  }>;
}

function captureSingle(
  db: ThoughtDatabase,
  args: {
    content: string;
    summary?: string;
    type?: string;
    source?: string;
    project?: string;
    topics?: string[];
    people?: string[];
    metadata?: Record<string, unknown>;
    related_to?: string[];
  },
): { id: string; linked: string[]; skipped: string[] } {
  const id = insertThought(db.db, {
    content: args.content,
    summary: args.summary,
    type: args.type,
    source: args.source,
    project: args.project,
    topics: args.topics,
    people: args.people,
    metadata: args.metadata,
  });

  const linked: string[] = [];
  const skipped: string[] = [];

  if (args.related_to && Array.isArray(args.related_to)) {
    for (const relatedId of args.related_to) {
      const exists = getThought(db.db, relatedId);
      if (!exists) {
        skipped.push(relatedId);
        continue;
      }
      try {
        linkThoughts(db, {
          source_id: id,
          target_id: relatedId,
          edge_type: "related",
        });
        linked.push(relatedId);
      } catch {
        skipped.push(relatedId);
      }
    }
  }

  return { id, linked, skipped };
}

export function handleCaptureThought(
  db: ThoughtDatabase,
  args: Record<string, unknown>,
): ToolResult {
  const a = args as unknown as CaptureArgs;

  // Bulk capture mode
  if (a.thoughts && Array.isArray(a.thoughts)) {
    if (a.thoughts.length === 0) {
      return toolError("invalid_input", "thoughts array is empty");
    }

    const results: Array<{ id: string; linked: string[]; skipped: string[] }> = [];
    for (const thought of a.thoughts) {
      if (!thought.content || typeof thought.content !== "string") {
        return toolError(
          "invalid_input",
          "Each thought in bulk capture must have a content string",
        );
      }
      results.push(captureSingle(db, thought));
    }

    return toolSuccess({
      captured: results.length,
      thoughts: results,
    });
  }

  // Single capture mode
  if (!a.content || typeof a.content !== "string") {
    return toolError(
      "invalid_input",
      "content is required and must be a string. For bulk capture, provide a thoughts array.",
    );
  }

  const result = captureSingle(db, {
    content: a.content,
    summary: a.summary,
    type: a.type,
    source: a.source,
    project: a.project,
    topics: a.topics,
    people: a.people,
    metadata: a.metadata,
    related_to: a.related_to,
  });

  const suggested_connections = findSuggestedConnections(
    db,
    a.content,
    a.summary,
    result.id,
  );

  return toolSuccess({
    id: result.id,
    linked: result.linked,
    skipped: result.skipped,
    suggested_connections,
  });
}
