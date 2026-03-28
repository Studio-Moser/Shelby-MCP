import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { handleSearchThoughts } from "../../src/tools/search.js";
import { handleCaptureThought } from "../../src/tools/capture.js";
import { storeEmbedding } from "../../src/db/vectors.js";

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

describe("handleSearchThoughts", () => {
  it("returns error when neither query nor embedding is provided", () => {
    const result = handleSearchThoughts(db, {});
    const r = result as any;
    expect(r.isError).toBe(true);
  });

  it("performs FTS search and finds matching thoughts", () => {
    captureId("The quick brown fox jumps over the lazy dog");
    captureId("A different thought about cats");

    const result = handleSearchThoughts(db, { query: "fox" });
    const data = parseResult(result);
    expect(data.mode).toBe("fts");
    expect(data.results.length).toBeGreaterThanOrEqual(1);
    expect(data.results[0].id).toBeDefined();
  });

  it("returns empty results for no FTS matches", () => {
    captureId("Hello world");

    const result = handleSearchThoughts(db, { query: "xyznonexistent" });
    const data = parseResult(result);
    expect(data.results).toEqual([]);
    expect(data.total_count).toBe(0);
  });

  it("performs vector search when embedding is provided", () => {
    const id = captureId("Vector test thought");
    storeEmbedding(db.db, id, [1.0, 0.0, 0.0]);

    const result = handleSearchThoughts(db, { embedding: [1.0, 0.0, 0.0] });
    const data = parseResult(result);
    expect(data.mode).toBe("vector");
    expect(data.results.length).toBe(1);
    expect(data.results[0].similarity).toBeCloseTo(1.0);
  });

  it("performs hybrid search when both query and embedding provided", () => {
    const id = captureId("Machine learning algorithms");
    storeEmbedding(db.db, id, [0.5, 0.5, 0.0]);

    const result = handleSearchThoughts(db, {
      query: "machine",
      embedding: [0.5, 0.5, 0.0],
    });
    const data = parseResult(result);
    expect(data.mode).toBe("hybrid");
    expect(data.results.length).toBeGreaterThanOrEqual(1);
  });

  it("respects limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      captureId(`Testing search limit thought number ${i}`);
    }

    const result = handleSearchThoughts(db, { query: "testing search limit", limit: 2 });
    const data = parseResult(result);
    expect(data.results.length).toBeLessThanOrEqual(2);
  });
});
