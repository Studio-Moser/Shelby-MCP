import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { handleSelectContext } from "../../src/tools/context.js";
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

function capture(content: string, extra: Record<string, unknown> = {}): void {
  handleCaptureThought(db, { content, ...extra });
}

describe("handleSelectContext", () => {
  it("returns a 'no thoughts matched' document on an empty database", () => {
    const result = handleSelectContext(db, {});
    expect(result.isError).toBeUndefined();
    const data = parseResult(result);
    expect(data.matched_count).toBe(0);
    expect(data.document).toContain("No thoughts matched");
  });

  it("filters by a single type", () => {
    capture("Decision A", { type: "decision", summary: "Decision A" });
    capture("Note A", { type: "note", summary: "Note A" });

    const result = handleSelectContext(db, { types: ["decision"] });
    const data = parseResult(result);
    expect(data.matched_count).toBe(1);
    expect(data.document).toContain("Decision A");
    expect(data.document).not.toContain("Note A");
  });

  it("filters by multiple types and dedupes by id", () => {
    capture("Decision A", { type: "decision", summary: "Decision A" });
    capture("Insight A", { type: "insight", summary: "Insight A" });
    capture("Note A", { type: "note", summary: "Note A" });

    const result = handleSelectContext(db, {
      types: ["decision", "insight"],
    });
    const data = parseResult(result);
    expect(data.matched_count).toBe(2);
    expect(data.document).toContain("Decision A");
    expect(data.document).toContain("Insight A");
    expect(data.document).not.toContain("Note A");
  });

  it("filters by topic (uses first topic in the array)", () => {
    capture("Auth decision", {
      type: "decision",
      topics: ["auth"],
      summary: "Auth",
    });
    capture("DB decision", {
      type: "decision",
      topics: ["db"],
      summary: "DB",
    });

    const result = handleSelectContext(db, { topics: ["auth"] });
    const data = parseResult(result);
    expect(data.matched_count).toBe(1);
    expect(data.document).toContain("Auth");
  });

  it("filters by person", () => {
    capture("Tim said...", { people: ["Tim"], summary: "Tim quote" });
    capture("Sarah said...", { people: ["Sarah"], summary: "Sarah quote" });

    const result = handleSelectContext(db, { people: ["Tim"] });
    const data = parseResult(result);
    expect(data.matched_count).toBe(1);
    expect(data.document).toContain("Tim quote");
  });

  it("include_brief prepends an essentials brief header", () => {
    capture("Important decision", {
      type: "decision",
      summary: "Important decision",
    });
    capture("A note", { type: "note", summary: "A note" });

    const result = handleSelectContext(db, {
      types: ["note"],
      include_brief: true,
    });
    const data = parseResult(result);
    // The brief header should mention the decision (from essentials)
    expect(data.document).toContain("Essentials");
    expect(data.document).toContain("Important decision");
    // The main selection should be the note
    expect(data.document).toContain("Selected Context");
    expect(data.document).toContain("A note");
  });

  it("include_stats appends a stats footer", () => {
    capture("One", { summary: "One" });
    capture("Two", { summary: "Two" });

    const result = handleSelectContext(db, { include_stats: true });
    const data = parseResult(result);
    expect(data.document).toContain("Memory Stats");
    expect(data.document).toContain("Total: 2 thoughts");
  });

  it("limit caps the number of results", () => {
    for (let i = 0; i < 5; i++) {
      capture(`Thought ${i}`, { summary: `Summary ${i}` });
    }
    const result = handleSelectContext(db, { limit: 2 });
    const data = parseResult(result);
    expect(data.matched_count).toBe(2);
  });

  it("scopes by project path", () => {
    capture("Shelby thing", {
      project: "/projects/shelby",
      summary: "Shelby thing",
    });
    capture("Other thing", {
      project: "/projects/other",
      summary: "Other thing",
    });

    const result = handleSelectContext(db, { project: "/projects/shelby" });
    const data = parseResult(result);
    expect(data.matched_count).toBe(1);
    expect(data.document).toContain("Shelby thing");
    expect(data.document).not.toContain("Other thing");
  });

  it("rejects non-string-array types", () => {
    const result = handleSelectContext(db, { types: [1, 2, 3] as unknown as string[] });
    expect(result.isError).toBe(true);
    const data = parseResult(result);
    expect(data.error).toBe("invalid_input");
  });

  it("rejects non-string since", () => {
    const result = handleSelectContext(db, { since: 12345 as unknown as string });
    expect(result.isError).toBe(true);
  });
});
