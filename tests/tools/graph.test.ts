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

describe("handleManageEdges — expire", () => {
  it("expires an edge", () => {
    const a = captureId("Thought A");
    const b = captureId("Thought B");
    const linkResult = handleManageEdges(db, {
      action: "link",
      source_id: a,
      target_id: b,
      edge_type: "related",
    });
    const edgeId = parseResult(linkResult).edge_id;
    const result = handleManageEdges(db, {
      action: "expire",
      edge_id: edgeId,
    });
    const data = parseResult(result);
    expect(data.action).toBe("expired");
    expect(data.edge_id).toBe(edgeId);
  });

  it("returns error for non-existent edge_id", () => {
    const result = handleManageEdges(db, {
      action: "expire",
      edge_id: "nonexistent",
    });
    const r = result as any;
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0].text);
    expect(data.error).toBe("not_found");
  });

  it("returns error when edge_id is missing", () => {
    const result = handleManageEdges(db, {
      action: "expire",
    });
    const r = result as any;
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0].text);
    expect(data.error).toBe("invalid_input");
  });

  it("links with valid_from and valid_until", () => {
    const a = captureId("A");
    const b = captureId("B");
    const result = handleManageEdges(db, {
      action: "link",
      source_id: a,
      target_id: b,
      edge_type: "related",
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_until: "2026-12-31T23:59:59.000Z",
    });
    const data = parseResult(result);
    expect(data.action).toBe("linked");
  });
});

describe("handleExploreGraph — include_expired", () => {
  it("excludes expired edges by default", () => {
    const a = captureId("Root");
    const b = captureId("Active child");
    const c = captureId("Expired child");
    handleManageEdges(db, { action: "link", source_id: a, target_id: b, edge_type: "related" });
    handleManageEdges(db, {
      action: "link",
      source_id: a,
      target_id: c,
      edge_type: "follows",
      valid_until: "2020-01-01T00:00:00.000Z",
    });
    const result = handleExploreGraph(db, { thought_id: a, max_depth: 1 });
    const data = parseResult(result);
    expect(data.node_count).toBe(2);
  });

  it("includes expired edges when include_expired is true", () => {
    const a = captureId("Root");
    const b = captureId("Active child");
    const c = captureId("Expired child");
    handleManageEdges(db, { action: "link", source_id: a, target_id: b, edge_type: "related" });
    handleManageEdges(db, {
      action: "link",
      source_id: a,
      target_id: c,
      edge_type: "follows",
      valid_until: "2020-01-01T00:00:00.000Z",
    });
    const result = handleExploreGraph(db, { thought_id: a, max_depth: 1, include_expired: true });
    const data = parseResult(result);
    expect(data.node_count).toBe(3);
  });
});
