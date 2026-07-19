import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrations.js";
import { getProjectByAlias, upsertProject } from "../../src/db/projects.js";
import { applyDefaultScope } from "../../src/mcp/scope-defaults.js";

let db: Database.Database;
beforeEach(() => { db = new Database(":memory:"); runMigrations(db); });

function repo(remote: string): string {
  const root = mkdtempSync(join(tmpdir(), "sd-"));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "config"), `[remote "origin"]\n\turl = ${remote}\n`);
  return root;
}

function argsOf(result: ReturnType<typeof applyDefaultScope>) {
  expect(result.kind).toBe("applied");
  if (result.kind !== "applied") throw new Error(result.message);
  return result.args;
}

function countingDatabase(database: Database.Database): {
  database: Database.Database;
  preparedSql: string[];
} {
  const preparedSql: string[] = [];
  const proxy = new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (sql: string) => {
          preparedSql.push(sql);
          return target.prepare(sql);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { database: proxy, preparedSql };
}

describe("applyDefaultScope", () => {
  it("injects resolved project and shared records", () => {
    upsertProject(db, { slug: "shelby", displayName: "Shelby", memberRepos: ["github.com/Studio-Moser/Shelby-MCP"], memberPaths: [], provisional: false });
    expect(argsOf(applyDefaultScope({}, db, [repo("git@github.com:Studio-Moser/Shelby-MCP.git")]))).toMatchObject({
      project_identifier: "shelby", include_shared: true,
    });
  });

  it("accepts UUID scope and emits UUID plus the current compatibility slug", () => {
    upsertProject(db, { slug: "shelby", displayName: "Shelby", memberRepos: [], memberPaths: [], provisional: false });
    const project = getProjectByAlias(db, "shelby")!;
    expect(argsOf(applyDefaultScope({ project_id: project.projectId }, db, []))).toMatchObject({
      project_id: project.projectId, project_identifier: "shelby", include_shared: true,
    });
  });

  it("rejects malformed, unknown, and conflicting UUID scope before all_projects", () => {
    upsertProject(db, { slug: "shelby", displayName: "Shelby", memberRepos: [], memberPaths: [], provisional: false });
    upsertProject(db, { slug: "other", displayName: "Other", memberRepos: [], memberPaths: [], provisional: false });
    const projectId = getProjectByAlias(db, "shelby")!.projectId;
    for (const input of [
      { project_id: "bad" },
      { project_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { project_id: projectId, project_identifier: "other" },
      { all_projects: true, project_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    ]) {
      expect(applyDefaultScope(input, db, [])).toMatchObject({ kind: "error", category: "project_scope_invalid" });
    }
  });

  it("returns explicit scope errors before downstream thought/search/list SQL", () => {
    upsertProject(db, { slug: "shelby", displayName: "Shelby", memberRepos: [], memberPaths: [], provisional: false });
    upsertProject(db, { slug: "other", displayName: "Other", memberRepos: [], memberPaths: [], provisional: false });
    const projectId = getProjectByAlias(db, "shelby")!.projectId;
    const { database, preparedSql } = countingDatabase(db);
    const downstreamSql = [
      "SELECT id FROM thoughts",
      "SELECT rowid FROM thoughts_fts",
      "SELECT id FROM thoughts ORDER BY created_at",
    ];

    for (const { input, registryLookup } of [
      { input: { project_id: "bad" }, registryLookup: false },
      { input: { project_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, registryLookup: true },
      { input: { project_id: projectId, project_identifier: "other" }, registryLookup: true },
    ]) {
      preparedSql.length = 0;
      const scoped = applyDefaultScope(input, database, []);
      if (scoped.kind === "applied") {
        for (const sql of downstreamSql) database.prepare(sql).all();
      }

      expect(scoped).toMatchObject({ kind: "error", category: "project_scope_invalid" });
      expect(preparedSql).not.toEqual(expect.arrayContaining(downstreamSql));
      expect(preparedSql.some((sql) => /projects|project_slug_aliases/.test(sql))).toBe(registryLookup);
    }
  });

  it("preserves all_projects and explicit include_shared", () => {
    const all = { all_projects: true };
    expect(argsOf(applyDefaultScope(all, db, []))).toBe(all);
    upsertProject(db, { slug: "shelby", displayName: "Shelby", memberRepos: [], memberPaths: [], provisional: false });
    expect(argsOf(applyDefaultScope({ project_identifier: "shelby", include_shared: false }, db, []))).toMatchObject({
      project_identifier: "shelby", include_shared: false,
    });
    const explicitAll = { all_projects: true, project_identifier: "shelby" };
    expect(argsOf(applyDefaultScope(explicitAll, db, []))).toBe(explicitAll);
  });

  it("rejects unknown and noncanonical explicit slugs, including all-project reads", () => {
    upsertProject(db, { slug: "shelby", displayName: "Shelby", memberRepos: [], memberPaths: [], provisional: false });
    expect(applyDefaultScope({ project_identifier: "missing" }, db, [])).toMatchObject({ kind: "error", category: "project_scope_invalid" });
    expect(applyDefaultScope({ project_identifier: "Shelby" }, db, [])).toMatchObject({ kind: "error", category: "project_scope_invalid" });
    expect(applyDefaultScope({ all_projects: true, project_identifier: "missing" }, db, [])).toMatchObject({
      kind: "error", category: "project_scope_invalid",
    });
  });

  it("fails unresolved, ambiguous, and colliding roots closed to shared-only", () => {
    expect(argsOf(applyDefaultScope({ query: "hello" }, db, []))).toMatchObject({ shared_only: true, query: "hello" });
    const one = repo("https://github.com/acme/one.git");
    const two = repo("https://github.com/acme/two.git");
    expect(argsOf(applyDefaultScope({}, db, [one, two]))).toMatchObject({ shared_only: true });

    upsertProject(db, {
      slug: "shared-name", displayName: "Original", memberRepos: ["github.com/owner/shared-name"], memberPaths: [], provisional: false,
    });
    const collision = repo("https://gitlab.com/other/shared-name.git");
    expect(argsOf(applyDefaultScope({}, db, [collision]))).toMatchObject({ shared_only: true });
  });
});
