import { describe, it, expect, beforeEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { searchThoughts, sanitizeFTSQuery } from "../../src/db/fts.js";

function insertThought(
  db: ThoughtDatabase,
  id: string,
  content: string,
  opts: {
    summary?: string;
    type?: string;
    project?: string;
    topics?: string;
  } = {},
) {
  const now = new Date().toISOString();
  db.db
    .prepare(
      `INSERT INTO thoughts (id, content, summary, type, source, project, topics, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'test', ?, ?, 'personal', ?, ?)`,
    )
    .run(
      id,
      content,
      opts.summary ?? null,
      opts.type ?? "note",
      opts.project ?? null,
      opts.topics ?? "[]",
      now,
      now,
    );
}

describe("sanitizeFTSQuery", () => {
  it("removes special characters", () => {
    const result = sanitizeFTSQuery('hello "world" (test)');
    expect(result).toBe('"hello"* "world"* "test"*');
  });

  it("strips FTS keywords", () => {
    const result = sanitizeFTSQuery("cats AND dogs NOT fish");
    expect(result).toBe('"cats"* "dogs"* "fish"*');
  });

  it("handles empty input", () => {
    expect(sanitizeFTSQuery("")).toBe("");
    expect(sanitizeFTSQuery("   ")).toBe("");
    expect(sanitizeFTSQuery('"*()+')).toBe("");
  });
});

describe("searchThoughts", () => {
  let tdb: ThoughtDatabase;

  beforeEach(() => {
    tdb = new ThoughtDatabase(":memory:");
  });

  it("finds matching thought", () => {
    insertThought(tdb, "t1", "CloudKit sync architecture decision", {
      summary: "Chose CloudKit for sync",
      type: "decision",
      project: "shelby",
      topics: '["sync","cloud"]',
    });

    const result = searchThoughts(tdb.db, { query: "CloudKit" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe("t1");
  });

  it("returns summaries not content", () => {
    insertThought(tdb, "t1", "Very long content about CloudKit sync", {
      summary: "Short summary",
    });

    const result = searchThoughts(tdb.db, { query: "CloudKit" });
    expect(result.results[0].summary).toBe("Short summary");
    // No content field exposed
    expect((result.results[0] as Record<string, unknown>).content).toBeUndefined();
  });

  it("ranks results by relevance", () => {
    insertThought(tdb, "t1", "CloudKit sync architecture", {
      summary: "CloudKit arch",
    });
    insertThought(tdb, "t2", "CloudKit CloudKit CloudKit performance tuning", {
      summary: "CloudKit perf",
    });
    insertThought(tdb, "t3", "Database design patterns", {
      summary: "DB patterns",
    });

    const result = searchThoughts(tdb.db, { query: "CloudKit" });
    expect(result.results.length).toBeGreaterThanOrEqual(2);
    // All returned results should have positive rank
    for (const r of result.results) {
      expect(r.rank).toBeGreaterThan(0);
    }
  });

  it("returns empty for no matches", () => {
    insertThought(tdb, "t1", "CloudKit sync architecture");

    const result = searchThoughts(tdb.db, { query: "zebra" });
    expect(result.results).toHaveLength(0);
    expect(result.total_count).toBe(0);
    expect(result.has_more).toBe(false);
  });

  it("sanitizes special characters in query", () => {
    insertThought(tdb, "t1", "Testing special characters");

    const result = searchThoughts(tdb.db, { query: '"Testing" (special)*' });
    expect(result.results).toHaveLength(1);
  });

  it("handles empty query", () => {
    insertThought(tdb, "t1", "Some content");

    const result = searchThoughts(tdb.db, { query: "" });
    expect(result.results).toHaveLength(0);
    expect(result.total_count).toBe(0);
  });

  it("respects limit", () => {
    for (let i = 0; i < 5; i++) {
      insertThought(tdb, `t${i}`, `CloudKit feature number ${i}`);
    }

    const result = searchThoughts(tdb.db, { query: "CloudKit", limit: 2 });
    expect(result.results).toHaveLength(2);
    expect(result.total_count).toBe(5);
    expect(result.has_more).toBe(true);
  });

  it("respects offset", () => {
    for (let i = 0; i < 5; i++) {
      insertThought(tdb, `t${i}`, `CloudKit feature number ${i}`);
    }

    const result = searchThoughts(tdb.db, {
      query: "CloudKit",
      limit: 2,
      offset: 3,
    });
    expect(result.results).toHaveLength(2);
    expect(result.offset).toBe(3);
    expect(result.has_more).toBe(false);
  });

  it("filters by type", () => {
    insertThought(tdb, "t1", "CloudKit sync decision", { type: "decision" });
    insertThought(tdb, "t2", "CloudKit sync note", { type: "note" });

    const result = searchThoughts(tdb.db, {
      query: "CloudKit",
      type: "decision",
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe("t1");
  });

  it("filters by project", () => {
    insertThought(tdb, "t1", "CloudKit sync for shelby", {
      project: "shelby",
    });
    insertThought(tdb, "t2", "CloudKit sync for other", {
      project: "other",
    });

    const result = searchThoughts(tdb.db, {
      query: "CloudKit",
      project: "shelby",
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe("t1");
  });

  it("parses topics as array", () => {
    insertThought(tdb, "t1", "CloudKit topics test", {
      topics: '["sync","cloud"]',
    });

    const result = searchThoughts(tdb.db, { query: "CloudKit" });
    expect(result.results[0].topics).toEqual(["sync", "cloud"]);
  });
});
