import type Database from "better-sqlite3";
import { resolveProjectReference } from "../db/resolve-project.js";
import { toolError, type ToolResult } from "./helpers.js";

export interface ProjectScopeArgs {
  project_id?: string;
  project_identifier?: string;
}

export type ResolvedProjectScope =
  | { kind: "resolved"; projectId?: string; currentSlug?: string }
  | { kind: "error"; result: ToolResult };

export function resolveReadProjectScope(
  db: Database.Database,
  args: ProjectScopeArgs,
): ResolvedProjectScope {
  const { project_id: projectId, project_identifier: projectIdentifier } = args;
  if (projectId === undefined && projectIdentifier === undefined) {
    return { kind: "resolved" };
  }
  const reference = resolveProjectReference(db, {
    projectId,
    projectIdentifier,
  });
  if (reference.kind !== "resolved") {
    return {
      kind: "error",
      result: toolError(
        "project_scope_invalid",
        `Project scope could not be resolved (${reference.kind}). Pass a registered project_id or project_identifier.`,
      ),
    };
  }
  return {
    kind: "resolved",
    projectId: reference.projectId,
    currentSlug: reference.currentSlug,
  };
}
