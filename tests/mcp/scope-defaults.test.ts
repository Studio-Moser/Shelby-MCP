import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrations.js";
import { upsertProject } from "../../src/db/projects.js";
import { applyDefaultScope } from "../../src/mcp/scope-defaults.js";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

/** Build a temp dir that looks like a git repo with the given remote. */
function repo(remote: string): string {
  const root = mkdtempSync(join(tmpdir(), "sd-"));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "config"), `[remote "origin"]\n\turl = ${remote}\n`);
  return root;
}

/** A non-project directory (no markers). */
function plainDir(): string {
  return mkdtempSync(join(tmpdir(), "sd-plain-"));
}

describe("applyDefaultScope", () => {
  it("injects project_identifier and include_shared when nothing is set and cwd resolves", () => {
    upsertProject(db, {
      slug: "shelby",
      displayName: "Shelby",
      memberRepos: ["github.com/Studio-Moser/Shelby-MCP"],
      memberPaths: [],
      provisional: false,
    });
    const cwd = repo("git@github.com:Studio-Moser/Shelby-MCP.git");

    const result = applyDefaultScope({}, db, cwd);

    expect(result.project_identifier).toBe("shelby");
    expect(result.include_shared).toBe(true);
  });

  it("leaves args unchanged when all_projects: true is set (opt-out)", () => {
    upsertProject(db, {
      slug: "shelby",
      displayName: "Shelby",
      memberRepos: ["github.com/Studio-Moser/Shelby-MCP"],
      memberPaths: [],
      provisional: false,
    });
    const cwd = repo("git@github.com:Studio-Moser/Shelby-MCP.git");

    const args = { all_projects: true };
    const result = applyDefaultScope(args, db, cwd);

    expect(result).toBe(args); // same reference — untouched
    expect(result.project_identifier).toBeUndefined();
  });

  it("leaves args unchanged when project_identifier is already explicitly set", () => {
    upsertProject(db, {
      slug: "shelby",
      displayName: "Shelby",
      memberRepos: ["github.com/Studio-Moser/Shelby-MCP"],
      memberPaths: [],
      provisional: false,
    });
    const cwd = repo("git@github.com:Studio-Moser/Shelby-MCP.git");

    const args = { project_identifier: "other-project" };
    const result = applyDefaultScope(args, db, cwd);

    expect(result).toBe(args); // same reference — untouched
    expect(result.project_identifier).toBe("other-project");
  });

  it("preserves existing include_shared value when injecting project_identifier", () => {
    upsertProject(db, {
      slug: "shelby",
      displayName: "Shelby",
      memberRepos: ["github.com/Studio-Moser/Shelby-MCP"],
      memberPaths: [],
      provisional: false,
    });
    const cwd = repo("git@github.com:Studio-Moser/Shelby-MCP.git");

    const result = applyDefaultScope({ include_shared: false }, db, cwd);

    expect(result.project_identifier).toBe("shelby");
    // Caller explicitly set include_shared=false — that should be respected.
    expect(result.include_shared).toBe(false);
  });

  it("falls back to shared-only (never global) when cwd does not resolve", () => {
    const result = applyDefaultScope({ query: "hello" }, db, plainDir());
    expect(result.project_identifier).toBeUndefined();
    expect(result.shared_only).toBe(true);   // new fail-safe
    expect(result.query).toBe("hello");
  });

  it("passes through other args fields unchanged when injecting scope", () => {
    upsertProject(db, {
      slug: "shelby",
      displayName: "Shelby",
      memberRepos: ["github.com/Studio-Moser/Shelby-MCP"],
      memberPaths: [],
      provisional: false,
    });
    const cwd = repo("git@github.com:Studio-Moser/Shelby-MCP.git");

    const result = applyDefaultScope({ query: "auth", limit: 5, offset: 10 }, db, cwd);

    expect(result.project_identifier).toBe("shelby");
    expect(result.query).toBe("auth");
    expect(result.limit).toBe(5);
    expect(result.offset).toBe(10);
  });
});
