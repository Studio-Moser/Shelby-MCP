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
});

// helper
import { getProjectBySlug } from "../../src/db/projects.js";
function getProjectBySlugSafe(db: Database.Database, slug: string): boolean {
  return getProjectBySlug(db, slug) !== null;
}
