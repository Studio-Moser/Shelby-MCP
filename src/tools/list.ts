import type { ThoughtDatabase } from "../db/database.js";
import { listThoughts } from "../db/thoughts.js";
import { toolSuccess, clampLimit, type ToolResult } from "./helpers.js";

interface ListArgs {
  type?: string;
  project?: string;
  topic?: string;
  person?: string;
  source?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export function handleListThoughts(
  db: ThoughtDatabase,
  args: Record<string, unknown>,
): ToolResult {
  const a = args as unknown as ListArgs;

  const result = listThoughts(db.db, {
    type: a.type,
    project: a.project,
    topic: a.topic,
    person: a.person,
    source: a.source,
    since: a.since,
    until: a.until,
    limit: clampLimit(a.limit),
    offset: a.offset,
  });

  return toolSuccess(result);
}
