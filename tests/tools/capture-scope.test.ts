import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThoughtDatabase } from "../../src/db/database.js";
import { getProjectBySlug, upsertProject } from "../../src/db/projects.js";
import { resolveProjectScope } from "../../src/db/resolve-project.js";
import { handleCaptureThought } from "../../src/tools/capture.js";

let db: ThoughtDatabase;
beforeEach(() => { db = new ThoughtDatabase(":memory:"); });

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

  it("upserts a provisional project before inserting a derived personal capture", () => {
    const root = repo("https://github.com/acme/new-project.git");
    const scope = resolveProjectScope(db.db, [root]);
    const result = handleCaptureThought(db, { content: "Personal" }, scope);
    expect(result.isError).toBeUndefined();
    expect(getProjectBySlug(db.db, "new-project")).toMatchObject({ provisional: true, memberRepos: ["github.com/acme/new-project"] });
    expect(db.db.prepare("SELECT project_identifier FROM thoughts").get()).toEqual({ project_identifier: "new-project" });
  });
});
