import type Database from "better-sqlite3";
import path from "node:path";
import { detectProject } from "./project-detector.js";
import { findProjectByRepo, findProjectByPath, getProjectBySlug, upsertProject, normalizeGitRemote } from "./projects.js";

/** lowercase, spaces/underscores → hyphens, strip other unsafe chars. */
export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "") || "project";
}

/**
 * Shared detection logic: walk up from cwd to find the project root and
 * remote, then derive a slug — without any database writes.
 *
 * Returns the slug and the detected info, or null if no project marker is found.
 */
function detectSlug(db: Database.Database, cwd: string): { slug: string; remote: string | null; projectRoot: string } | null {
  // Registry path match first — handles markerless multi-repo containers and is
  // setup-portable: the caller's real dir maps to a human-curated slug directly.
  const byPath = findProjectByPath(db, cwd);
  if (byPath) return { slug: byPath.slug, remote: null, projectRoot: cwd };

  const detected = detectProject(cwd);
  if (!detected) return null;

  if (detected.remote) {
    // Registry match takes priority (returns the human-confirmed slug).
    const existing = findProjectByRepo(db, detected.remote);
    if (existing) {
      return { slug: existing.slug, remote: detected.remote, projectRoot: detected.projectRoot };
    }
    const normalized = normalizeGitRemote(detected.remote);
    return { slug: slugify(path.basename(normalized)), remote: detected.remote, projectRoot: detected.projectRoot };
  }

  // No remote — derive slug from directory basename.
  return { slug: slugify(path.basename(detected.projectRoot)), remote: null, projectRoot: detected.projectRoot };
}

/**
 * Resolve the project slug for a working directory. Matches the registry by git
 * remote; if a real project root is detected (detectProject non-null):
 *   - has a remote  → registry match or provision from remote basename
 *   - no remote     → provision from the project-root basename
 *
 * Returns null when detectProject finds no project marker (e.g. the server's
 * home/install dir). Callers should treat null as "unresolved" and not stamp a
 * provisional project.
 *
 * Note: for HTTP transport / clients that launch the server outside the project
 * dir, cwd-resolution is best-effort; callers should pass an explicit
 * project_identifier (the macOS app does this from its active-project context).
 */
export function resolveProjectIdentifier(db: Database.Database, cwd: string): string | null {
  const info = detectSlug(db, cwd);
  if (!info) return null;

  const { slug, remote, projectRoot } = info;

  // Only provision if no existing entry for this slug.
  const normalized = remote ? normalizeGitRemote(remote) : null;
  upsertProvisional(db, slug, normalized ? [normalized] : [], [projectRoot]);
  return slug;
}

/**
 * Read-only variant of resolveProjectIdentifier: derives the current project
 * slug from cwd WITHOUT writing anything to the database.
 *
 * - Registry hit (remote matches a registered project) → returns that project's slug.
 * - Detected project with unmatched remote → returns slugified remote basename.
 * - Detected project with no remote → returns slugified directory basename.
 * - No project marker found → returns null.
 */
export function currentProjectSlug(db: Database.Database, cwd: string): string | null {
  const info = detectSlug(db, cwd);
  return info ? info.slug : null;
}

function upsertProvisional(db: Database.Database, slug: string, repos: string[], paths: string[]): void {
  const existing = getProjectBySlug(db, slug);
  if (existing) return; // don't clobber an existing (possibly human-confirmed) project
  upsertProject(db, { slug, displayName: slug, memberRepos: repos, memberPaths: paths, provisional: true });
}
