import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { insertThought, getThought } from "../../src/db/thoughts.js";
import { seedKnownProjects, planProjectRepairs, repairProjects } from "../../src/integrity/project-repair.js";
import { getProjectBySlug, type Project } from "../../src/db/projects.js";

// After #308/#309 the seed (projects, topic clusters, source aliases) is
// injected, not bundled. Tests supply neutral, depersonalized fixture data.
const TEST_PROJECTS: Project[] = [
  { slug: "shelby", displayName: "Shelby", memberRepos: [], memberPaths: ["/p/shelby"], provisional: false },
  { slug: "kuow-games", displayName: "KUOW Games", memberRepos: [], memberPaths: ["/p/kuow"], provisional: false },
  { slug: "the-crooked-line", displayName: "The Crooked Line", memberRepos: [], memberPaths: ["/p/tcl"], provisional: false },
  { slug: "ausra-photos", displayName: "Ausra Photos", memberRepos: [], memberPaths: ["/p/ausra"], provisional: false },
];
const TEST_TOPICS: Record<string, string> = {
  "kuow-games": "kuow-games",
  "foggy-find": "kuow-games",
  "polymarket": "the-crooked-line",
};
const TEST_ALIASES: Record<string, string> = {
  graphify: "shelby",
  shelby: "shelby",
  gdelt: "the-crooked-line",
  ausra: "ausra-photos",
};

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
  seedKnownProjects(db, TEST_PROJECTS);
});

describe("seedKnownProjects", () => {
  it("registers the injected projects idempotently", () => {
    seedKnownProjects(db, TEST_PROJECTS); // second call
    for (const s of ["shelby", "kuow-games", "the-crooked-line", "ausra-photos"]) {
      expect(getProjectBySlug(db, s) !== null).toBe(true);
    }
  });

  it("seeds nothing with no injected projects (fresh install, #308)", () => {
    const fresh = new Database(":memory:");
    runMigrations(fresh);
    seedKnownProjects(fresh);
    expect(getProjectBySlug(fresh, "shelby")).toBeNull();
  });
});

describe("repair classification", () => {
  it("high-confidence by distinctive topic", () => {
    const id = insertThought(db, { content: "x", topics: ["kuow-games", "foggy-find"] });
    const report = planProjectRepairs(db, TEST_TOPICS, TEST_ALIASES);
    const item = report.highConfidence.find((i) => i.id === id);
    expect(item?.suggestedSlug).toBe("kuow-games");
  });
  it("high-confidence by legacy project path matching a member_path", () => {
    const id = insertThought(db, { content: "y", project: "/p/tcl", topics: ["research-source"] });
    const item = planProjectRepairs(db, TEST_TOPICS, TEST_ALIASES).highConfidence.find((i) => i.id === id);
    expect(item?.suggestedSlug).toBe("the-crooked-line");
  });
  it("flags ambiguous (generic topics only) for review", () => {
    const id = insertThought(db, { content: "z", topics: ["research-source", "competitive"] });
    const report = planProjectRepairs(db, TEST_TOPICS, TEST_ALIASES);
    expect(report.flagged.some((i) => i.id === id)).toBe(true);
    expect(report.highConfidence.some((i) => i.id === id)).toBe(false);
  });
  it("high-confidence by distinctive source string (configured alias)", () => {
    const id = insertThought(db, { content: "x", source: "deep-dive-graphify-techniques-for-shelby" });
    const report = planProjectRepairs(db, TEST_TOPICS, TEST_ALIASES);
    const item = report.highConfidence.find((i) => i.id === id);
    expect(item?.suggestedSlug).toBe("shelby");
  });
  it("ignores already-resolved thoughts", () => {
    const id = insertThought(db, { content: "ok", project_identifier: "shelby" });
    const report = planProjectRepairs(db, TEST_TOPICS, TEST_ALIASES);
    expect([...report.highConfidence, ...report.flagged].some((i) => i.id === id)).toBe(false);
  });
});

describe("#309: source inference is registry-derived", () => {
  it("makes no source-based assignment with no configured aliases", () => {
    // A source the old hardcoded ladder routed to "shelby" must now fall through.
    const id = insertThought(db, { content: "x", source: "deep-dive-graphify-techniques-for-shelby" });
    const report = planProjectRepairs(db, TEST_TOPICS, {});
    expect(report.highConfidence.some((i) => i.id === id)).toBe(false);
    expect(report.flagged.some((i) => i.id === id)).toBe(true);
  });
});

describe("apply", () => {
  const opts = (apply: boolean) => ({
    apply,
    projects: TEST_PROJECTS,
    topicClusters: TEST_TOPICS,
    sourceAliases: TEST_ALIASES,
  });

  it("dry-run writes nothing", () => {
    const id = insertThought(db, { content: "x", topics: ["kuow-games"] });
    repairProjects(db, opts(false));
    expect(getThought(db, id)?.project_identifier).toBeNull();
  });
  it("apply sets project_identifier + repaired_by for high-confidence, flags ambiguous", () => {
    const hi = insertThought(db, { content: "x", topics: ["polymarket"] });
    const amb = insertThought(db, { content: "z", topics: ["research-source"] });
    const report = repairProjects(db, opts(true));
    expect(getThought(db, hi)?.project_identifier).toBe("the-crooked-line");
    expect(getThought(db, hi)?.metadata?.repaired_by).toBe("integrity-project-v1");
    expect(getThought(db, amb)?.project_identifier).toBeNull();
    expect(getThought(db, amb)?.metadata?.needs_project_review).toBe(true);
    expect(report.applied).toBeGreaterThanOrEqual(1);
  });
  it("prior metadata keys survive repair (metadata merge check)", () => {
    const id = insertThought(db, { content: "x", topics: ["polymarket"], metadata: { prior_key: "prior_value" } });
    repairProjects(db, opts(true));
    const t = getThought(db, id);
    expect(t?.metadata?.repaired_by).toBe("integrity-project-v1");
    expect(t?.metadata?.prior_key).toBe("prior_value");
  });
  it("empty-string project_identifier gets repaired_from === 'empty'", () => {
    const id = insertThought(db, { content: "x", topics: ["polymarket"] });
    db.prepare("UPDATE thoughts SET project_identifier = '' WHERE id = ?").run(id);
    repairProjects(db, opts(true));
    expect(getThought(db, id)?.metadata?.repaired_from).toBe("empty");
  });
  it("null project_identifier gets repaired_from === 'null'", () => {
    const id = insertThought(db, { content: "x", topics: ["polymarket"] });
    repairProjects(db, opts(true));
    expect(getThought(db, id)?.metadata?.repaired_from).toBe("null");
  });
  it("ambiguous repair writes needs_project_review and never ai_reviewed", () => {
    const id = insertThought(db, { content: "z", topics: ["research-source", "competitive"] });
    repairProjects(db, opts(true));
    const meta = getThought(db, id)?.metadata as Record<string, unknown>;
    expect(meta.needs_project_review).toBe(true);
    expect(meta.ai_reviewed).toBeUndefined();
  });
});

describe("data injection", () => {
  it("honors injected projects and topicClusters (not the hardcoded defaults)", () => {
    const customDb = new Database(":memory:");
    runMigrations(customDb);

    const customProject: Project = {
      slug: "custom",
      displayName: "Custom",
      memberRepos: [],
      memberPaths: ["/tmp/x"],
      provisional: false,
    };
    const customTopicClusters = { widgets: "custom" };

    const id = insertThought(customDb, { content: "injection test", topics: ["widgets"] });
    repairProjects(customDb, {
      apply: true,
      projects: [customProject],
      topicClusters: customTopicClusters,
    });

    expect(getThought(customDb, id)?.project_identifier).toBe("custom");
  });
});
