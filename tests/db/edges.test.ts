import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import {
  linkThoughts,
  unlinkThoughts,
  getEdge,
  getEdgesBetween,
  getConnections,
  traverseGraph,
  expireEdge,
} from "../../src/db/edges.js";

// Helper to insert a test thought directly
function insertThought(
  db: ThoughtDatabase,
  id: string,
  content: string,
  summary?: string
): void {
  const now = new Date().toISOString();
  db.db
    .prepare(
      `INSERT INTO thoughts (id, content, summary, type, source, visibility, created_at, updated_at)
       VALUES (?, ?, ?, 'note', 'test', 'personal', ?, ?)`
    )
    .run(id, content, summary ?? null, now, now);
}

describe("Edge operations", () => {
  let db: ThoughtDatabase;

  beforeEach(() => {
    db = new ThoughtDatabase(":memory:");
  });

  afterEach(() => {
    db?.close();
  });

  // --- linkThoughts ---

  describe("linkThoughts", () => {
    it("links two thoughts with default type", () => {
      insertThought(db, "t1", "Thought 1");
      insertThought(db, "t2", "Thought 2");

      const edgeId = linkThoughts(db, {
        source_id: "t1",
        target_id: "t2",
        edge_type: "related",
      });

      expect(edgeId).toBeDefined();
      expect(typeof edgeId).toBe("string");
      expect(edgeId.length).toBeGreaterThan(0);

      const edge = getEdge(db, edgeId);
      expect(edge).not.toBeNull();
      expect(edge!.source_id).toBe("t1");
      expect(edge!.target_id).toBe("t2");
      expect(edge!.edge_type).toBe("related");
    });

    it("links with a specific edge type", () => {
      insertThought(db, "t1", "Thought 1");
      insertThought(db, "t2", "Thought 2");

      const edgeId = linkThoughts(db, {
        source_id: "t1",
        target_id: "t2",
        edge_type: "refines",
      });

      const edge = getEdge(db, edgeId);
      expect(edge!.edge_type).toBe("refines");
    });

    it("links with metadata", () => {
      insertThought(db, "t1", "Thought 1");
      insertThought(db, "t2", "Thought 2");

      const edgeId = linkThoughts(db, {
        source_id: "t1",
        target_id: "t2",
        edge_type: "cites",
        metadata: { confidence: 0.9, reason: "direct reference" },
      });

      const edge = getEdge(db, edgeId);
      expect(edge!.metadata).toEqual({
        confidence: 0.9,
        reason: "direct reference",
      });
    });

    it("throws on duplicate edge", () => {
      insertThought(db, "t1", "Thought 1");
      insertThought(db, "t2", "Thought 2");

      linkThoughts(db, {
        source_id: "t1",
        target_id: "t2",
        edge_type: "related",
      });

      expect(() =>
        linkThoughts(db, {
          source_id: "t1",
          target_id: "t2",
          edge_type: "related",
        })
      ).toThrow(/Edge already exists/);
    });

    it("allows same thoughts with different edge types", () => {
      insertThought(db, "t1", "Thought 1");
      insertThought(db, "t2", "Thought 2");

      const id1 = linkThoughts(db, {
        source_id: "t1",
        target_id: "t2",
        edge_type: "related",
      });
      const id2 = linkThoughts(db, {
        source_id: "t1",
        target_id: "t2",
        edge_type: "refines",
      });

      expect(id1).not.toBe(id2);
    });

    it("throws when source thought does not exist", () => {
      insertThought(db, "t2", "Thought 2");

      expect(() =>
        linkThoughts(db, {
          source_id: "nonexistent",
          target_id: "t2",
          edge_type: "related",
        })
      ).toThrow(/Source thought "nonexistent" does not exist/);
    });

    it("throws when target thought does not exist", () => {
      insertThought(db, "t1", "Thought 1");

      expect(() =>
        linkThoughts(db, {
          source_id: "t1",
          target_id: "nonexistent",
          edge_type: "related",
        })
      ).toThrow(/Target thought "nonexistent" does not exist/);
    });

    it("throws on invalid edge type", () => {
      insertThought(db, "t1", "Thought 1");
      insertThought(db, "t2", "Thought 2");

      expect(() =>
        linkThoughts(db, {
          source_id: "t1",
          target_id: "t2",
          edge_type: "invalid_type",
        })
      ).toThrow(/Invalid edge type/);
    });

    it("stores created_at as ISO 8601", () => {
      insertThought(db, "t1", "Thought 1");
      insertThought(db, "t2", "Thought 2");

      const edgeId = linkThoughts(db, {
        source_id: "t1",
        target_id: "t2",
        edge_type: "related",
      });

      const edge = getEdge(db, edgeId);
      // ISO 8601 check: parseable and not NaN
      expect(new Date(edge!.created_at).toISOString()).toBe(edge!.created_at);
    });
  });

  // --- unlinkThoughts ---

  describe("unlinkThoughts", () => {
    it("removes an existing edge and returns true", () => {
      insertThought(db, "t1", "Thought 1");
      insertThought(db, "t2", "Thought 2");

      const edgeId = linkThoughts(db, {
        source_id: "t1",
        target_id: "t2",
        edge_type: "related",
      });

      const removed = unlinkThoughts(db, "t1", "t2", "related");
      expect(removed).toBe(true);

      // Edge should no longer exist
      expect(getEdge(db, edgeId)).toBeNull();
    });

    it("returns false when edge does not exist", () => {
      const removed = unlinkThoughts(db, "t1", "t2", "related");
      expect(removed).toBe(false);
    });
  });

  // --- getEdge ---

  describe("getEdge", () => {
    it("returns null for non-existent edge", () => {
      expect(getEdge(db, "nonexistent-id")).toBeNull();
    });
  });

  // --- getEdgesBetween ---

  describe("getEdgesBetween", () => {
    it("returns all edges between two thoughts", () => {
      insertThought(db, "t1", "Thought 1");
      insertThought(db, "t2", "Thought 2");

      linkThoughts(db, { source_id: "t1", target_id: "t2", edge_type: "related" });
      linkThoughts(db, { source_id: "t1", target_id: "t2", edge_type: "refines" });

      const edges = getEdgesBetween(db, "t1", "t2");
      expect(edges).toHaveLength(2);
      expect(edges.map((e) => e.edge_type).sort()).toEqual(["refines", "related"]);
    });

    it("returns empty array when no edges exist", () => {
      const edges = getEdgesBetween(db, "t1", "t2");
      expect(edges).toEqual([]);
    });
  });

  // --- getConnections ---

  describe("getConnections", () => {
    it("returns both outgoing and incoming connections", () => {
      insertThought(db, "t1", "Thought 1", "Summary 1");
      insertThought(db, "t2", "Thought 2", "Summary 2");
      insertThought(db, "t3", "Thought 3", "Summary 3");

      linkThoughts(db, { source_id: "t1", target_id: "t2", edge_type: "related" });
      linkThoughts(db, { source_id: "t3", target_id: "t1", edge_type: "cites" });

      const connections = getConnections(db, "t1");
      expect(connections).toHaveLength(2);

      const outgoing = connections.find((c) => c.direction === "outgoing");
      expect(outgoing).toBeDefined();
      expect(outgoing!.thought_id).toBe("t2");
      expect(outgoing!.summary).toBe("Summary 2");
      expect(outgoing!.edge_type).toBe("related");

      const incoming = connections.find((c) => c.direction === "incoming");
      expect(incoming).toBeDefined();
      expect(incoming!.thought_id).toBe("t3");
      expect(incoming!.summary).toBe("Summary 3");
      expect(incoming!.edge_type).toBe("cites");
    });

    it("filters by edge type", () => {
      insertThought(db, "t1", "Thought 1");
      insertThought(db, "t2", "Thought 2");
      insertThought(db, "t3", "Thought 3");

      linkThoughts(db, { source_id: "t1", target_id: "t2", edge_type: "related" });
      linkThoughts(db, { source_id: "t1", target_id: "t3", edge_type: "cites" });

      const related = getConnections(db, "t1", ["related"]);
      expect(related).toHaveLength(1);
      expect(related[0].thought_id).toBe("t2");
      expect(related[0].edge_type).toBe("related");
    });

    it("returns empty array for thought with no connections", () => {
      insertThought(db, "t1", "Thought 1");
      expect(getConnections(db, "t1")).toEqual([]);
    });
  });

  // --- traverseGraph ---

  describe("traverseGraph", () => {
    it("returns empty array for non-existent thought", () => {
      expect(traverseGraph(db, "nonexistent", 2)).toEqual([]);
    });

    it("returns just the root node at depth 0", () => {
      insertThought(db, "t1", "Thought 1", "Summary 1");
      insertThought(db, "t2", "Thought 2");
      linkThoughts(db, { source_id: "t1", target_id: "t2", edge_type: "related" });

      const nodes = traverseGraph(db, "t1", 0);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].id).toBe("t1");
      expect(nodes[0].depth).toBe(0);
      // At depth 0, edges are not explored, so the node has no edges recorded
      expect(nodes[0].edges).toHaveLength(0);
    });

    it("depth 1 matches direct connections", () => {
      insertThought(db, "t1", "Thought 1", "S1");
      insertThought(db, "t2", "Thought 2", "S2");
      insertThought(db, "t3", "Thought 3", "S3");

      linkThoughts(db, { source_id: "t1", target_id: "t2", edge_type: "related" });
      linkThoughts(db, { source_id: "t3", target_id: "t1", edge_type: "cites" });

      const nodes = traverseGraph(db, "t1", 1);
      expect(nodes).toHaveLength(3);

      const root = nodes.find((n) => n.id === "t1");
      expect(root!.depth).toBe(0);
      expect(root!.edges).toHaveLength(2);

      const t2Node = nodes.find((n) => n.id === "t2");
      expect(t2Node!.depth).toBe(1);

      const t3Node = nodes.find((n) => n.id === "t3");
      expect(t3Node!.depth).toBe(1);
    });

    it("depth 2 finds indirect connections", () => {
      insertThought(db, "t1", "Thought 1");
      insertThought(db, "t2", "Thought 2");
      insertThought(db, "t3", "Thought 3");

      // t1 -> t2 -> t3 (chain)
      linkThoughts(db, { source_id: "t1", target_id: "t2", edge_type: "related" });
      linkThoughts(db, { source_id: "t2", target_id: "t3", edge_type: "follows" });

      // Depth 1 should only find t2
      const shallow = traverseGraph(db, "t1", 1);
      expect(shallow).toHaveLength(2);
      expect(shallow.map((n) => n.id).sort()).toEqual(["t1", "t2"]);

      // Depth 2 should find t3
      const deep = traverseGraph(db, "t1", 2);
      expect(deep).toHaveLength(3);
      expect(deep.map((n) => n.id).sort()).toEqual(["t1", "t2", "t3"]);

      const t3 = deep.find((n) => n.id === "t3");
      expect(t3!.depth).toBe(2);
    });

    it("respects max depth cap of 5", () => {
      // Create a chain of 7 thoughts
      for (let i = 1; i <= 7; i++) {
        insertThought(db, `t${i}`, `Thought ${i}`);
      }
      for (let i = 1; i < 7; i++) {
        linkThoughts(db, {
          source_id: `t${i}`,
          target_id: `t${i + 1}`,
          edge_type: "follows",
        });
      }

      // Request depth 10, should be capped at 5
      const nodes = traverseGraph(db, "t1", 10);
      const maxDepth = Math.max(...nodes.map((n) => n.depth));
      expect(maxDepth).toBeLessThanOrEqual(5);
      // Should find t1 through t6 (depth 0-5), not t7
      expect(nodes).toHaveLength(6);
    });

    it("handles cycles without infinite loop", () => {
      insertThought(db, "t1", "Thought 1");
      insertThought(db, "t2", "Thought 2");
      insertThought(db, "t3", "Thought 3");

      // Create a cycle: t1 -> t2 -> t3 -> t1
      linkThoughts(db, { source_id: "t1", target_id: "t2", edge_type: "related" });
      linkThoughts(db, { source_id: "t2", target_id: "t3", edge_type: "related" });
      linkThoughts(db, { source_id: "t3", target_id: "t1", edge_type: "related" });

      const nodes = traverseGraph(db, "t1", 5);

      // Should visit each node exactly once
      expect(nodes).toHaveLength(3);
      const ids = nodes.map((n) => n.id).sort();
      expect(ids).toEqual(["t1", "t2", "t3"]);
    });

    it("filters by edge type", () => {
      insertThought(db, "t1", "Thought 1");
      insertThought(db, "t2", "Thought 2");
      insertThought(db, "t3", "Thought 3");

      linkThoughts(db, { source_id: "t1", target_id: "t2", edge_type: "related" });
      linkThoughts(db, { source_id: "t1", target_id: "t3", edge_type: "cites" });

      // Only follow "related" edges
      const nodes = traverseGraph(db, "t1", 1, ["related"]);
      expect(nodes).toHaveLength(2);
      expect(nodes.map((n) => n.id).sort()).toEqual(["t1", "t2"]);
    });

    it("includes edge details on nodes", () => {
      insertThought(db, "t1", "Thought 1");
      insertThought(db, "t2", "Thought 2");

      linkThoughts(db, { source_id: "t1", target_id: "t2", edge_type: "refines" });

      const nodes = traverseGraph(db, "t1", 1);
      const root = nodes.find((n) => n.id === "t1")!;

      expect(root.edges).toHaveLength(1);
      expect(root.edges[0].edge_type).toBe("refines");
      expect(root.edges[0].connected_to).toBe("t2");
      expect(root.edges[0].direction).toBe("outgoing");
    });
  });

  describe("temporal edges", () => {
    it("linkThoughts stores valid_from and valid_until", () => {
      insertThought(db, "t1", "Thought 1");
      insertThought(db, "t2", "Thought 2");
      const edgeId = linkThoughts(db, {
        source_id: "t1",
        target_id: "t2",
        edge_type: "related",
        valid_from: "2026-01-01T00:00:00.000Z",
        valid_until: "2026-12-31T23:59:59.000Z",
      });
      const edge = getEdge(db, edgeId);
      expect(edge!.valid_from).toBe("2026-01-01T00:00:00.000Z");
      expect(edge!.valid_until).toBe("2026-12-31T23:59:59.000Z");
    });

    it("linkThoughts defaults valid_from and valid_until to null", () => {
      insertThought(db, "t1", "Thought 1");
      insertThought(db, "t2", "Thought 2");
      const edgeId = linkThoughts(db, {
        source_id: "t1",
        target_id: "t2",
        edge_type: "related",
      });
      const edge = getEdge(db, edgeId);
      expect(edge!.valid_from).toBeNull();
      expect(edge!.valid_until).toBeNull();
    });

    it("expireEdge sets valid_until", () => {
      insertThought(db, "t1", "Thought 1");
      insertThought(db, "t2", "Thought 2");
      const edgeId = linkThoughts(db, {
        source_id: "t1",
        target_id: "t2",
        edge_type: "related",
      });
      expireEdge(db, edgeId, "2026-06-01T00:00:00.000Z");
      const edge = getEdge(db, edgeId);
      expect(edge!.valid_until).toBe("2026-06-01T00:00:00.000Z");
    });

    it("expireEdge defaults to now when no timestamp given", () => {
      insertThought(db, "t1", "Thought 1");
      insertThought(db, "t2", "Thought 2");
      const edgeId = linkThoughts(db, {
        source_id: "t1",
        target_id: "t2",
        edge_type: "related",
      });
      const before = new Date().toISOString();
      expireEdge(db, edgeId);
      const after = new Date().toISOString();
      const edge = getEdge(db, edgeId);
      expect(edge!.valid_until).not.toBeNull();
      expect(edge!.valid_until! >= before).toBe(true);
      expect(edge!.valid_until! <= after).toBe(true);
    });

    it("expireEdge throws for non-existent edge", () => {
      expect(() => expireEdge(db, "nonexistent")).toThrow(/does not exist/);
    });

    it("getConnections excludes expired edges by default", () => {
      insertThought(db, "t1", "Thought 1", "S1");
      insertThought(db, "t2", "Thought 2", "S2");
      insertThought(db, "t3", "Thought 3", "S3");
      linkThoughts(db, { source_id: "t1", target_id: "t2", edge_type: "related" });
      linkThoughts(db, {
        source_id: "t1",
        target_id: "t3",
        edge_type: "cites",
        valid_until: "2020-01-01T00:00:00.000Z",
      });
      const connections = getConnections(db, "t1");
      expect(connections).toHaveLength(1);
      expect(connections[0].thought_id).toBe("t2");
    });

    it("traverseGraph excludes expired edges by default", () => {
      insertThought(db, "t1", "Thought 1", "S1");
      insertThought(db, "t2", "Thought 2", "S2");
      insertThought(db, "t3", "Thought 3", "S3");
      linkThoughts(db, { source_id: "t1", target_id: "t2", edge_type: "related" });
      linkThoughts(db, {
        source_id: "t1",
        target_id: "t3",
        edge_type: "follows",
        valid_until: "2020-01-01T00:00:00.000Z",
      });
      const nodes = traverseGraph(db, "t1", 1);
      expect(nodes).toHaveLength(2);
      expect(nodes.map((n) => n.id).sort()).toEqual(["t1", "t2"]);
    });

    it("traverseGraph with include_expired=true returns all edges", () => {
      insertThought(db, "t1", "Thought 1", "S1");
      insertThought(db, "t2", "Thought 2", "S2");
      insertThought(db, "t3", "Thought 3", "S3");
      linkThoughts(db, { source_id: "t1", target_id: "t2", edge_type: "related" });
      linkThoughts(db, {
        source_id: "t1",
        target_id: "t3",
        edge_type: "follows",
        valid_until: "2020-01-01T00:00:00.000Z",
      });
      const nodes = traverseGraph(db, "t1", 1, undefined, true);
      expect(nodes).toHaveLength(3);
      expect(nodes.map((n) => n.id).sort()).toEqual(["t1", "t2", "t3"]);
    });
  });
});
