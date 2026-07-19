import type { ThoughtDatabase } from "../db/database.js";
import { listThoughts, type TrustLevel } from "../db/thoughts.js";
import { toolSuccess, clampLimit, type ToolResult } from "./helpers.js";
import { resolveReadProjectScope } from "./project-scope.js";

interface ListArgs {
  type?: string;
  project?: string;
  project_id?: string;
  project_identifier?: string;
  include_shared?: boolean;
  shared_only?: boolean;
  all_projects?: boolean;
  topic?: string;
  person?: string;
  source?: string;
  source_agent?: string;
  trust_level?: TrustLevel;
  since?: string;
  until?: string;
  has_summary?: boolean;
  limit?: number;
  offset?: number;
}

export function handleListThoughts(
  db: ThoughtDatabase,
  args: Record<string, unknown>,
): ToolResult {
  const a = args as unknown as ListArgs;
  const scope = resolveReadProjectScope(db.db, a);
  if (scope.kind === "error") return scope.result;

  const result = listThoughts(db.db, {
    type: a.type,
    project: a.project,
    project_id: a.all_projects === true ? undefined : scope.projectId,
    include_shared: a.include_shared,
    shared_only: a.shared_only,
    topic: a.topic,
    person: a.person,
    source: a.source,
    source_agent: a.source_agent,
    trust_level: a.trust_level,
    since: a.since,
    until: a.until,
    has_summary: a.has_summary,
    limit: clampLimit(a.limit),
    offset: a.offset,
  });

  return toolSuccess(result);
}
