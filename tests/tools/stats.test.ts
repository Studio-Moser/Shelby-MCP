import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { handleThoughtStats } from "../../src/tools/stats.js";
import { handleCaptureThought } from "../../src/tools/capture.js";
import { handleManageEdges } from "../../src/tools/graph.js";
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

describe("handleThoughtStats", () => {
  it("returns zero counts on empty database", () => {
    const result = handleThoughtStats(db);
    const data = parseResult(result);
    expect(data.thought_count).toBe(0);
    expect(data.edge_count).toBe(0);
    expect(data.by_type).toEqual({});
    expect(data.embedding_count).toBe(0);
  });

  it("returns correct counts after inserting thoughts and edges", () => {
    const a = captureId("A note", { type: "note", source: "claude", summary: "note A" });
    const b = captureId("A task", { type: "task", source: "cursor" });
    handleManageEdges(db, { action: "link", source_id: a, target_id: b, edge_type: "related" });

    const result = handleThoughtStats(db);
    const data = parseResult(result);
    expect(data.thought_count).toBe(2);
    expect(data.edge_count).toBe(1);
    expect(data.by_type.note).toBe(1);
    expect(data.by_type.task).toBe(1);
    expect(data.by_edge_type.related).toBe(1);
  });

  it("counts thoughts with embeddings correctly", () => {
    const id = captureId("Embedded thought");
    storeEmbedding(db.db, id, [1.0, 0.0]);

    const result = handleThoughtStats(db);
    const data = parseResult(result);
    expect(data.embedding_count).toBe(1);
  });
});
