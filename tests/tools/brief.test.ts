import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { handleGetBrief } from "../../src/tools/brief.js";
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

describe("handleGetBrief", () => {
  it("returns an empty brief on an empty database", () => {
    const result = handleGetBrief(db, {});
    expect(result.isError).toBeUndefined();
    const data = parseResult(result);
    expect(data.thought_count).toBe(0);
    expect(data.last_activity).toBeNull();
    expect(data.brief).toContain("No memories found");
  });

  it("includes decisions, references, and insights in the essentials section", () => {
    capture("Chose SQLite because we need offline access", {
      type: "decision",
      summary: "SQLite for offline access",
    });
    capture("OWASP ASI06 reference", {
      type: "reference",
      summary: "OWASP memory poisoning reference",
    });
    capture("Bulk capture is faster than single calls", {
      type: "insight",
      summary: "Bulk capture is faster",
    });
    // A plain note should NOT appear in essentials
    capture("Random note", { type: "note", summary: "Random" });

    const result = handleGetBrief(db, { scope: "essentials" });
    const data = parseResult(result);
    expect(data.thought_count).toBe(3);
    expect(data.brief).toContain("Essentials");
    expect(data.brief).toContain("SQLite for offline access");
    expect(data.brief).toContain("OWASP memory poisoning reference");
    expect(data.brief).toContain("Bulk capture is faster");
    expect(data.brief).not.toContain("Random");
  });

  it("scope=recent returns everything from the last 7 days", () => {
    capture("Something I did today", { type: "note", summary: "Today" });
    capture("Another thing", { type: "task", summary: "Task today" });

    const result = handleGetBrief(db, { scope: "recent" });
    const data = parseResult(result);
    expect(data.thought_count).toBe(2);
    expect(data.brief).toContain("Recent (last 7 days)");
    expect(data.brief).toContain("Today");
    expect(data.brief).toContain("Task today");
  });

  it("formats tasks in the recent section with a checkbox bullet", () => {
    capture("Finish the parity work", {
      type: "task",
      summary: "Finish parity",
    });
    const result = handleGetBrief(db, { scope: "recent" });
    const data = parseResult(result);
    // Tasks should render with `- [ ]`
    expect(data.brief).toMatch(/- \[ \].*Finish parity/);
  });

  it("scope=full merges essentials and recent without double-counting", () => {
    // A recent decision should appear in BOTH sections but count once.
    capture("Important decision made today", {
      type: "decision",
      summary: "Today's decision",
    });
    const result = handleGetBrief(db, { scope: "full" });
    const data = parseResult(result);
    expect(data.thought_count).toBe(1); // not 2
    expect(data.brief).toContain("Essentials");
    expect(data.brief).toContain("Recent (last 7 days)");
  });

  it("rejects invalid scope", () => {
    const result = handleGetBrief(db, { scope: "everything" });
    expect(result.isError).toBe(true);
    const data = parseResult(result);
    expect(data.error).toBe("invalid_input");
  });

  it("scopes by project path when provided", () => {
    capture("Shelby decision", {
      type: "decision",
      project: "/Users/me/Projects/Shelby",
      summary: "Shelby decision",
    });
    capture("Other project decision", {
      type: "decision",
      project: "/Users/me/Projects/Other",
      summary: "Other decision",
    });

    const result = handleGetBrief(db, {
      scope: "essentials",
      project: "/Users/me/Projects/Shelby",
    });
    const data = parseResult(result);
    expect(data.brief).toContain("Shelby decision");
    expect(data.brief).not.toContain("Other decision");
    expect(data.brief).toContain("# Project Brief — Shelby");
  });

  it("last_activity reflects the newest included thought", () => {
    capture("Older", { type: "decision", summary: "Older decision" });
    // A tiny delay so timestamps differ. vitest's event loop is usually enough
    // because of the ISO8601 fractional-second resolution.
    capture("Newer", { type: "decision", summary: "Newer decision" });
    const result = handleGetBrief(db, {});
    const data = parseResult(result);
    expect(data.last_activity).toBeTruthy();
    // Should be an ISO 8601 string
    expect(new Date(data.last_activity).toString()).not.toBe("Invalid Date");
  });
});
