import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThoughtDatabase } from "../../src/db/database.js";
import { getProjectByAlias, getProjectBySlug, upsertProject } from "../../src/db/projects.js";
import { resolveProjectScope } from "../../src/db/resolve-project.js";
import { handleCaptureThought as handleCaptureThoughtImpl } from "../../src/tools/capture.js";

let db: ThoughtDatabase;
beforeEach(() => { db = new ThoughtDatabase(":memory:"); });

function handleCaptureThought(
  database: ThoughtDatabase,
  args: Record<string, unknown>,
  scope?: Parameters<typeof handleCaptureThoughtImpl>[2],
) {
  return scope === undefined
    ? handleCaptureThoughtImpl(database, { summary: "Test summary", ...args })
    : handleCaptureThoughtImpl(database, { summary: "Test summary", ...args }, scope);
}

function repo(remote: string): string {
  const root = mkdtempSync(join(tmpdir(), "capture-scope-"));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "config"), `[remote "origin"]\n\turl = ${remote}\n`);
  return root;
}
function count(): number { return (db.db.prepare("SELECT COUNT(*) AS n FROM thoughts").get() as { n: number }).n; }
function error(result: ReturnType<typeof handleCaptureThought>): string {
  const text = result.content[0]?.text;
  if (!text) throw new Error("Expected an error result");
  try {
    return (JSON.parse(text) as { error: string }).error;
  } catch {
    throw new Error(`Expected JSON error result, received: ${text}`);
  }
}

describe("capture project scope", () => {
  it("accepts a registered explicit canonical slug", () => {
    upsertProject(db.db, { slug: "shelby", displayName: "Shelby", memberRepos: [], memberPaths: [], provisional: false });
    const result = handleCaptureThought(db, { content: "Scoped", project_identifier: "shelby" }, { kind: "unresolved" });
    expect(result.isError).toBeUndefined();
    expect(db.db.prepare("SELECT project_identifier FROM thoughts").get()).toEqual({ project_identifier: "shelby" });
  });

  it("accepts project_id and dual-writes UUID plus current compatibility slug", () => {
    upsertProject(db.db, { slug: "shelby", displayName: "Shelby", memberRepos: [], memberPaths: [], provisional: false });
    const project = getProjectByAlias(db.db, "shelby")!;
    const result = handleCaptureThought(db, { content: "Scoped", project_id: project.projectId }, { kind: "unresolved" });
    expect(result.isError).toBeUndefined();
    expect(db.db.prepare("SELECT project_id, project_identifier FROM thoughts").get()).toEqual({
      project_id: project.projectId,
      project_identifier: "shelby",
    });
  });

  it("rejects unknown, malformed, and conflicting project IDs without insertion", () => {
    upsertProject(db.db, { slug: "shelby", displayName: "Shelby", memberRepos: [], memberPaths: [], provisional: false });
    upsertProject(db.db, { slug: "other", displayName: "Other", memberRepos: [], memberPaths: [], provisional: false });
    const projectId = getProjectByAlias(db.db, "shelby")!.projectId;
    for (const input of [
      { content: "No", project_id: "bad" },
      { content: "No", project_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { content: "No", project_id: projectId, project_identifier: "other" },
    ]) {
      expect(error(handleCaptureThought(db, input, { kind: "unresolved" }))).toBe("project_scope_invalid");
    }
    expect(count()).toBe(0);
  });

  it("rejects unknown and noncanonical explicit slugs without insertion", () => {
    expect(error(handleCaptureThought(db, { content: "No", project_identifier: "missing" }, { kind: "unresolved" }))).toBe("project_scope_invalid");
    expect(error(handleCaptureThought(db, { content: "No", project_identifier: "Bad Slug" }, { kind: "unresolved" }))).toBe("project_scope_invalid");
    expect(count()).toBe(0);
  });

  it("rejects unresolved and ambiguous personal captures without insertion", () => {
    expect(error(handleCaptureThought(db, { content: "No" }, { kind: "unresolved" }))).toBe("project_scope_unresolved");
    expect(error(handleCaptureThought(db, { content: "No" }, { kind: "ambiguous", slugs: ["one", "two"] }))).toBe("project_scope_ambiguous");
    expect(count()).toBe(0);
  });

  it("allows an explicitly shared capture without project roots", () => {
    const result = handleCaptureThought(db, { content: "Shared", visibility: "shared" }, { kind: "unresolved" });
    expect(result.isError).toBeUndefined();
    expect(count()).toBe(1);
  });

  it("creates one UUIDv4 local-only project for a derived personal capture", () => {
    const root = repo("https://github.com/acme/new-project.git");
    const scope = resolveProjectScope(db.db, [root]);
    const result = handleCaptureThought(db, { content: "Personal" }, scope);
    expect(result.isError).toBeUndefined();
    const project = getProjectByAlias(db.db, "new-project")!;
    expect(project.projectId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(project).toMatchObject({
      slug: project.projectId,
      currentSlug: "new-project",
      identityState: "local_only",
      provisional: true,
      memberRepos: ["github.com/acme/new-project"],
    });
    expect(db.db.prepare("SELECT slug, project_id, status FROM project_slug_aliases").all()).toEqual([
      { slug: "new-project", project_id: project.projectId, status: "tentative" },
    ]);
    expect(db.db.prepare("SELECT COUNT(*) AS count FROM projects").get()).toEqual({ count: 1 });
    expect(db.db.prepare("SELECT project_id, project_identifier FROM thoughts").get()).toEqual({
      project_id: project.projectId,
      project_identifier: "new-project",
    });
  });

  it("rejects a derived slug collision without inserting or exposing the registered project", () => {
    upsertProject(db.db, {
      slug: "shared-name", displayName: "Original", memberRepos: ["github.com/owner/shared-name"], memberPaths: [], provisional: false,
    });
    const scope = resolveProjectScope(db.db, [repo("https://gitlab.com/other/shared-name.git")]);

    expect(scope).toEqual({ kind: "unresolved" });
    expect(error(handleCaptureThought(db, { content: "Wrong project" }, scope))).toBe("project_scope_unresolved");
    expect(count()).toBe(0);
    expect(getProjectBySlug(db.db, "shared-name")?.memberRepos).toEqual(["github.com/owner/shared-name"]);
  });

  it("rolls back provisional registration when thought insertion fails", () => {
    const scope = resolveProjectScope(db.db, [repo("https://github.com/acme/atomic-project.git")]);
    db.db.exec("CREATE TRIGGER reject_thought BEFORE INSERT ON thoughts BEGIN SELECT RAISE(ABORT, 'blocked'); END");

    expect(() => handleCaptureThought(db, { content: "Personal" }, scope)).toThrow("blocked");
    expect(getProjectBySlug(db.db, "atomic-project")).toBeNull();
    expect(db.db.prepare("SELECT COUNT(*) AS count FROM projects").get()).toEqual({ count: 0 });
    expect(db.db.prepare("SELECT COUNT(*) AS count FROM project_slug_aliases").get()).toEqual({ count: 0 });
    expect(count()).toBe(0);
  });
});
