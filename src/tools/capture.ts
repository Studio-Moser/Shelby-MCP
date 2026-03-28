import type { ThoughtDatabase } from "../db/database.js";
import { insertThought, getThought } from "../db/thoughts.js";
import { linkThoughts } from "../db/edges.js";
import { toolSuccess, toolError, type ToolResult } from "./helpers.js";

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

  return toolSuccess({
    id: result.id,
    linked: result.linked,
    skipped: result.skipped,
  });
}
