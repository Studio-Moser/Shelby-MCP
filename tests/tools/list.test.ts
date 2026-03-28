import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { handleListThoughts } from "../../src/tools/list.js";
import { handleCaptureThought } from "../../src/tools/capture.js";

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

function captureId(content: string, extra: Record<string, unknown> = {}): string {
  const result = handleCaptureThought(db, { content, ...extra });
  return parseResult(result).id;
}

describe("handleListThoughts", () => {
  it("returns empty list for empty database", () => {
    const result = handleListThoughts(db, {});
    const data = parseResult(result);
    expect(data.results).toEqual([]);
    expect(data.total_count).toBe(0);
    expect(data.has_more).toBe(false);
  });

  it("lists thoughts and respects limit", () => {
    for (let i = 0; i < 5; i++) {
      captureId(`Thought ${i}`);
    }

    const result = handleListThoughts(db, { limit: 3 });
    const data = parseResult(result);
    expect(data.results.length).toBe(3);
    expect(data.total_count).toBe(5);
    expect(data.has_more).toBe(true);
  });

  it("filters by type", () => {
    captureId("A note", { type: "note" });
    captureId("A task", { type: "task" });
    captureId("Another note", { type: "note" });

    const result = handleListThoughts(db, { type: "task" });
    const data = parseResult(result);
    expect(data.results.length).toBe(1);
    expect(data.total_count).toBe(1);
  });

  it("filters by project", () => {
    captureId("In project", { project: "myproject" });
    captureId("No project");

    const result = handleListThoughts(db, { project: "myproject" });
    const data = parseResult(result);
    expect(data.results.length).toBe(1);
  });
});
