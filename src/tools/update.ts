import type { ThoughtDatabase } from "../db/database.js";
import { updateThought, getThought } from "../db/thoughts.js";
import { toolSuccess, toolError, type ToolResult } from "./helpers.js";

interface UpdateArgs {
  id?: string;
  ids?: string[];
  content?: string;
  summary?: string;
  type?: string;
  source?: string;
  project?: string;
  topics?: string[];
  people?: string[];
  metadata?: Record<string, unknown>;
  visibility?: string;
}

export function handleUpdateThought(
  db: ThoughtDatabase,
  args: Record<string, unknown>,
): ToolResult {
  const a = args as unknown as UpdateArgs;

  // Determine target IDs
  const targetIds: string[] = [];
  if (a.ids && Array.isArray(a.ids)) {
    targetIds.push(...a.ids);
  } else if (a.id && typeof a.id === "string") {
    targetIds.push(a.id);
  } else {
    return toolError(
      "invalid_input",
      "Either id (string) or ids (string[]) is required",
    );
  }

  if (targetIds.length === 0) {
    return toolError("invalid_input", "No target IDs provided");
  }

  // Build updates object (exclude id/ids)
  const updates: Record<string, unknown> = {};
  if (a.content !== undefined) updates.content = a.content;
  if (a.summary !== undefined) updates.summary = a.summary;
  if (a.type !== undefined) updates.type = a.type;
  if (a.source !== undefined) updates.source = a.source;
  if (a.project !== undefined) updates.project = a.project;
  if (a.topics !== undefined) updates.topics = a.topics;
  if (a.people !== undefined) updates.people = a.people;
  if (a.metadata !== undefined) updates.metadata = a.metadata;
  if (a.visibility !== undefined) updates.visibility = a.visibility;

  if (Object.keys(updates).length === 0) {
    return toolError("invalid_input", "No fields to update were provided");
  }

  let updatedCount = 0;
  const notFound: string[] = [];

  for (const tid of targetIds) {
    const exists = getThought(db.db, tid);
    if (!exists) {
      notFound.push(tid);
      continue;
    }
    const ok = updateThought(db.db, tid, updates as Parameters<typeof updateThought>[2]);
    if (ok) updatedCount++;
  }

  return toolSuccess({
    updated: updatedCount,
    not_found: notFound,
  });
}
