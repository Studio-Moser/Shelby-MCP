import type Database from "better-sqlite3";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { detectProject } from "./project-detector.js";
import { findProjectByRepo, findProjectByPath, getProjectBySlug, upsertProject, normalizeGitRemote } from "./projects.js";

/** lowercase, spaces/underscores → hyphens, strip other unsafe chars. */
export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "") || "project";
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

function resolvePath(db: Database.Database, input: string): Extract<ProjectScopeResolution, { kind: "resolved" }> | null {
  const cwd = canonicalPath(input);
  const byPath = findProjectByPath(db, cwd);
  if (byPath) {
    return { kind: "resolved", slug: byPath.slug, source: "member_path" };
  }

  const detected = detectProject(cwd);
  if (!detected) return null;
  const projectRoot = canonicalPath(detected.projectRoot);

  if (detected.remote) {
    const normalizedRemote = normalizeGitRemote(detected.remote);
    const byRepo = findProjectByRepo(db, normalizedRemote);
    if (byRepo) {
      return { kind: "resolved", slug: byRepo.slug, source: "git_remote" };
    }
    return {
      kind: "resolved",
      slug: slugify(path.basename(normalizedRemote)),
      source: "derived",
      memberPaths: [projectRoot],
      memberRepos: [normalizedRemote],
    };
  }

  return {
    kind: "resolved",
    slug: slugify(path.basename(projectRoot)),
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
    if (slugify(explicit) !== explicit || !getProjectBySlug(db, explicit)) {
      return { kind: "invalid_explicit", slug: explicit };
    }
    return { kind: "resolved", slug: explicit, source: "explicit" };
  }

  const resolutions = paths.flatMap((candidate) => {
    const resolved = resolvePath(db, candidate);
    return resolved ? [resolved] : [];
  });
  if (resolutions.length === 0) return { kind: "unresolved" };

  const slugs = [...new Set(resolutions.map((result) => result.slug))].sort();
  if (slugs.length > 1) return { kind: "ambiguous", slugs };

  const priority = { member_path: 0, git_remote: 1, derived: 2, explicit: 3 } as const;
  const best = resolutions.sort((a, b) => priority[a.source] - priority[b.source])[0]!;
  if (best.source !== "derived") return best;

  return {
    ...best,
    memberPaths: [...new Set(resolutions.flatMap((result) => result.memberPaths ?? []))],
    memberRepos: [...new Set(resolutions.flatMap((result) => result.memberRepos ?? []))],
  };
}

/** Persist a detected derived scope before a personal capture. */
export function upsertProvisionalProject(
  db: Database.Database,
  resolution: Extract<ProjectScopeResolution, { kind: "resolved" }>,
): void {
  if (resolution.source !== "derived" || getProjectBySlug(db, resolution.slug)) return;
  upsertProject(db, {
    slug: resolution.slug,
    displayName: resolution.slug,
    memberRepos: resolution.memberRepos ?? [],
    memberPaths: resolution.memberPaths ?? [],
    provisional: true,
  });
}

/** Backward-compatible single-directory write resolution. */
export function resolveProjectIdentifier(db: Database.Database, cwd: string): string | null {
  const result = resolveProjectScope(db, [cwd]);
  if (result.kind !== "resolved") return null;
  upsertProvisionalProject(db, result);
  return result.slug;
}

/** Backward-compatible single-directory read resolution. */
export function currentProjectSlug(db: Database.Database, cwd: string): string | null {
  const result = resolveProjectScope(db, [cwd]);
  return result.kind === "resolved" ? result.slug : null;
}
