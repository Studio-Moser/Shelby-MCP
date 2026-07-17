import type { ThoughtDatabase } from "../db/database.js";
import { loadBriefCandidates } from "../db/brief-candidates.js";
import { toolSuccess, toolError, type ToolResult } from "./helpers.js";
import { selectBriefItems, type BriefScope } from "./brief-policy.js";
import { renderTokenBoundBrief } from "./brief-renderer.js";

export type { BriefScope } from "./brief-policy.js";

export interface BriefArgs {
  scope?: BriefScope;
  project_identifier?: string;
  include_shared?: boolean;
  shared_only?: boolean;
  all_projects?: boolean;
  token_budget?: number;
  now?: string;
}

export function handleGetBrief(
  db: ThoughtDatabase,
  args: Record<string, unknown>,
): ToolResult {
  const a = args as unknown as BriefArgs;
  const scope = a.scope ?? "full";
  if (scope !== "essentials" && scope !== "recent" && scope !== "full") {
    return toolError("invalid_input", 'scope must be one of: "essentials", "recent", "full"');
  }

  const now = a.now ?? new Date().toISOString();
  const candidates = loadBriefCandidates(db.db, now);
  const policy = selectBriefItems(candidates, {
    scope,
    project_identifier: a.project_identifier,
    include_shared: a.include_shared ?? true,
    shared_only: a.shared_only,
    all_projects: a.all_projects,
    now,
  });
  const budget = Math.max(600, Math.min(a.token_budget ?? 800, 900));
  const rendered = renderTokenBoundBrief(policy.items, policy.omitted_counts, budget);
  const lastActivity = rendered.items.reduce<string | null>(
    (latest, item) => latest === null || item.updated_at > latest ? item.updated_at : latest,
    null,
  );

  return toolSuccess({
    project_identifier: a.all_projects === true ? null : a.project_identifier ?? null,
    scope,
    thought_count: rendered.items.length,
    last_activity: lastActivity,
    policy_version: policy.policy_version,
    estimated_tokens: rendered.estimated_tokens,
    omitted_counts: policy.omitted_counts,
    items: rendered.items,
    brief: rendered.brief,
  });
}
