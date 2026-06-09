import type Database from "better-sqlite3";
import path from "node:path";
import { detectProject } from "./project-detector.js";
import { findProjectByRepo, getProjectBySlug, upsertProject, normalizeGitRemote } from "./projects.js";

/** lowercase, spaces/underscores → hyphens, strip other unsafe chars. */
export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "") || "project";
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
  const detected = detectProject(cwd);
  if (!detected) {
    // No project marker found — don't auto-provision anything.
    return null;
  }
  if (detected.remote) {
    const existing = findProjectByRepo(db, detected.remote);
    if (existing) return existing.slug;
    const normalized = normalizeGitRemote(detected.remote);
    const slug = slugify(path.basename(normalized));
    upsertProvisional(db, slug, [normalized], [detected.projectRoot]);
    return slug;
  }
  // Real project root with no remote — provision from dir basename.
  const base = path.basename(detected.projectRoot);
  const slug = slugify(base);
  upsertProvisional(db, slug, [], [detected.projectRoot]);
  return slug;
}

function upsertProvisional(db: Database.Database, slug: string, repos: string[], paths: string[]): void {
  const existing = getProjectBySlug(db, slug);
  if (existing) return; // don't clobber an existing (possibly human-confirmed) project
  upsertProject(db, { slug, displayName: slug, memberRepos: repos, memberPaths: paths, provisional: true });
}
