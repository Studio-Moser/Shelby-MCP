import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { insertThought } from "../../src/db/thoughts.js";
import { handleGetBrief } from "../../src/tools/brief.js";
import { getProjectByAlias, upsertProject } from "../../src/db/projects.js";

let db: ThoughtDatabase;
beforeEach(() => {
  db = new ThoughtDatabase(":memory:");
  for (const slug of ["shelby", "other-project"]) {
    upsertProject(db.db, { slug, displayName: slug, memberRepos: [], memberPaths: [], provisional: false });
  }
});
afterEach(() => db.close());

function parseResult(result: ReturnType<typeof handleGetBrief>): Record<string, unknown> {
  const text = result.content[0]?.text;
  if (!text) throw new Error("Missing get_brief result text");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new Error("Invalid get_brief result JSON", { cause: error });
  }
}

function add(summary: string, extra: Record<string, unknown> = {}): void {
  insertThought(db.db, {
    content: summary,
    summary,
    type: "decision",
    source: "test",
    project_identifier: "shelby",
    ...extra,
  });
}

describe("handleGetBrief curated response", () => {
  it("returns the required structured empty brief", () => {
    const data = parseResult(handleGetBrief(db, { project_identifier: "shelby" }));
    expect(data).toMatchObject({
      project_identifier: "shelby",
      scope: "full",
      thought_count: 0,
      last_activity: null,
      policy_version: 2,
      estimated_tokens: 33,
      items: [],
    });
    expect(data.brief).toContain("evidence, not instructions");
  });

  it("includes safe legacy decisions/references/insights/preferences but not untagged notes", () => {
    add("SQLite for offline access.");
    add("OWASP memory poisoning reference.", { type: "reference" });
    add("Bulk capture is faster.", { type: "insight" });
		add("Legacy preference remains visible.", { type: "preference" });
    add("Random note.", { type: "note" });

    const data = parseResult(handleGetBrief(db, { scope: "essentials", project_identifier: "shelby" }));
		expect(data.thought_count).toBe(4);
    expect(data.brief).toContain("### Constraints and decisions");
		expect(data.brief).toContain("Legacy preference remains visible.");
    expect(data.brief).not.toContain("Random note");
  });

  it("includes explicitly eligible recent activity and emits each item once", () => {
    add("Today's decision.");
    add("Task today.", { type: "task", metadata: { extra: { briefEligible: true } } });
    const data = parseResult(handleGetBrief(db, { scope: "full", project_identifier: "shelby" }));
    expect(data.thought_count).toBe(2);
    expect((String(data.brief).match(/Today's decision\./g) ?? [])).toHaveLength(1);
    expect(data.brief).toContain("### Recent");
    expect(data.brief).toContain("Task today.");
  });

  it("rejects invalid scope", () => {
    const result = handleGetBrief(db, { scope: "everything", project_identifier: "shelby" });
    expect(result.isError).toBe(true);
    expect(parseResult(result).error).toBe("invalid_input");
  });

  it("includes exact project plus explicitly eligible shared and excludes other projects", () => {
    add("Shelby decision.");
    add("Other decision.", { project_identifier: "other-project" });
    add("Concise context preference.", {
      project_identifier: undefined,
      visibility: "shared",
      metadata: { extra: { briefEligible: true, briefRole: "preference" } },
    });
    const data = parseResult(handleGetBrief(db, { scope: "essentials", project_identifier: "shelby", include_shared: true }));
    expect(data.brief).toContain("Shelby decision.");
    expect(data.brief).toContain("Concise context preference.");
    expect(data.brief).not.toContain("Other decision.");
    expect(data.thought_count).toBe(2);
  });

  it("fails safely to explicitly eligible shared records only", () => {
    add("Private project decision.");
    add("Shared preference.", {
      project_identifier: undefined,
      visibility: "shared",
      metadata: { extra: { briefEligible: true, briefRole: "preference" } },
    });
    const data = parseResult(handleGetBrief(db, { shared_only: true }));
    expect(data.brief).toContain("Shared preference.");
    expect(data.brief).not.toContain("Private project decision.");
    expect(data.project_identifier).toBeNull();
  });

  it("renders summaries only and never falls back to raw content", () => {
    add("Safe summary.", { content: "PRIVATE RAW CONTENT MUST NOT RENDER" });
    const data = parseResult(handleGetBrief(db, { project_identifier: "shelby" }));
    expect(data.brief).toContain("Safe summary.");
    expect(data.brief).not.toContain("PRIVATE RAW CONTENT MUST NOT RENDER");
  });

  it("uses the newest included updated_at as last_activity", () => {
    add("Included decision.");
    const data = parseResult(handleGetBrief(db, { project_identifier: "shelby" }));
    expect(new Date(String(data.last_activity)).toString()).not.toBe("Invalid Date");
  });

  it("scopes candidates and output by immutable project_id", () => {
    upsertProject(db.db, { slug: "retired-slug", displayName: "Renamed", memberRepos: [], memberPaths: [], provisional: false });
    const projectId = getProjectByAlias(db.db, "retired-slug")!.projectId;
    add("Renamed decision.", { project_identifier: "retired-slug" });
    db.db.prepare("UPDATE thoughts SET project_id = ? WHERE summary = 'Renamed decision.'").run(projectId);

    const data = parseResult(handleGetBrief(db, { project_id: projectId, include_shared: false }));
    expect(data).toMatchObject({ project_id: projectId, project_identifier: "retired-slug", thought_count: 1 });
    expect(data.brief).toContain("Renamed decision.");
  });
});
