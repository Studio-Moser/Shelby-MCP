import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { insertThought, getThought } from "../../src/db/thoughts.js";
import { seedKnownProjects, planProjectRepairs, repairProjects } from "../../src/integrity/project-repair.js";

let db: Database.Database;
beforeEach(() => { db = new Database(":memory:"); runMigrations(db); seedKnownProjects(db); });

describe("seedKnownProjects", () => {
  it("registers the known projects idempotently", () => {
    seedKnownProjects(db); // second call
    const slugs = ["shelby", "kuow-games", "the-crooked-line", "ausra-photos"];
    for (const s of slugs) expect(getProjectBySlugSafe(db, s)).toBe(true);
  });
});

describe("repair classification", () => {
  it("high-confidence by distinctive topic", () => {
    const id = insertThought(db, { content: "x", topics: ["kuow-games", "foggy-find"] });
    const report = planProjectRepairs(db);
    const item = report.highConfidence.find((i) => i.id === id);
    expect(item?.suggestedSlug).toBe("kuow-games");
  });
  it("high-confidence by legacy project path matching a member_path", () => {
    const id = insertThought(db, { content: "y", project: "/Users/timmoser/Projects/The Crooked Line", topics: ["research-source"] });
    const item = planProjectRepairs(db).highConfidence.find((i) => i.id === id);
    expect(item?.suggestedSlug).toBe("the-crooked-line");
  });
  it("flags ambiguous (generic topics only) for review", () => {
    const id = insertThought(db, { content: "z", topics: ["research-source", "competitive"] });
    const report = planProjectRepairs(db);
    expect(report.flagged.some((i) => i.id === id)).toBe(true);
    expect(report.highConfidence.some((i) => i.id === id)).toBe(false);
  });
  it("high-confidence by distinctive source string", () => {
    const id = insertThought(db, { content: "x", source: "deep-dive-graphify-techniques-for-shelby" });
    const report = planProjectRepairs(db);
    const item = report.highConfidence.find((i) => i.id === id);
    expect(item?.suggestedSlug).toBe("shelby");
  });
  it("ignores already-resolved thoughts", () => {
    const id = insertThought(db, { content: "ok", project_identifier: "shelby" });
    const report = planProjectRepairs(db);
    expect([...report.highConfidence, ...report.flagged].some((i) => i.id === id)).toBe(false);
  });
});

describe("apply", () => {
  it("dry-run writes nothing", () => {
    const id = insertThought(db, { content: "x", topics: ["kuow-games"] });
    repairProjects(db, { apply: false });
    expect(getThought(db, id)?.project_identifier).toBeNull();
  });
  it("apply sets project_identifier + repaired_by for high-confidence, flags ambiguous", () => {
    const hi = insertThought(db, { content: "x", topics: ["polymarket"] });
    const amb = insertThought(db, { content: "z", topics: ["research-source"] });
    const report = repairProjects(db, { apply: true });
    expect(getThought(db, hi)?.project_identifier).toBe("the-crooked-line");
    expect(getThought(db, hi)?.metadata?.repaired_by).toBe("integrity-project-v1");
    expect(getThought(db, amb)?.project_identifier).toBeNull();
    expect(getThought(db, amb)?.metadata?.needs_project_review).toBe(true);
    expect(report.applied).toBeGreaterThanOrEqual(1);
  });
  it("prior metadata keys survive repair (metadata merge check)", () => {
    const id = insertThought(db, { content: "x", topics: ["polymarket"], metadata: { prior_key: "prior_value" } });
    repairProjects(db, { apply: true });
    const t = getThought(db, id);
    expect(t?.metadata?.repaired_by).toBe("integrity-project-v1");
    expect(t?.metadata?.prior_key).toBe("prior_value");
  });

  it("empty-string project_identifier gets repaired_from === 'empty'", () => {
    // Insert a thought then manually set project_identifier to empty string
    // (simulates a thought that was captured with project_identifier = "").
    const id = insertThought(db, { content: "x", topics: ["polymarket"] });
    // Force empty string via raw SQL (insertThought defaults to null, not "")
    db.prepare("UPDATE thoughts SET project_identifier = '' WHERE id = ?").run(id);

    repairProjects(db, { apply: true });
    const t = getThought(db, id);
    expect(t?.metadata?.repaired_from).toBe("empty");
  });

  it("null project_identifier gets repaired_from === 'null'", () => {
    const id = insertThought(db, { content: "x", topics: ["polymarket"] });
    // insertThought defaults project_identifier to null
    repairProjects(db, { apply: true });
    const t = getThought(db, id);
    expect(t?.metadata?.repaired_from).toBe("null");
  });
});

describe("data injection", () => {
  it("honors injected projects and topicClusters (not the hardcoded defaults)", () => {
    const customDb = new Database(":memory:");
    runMigrations(customDb);

    const customProject = {
      slug: "custom",
      displayName: "Custom",
      memberRepos: [] as string[],
      memberPaths: ["/tmp/x"],
      provisional: false,
    };
    const customTopicClusters = { "widgets": "custom" };

    repairProjects(customDb, {
      apply: true,
      projects: [customProject],
      topicClusters: customTopicClusters,
    });

    const id = insertThought(customDb, { content: "injection test", topics: ["widgets"] });
    // The thought was inserted AFTER the initial repair pass, so run repair again
    repairProjects(customDb, {
      apply: true,
      projects: [customProject],
      topicClusters: customTopicClusters,
    });

    expect(getThought(customDb, id)?.project_identifier).toBe("custom");
  });
});

// helper
import { getProjectBySlug } from "../../src/db/projects.js";
function getProjectBySlugSafe(db: Database.Database, slug: string): boolean {
  return getProjectBySlug(db, slug) !== null;
}
