import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { listProjects, getProjectBySlug, upsertProject, type Project } from "../../src/db/projects.js";
import { ensureSeedProjects } from "../../src/db/seed.js";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

// Neutral, depersonalized fixture seed (stands in for a user-authored
// `~/.shelbymcp/projects.seed.json`). After #308 the seed is injected, not
// bundled.
const TEST_PROJECTS: Project[] = [
  { slug: "shelby", displayName: "Shelby", memberRepos: ["github.com/example/shelby"], memberPaths: ["/p/shelby"], provisional: false },
  { slug: "kuow-games", displayName: "KUOW Games", memberRepos: [], memberPaths: ["/p/kuow"], provisional: false },
  { slug: "the-crooked-line", displayName: "The Crooked Line", memberRepos: [], memberPaths: ["/p/tcl"], provisional: false },
  { slug: "ausra-photos", displayName: "Ausra Photos", memberRepos: [], memberPaths: ["/p/ausra"], provisional: false },
];

describe("ensureSeedProjects", () => {
  it("seeds nothing when no projects are injected (fresh install, #308)", () => {
    ensureSeedProjects(db);
    expect(listProjects(db).length).toBe(0);
  });

  it("seeds injected projects into an empty registry", () => {
    ensureSeedProjects(db, TEST_PROJECTS);
    expect(getProjectBySlug(db, "shelby")?.memberPaths.length).toBeGreaterThan(0);
    expect(listProjects(db).length).toBe(4);
  });

  it("does not clobber a human-confirmed (non-provisional, edited) project", () => {
    upsertProject(db, { slug: "shelby", displayName: "My Shelby", memberRepos: ["x"], memberPaths: ["/custom"], provisional: false });
    ensureSeedProjects(db, TEST_PROJECTS);
    expect(getProjectBySlug(db, "shelby")?.displayName).toBe("My Shelby");
  });
});
