import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrations.js";
import { upsertProject, getProjectBySlug } from "../../src/db/projects.js";
import { resolveProjectIdentifier } from "../../src/db/resolve-project.js";

let db: Database.Database;
beforeEach(() => { db = new Database(":memory:"); runMigrations(db); });

function repo(remote: string): string {
  const root = mkdtempSync(join(tmpdir(), "rp-"));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "config"), `[remote "origin"]\n\turl = ${remote}\n`);
  return root;
}

describe("resolveProjectIdentifier", () => {
  it("returns the slug of a registered project matching the repo remote", () => {
    upsertProject(db, { slug: "shelby", displayName: "Shelby", memberRepos: ["github.com/Studio-Moser/Shelby-MCP"], memberPaths: [], provisional: false });
    const root = repo("git@github.com:Studio-Moser/Shelby-MCP.git");
    expect(resolveProjectIdentifier(db, root)).toBe("shelby");
    expect(getProjectBySlug(db, "shelby")?.provisional).toBe(false);
  });

  it("auto-provisions a provisional project from the repo basename when unmatched", () => {
    const root = repo("https://github.com/acme/Cool-Repo.git");
    const slug = resolveProjectIdentifier(db, root);
    expect(slug).toBe("cool-repo");
    const p = getProjectBySlug(db, "cool-repo");
    expect(p?.provisional).toBe(true);
    expect(p?.memberRepos).toEqual(["github.com/acme/Cool-Repo"]);
  });

  it("falls back to the directory basename (provisional) for a non-git dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "Plain Dir-"));
    const slug = resolveProjectIdentifier(db, dir);
    expect(typeof slug).toBe("string");
    expect(slug.length).toBeGreaterThan(0);
    expect(getProjectBySlug(db, slug)?.provisional).toBe(true);
  });
});
