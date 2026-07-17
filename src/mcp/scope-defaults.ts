import type Database from "better-sqlite3";
import { resolveProjectScope } from "../db/resolve-project.js";

export interface ScopableArgs {
  project_identifier?: string;
  include_shared?: boolean;
  all_projects?: boolean;
  [key: string]: unknown;
}

export type AppliedScope =
  | { kind: "applied"; args: ScopableArgs }
  | { kind: "error"; category: "project_scope_invalid"; message: string };

/** Apply exact project scope, failing closed to shared-only when roots are unresolved. */
export function applyDefaultScope(
  args: ScopableArgs,
  db: Database.Database,
  paths: string[],
): AppliedScope {
  if (args.all_projects === true) return { kind: "applied", args };

  const resolution = resolveProjectScope(db, paths, args.project_identifier);
  if (resolution.kind === "invalid_explicit") {
    return {
      kind: "error",
      category: "project_scope_invalid",
      message: `project_identifier "${resolution.slug}" is unknown or noncanonical. Pass a registered canonical project_identifier or configure project roots.`,
    };
  }
  if (resolution.kind !== "resolved") {
    return { kind: "applied", args: { ...args, project_identifier: undefined, shared_only: true } };
  }

  return {
    kind: "applied",
    args: {
      ...args,
      project_identifier: resolution.slug,
      include_shared: args.include_shared ?? true,
    },
  };
}
