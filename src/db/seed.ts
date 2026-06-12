import type Database from "better-sqlite3";
import { getProjectBySlug, upsertProject, type Project } from "./projects.js";
import { DEFAULT_KNOWN_PROJECTS } from "../integrity/seed-data.js";

/** Idempotently seed known projects. Never clobbers a human-confirmed (non-provisional, populated) entry. */
export function ensureSeedProjects(db: Database.Database, projects: Project[] = DEFAULT_KNOWN_PROJECTS): void {
  for (const p of projects) {
    const existing = getProjectBySlug(db, p.slug);
    if (existing && existing.provisional === false && (existing.memberRepos.length > 0 || existing.memberPaths.length > 0)) continue;
    upsertProject(db, p);
  }
}
