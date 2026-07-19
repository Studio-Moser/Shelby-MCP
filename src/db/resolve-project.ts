import type Database from "better-sqlite3";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { detectProject } from "./project-detector.js";
import {
	findProjectByRepo,
	findProjectByPath,
	getProjectByAlias,
	upsertProject,
	normalizeGitRemote,
} from "./projects.js";

/** lowercase, spaces/underscores → hyphens, strip other unsafe chars. */
export function slugify(name: string): string {
	return (
		name
			.trim()
			.toLowerCase()
			.replace(/[\s_]+/g, "-")
			.replace(/[^a-z0-9-]/g, "")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "") || "project"
	);
}

export type ProjectScopeResolution =
	| {
			kind: "resolved";
			slug: string;
			source: "explicit" | "member_path" | "git_remote" | "derived";
			memberPaths?: string[];
			memberRepos?: string[];
	  }
	| { kind: "unresolved" }
	| { kind: "ambiguous"; slugs: string[] }
	| { kind: "invalid_explicit"; slug: string };

function canonicalPath(input: string): string {
	return existsSync(input) ? realpathSync.native(input) : path.resolve(input);
}

type PathResolution =
	| Extract<ProjectScopeResolution, { kind: "resolved" }>
	| { kind: "slug_collision" };

function resolvePath(
	db: Database.Database,
	input: string,
): PathResolution | null {
	const cwd = canonicalPath(input);
	const byPath = findProjectByPath(db, cwd);
	if (byPath) {
		return {
			kind: "resolved",
			slug: byPath.currentSlug,
			source: "member_path",
		};
	}

	const detected = detectProject(cwd);
	if (!detected) return null;
	const projectRoot = canonicalPath(detected.projectRoot);

	if (detected.remote) {
		const normalizedRemote = normalizeGitRemote(detected.remote);
		const byRepo = findProjectByRepo(db, normalizedRemote);
		if (byRepo) {
			return {
				kind: "resolved",
				slug: byRepo.currentSlug,
				source: "git_remote",
			};
		}
		const slug = slugify(path.basename(normalizedRemote));
		if (getProjectByAlias(db, slug)) return { kind: "slug_collision" };
		return {
			kind: "resolved",
			slug,
			source: "derived",
			memberPaths: [projectRoot],
			memberRepos: [normalizedRemote],
		};
	}

	const slug = slugify(path.basename(projectRoot));
	if (getProjectByAlias(db, slug)) return { kind: "slug_collision" };
	return {
		kind: "resolved",
		slug,
		source: "derived",
		memberPaths: [projectRoot],
		memberRepos: [],
	};
}

/** Resolve explicit or multi-root scope without mutating the project registry. */
export function resolveProjectScope(
	db: Database.Database,
	paths: string[],
	explicit?: string,
): ProjectScopeResolution {
	if (explicit !== undefined) {
		const project = getProjectByAlias(db, explicit);
		if (slugify(explicit) !== explicit || !project) {
			return { kind: "invalid_explicit", slug: explicit };
		}
		return { kind: "resolved", slug: project.currentSlug, source: "explicit" };
	}

	const pathResolutions = paths.flatMap((candidate) => {
		const resolved = resolvePath(db, candidate);
		return resolved ? [resolved] : [];
	});
	if (pathResolutions.some((result) => result.kind === "slug_collision")) {
		return { kind: "unresolved" };
	}
	const resolutions = pathResolutions.filter(
		(result): result is Extract<ProjectScopeResolution, { kind: "resolved" }> =>
			result.kind === "resolved",
	);
	if (resolutions.length === 0) return { kind: "unresolved" };

	const slugs = [...new Set(resolutions.map((result) => result.slug))].sort();
	if (slugs.length > 1) return { kind: "ambiguous", slugs };

	const priority = {
		member_path: 0,
		git_remote: 1,
		derived: 2,
		explicit: 3,
	} as const;
	const best = resolutions.sort(
		(a, b) => priority[a.source] - priority[b.source],
	)[0]!;
	if (best.source !== "derived") return best;

	return {
		...best,
		memberPaths: [
			...new Set(resolutions.flatMap((result) => result.memberPaths ?? [])),
		],
		memberRepos: [
			...new Set(resolutions.flatMap((result) => result.memberRepos ?? [])),
		],
	};
}

/** Persist a detected derived scope before a personal capture. */
export function upsertProvisionalProject(
	db: Database.Database,
	resolution: Extract<ProjectScopeResolution, { kind: "resolved" }>,
): void {
	if (resolution.source !== "derived" || getProjectByAlias(db, resolution.slug))
		return;
	upsertProject(db, {
		slug: resolution.slug,
		displayName: resolution.slug,
		memberRepos: resolution.memberRepos ?? [],
		memberPaths: resolution.memberPaths ?? [],
		provisional: true,
	});
}

/** Backward-compatible single-directory write resolution. */
export function resolveProjectIdentifier(
	db: Database.Database,
	cwd: string,
): string | null {
	const result = resolveProjectScope(db, [cwd]);
	if (result.kind !== "resolved") return null;
	upsertProvisionalProject(db, result);
	return result.slug;
}

/** Backward-compatible single-directory read resolution. */
export function currentProjectSlug(
	db: Database.Database,
	cwd: string,
): string | null {
	const result = resolveProjectScope(db, [cwd]);
	return result.kind === "resolved" ? result.slug : null;
}
