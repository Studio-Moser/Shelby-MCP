import type Database from "better-sqlite3";

export interface Project {
  slug: string;
  displayName: string;
  memberRepos: string[];
  memberPaths: string[];
  provisional: boolean;
  created_at?: string;
  updated_at?: string;
}

interface RawProjectRow {
  slug: string;
  display_name: string;
  member_repos: string | null;
  member_paths: string | null;
  provisional: number;
  created_at: string;
  updated_at: string;
}

function parseArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function rowToProject(row: RawProjectRow): Project {
  return {
    slug: row.slug,
    displayName: row.display_name,
    memberRepos: parseArray(row.member_repos),
    memberPaths: parseArray(row.member_paths),
    provisional: row.provisional === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
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

export function upsertProject(db: Database.Database, p: Project): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (slug, display_name, member_repos, member_paths, provisional, created_at, updated_at)
     VALUES (@slug, @display_name, @member_repos, @member_paths, @provisional, @created_at, @updated_at)
     ON CONFLICT(slug) DO UPDATE SET
       display_name = excluded.display_name,
       member_repos = excluded.member_repos,
       member_paths = excluded.member_paths,
       provisional  = excluded.provisional,
       updated_at   = excluded.updated_at`,
  ).run({
    slug: p.slug,
    display_name: p.displayName,
    member_repos: JSON.stringify(p.memberRepos ?? []),
    member_paths: JSON.stringify(p.memberPaths ?? []),
    provisional: p.provisional ? 1 : 0,
    created_at: now,
    updated_at: now,
  });
}

export function getProjectBySlug(db: Database.Database, slug: string): Project | null {
  const row = db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug) as RawProjectRow | undefined;
  return row ? rowToProject(row) : null;
}

export function listProjects(db: Database.Database): Project[] {
  const rows = db.prepare("SELECT * FROM projects ORDER BY slug").all() as RawProjectRow[];
  return rows.map(rowToProject);
}

/**
 * Find the project that owns a given git remote (normalized match against
 * member_repos). Returns null if no project claims it.
 */
export function findProjectByRepo(db: Database.Database, remote: string): Project | null {
  const target = normalizeGitRemote(remote);
  for (const p of listProjects(db)) {
    if (p.memberRepos.some((r) => normalizeGitRemote(r) === target)) return p;
  }
  return null;
}
