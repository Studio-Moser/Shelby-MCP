import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { listProjects, getProjectBySlug, upsertProject } from "../../src/db/projects.js";
import { ensureSeedProjects } from "../../src/db/seed.js";

let db: Database.Database;
beforeEach(() => { db = new Database(":memory:"); runMigrations(db); });

describe("ensureSeedProjects", () => {
  it("seeds known projects into an empty registry", () => {
    ensureSeedProjects(db);
    expect(getProjectBySlug(db, "shelby")?.memberPaths.length).toBeGreaterThan(0);
    expect(listProjects(db).length).toBeGreaterThanOrEqual(4);
  });

  it("does not clobber a human-confirmed (non-provisional, edited) project", () => {
    upsertProject(db, { slug: "shelby", displayName: "My Shelby", memberRepos: ["x"], memberPaths: ["/custom"], provisional: false });
    ensureSeedProjects(db);
    expect(getProjectBySlug(db, "shelby")?.displayName).toBe("My Shelby");
  });
});
