import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { handleCaptureThought } from "../../src/tools/capture.js";
import { getThought } from "../../src/db/thoughts.js";
import { getEdgesBetween } from "../../src/db/edges.js";

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

describe("handleCaptureThought", () => {
  it("captures a single thought with minimal fields", () => {
    const result = handleCaptureThought(db, { content: "Hello world" });
    const data = parseResult(result);
    expect(data.id).toBeDefined();
    expect(typeof data.id).toBe("string");
    expect(data.linked).toEqual([]);
    expect(data.skipped).toEqual([]);

    // Verify in DB
    const thought = getThought(db.db, data.id);
    expect(thought).not.toBeNull();
    expect(thought!.content).toBe("Hello world");
    expect(thought!.type).toBe("note");
  });

  it("captures a thought with all optional fields", () => {
    const result = handleCaptureThought(db, {
      content: "Full thought",
      summary: "A full thought",
      type: "decision",
      source: "claude",
      project: "shelbymcp",
      topics: ["testing", "mcp"],
      people: ["tim"],
      metadata: { key: "value" },
    });
    const data = parseResult(result);
    const thought = getThought(db.db, data.id);
    expect(thought!.summary).toBe("A full thought");
    expect(thought!.type).toBe("decision");
    expect(thought!.source).toBe("claude");
    expect(thought!.project).toBe("shelbymcp");
    expect(thought!.topics).toEqual(["testing", "mcp"]);
    expect(thought!.people).toEqual(["tim"]);
    expect(thought!.metadata).toEqual({ key: "value" });
  });

  it("creates related edges for existing thoughts", () => {
    // Create a target thought first
    const target = handleCaptureThought(db, { content: "Target thought" });
    const targetId = parseResult(target).id;

    const result = handleCaptureThought(db, {
      content: "Source thought",
      related_to: [targetId],
    });
    const data = parseResult(result);
    expect(data.linked).toEqual([targetId]);
    expect(data.skipped).toEqual([]);

    // Verify edge exists
    const edges = getEdgesBetween(db, data.id, targetId);
    expect(edges.length).toBe(1);
    expect(edges[0].edge_type).toBe("related");
  });

  it("skips non-existent related_to IDs without failing", () => {
    const result = handleCaptureThought(db, {
      content: "Some thought",
      related_to: ["nonexistent-id"],
    });
    const data = parseResult(result);
    expect(data.id).toBeDefined();
    expect(data.linked).toEqual([]);
    expect(data.skipped).toEqual(["nonexistent-id"]);
  });

  it("handles bulk capture via thoughts array", () => {
    const result = handleCaptureThought(db, {
      thoughts: [
        { content: "First" },
        { content: "Second", type: "task" },
        { content: "Third", summary: "third one" },
      ],
    });
    const data = parseResult(result);
    expect(data.captured).toBe(3);
    expect(data.thoughts).toHaveLength(3);

    // Verify each was saved
    for (const t of data.thoughts) {
      const thought = getThought(db.db, t.id);
      expect(thought).not.toBeNull();
    }
  });

  it("returns error when content is missing", () => {
    const result = handleCaptureThought(db, {});
    const r = result as any;
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0].text);
    expect(data.error).toBe("invalid_input");
  });

  it("returns error when bulk thoughts array is empty", () => {
    const result = handleCaptureThought(db, { thoughts: [] });
    const r = result as any;
    expect(r.isError).toBe(true);
  });
});
