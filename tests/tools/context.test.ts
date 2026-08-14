import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { handleSelectContext } from "../../src/tools/context.js";
import { handleCaptureThought } from "../../src/tools/capture.js";
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

function capture(content: string, extra: Record<string, unknown> = {}): void {
  const slug = extra.project_identifier;
  if (typeof slug === "string") {
    upsertProject(db.db, { slug, displayName: slug, memberRepos: [], memberPaths: [], provisional: false });
  }
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

	it("canonicalizes its first topic filter", () => {
		capture("Graph context", { topics: ["Knowledge Graph"], summary: "Graph" });

		const data = parseResult(handleSelectContext(db, { topics: ["knowledge_graph"] }));

		expect(data.matched_count).toBe(1);
		expect(data.document).toContain("Graph context");
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
      all_projects: true,
    });
    const data = parseResult(result);
    // The curated brief header should mention the decision.
    expect(data.document).toContain("Shelby memory context");
    expect(data.document).toContain("Important decision");
    // The main selection should be the note
    expect(data.document).toContain("Selected Context");
    expect(data.document).toContain("A note");
  });

  it("forwards include_shared:false to the curated brief", () => {
    capture("Local decision", {
      type: "decision",
      summary: "Local decision",
      project_identifier: "shelby",
    });
    capture("Shared preference", {
      type: "decision",
      summary: "Shared preference",
      project_identifier: "shelby",
      visibility: "shared",
      metadata: { extra: { briefEligible: true, briefRole: "preference" } },
    });
    capture("Selected note", {
      type: "note",
      summary: "Selected note",
      project_identifier: "shelby",
    });

    const result = handleSelectContext(db, {
      types: ["note"],
      project_identifier: "shelby",
      include_shared: false,
      include_brief: true,
    });
    const data = parseResult(result);
    expect(data.document).toContain("Local decision");
    expect(data.document).toContain("Selected note");
    expect(data.document).not.toContain("Shared preference");
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

  it("scopes by project_identifier slug (formerly project path)", () => {
    capture("Shelby thing", {
      project_identifier: "shelby",
      summary: "Shelby thing",
    });
    capture("Other thing", {
      project_identifier: "other",
      summary: "Other thing",
    });

    const result = handleSelectContext(db, { project_identifier: "shelby" });
    const data = parseResult(result);
    expect(data.matched_count).toBe(1);
    expect(data.document).toContain("Shelby thing");
    expect(data.document).not.toContain("Other thing");
  });

  it("scopes by project_identifier slug", () => {
    capture("Shelby slug thought", {
      project_identifier: "shelby",
      summary: "Shelby slug thought",
    });
    capture("Kuow slug thought", {
      project_identifier: "kuow-games",
      summary: "Kuow slug thought",
    });

    const result = handleSelectContext(db, { project_identifier: "shelby" });
    const data = parseResult(result);
    expect(data.matched_count).toBe(1);
    expect(data.document).toContain("Shelby slug thought");
    expect(data.document).not.toContain("Kuow slug thought");
  });

  it("shared_only: returns only shared thoughts, excludes all project-scoped thoughts", () => {
    // A personal decision in project "a" — must NOT leak
    capture("Project A private decision", {
      project_identifier: "project-a",
      type: "decision",
      summary: "Project A private decision",
    });
    // A personal note in project "b" — must NOT leak
    capture("Project B private note", {
      project_identifier: "project-b",
      type: "note",
      summary: "Project B private note",
    });
    // A shared reference — MUST appear
    capture("Shared reference", {
      visibility: "shared",
      type: "reference",
      summary: "Shared reference",
    });

    const result = handleSelectContext(db, { shared_only: true });
    expect(result.isError).toBeUndefined();
    const data = parseResult(result);

    expect(data.matched_count).toBe(1);
    expect(data.document).toContain("Shared reference");
    expect(data.document).not.toContain("Project A private decision");
    expect(data.document).not.toContain("Project B private note");
  });

  it("shared_only with include_brief: brief header is also shared-only (no cross-project leak)", () => {
    // A decision in project "a" that would appear in a normal brief — must NOT leak via the brief header
    capture("Project A critical decision", {
      project_identifier: "project-a",
      type: "decision",
      summary: "Project A critical decision",
    });
    // A shared decision that SHOULD appear in the brief header
    capture("Shared critical decision", {
      visibility: "shared",
      type: "decision",
      summary: "Shared critical decision",
    });

    const result = handleSelectContext(db, { shared_only: true, include_brief: true });
    expect(result.isError).toBeUndefined();
    const data = parseResult(result);

    expect(data.document).not.toContain("Project A critical decision");
    expect(data.document).toContain("Shared critical decision");
  });

  it("scopes and reports context by immutable project_id", () => {
    capture("Renamed context", { project_identifier: "retired-slug", summary: "Renamed context" });
    const projectId = getProjectByAlias(db.db, "retired-slug")!.projectId;
    const result = handleSelectContext(db, { project_id: projectId, include_shared: false });
    const data = parseResult(result);
    expect(data).toMatchObject({ matched_count: 1, project_id: projectId, project_identifier: "retired-slug" });
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
