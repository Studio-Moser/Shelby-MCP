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

  it("filters by has_summary = false (missing summaries)", () => {
    captureId("Has summary", { summary: "A summary" });
    captureId("No summary");

    const result = handleListThoughts(db, { has_summary: false });
    const data = parseResult(result);
    expect(data.results.length).toBe(1);
    expect(data.total_count).toBe(1);
  });

  it("filters by has_summary = true (has summaries)", () => {
    captureId("Has summary", { summary: "A summary" });
    captureId("No summary");

    const result = handleListThoughts(db, { has_summary: true });
    const data = parseResult(result);
    expect(data.results.length).toBe(1);
    expect(data.results[0].summary).toBe("A summary");
  });

  it("filters by source_agent (#23)", () => {
    captureId("Claude thought", { source_agent: "claude-code" });
    captureId("Cursor thought", { source_agent: "cursor" });
    captureId("No agent");

    const result = handleListThoughts(db, { source_agent: "claude-code" });
    const data = parseResult(result);
    expect(data.results.length).toBe(1);
    expect(data.total_count).toBe(1);
  });

  it("filters by trust_level (#35)", () => {
    captureId("Trusted", { trust_level: "trusted" });
    captureId("Unverified", { trust_level: "unverified" });
    captureId("External", { trust_level: "external" });

    const unverified = handleListThoughts(db, { trust_level: "unverified" });
    const unverifiedData = parseResult(unverified);
    expect(unverifiedData.total_count).toBe(1);

    const external = handleListThoughts(db, { trust_level: "external" });
    const externalData = parseResult(external);
    expect(externalData.total_count).toBe(1);
  });
});
