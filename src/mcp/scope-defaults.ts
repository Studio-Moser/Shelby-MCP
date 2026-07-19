import type Database from "better-sqlite3";
import {
	resolveProjectReference,
	resolveProjectScope,
} from "../db/resolve-project.js";
import type { ProjectReferenceResolution } from "../db/project-identity.js";

export interface ScopableArgs {
	project_id?: string;
  project_identifier?: string;
  include_shared?: boolean;
  all_projects?: boolean;
  [key: string]: unknown;
}

export type AppliedScope =
  | { kind: "applied"; args: ScopableArgs }
  | { kind: "error"; category: "project_scope_invalid"; message: string };

function invalidScope(
	resolution: Exclude<ProjectReferenceResolution, { kind: "resolved" }>,
): AppliedScope {
	return {
		kind: "error",
		category: "project_scope_invalid",
		message: `Project scope could not be resolved (${resolution.kind}). Pass a registered project_id or project_identifier.`,
	};
}

/** Apply exact project scope, failing closed to shared-only when roots are unresolved. */
export function applyDefaultScope(
  args: ScopableArgs,
  db: Database.Database,
  paths: string[],
): AppliedScope {
	const hasExplicitScope =
		args.project_id !== undefined || args.project_identifier !== undefined;
	if (hasExplicitScope) {
		const reference = resolveProjectReference(db, {
			projectId: args.project_id,
			projectIdentifier: args.project_identifier,
		});
		if (reference.kind !== "resolved") return invalidScope(reference);
		if (args.all_projects === true) return { kind: "applied", args };
    return {
			kind: "applied",
			args: {
				...args,
				project_id: reference.projectId,
				project_identifier: reference.currentSlug,
				include_shared: args.include_shared ?? true,
			},
    };
  }

  if (args.all_projects === true) return { kind: "applied", args };

	const detected = resolveProjectScope(db, paths);
	if (detected.kind !== "resolved") {
		return {
			kind: "applied",
			args: {
				...args,
				project_id: undefined,
				project_identifier: undefined,
				shared_only: true,
			},
		};
	}

	const reference = resolveProjectReference(db, {
		projectIdentifier: detected.slug,
	});
	if (reference.kind !== "resolved") {
		return {
			kind: "applied",
			args: {
				...args,
				project_id: undefined,
				project_identifier: undefined,
				shared_only: true,
			},
		};
  }

  return {
    kind: "applied",
    args: {
      ...args,
			project_id: reference.projectId,
			project_identifier: reference.currentSlug,
      include_shared: args.include_shared ?? true,
    },
  };
}
