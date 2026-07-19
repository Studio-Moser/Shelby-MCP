import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import {
	deriveExistingProjectId,
	isValidProjectSlug,
	type ProjectIdentityState,
} from "./project-identity.js";

export interface ProjectSeed {
	slug: string;
	displayName: string;
	memberRepos: string[];
	memberPaths: string[];
	provisional: boolean;
}

export interface Project extends ProjectSeed {
	projectId: string;
	currentSlug: string;
	identityState: ProjectIdentityState;
}

interface RawProjectRow {
	slug: string;
	project_id: string;
	current_slug: string;
	identity_state: ProjectIdentityState;
	display_name: string;
	member_repos: string | null;
	member_paths: string | null;
	provisional: number;
}

function parseArray(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value)
			? value.filter((item) => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}

function rowToProject(row: RawProjectRow): Project {
	return {
		slug: row.slug,
		projectId: row.project_id,
		currentSlug: row.current_slug,
		identityState: row.identity_state,
		displayName: row.display_name,
		memberRepos: parseArray(row.member_repos),
		memberPaths: parseArray(row.member_paths),
		provisional: row.provisional === 1,
	};
}

function projectParams(input: ProjectSeed, now: string) {
	return {
		slug: input.slug,
		display_name: input.displayName,
		member_repos: JSON.stringify(input.memberRepos ?? []),
		member_paths: JSON.stringify(input.memberPaths ?? []),
		provisional: input.provisional ? 1 : 0,
		created_at: now,
		updated_at: now,
	};
}

/**
 * Normalize a git remote URL to a portable identifier.
 * Mirrors Shelby-MacOS ProjectDetector.normalizeGitRemoteURL so both codebases
 * resolve the same string for the same repo.
 */
export function normalizeGitRemote(url: string): string {
	let result = url.trim();
	if (result.endsWith(".git")) result = result.slice(0, -4);
	if (result.includes("@") && result.includes(":") && !result.includes("://")) {
		const afterAt = result.slice(result.indexOf("@") + 1);
		result = afterAt.replace(":", "/");
	}
	if (result.startsWith("https://")) result = result.slice(8);
	else if (result.startsWith("http://")) result = result.slice(7);
	return result;
}

/** Compatibility writer for legacy callers. Existing identity columns are immutable. */
export function upsertProject(db: Database.Database, input: ProjectSeed): void {
	const now = new Date().toISOString();
	const params = {
		...projectParams(input, now),
		project_id: deriveExistingProjectId(input.slug),
	};

	db.transaction(() => {
		db.prepare(
			`INSERT INTO projects (
         slug, project_id, current_slug, identity_state, display_name,
         member_repos, member_paths, provisional, created_at, updated_at
       )
       VALUES (
         @slug, @project_id, @slug, 'local_only', @display_name,
         @member_repos, @member_paths, @provisional, @created_at, @updated_at
       )
       ON CONFLICT(slug) DO UPDATE SET
         display_name = excluded.display_name,
         member_repos = excluded.member_repos,
         member_paths = excluded.member_paths,
         provisional  = excluded.provisional,
         updated_at   = excluded.updated_at`,
		).run(params);

		db.prepare(
			`INSERT INTO project_slug_aliases (slug, project_id, status, claimed_at)
       SELECT slug, project_id, 'tentative', @created_at
       FROM projects WHERE slug = @slug
       ON CONFLICT(slug) DO NOTHING`,
		).run(params);
	})();
}

export function createLocalOnlyProject(
	db: Database.Database,
	input: ProjectSeed,
): Project {
	if (!isValidProjectSlug(input.slug)) throw new Error("invalid_project_slug");
	const projectId = randomUUID().toLowerCase();
	const now = new Date().toISOString();
	const params = {
		...projectParams(input, now),
		legacy_key: projectId,
		project_id: projectId,
	};

	db.transaction(() => {
		db.prepare(
			`INSERT INTO projects (
         slug, project_id, current_slug, identity_state, display_name,
         member_repos, member_paths, provisional, created_at, updated_at
       ) VALUES (
         @legacy_key, @project_id, @slug, 'local_only', @display_name,
         @member_repos, @member_paths, @provisional, @created_at, @updated_at
       )`,
		).run(params);
		db.prepare(
			`INSERT INTO project_slug_aliases (slug, project_id, status, claimed_at)
       VALUES (@slug, @project_id, 'tentative', @created_at)`,
		).run(params);
	})();

	const created = getProjectById(db, projectId);
	if (!created) throw new Error("project_creation_failed");
	return created;
}

export function getProjectById(
	db: Database.Database,
	projectId: string,
): Project | null {
	const row = db
		.prepare("SELECT * FROM projects WHERE project_id = ?")
		.get(projectId) as RawProjectRow | undefined;
	return row ? rowToProject(row) : null;
}

export function getProjectByAlias(
	db: Database.Database,
	slug: string,
): Project | null {
	const row = db
		.prepare(
			`SELECT projects.*
       FROM project_slug_aliases
       JOIN projects ON projects.project_id = project_slug_aliases.project_id
       WHERE project_slug_aliases.slug = ?`,
		)
		.get(slug) as RawProjectRow | undefined;
	return row ? rowToProject(row) : null;
}

export function getProjectBySlug(
	db: Database.Database,
	slug: string,
): Project | null {
	const row = db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug) as
		| RawProjectRow
		| undefined;
	return row ? rowToProject(row) : null;
}

export function listProjects(db: Database.Database): Project[] {
	const rows = db
		.prepare("SELECT * FROM projects ORDER BY slug")
		.all() as RawProjectRow[];
	return rows.map(rowToProject);
}

/**
 * Find the project that owns a given git remote (normalized match against
 * member_repos). Returns null if no project claims it.
 */
export function findProjectByRepo(
	db: Database.Database,
	remote: string,
): Project | null {
	const target = normalizeGitRemote(remote);
	for (const project of listProjects(db)) {
		if (
			project.memberRepos.some((repo) => normalizeGitRemote(repo) === target)
		) {
			return project;
		}
	}
	return null;
}

/**
 * Return the registered project whose member_paths contains the longest prefix
 * of `dir` (exact match or `dir` is a sub-path), or null. This is what lets a
 * markerless multi-repo container directory resolve to its project slug.
 */
export function findProjectByPath(
	db: Database.Database,
	dir: string,
): Project | null {
	const target = existsSync(dir) ? realpathSync.native(dir) : path.resolve(dir);
	let best: Project | null = null;
	let bestLength = -1;
	for (const project of listProjects(db)) {
		for (const memberPath of project.memberPaths) {
			const candidate = existsSync(memberPath)
				? realpathSync.native(memberPath)
				: path.resolve(memberPath);
			if (
				candidate.length > bestLength &&
				(target === candidate || target.startsWith(candidate + path.sep))
			) {
				bestLength = candidate.length;
				best = project;
			}
		}
	}
	return best;
}
