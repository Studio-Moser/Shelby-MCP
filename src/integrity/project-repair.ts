import type Database from "better-sqlite3";
import { getThought, updateThought } from "../db/thoughts.js";
import { upsertProject, getProjectBySlug, listProjects, type Project } from "../db/projects.js";
import { DEFAULT_KNOWN_PROJECTS, DEFAULT_TOPIC_CLUSTERS } from "./seed-data.js";

const REPAIRED_BY = "integrity-project-v1";

export interface RepairItem {
  id: string;
  suggestedSlug: string | null;
  confidence: "high" | "low";
  reason: string;
}

export interface RepairReport {
  scanned: number;
  highConfidence: RepairItem[];
  flagged: RepairItem[];
  applied: number;
}

export function seedKnownProjects(db: Database.Database, projects: Project[] = DEFAULT_KNOWN_PROJECTS): void {
  for (const p of projects) {
    const existing = getProjectBySlug(db, p.slug);
    // Don't clobber a human-confirmed project that's been edited; only seed if
    // missing or still provisional.
    if (
      existing &&
      existing.provisional === false &&
      (existing.memberRepos.length > 0 || existing.memberPaths.length > 0)
    ) {
      continue;
    }
    upsertProject(db, p);
  }
}


function inferByPath(project: string | null, projects: Project[]): string | null {
  if (!project) return null;
  for (const p of projects) {
    for (const mp of p.memberPaths) {
      if (project === mp || project.startsWith(mp + "/")) return p.slug;
    }
  }
  return null;
}

function inferByTopics(topics: string[], topicClusters: Record<string, string>): { slug: string | null; ambiguous: boolean } {
  const hits = new Set<string>();
  for (const t of topics) {
    const slug = topicClusters[t.toLowerCase()];
    if (slug) hits.add(slug);
  }
  if (hits.size === 1) {
    const slug = [...hits][0];
    // hits.size === 1 guarantees exactly one element; non-null assertion is safe
    return { slug: slug ?? null, ambiguous: false };
  }
  if (hits.size > 1) return { slug: null, ambiguous: true };
  return { slug: null, ambiguous: false };
}

/**
 * Map a capture source string to a slug using the registry-derived source-alias
 * map (#309) instead of a hardcoded ladder of one developer's project names.
 * With no configured aliases this returns null — a fresh install makes no
 * source-based assignment. Match order is deterministic: longest alias first
 * (more specific wins), then lexicographic.
 */
function inferBySource(source: string | null, aliases: Record<string, string>): string | null {
  if (!source) return null;
  const keys = Object.keys(aliases);
  if (keys.length === 0) return null;
  const s = source.toLowerCase();
  keys.sort((a, b) => (a.length !== b.length ? b.length - a.length : a < b ? -1 : 1));
  for (const alias of keys) {
    if (s.includes(alias)) return aliases[alias] ?? null;
  }
  return null;
}

function classify(
  t: { id: string; project: string | null; topics: string[]; source: string | null },
  projects: Project[],
  topicClusters: Record<string, string>,
  sourceAliases: Record<string, string>,
): RepairItem {
  const byPath = inferByPath(t.project, projects);
  if (byPath) {
    return {
      id: t.id,
      suggestedSlug: byPath,
      confidence: "high",
      reason: `legacy project path matches ${byPath} member_path`,
    };
  }
  const byTopic = inferByTopics(t.topics, topicClusters);
  if (byTopic.slug) {
    return {
      id: t.id,
      suggestedSlug: byTopic.slug,
      confidence: "high",
      reason: `distinctive topic → ${byTopic.slug}`,
    };
  }
  const bySource = inferBySource(t.source, sourceAliases);
  if (bySource) {
    return {
      id: t.id,
      suggestedSlug: bySource,
      confidence: "high",
      reason: `distinctive source → ${bySource}`,
    };
  }
  return {
    id: t.id,
    suggestedSlug: null,
    confidence: "low",
    reason: byTopic.ambiguous ? "topics map to multiple projects" : "no distinctive signal",
  };
}

/** Minimal thought shape sufficient for classify() / inferByPath() / inferByTopics() / inferBySource(). */
interface RepairCandidate {
  id: string;
  project: string | null;
  topics: string[];
  project_identifier: string | null;
  source: string | null;
}

/**
 * Fetch only the rows that need repair in a single query, avoiding the N+1
 * SELECT id → getThought per row pattern of the old allThoughts() scan.
 */
function repairCandidates(db: Database.Database): RepairCandidate[] {
  const rows = db
    .prepare(
      "SELECT id, project, project_identifier, topics, source FROM thoughts WHERE project_identifier IS NULL OR project_identifier = ''",
    )
    .all() as Array<{ id: string; project: string | null; project_identifier: string | null; topics: string | null; source: string | null }>;
  return rows.map((r) => ({
    id: r.id,
    project: r.project,
    project_identifier: r.project_identifier,
    topics: parseJsonArrayRaw(r.topics),
    source: r.source,
  }));
}

function parseJsonArrayRaw(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function planProjectRepairs(
  db: Database.Database,
  topicClusters: Record<string, string> = DEFAULT_TOPIC_CLUSTERS,
  sourceAliases: Record<string, string> = {},
): RepairReport {
  const projects = listProjects(db);
  const highConfidence: RepairItem[] = [];
  const flagged: RepairItem[] = [];
  let scanned = 0;
  for (const t of repairCandidates(db)) {
    scanned++;
    const item = classify(t, projects, topicClusters, sourceAliases);
    if (item.confidence === "high") highConfidence.push(item);
    else flagged.push(item);
  }
  return { scanned, highConfidence, flagged, applied: 0 };
}

export function repairProjects(
  db: Database.Database,
  opts: {
    apply: boolean;
    projects?: Project[];
    topicClusters?: Record<string, string>;
    sourceAliases?: Record<string, string>;
  },
): RepairReport {
  // Defaults are EMPTY (#308/#309): no bundled projects/topics/aliases. The
  // production caller (cli/repair-projects) injects the per-user seed.
  const projects = opts.projects ?? DEFAULT_KNOWN_PROJECTS;
  const topicClusters = opts.topicClusters ?? DEFAULT_TOPIC_CLUSTERS;
  const sourceAliases = opts.sourceAliases ?? {};
  seedKnownProjects(db, projects);
  const report = planProjectRepairs(db, topicClusters, sourceAliases);
  if (!opts.apply) return report;

  let applied = 0;
  for (const item of report.highConfidence) {
    const t = getThought(db, item.id);
    if (!t) continue;
    // Spread existing metadata first so prior keys survive; updateThought replaces
    // the entire metadata column, so we must carry them forward manually.
    const meta: Record<string, unknown> = {
      ...(t.metadata ?? {}),
      repaired_by: REPAIRED_BY,
      repaired_reason: item.reason,
      repaired_from: t.project_identifier === null ? "null" : "empty",
    };
    updateThought(db, item.id, {
      project_identifier: item.suggestedSlug ?? undefined,
      metadata: meta,
    });
    applied++;
  }
  for (const item of report.flagged) {
    const t = getThought(db, item.id);
    if (!t) continue;
    // FLAG CONTRACT (parity with Shelby-MacOS, ADR 0001):
    // `needs_project_review` = "deterministic repair could not place this; it is QUEUED
    // for review." A future agentic classifier MUST treat these as candidates (INCLUDE
    // them) and, when it decides to leave a thought unclassified, write a SEPARATE
    // terminal flag `ai_reviewed: true` (NOT `needs_project_review`) to avoid re-review.
    // Do not exclude `needs_project_review` from a classifier's candidate query.
    const meta: Record<string, unknown> = {
      ...(t.metadata ?? {}),
      needs_project_review: true,
      suggested_project: item.suggestedSlug,
    };
    updateThought(db, item.id, { metadata: meta });
  }
  return { ...report, applied };
}
