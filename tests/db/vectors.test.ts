import { describe, it, expect, beforeEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import {
  storeEmbedding,
  getEmbedding,
  searchByEmbedding,
  cosineSimilarity,
  embeddingToBuffer,
  bufferToEmbedding,
} from "../../src/db/vectors.js";

function insertThought(
  db: ThoughtDatabase,
  id: string,
  content: string,
  opts: {
    summary?: string;
    type?: string;
    topics?: string;
  } = {},
) {
  const now = new Date().toISOString();
  db.db
    .prepare(
      `INSERT INTO thoughts (id, content, summary, type, source, project, topics, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'test', NULL, ?, 'personal', ?, ?)`,
    )
    .run(
      id,
      content,
      opts.summary ?? null,
      opts.type ?? "note",
      opts.topics ?? "[]",
      now,
      now,
    );
}

describe("cosineSimilarity", () => {
  it("identical vectors = 1", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("orthogonal vectors = 0", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  it("opposite vectors = -1", () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1);
  });
});

describe("embeddingToBuffer / bufferToEmbedding", () => {
  it("roundtrips correctly", () => {
    const embedding = [0.1, 0.5, -0.3, 1.0, 0.0];
    const buf = embeddingToBuffer(embedding);
    const restored = bufferToEmbedding(buf);
    expect(restored).toHaveLength(embedding.length);
    for (let i = 0; i < embedding.length; i++) {
      expect(restored[i]).toBeCloseTo(embedding[i], 5);
    }
  });
});

describe("storeEmbedding / getEmbedding", () => {
  let tdb: ThoughtDatabase;

  beforeEach(() => {
    tdb = new ThoughtDatabase(":memory:");
  });

  it("stores and retrieves embedding", () => {
    insertThought(tdb, "t1", "Test thought");
    const embedding = [1, 0, 0];

    const stored = storeEmbedding(tdb.db, "t1", embedding);
    expect(stored).toBe(true);

    const retrieved = getEmbedding(tdb.db, "t1");
    expect(retrieved).not.toBeNull();
    expect(retrieved).toHaveLength(3);
    expect(retrieved![0]).toBeCloseTo(1);
    expect(retrieved![1]).toBeCloseTo(0);
    expect(retrieved![2]).toBeCloseTo(0);
  });

  it("returns false for non-existent thought", () => {
    const result = storeEmbedding(tdb.db, "nonexistent", [1, 0, 0]);
    expect(result).toBe(false);
  });

  it("returns null for thought without embedding", () => {
    insertThought(tdb, "t1", "Test thought");
    const result = getEmbedding(tdb.db, "t1");
    expect(result).toBeNull();
  });
});

describe("searchByEmbedding", () => {
  let tdb: ThoughtDatabase;

  beforeEach(() => {
    tdb = new ThoughtDatabase(":memory:");

    insertThought(tdb, "t1", "First thought", {
      summary: "First",
      topics: '["a"]',
    });
    insertThought(tdb, "t2", "Second thought", {
      summary: "Second",
      topics: '["b"]',
    });
    insertThought(tdb, "t3", "Third thought", {
      summary: "Third",
      topics: '["a","b"]',
    });

    storeEmbedding(tdb.db, "t1", [1, 0, 0]);
    storeEmbedding(tdb.db, "t2", [0, 1, 0]);
    storeEmbedding(tdb.db, "t3", [0.7, 0.7, 0]); // somewhat similar to t1
  });

  it("returns similar thoughts", () => {
    const results = searchByEmbedding(tdb.db, [1, 0, 0]);
    expect(results.length).toBeGreaterThanOrEqual(2);
    // t1 should be most similar (identical)
    expect(results[0].id).toBe("t1");
    expect(results[0].similarity).toBeCloseTo(1);
    // t3 should be second most similar
    expect(results[1].id).toBe("t3");
    expect(results[1].similarity).toBeGreaterThan(0.5);
  });

  it("respects threshold", () => {
    const results = searchByEmbedding(tdb.db, [1, 0, 0], 20, 0.95);
    // Only t1 (similarity=1) should pass a 0.95 threshold
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("t1");
  });

  it("respects limit", () => {
    const results = searchByEmbedding(tdb.db, [1, 0, 0], 1);
    expect(results).toHaveLength(1);
  });

  it("parses topics as array", () => {
    const results = searchByEmbedding(tdb.db, [1, 0, 0]);
    const t3 = results.find((r) => r.id === "t3");
    expect(t3?.topics).toEqual(["a", "b"]);
  });
});
