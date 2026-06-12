import type Database from "better-sqlite3";
import { currentProjectSlug } from "../db/resolve-project.js";

/**
 * Read-tool args that can carry project scoping fields.
 */
export interface ScopableArgs {
  project_identifier?: string;
  include_shared?: boolean;
  all_projects?: boolean;
  [key: string]: unknown;
}

/**
 * Apply cwd-based default project scoping to read-tool args when the caller
 * has NOT explicitly provided a project_identifier and has NOT opted out via
 * all_projects: true.
 *
 * Rules:
 *  - If all_projects === true  → return args unchanged (caller wants global view).
 *  - If project_identifier is already set → return args unchanged (explicit wins).
 *  - Otherwise → resolve current slug from cwd; if non-null, inject
 *    project_identifier = slug and default include_shared = true.
 *
 * This is extracted as a pure(-ish) function so it can be unit-tested
 * independently of the MCP server registration machinery.
 */
export function applyDefaultScope(
  args: ScopableArgs,
  db: Database.Database,
  cwd: string,
): ScopableArgs {
  // Caller opted out of auto-scoping.
  if (args.all_projects === true) return args;

  // Caller already provided an explicit project scope.
  if (args.project_identifier !== undefined) return args;

  // Attempt to derive the current project slug from cwd.
  const slug = currentProjectSlug(db, cwd);
  // No slug resolved → fail safe to shared-only (never expose every project).
  if (!slug) return { ...args, shared_only: true };

  return {
    ...args,
    project_identifier: slug,
    include_shared: args.include_shared ?? true,
  };
}
