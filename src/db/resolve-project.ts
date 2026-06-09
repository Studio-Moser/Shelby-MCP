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
 * remote; if unmatched, auto-provisions a provisional Project (slug from the
 * repo/dir basename) so a capture is never left unresolved. Never returns null.
 */
export function resolveProjectIdentifier(db: Database.Database, cwd: string): string {
  const detected = detectProject(cwd);
  if (detected?.remote) {
    const existing = findProjectByRepo(db, detected.remote);
    if (existing) return existing.slug;
    const normalized = normalizeGitRemote(detected.remote);
    const slug = slugify(path.basename(normalized));
    upsertProvisional(db, slug, [normalized], [detected.projectRoot]);
    return slug;
  }
  const base = path.basename(detected?.projectRoot ?? cwd);
  const slug = slugify(base);
  upsertProvisional(db, slug, [], [detected?.projectRoot ?? cwd]);
  return slug;
}

function upsertProvisional(db: Database.Database, slug: string, repos: string[], paths: string[]): void {
  const existing = getProjectBySlug(db, slug);
  if (existing) return; // don't clobber an existing (possibly human-confirmed) project
  upsertProject(db, { slug, displayName: slug, memberRepos: repos, memberPaths: paths, provisional: true });
}
