import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import {
  upsertProject,
  getProjectBySlug,
  findProjectByRepo,
  listProjects,
  normalizeGitRemote,
} from "../../src/db/projects.js";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

describe("normalizeGitRemote", () => {
  it("normalizes https and ssh and strips .git", () => {
    expect(normalizeGitRemote("https://github.com/Studio-Moser/Shelby-MCP.git")).toBe("github.com/Studio-Moser/Shelby-MCP");
    expect(normalizeGitRemote("git@github.com:Studio-Moser/Shelby-MCP.git")).toBe("github.com/Studio-Moser/Shelby-MCP");
  });
});

describe("projects registry", () => {
  it("upserts and reads back by slug", () => {
    upsertProject(db, { slug: "shelby", displayName: "Shelby", memberRepos: ["github.com/Studio-Moser/Shelby-MCP"], memberPaths: [], provisional: false });
    const p = getProjectBySlug(db, "shelby");
    expect(p?.displayName).toBe("Shelby");
    expect(p?.memberRepos).toEqual(["github.com/Studio-Moser/Shelby-MCP"]);
    expect(p?.provisional).toBe(false);
  });

  it("finds a project by a member repo remote (normalized)", () => {
    upsertProject(db, { slug: "shelby", displayName: "Shelby", memberRepos: ["github.com/Studio-Moser/Shelby-MCP"], memberPaths: [], provisional: false });
    const p = findProjectByRepo(db, "git@github.com:Studio-Moser/Shelby-MCP.git");
    expect(p?.slug).toBe("shelby");
    expect(findProjectByRepo(db, "github.com/other/unknown")).toBeNull();
  });

  it("upsert is idempotent on slug and updates fields", () => {
    upsertProject(db, { slug: "x", displayName: "X", memberRepos: [], memberPaths: [], provisional: true });
    upsertProject(db, { slug: "x", displayName: "X2", memberRepos: ["github.com/a/b"], memberPaths: [], provisional: false });
    expect(listProjects(db)).toHaveLength(1);
    const p = getProjectBySlug(db, "x");
    expect(p?.displayName).toBe("X2");
    expect(p?.provisional).toBe(false);
  });
});
