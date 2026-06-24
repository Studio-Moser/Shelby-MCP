// Per-user project seed (#308). Mirrors the Shelby-MacOS `ProjectSeed` type
// (ADR-0001 parity). Replaces the formerly bundled, hardcoded seed (one
// developer's projects, `/Users/...` paths, ~26 personal topics) with config
// loaded from `~/.shelbymcp/projects.seed.json`.
//
// The compiled-in default is EMPTY: a published package with no config seeds
// zero projects, an empty topic-cluster map, and no source-routing aliases.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Project } from "../db/projects.js";

export interface SeedProject {
  slug: string;
  displayName: string;
  memberRepos?: string[];
  memberPaths?: string[];
  provisional?: boolean;
  /** Substrings that route a thought's `source` to this slug (#309). */
  sourceAliases?: string[];
}

export interface ProjectSeed {
  projects: SeedProject[];
  topicClusters: Record<string, string>;
}

/** The compiled-in default: no bundled projects, topics, or aliases. */
export const EMPTY_SEED: ProjectSeed = { projects: [], topicClusters: {} };

/** Default per-user config location: `~/.shelbymcp/projects.seed.json`. */
export function seedDefaultPath(): string {
  return join(homedir(), ".shelbymcp", "projects.seed.json");
}

/**
 * Load the seed from `path`. Returns `EMPTY_SEED` when the file is absent or
 * unparseable — never throws, so a missing/corrupt config can't break server
 * start.
 */
export function loadProjectSeed(path: string = seedDefaultPath()): ProjectSeed {
  try {
    if (!existsSync(path)) return EMPTY_SEED;
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return EMPTY_SEED;
    const obj = parsed as { projects?: unknown; topicClusters?: unknown };
    const projects = Array.isArray(obj.projects) ? (obj.projects as SeedProject[]) : [];
    const topicClusters =
      typeof obj.topicClusters === "object" && obj.topicClusters !== null
        ? (obj.topicClusters as Record<string, string>)
        : {};
    return { projects, topicClusters };
  } catch {
    return EMPTY_SEED;
  }
}

/** Registry `Project` records for seeding the `projects` table. */
export function toProjects(seed: ProjectSeed): Project[] {
  return seed.projects.map((p) => ({
    slug: p.slug,
    displayName: p.displayName,
    memberRepos: p.memberRepos ?? [],
    memberPaths: p.memberPaths ?? [],
    provisional: p.provisional ?? false,
  }));
}

/** Flattened `lowercased-alias → slug` map used by source inference (#309). */
export function sourceAliasMap(seed: ProjectSeed): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of seed.projects) {
    for (const alias of p.sourceAliases ?? []) map[alias.toLowerCase()] = p.slug;
  }
  return map;
}
