import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { handleUpdateThought } from "../../src/tools/update.js";
import { handleCaptureThought } from "../../src/tools/capture.js";
import { getThought } from "../../src/db/thoughts.js";
import { getProjectByAlias, upsertProject } from "../../src/db/projects.js";

let db: ThoughtDatabase;

beforeEach(() => {
  db = new ThoughtDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

function parseResult(result: object): any {
  const text = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text;
  if (!text) throw new Error("Expected tool result text");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON tool result: ${text}`, { cause: error });
  }
}

function captureId(content: string): string {
  const result = handleCaptureThought(db, { content });
  return parseResult(result).id;
}

describe("handleUpdateThought", () => {
  it("updates a single thought by id", () => {
    const id = captureId("Original content");

    const result = handleUpdateThought(db, {
      id,
      content: "Updated content",
      summary: "Updated summary",
    });
    const data = parseResult(result);
    expect(data.updated).toBe(1);
    expect(data.not_found).toEqual([]);

    const thought = getThought(db.db, id);
    expect(thought!.content).toBe("Updated content");
    expect(thought!.summary).toBe("Updated summary");
  });

  it("updates multiple thoughts via ids", () => {
    const id1 = captureId("One");
    const id2 = captureId("Two");

    const result = handleUpdateThought(db, {
      ids: [id1, id2],
      type: "task",
      project: "shelbymcp",
    });
    const data = parseResult(result);
    expect(data.updated).toBe(2);

    expect(getThought(db.db, id1)!.type).toBe("task");
    expect(getThought(db.db, id2)!.project).toBe("shelbymcp");
  });

  it("reports not_found for non-existent IDs", () => {
    const id = captureId("Exists");

    const result = handleUpdateThought(db, {
      ids: [id, "bad-id"],
      type: "decision",
    });
    const data = parseResult(result);
    expect(data.updated).toBe(1);
    expect(data.not_found).toEqual(["bad-id"]);
  });

  it("returns error when no id or ids provided", () => {
    const result = handleUpdateThought(db, { content: "something" });
    const r = result as any;
    expect(r.isError).toBe(true);
  });

  it("returns error when no update fields provided", () => {
    const id = captureId("Test");
    const result = handleUpdateThought(db, { id });
    const r = result as any;
    expect(r.isError).toBe(true);
    expect(parseResult(result).error).toBe("invalid_input");
  });

  it("resolves UUID/current/retired project references before re-homing", () => {
    upsertProject(db.db, { slug: "retired-slug", displayName: "Renamed", memberRepos: [], memberPaths: [], provisional: false });
    const projectId = getProjectByAlias(db.db, "retired-slug")!.projectId;
    db.db.prepare("UPDATE projects SET current_slug = 'current-slug' WHERE project_id = ?").run(projectId);
    db.db.prepare("UPDATE project_slug_aliases SET status = 'retired' WHERE slug = 'retired-slug'").run();
    db.db.prepare("INSERT INTO project_slug_aliases (slug, project_id, status, claimed_at) VALUES ('current-slug', ?, 'current', ?)").run(projectId, new Date().toISOString());

    for (const reference of [
      { project_id: projectId },
      { project_identifier: "current-slug" },
      { project_identifier: "retired-slug" },
      { project_id: projectId, project_identifier: "retired-slug" },
    ]) {
      const id = captureId("re-home target");
      expect(parseResult(handleUpdateThought(db, { id, ...reference })).updated).toBe(1);
      expect(getThought(db.db, id)).toMatchObject({ project_id: projectId, project_identifier: "current-slug" });
    }
    });

  it("rejects unknown, conflicting, and arbitrary project references before thought SQL", () => {
    upsertProject(db.db, { slug: "one", displayName: "One", memberRepos: [], memberPaths: [], provisional: false });
    upsertProject(db.db, { slug: "two", displayName: "Two", memberRepos: [], memberPaths: [], provisional: false });
    const projectId = getProjectByAlias(db.db, "one")!.projectId;
    const id = captureId("must stay put");
    const original = getThought(db.db, id);
    for (const reference of [
      { project_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { project_id: projectId, project_identifier: "two" },
      { project_identifier: "arbitrary-new-slug" },
    ]) {
      const result = handleUpdateThought(db, { id, ...reference });
      expect(result.isError).toBe(true);
      expect(getThought(db.db, id)).toMatchObject({ project_id: original?.project_id, project_identifier: original?.project_identifier });
    }
  });

  it("forwards visibility to updateThought", () => {
    const id = captureId("Personal note");
    expect(getThought(db.db, id)!.visibility).toBe("personal");

    handleUpdateThought(db, { id, visibility: "shared" });

    expect(getThought(db.db, id)!.visibility).toBe("shared");
  });
});
