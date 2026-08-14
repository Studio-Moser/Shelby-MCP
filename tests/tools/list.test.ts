import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { handleListThoughts } from "../../src/tools/list.js";
import { handleCaptureThought } from "../../src/tools/capture.js";
import { getProjectByAlias, upsertProject } from "../../src/db/projects.js";
import { getThought } from "../../src/db/thoughts.js";

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

	it("canonicalizes topic filters", () => {
		captureId("Graph memory", { topics: ["Knowledge Graph"] });
		captureId("Other memory", { topics: ["database"] });

		const data = parseResult(handleListThoughts(db, { topic: "knowledge_graph" }));

		expect(data.total_count).toBe(1);
		expect(data.results[0].topics).toEqual(["knowledge-graph"]);
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

  it("scopes by immutable project_id and emits the current slug", () => {
    upsertProject(db.db, { slug: "retired-slug", displayName: "Renamed", memberRepos: [], memberPaths: [], provisional: false });
    const projectId = getProjectByAlias(db.db, "retired-slug")!.projectId;
    const id = captureId("renamed project", { project_identifier: "retired-slug" });
    db.db.prepare("UPDATE projects SET current_slug = 'current-slug' WHERE project_id = ?").run(projectId);
    db.db.prepare("UPDATE project_slug_aliases SET status = 'retired' WHERE slug = 'retired-slug'").run();
    db.db.prepare("INSERT INTO project_slug_aliases (slug, project_id, status, claimed_at) VALUES ('current-slug', ?, 'current', ?)").run(projectId, new Date().toISOString());

    const data = parseResult(handleListThoughts(db, { project_id: projectId, project_identifier: "current-slug", include_shared: false }));
    expect(data.results).toEqual([expect.objectContaining({ id, project_id: projectId, project_identifier: "current-slug" })]);
    expect(getThought(db.db, id)?.project_identifier).toBe("current-slug");
  });
});
