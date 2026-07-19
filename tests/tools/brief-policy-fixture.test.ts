import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { loadBriefCandidates } from "../../src/db/brief-candidates.js";
import { normalizeBriefSummary, selectBriefItems, type BriefScope } from "../../src/tools/brief-policy.js";
import { estimateBriefTokens, renderTokenBoundBrief } from "../../src/tools/brief-renderer.js";
import { handleGetBrief } from "../../src/tools/brief.js";

interface Fixture {
  policy_version: number;
  request: { scope: BriefScope; project_identifier: string; include_shared: boolean; all_projects: boolean; now: string };
  thoughts: Array<Record<string, unknown>>;
  active_refutations: Array<{ source_id: string; target_id: string }>;
  summary_safety_cases: Array<{ input: string; decision: "accept" | "reject"; reason?: string; normalized?: string }>;
  expected_by_scope: Record<BriefScope, string[]>;
  legacy_default_roles: Record<string, string>;
  expected: { ordered_item_ids: string[]; ordered_roles: string[]; omitted_counts: Record<string, number>; brief: string; estimated_tokens: number };
}

const fixturePath = fileURLToPath(new URL("../fixtures/brief-policy-v1.json", import.meta.url));

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error("Invalid brief policy fixture/result JSON", { cause: error });
  }
}

const fixture = parseJson<Fixture>(readFileSync(fixturePath, "utf8"));
let db: ThoughtDatabase;

beforeEach(() => {
  db = new ThoughtDatabase(":memory:");
  const insert = db.db.prepare(`
    INSERT INTO thoughts
      (id, content, summary, type, source, trust_level, project_identifier, visibility,
       metadata, created_at, updated_at, consolidated_into, reinforcement_count)
    VALUES
      (@id, @content, @summary, @type, @source, @trust_level, @project_identifier, @visibility,
       @metadata, @created_at, @updated_at, @consolidated_into, @reinforcement_count)
  `);
  for (const thought of fixture.thoughts) {
    insert.run({
      ...thought,
      content: thought.summary ?? "fixture content",
      metadata: JSON.stringify(thought.metadata),
    });
  }
  const edge = db.db.prepare(`
    INSERT INTO edges (id, source_id, target_id, edge_type, created_at)
    VALUES (@id, @source_id, @target_id, 'refuted_by', @created_at)
  `);
  fixture.active_refutations.forEach((item, index) => edge.run({
    id: `refutation-${index}`,
    ...item,
    created_at: fixture.request.now,
  }));
});

afterEach(() => db.close());

describe("canonical brief-policy fixture", () => {
  it("keeps the copied fixture byte-identical to the canonical Docs fixture", () => {
    const digest = createHash("sha256").update(readFileSync(fixturePath)).digest("hex");
    expect(digest).toBe("683d5d8f4e0fca374d56aeab2b36bf3ce9de02b709dfda6e98ded4d25b39de49");
  });

  it("matches every summary safety case exactly", () => {
    for (const testCase of fixture.summary_safety_cases) {
      const normalized = normalizeBriefSummary(testCase.input);
      if (testCase.decision === "reject") expect(normalized, testCase.input).toBeNull();
      else expect(normalized, testCase.input).toBe(testCase.normalized);
    }
  });

  it.each(["essentials", "recent", "full"] as BriefScope[])("matches %s ordering", (scope) => {
    const request = { ...fixture.request, scope };
    const result = selectBriefItems(
      loadBriefCandidates(db.db, fixture.request.now, request),
      request,
    );
    expect(result.items.map((item) => item.id)).toEqual(fixture.expected_by_scope[scope]);
  });

  it("matches roles, omissions, markdown, and UTF-8 token estimate", () => {
    const selected = selectBriefItems(
      loadBriefCandidates(db.db, fixture.request.now, fixture.request),
      fixture.request,
    );
    const rendered = renderTokenBoundBrief(selected.items, selected.omitted_counts, 800);
    expect(rendered.items.map((item) => item.id)).toEqual(fixture.expected.ordered_item_ids);
    expect(rendered.items.map((item) => item.role)).toEqual(fixture.expected.ordered_roles);
    expect(selected.omitted_counts).toEqual(fixture.expected.omitted_counts);
    expect(rendered.brief).toBe(fixture.expected.brief);
    expect(estimateBriefTokens(rendered.brief)).toBe(fixture.expected.estimated_tokens);
    expect(rendered.estimated_tokens).toBe(fixture.expected.estimated_tokens);
  });

  it("returns the exact required snake_case wire schema", () => {
    const result = handleGetBrief(db, fixture.request as unknown as Record<string, unknown>);
    const text = result.content[0]?.text;
    if (!text) throw new Error("Missing get_brief result text");
    const data = parseJson<Record<string, unknown>>(text);
    expect(Object.keys(data)).toEqual([
      "project_id", "project_identifier", "scope", "thought_count", "last_activity", "policy_version",
      "estimated_tokens", "omitted_counts", "items", "brief",
    ]);
    expect(data.policy_version).toBe(fixture.policy_version);
    expect(data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: fixture.expected.ordered_item_ids[0], trust_level: "trusted", updated_at: expect.any(String) }),
    ]));
    expect(data.brief).toBe(fixture.expected.brief);
  });
});
