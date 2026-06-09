import type Database from "better-sqlite3";
import { getThought, updateThought, type ThoughtRecord } from "../db/thoughts.js";
import { upsertProject, getProjectBySlug, listProjects, type Project } from "../db/projects.js";

const REPAIRED_BY = "integrity-project-v1";

// Known projects seed. member_repos are normalized git remotes; member_paths are
// machine-local hints (used to map legacy absolute-path `project` values to slugs).
const KNOWN_PROJECTS: Project[] = [
  {
    slug: "shelby",
    displayName: "Shelby",
    provisional: false,
    memberRepos: [
      "github.com/Studio-Moser/Shelby-MCP",
      "github.com/Studio-Moser/Shelby-MacOS",
      "github.com/Studio-Moser/Shelby-Strategy",
      "github.com/Studio-Moser/Shelby-Website",
    ],
    memberPaths: ["/Users/timmoser/Projects/Shelby"],
  },
  {
    slug: "kuow-games",
    displayName: "KUOW Games",
    provisional: false,
    memberRepos: [],
    memberPaths: [
      "/Users/timmoser/Projects/KUOW-Games",
      "/Users/timmoser/Projects/KUOW-Core",
      "/Users/timmoser/Projects/KUOW-Connect",
      "/Users/timmoser/Projects/KUOW-Website",
    ],
  },
  {
    slug: "the-crooked-line",
    displayName: "The Crooked Line",
    provisional: false,
    memberRepos: ["github.com/The-Crooked-Line/website"],
    memberPaths: ["/Users/timmoser/Projects/The Crooked Line"],
  },
  {
    slug: "ausra-photos",
    displayName: "Ausra Photos",
    provisional: false,
    memberRepos: [],
    memberPaths: ["/Users/timmoser/Projects/Ausra Photos"],
  },
];

// Distinctive topic → slug. Only topics that unambiguously identify a project.
const TOPIC_CLUSTERS: Record<string, string> = {
  "kuow-games": "kuow-games",
  "foggy-find": "kuow-games",
  "game-shell": "kuow-games",
  "game-takeover": "kuow-games",
  "player-progress": "kuow-games",
  "daily-puzzle-pipeline": "kuow-games",
  "overnight-worker": "the-crooked-line",
  "polymarket": "the-crooked-line",
  "prediction-market": "the-crooked-line",
  "prediction-markets": "the-crooked-line",
  "cftc": "the-crooked-line",
  "sec-edgar": "the-crooked-line",
  "market-manipulation": "the-crooked-line",
  "government-contracts": "the-crooked-line",
  "congressional-trading": "the-crooked-line",
  "unusual-whales": "the-crooked-line",
  "the-crooked-line": "the-crooked-line",
  "ausra-photos": "ausra-photos",
  "ausra-research": "ausra-photos",
  "shelby-daily-research": "shelby",
  "shelby-macos": "shelby",
  "shelby-mcp": "shelby",
  "shelby-strategy": "shelby",
  "shelby-research": "shelby",
  "shelby-mac-ui": "shelby",
};

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

export function seedKnownProjects(db: Database.Database): void {
  for (const p of KNOWN_PROJECTS) {
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

function needsRepair(t: ThoughtRecord): boolean {
  return t.project_identifier === null || t.project_identifier === "";
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

function inferByTopics(topics: string[]): { slug: string | null; ambiguous: boolean } {
  const hits = new Set<string>();
  for (const t of topics) {
    const slug = TOPIC_CLUSTERS[t.toLowerCase()];
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

function classify(t: ThoughtRecord, projects: Project[]): RepairItem {
  const byPath = inferByPath(t.project, projects);
  if (byPath) {
    return {
      id: t.id,
      suggestedSlug: byPath,
      confidence: "high",
      reason: `legacy project path matches ${byPath} member_path`,
    };
  }
  const byTopic = inferByTopics(t.topics);
  if (byTopic.slug) {
    return {
      id: t.id,
      suggestedSlug: byTopic.slug,
      confidence: "high",
      reason: `distinctive topic → ${byTopic.slug}`,
    };
  }
  return {
    id: t.id,
    suggestedSlug: null,
    confidence: "low",
    reason: byTopic.ambiguous ? "topics map to multiple projects" : "no distinctive signal",
  };
}

function allThoughts(db: Database.Database): ThoughtRecord[] {
  const ids = db.prepare("SELECT id FROM thoughts").all() as Array<{ id: string }>;
  return ids.map((r) => getThought(db, r.id)).filter((t): t is ThoughtRecord => t !== null);
}

export function planProjectRepairs(db: Database.Database): RepairReport {
  const projects = listProjects(db);
  const highConfidence: RepairItem[] = [];
  const flagged: RepairItem[] = [];
  let scanned = 0;
  for (const t of allThoughts(db)) {
    if (!needsRepair(t)) continue;
    scanned++;
    const item = classify(t, projects);
    if (item.confidence === "high") highConfidence.push(item);
    else flagged.push(item);
  }
  return { scanned, highConfidence, flagged, applied: 0 };
}

export function repairProjects(db: Database.Database, opts: { apply: boolean }): RepairReport {
  seedKnownProjects(db);
  const report = planProjectRepairs(db);
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
      repaired_from: t.project_identifier === null ? "null" : "",
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
    const meta: Record<string, unknown> = {
      ...(t.metadata ?? {}),
      needs_project_review: true,
      suggested_project: item.suggestedSlug,
    };
    updateThought(db, item.id, { metadata: meta });
  }
  return { ...report, applied };
}
