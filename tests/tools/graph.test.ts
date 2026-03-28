import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { handleManageEdges, handleExploreGraph } from "../../src/tools/graph.js";
import { handleCaptureThought } from "../../src/tools/capture.js";
import { getEdgesBetween } from "../../src/db/edges.js";

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

function captureId(content: string): string {
  const result = handleCaptureThought(db, { content });
  return parseResult(result).id;
}

describe("handleManageEdges", () => {
  it("links two thoughts", () => {
    const a = captureId("Thought A");
    const b = captureId("Thought B");

    const result = handleManageEdges(db, {
      action: "link",
      source_id: a,
      target_id: b,
      edge_type: "cites",
    });
    const data = parseResult(result);
    expect(data.action).toBe("linked");
    expect(data.edge_id).toBeDefined();

    const edges = getEdgesBetween(db, a, b);
    expect(edges.length).toBe(1);
  });

  it("unlinks two thoughts", () => {
    const a = captureId("A");
    const b = captureId("B");

    handleManageEdges(db, { action: "link", source_id: a, target_id: b, edge_type: "related" });
    const result = handleManageEdges(db, { action: "unlink", source_id: a, target_id: b, edge_type: "related" });
    const data = parseResult(result);
    expect(data.action).toBe("unlinked");

    const edges = getEdgesBetween(db, a, b);
    expect(edges.length).toBe(0);
  });

  it("returns error for invalid action", () => {
    const result = handleManageEdges(db, { action: "destroy" });
    const r = result as any;
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0].text);
    expect(data.error).toBe("invalid_input");
  });

  it("returns error when linking non-existent thought", () => {
    const a = captureId("A");
    const result = handleManageEdges(db, {
      action: "link",
      source_id: a,
      target_id: "nonexistent",
      edge_type: "related",
    });
    const r = result as any;
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0].text);
    expect(data.error).toBe("not_found");
  });
});

describe("handleExploreGraph", () => {
  it("explores a graph from a starting thought", () => {
    const a = captureId("Root");
    const b = captureId("Child");
    handleManageEdges(db, { action: "link", source_id: a, target_id: b, edge_type: "follows" });

    const result = handleExploreGraph(db, { thought_id: a, max_depth: 1 });
    const data = parseResult(result);
    expect(data.root).toBe(a);
    expect(data.node_count).toBe(2);
    expect(data.nodes.length).toBe(2);
  });

  it("returns error for non-existent thought", () => {
    const result = handleExploreGraph(db, { thought_id: "nope" });
    const r = result as any;
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0].text);
    expect(data.error).toBe("not_found");
  });

  it("filters by edge_types", () => {
    const a = captureId("Root");
    const b = captureId("Cited");
    const c = captureId("Related");
    handleManageEdges(db, { action: "link", source_id: a, target_id: b, edge_type: "cites" });
    handleManageEdges(db, { action: "link", source_id: a, target_id: c, edge_type: "related" });

    const result = handleExploreGraph(db, {
      thought_id: a,
      max_depth: 1,
      edge_types: ["cites"],
    });
    const data = parseResult(result);
    // Should only find root + cited, not related
    expect(data.node_count).toBe(2);
  });
});
