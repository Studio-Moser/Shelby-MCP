import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { handleUpdateThought } from "../../src/tools/update.js";
import { handleCaptureThought } from "../../src/tools/capture.js";
import { getThought } from "../../src/db/thoughts.js";

let db: ThoughtDatabase;

beforeEach(() => {
  db = new ThoughtDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

function parseResult(result: object): any {
  const r = result as any;
  return JSON.parse(r.content[0].text);
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
    const data = JSON.parse(r.content[0].text);
    expect(data.error).toBe("invalid_input");
  });
});
