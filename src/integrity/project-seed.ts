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

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Validate one raw project entry. Returns null if it is malformed. */
function parseSeedProject(raw: unknown): SeedProject | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.slug !== "string" || typeof o.displayName !== "string") return null;
  if (o.memberRepos !== undefined && !isStringArray(o.memberRepos)) return null;
  if (o.memberPaths !== undefined && !isStringArray(o.memberPaths)) return null;
  if (o.sourceAliases !== undefined && !isStringArray(o.sourceAliases)) return null;
  if (o.provisional !== undefined && typeof o.provisional !== "boolean") return null;
  return {
    slug: o.slug,
    displayName: o.displayName,
    memberRepos: o.memberRepos as string[] | undefined,
    memberPaths: o.memberPaths as string[] | undefined,
    provisional: o.provisional as boolean | undefined,
    sourceAliases: o.sourceAliases as string[] | undefined,
  };
}

/** Validate the topic-cluster map. Returns null if any value is not a string. */
function parseTopicClusters(raw: unknown): Record<string, string> | null {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string") return null;
    out[k] = v;
  }
  return out;
}

/**
 * Load the seed from `path`. Returns `EMPTY_SEED` when the file is absent,
 * unparseable, or **malformed** — never throws, so a missing/corrupt config
 * can't break server start. Validation is strict and whole-file (mirrors the
 * Swift `ProjectSeed` Codable): any project entry missing a string
 * `slug`/`displayName`, any mistyped member field, or any non-string topic
 * value rejects the entire config to `EMPTY_SEED` — so no phantom rows reach
 * the registry.
 */
export function loadProjectSeed(path: string = seedDefaultPath()): ProjectSeed {
  try {
    if (!existsSync(path)) return EMPTY_SEED;
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return EMPTY_SEED;
    const obj = parsed as { projects?: unknown; topicClusters?: unknown };

    const rawProjects = obj.projects === undefined ? [] : obj.projects;
    if (!Array.isArray(rawProjects)) return EMPTY_SEED;
    const projects: SeedProject[] = [];
    for (const raw of rawProjects) {
      const project = parseSeedProject(raw);
      if (project === null) return EMPTY_SEED; // strict: reject the whole file
      projects.push(project);
    }

    const topicClusters = parseTopicClusters(obj.topicClusters);
    if (topicClusters === null) return EMPTY_SEED;

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
