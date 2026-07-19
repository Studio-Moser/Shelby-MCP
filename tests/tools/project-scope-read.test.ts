import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { insertThought } from "../../src/db/thoughts.js";
import { storeEmbedding } from "../../src/db/vectors.js";
import { handleListThoughts } from "../../src/tools/list.js";
import { handleSearchThoughts } from "../../src/tools/search.js";
import { handleGetBrief } from "../../src/tools/brief.js";
import { handleSelectContext } from "../../src/tools/context.js";

const PROJECT_ID = "c51d5ec3-6e12-50d9-bd02-a43e170a71c6";
const OTHER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-07-18T00:00:00Z";

let db: ThoughtDatabase;

beforeEach(() => {
  db = new ThoughtDatabase(":memory:");
  db.db.prepare(`INSERT INTO projects
    (slug, project_id, current_slug, identity_state, display_name, member_repos, member_paths, provisional, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '[]', '[]', 0, ?, ?)`)
    .run("shelby-macos", PROJECT_ID, "current-slug", "active", "Current Project", NOW, NOW);
  db.db.prepare(`INSERT INTO projects
    (slug, project_id, current_slug, identity_state, display_name, member_repos, member_paths, provisional, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '[]', '[]', 0, ?, ?)`)
    .run(OTHER_ID, OTHER_ID, "other-project", "local_only", "Other Project", NOW, NOW);
  const alias = db.db.prepare(`INSERT INTO project_slug_aliases (slug, project_id, status, claimed_at, retired_at)
    VALUES (?, ?, ?, ?, ?)`);
  alias.run("current-slug", PROJECT_ID, "current", NOW, null);
  alias.run("retired-slug", PROJECT_ID, "retired", NOW, NOW);
  alias.run("other-project", OTHER_ID, "tentative", NOW, null);
});

afterEach(() => db.close());

function parse(result: { content: Array<{ text: string }> }): any {
  try {
    return JSON.parse(result.content[0]!.text);
  } catch (error) {
    throw new Error("Invalid tool result JSON", { cause: error });
  }
}

function seedThoughts(): { projectThought: string; otherThought: string } {
  const projectThought = insertThought(db.db, {
    content: "identity alpha decision",
    summary: "Identity alpha decision",
    type: "decision",
    project_id: PROJECT_ID,
    project_identifier: "retired-slug",
  });
  const otherThought = insertThought(db.db, {
    content: "identity alpha other",
    summary: "Identity alpha other",
    type: "decision",
    project_id: OTHER_ID,
    project_identifier: "other-project",
  });
  storeEmbedding(db.db, projectThought, [1, 0, 0]);
  storeEmbedding(db.db, otherThought, [1, 0, 0]);
  return { projectThought, otherThought };
}

function countingToolDatabase(): { toolDb: ThoughtDatabase; preparedSql: string[] } {
  const preparedSql: string[] = [];
  const database = new Proxy(db.db, {
    get(target, property) {
      if (property === "prepare") {
        return (sql: string) => {
          preparedSql.push(sql);
          return target.prepare(sql);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { toolDb: { db: database } as unknown as ThoughtDatabase, preparedSql };
}

const dataSql = /(?:FROM|JOIN|UPDATE|INSERT INTO)\s+thoughts(?:_fts)?\b/i;

describe("authoritative UUID read scope", () => {
  it("current and retired aliases return identical UUID rows and current-slug output", () => {
    const { projectThought, otherThought } = seedThoughts();
    for (const project_identifier of ["current-slug", "retired-slug"]) {
      const list = parse(handleListThoughts(db, { project_identifier, include_shared: false }));
      expect(list.results).toEqual([
        expect.objectContaining({ id: projectThought, project_id: PROJECT_ID, project_identifier: "current-slug" }),
      ]);

      const fts = parse(handleSearchThoughts(db, { query: "identity alpha", project_identifier, include_shared: false }));
      expect(fts.results).toEqual([
        expect.objectContaining({ id: projectThought, project_id: PROJECT_ID, project_identifier: "current-slug" }),
      ]);

      const hybrid = parse(handleSearchThoughts(db, {
        query: "identity alpha", embedding: [1, 0, 0], project_identifier, include_shared: false,
      }));
      expect(hybrid.results).toEqual([
        expect.objectContaining({ id: projectThought, project_id: PROJECT_ID, project_identifier: "current-slug" }),
      ]);
      expect(hybrid.results.map((item: { id: string }) => item.id)).not.toContain(otherThought);

      const brief = parse(handleGetBrief(db, { project_identifier, include_shared: false }));
      expect(brief).toMatchObject({ project_id: PROJECT_ID, project_identifier: "current-slug", thought_count: 1 });

      const context = parse(handleSelectContext(db, { project_identifier, include_shared: false }));
      expect(context).toMatchObject({ project_id: PROJECT_ID, project_identifier: "current-slug", matched_count: 1 });
      expect(context.document).toContain("Identity alpha decision");
      expect(context.document).not.toContain("Identity alpha other");
    }
  });

  it("hybrid all_projects always hydrates additive canonical identity", () => {
    const { projectThought } = seedThoughts();
    const result = parse(handleSearchThoughts(db, {
      query: "identity alpha", embedding: [1, 0, 0], all_projects: true,
    }));
    expect(result.results).toContainEqual(expect.objectContaining({
      id: projectThought,
      project_id: PROJECT_ID,
      project_identifier: "current-slug",
    }));
  });

  it("applies UUID scope before vector and hybrid ranking truncation", () => {
    for (let index = 0; index < 101; index++) {
      const id = insertThought(db.db, {
        content: `higher-scoring off-scope ${index}`,
        summary: `Higher-scoring off-scope ${index}`,
        project_id: OTHER_ID,
        project_identifier: "other-project",
      });
      storeEmbedding(db.db, id, [1, index / 1000, 0]);
    }
    const eligibleId = insertThought(db.db, {
      content: "eligible vector target",
      summary: "Eligible vector target",
      project_id: PROJECT_ID,
      project_identifier: "current-slug",
    });
    storeEmbedding(db.db, eligibleId, [1, 1, 0]);

    for (const args of [
      { embedding: [1, 0, 0] },
      { query: "lexically absent", embedding: [1, 0, 0] },
    ]) {
      const result = parse(handleSearchThoughts(db, {
        ...args,
        project_id: PROJECT_ID,
        include_shared: false,
      }));
      expect(result.results, result.mode).toEqual([
        expect.objectContaining({ id: eligibleId, project_id: PROJECT_ID }),
      ]);
      expect(result.total_count).toBe(1);
    }
  });

  it("invalid and conflicting references stop every public read before data SQL", () => {
    const handlers = [
      (toolDb: ThoughtDatabase, scope: Record<string, unknown>) => handleListThoughts(toolDb, scope),
      (toolDb: ThoughtDatabase, scope: Record<string, unknown>) => handleSearchThoughts(toolDb, { query: "identity", ...scope }),
      (toolDb: ThoughtDatabase, scope: Record<string, unknown>) => handleGetBrief(toolDb, scope),
      (toolDb: ThoughtDatabase, scope: Record<string, unknown>) => handleSelectContext(toolDb, scope),
    ];
    for (const scope of [
      { project_id: "bad" },
      { project_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { project_id: PROJECT_ID, project_identifier: "other-project" },
    ]) {
      for (const handler of handlers) {
        const { toolDb, preparedSql } = countingToolDatabase();
        const result = handler(toolDb, scope);
        expect(parse(result).error).toBe("project_scope_invalid");
        expect(preparedSql.some((sql) => dataSql.test(sql))).toBe(false);
      }
    }
  });
});
