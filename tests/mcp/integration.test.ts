import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import type { ThoughtDatabase } from "../../src/db/database.js";

/** Parse the JSON text from an MCP tool result. */
function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

describe("MCP Integration", () => {
  let client: Client;
  let db: ThoughtDatabase;

  beforeEach(async () => {
    const created = createServer({ dbPath: ":memory:", verbose: false, logFile: null });
    db = created.db;
    const server = created.server;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
  });

  afterEach(() => {
    db?.close();
  });

  // ---- 1. Lists all 11 tools ----
  // (9 original memory tools + get_brief + select_context ported from the Mac app)
  it("lists all 11 tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "capture_thought",
      "delete_thought",
      "explore_graph",
      "get_brief",
      "get_thought",
      "list_thoughts",
      "manage_edges",
      "search_thoughts",
      "select_context",
      "thought_stats",
      "update_thought",
    ]);
    expect(tools).toHaveLength(11);
  });

  // ---- 2. Capture and retrieve ----
  it("captures a thought and retrieves it by ID", async () => {
    const captureResult = await client.callTool({
      name: "capture_thought",
      arguments: {
        content: "Integration test thought",
        summary: "Test summary",
        type: "note",
      },
    });
    const captured = parseResult(captureResult) as { id: string };
    expect(captured.id).toBeDefined();

    const getResult = await client.callTool({
      name: "get_thought",
      arguments: { id: captured.id },
    });
    const retrieved = parseResult(getResult) as { id: string; content: string; summary: string };
    expect(retrieved.id).toBe(captured.id);
    expect(retrieved.content).toBe("Integration test thought");
    expect(retrieved.summary).toBe("Test summary");
  });

  // ---- 3. Search finds captured thought ----
  it("search finds a captured thought by keyword", async () => {
    const captureResult = await client.callTool({
      name: "capture_thought",
      arguments: {
        content: "Quantum entanglement is a fascinating phenomenon",
        summary: "Quantum physics note",
        type: "note",
      },
    });
    const captured = parseResult(captureResult) as { id: string };

    const searchResult = await client.callTool({
      name: "search_thoughts",
      arguments: { query: "quantum entanglement" },
    });
    const searched = parseResult(searchResult) as { results: Array<{ id: string }> };
    const ids = searched.results.map((r) => r.id);
    expect(ids).toContain(captured.id);
  });

  // ---- 4. List with filters ----
  it("lists thoughts filtered by type", async () => {
    await client.callTool({
      name: "capture_thought",
      arguments: { content: "A decision was made", type: "decision" },
    });
    await client.callTool({
      name: "capture_thought",
      arguments: { content: "A task to do", type: "task" },
    });
    await client.callTool({
      name: "capture_thought",
      arguments: { content: "Another task", type: "task" },
    });

    const listResult = await client.callTool({
      name: "list_thoughts",
      arguments: { type: "task" },
    });
    const listed = parseResult(listResult) as { results: Array<{ type: string }> };
    expect(listed.results).toHaveLength(2);
    for (const r of listed.results) {
      expect(r.type).toBe("task");
    }
  });

  // ---- 5. Update a thought ----
  it("updates a thought summary", async () => {
    const captureResult = await client.callTool({
      name: "capture_thought",
      arguments: { content: "Original content", summary: "Old summary" },
    });
    const captured = parseResult(captureResult) as { id: string };

    await client.callTool({
      name: "update_thought",
      arguments: { id: captured.id, summary: "New summary" },
    });

    const getResult = await client.callTool({
      name: "get_thought",
      arguments: { id: captured.id },
    });
    const retrieved = parseResult(getResult) as { summary: string };
    expect(retrieved.summary).toBe("New summary");
  });

  // ---- 6. Delete a thought ----
  it("deletes a thought so get returns error", async () => {
    const captureResult = await client.callTool({
      name: "capture_thought",
      arguments: { content: "To be deleted" },
    });
    const captured = parseResult(captureResult) as { id: string };

    await client.callTool({
      name: "delete_thought",
      arguments: { id: captured.id },
    });

    const getResult = await client.callTool({
      name: "get_thought",
      arguments: { id: captured.id },
    });
    expect(getResult.isError).toBe(true);
  });

  // ---- 7. Link and explore ----
  it("links two thoughts and explores the graph", async () => {
    const r1 = await client.callTool({
      name: "capture_thought",
      arguments: { content: "Thought A", summary: "A" },
    });
    const r2 = await client.callTool({
      name: "capture_thought",
      arguments: { content: "Thought B", summary: "B" },
    });
    const idA = (parseResult(r1) as { id: string }).id;
    const idB = (parseResult(r2) as { id: string }).id;

    await client.callTool({
      name: "manage_edges",
      arguments: {
        action: "link",
        source_id: idA,
        target_id: idB,
        edge_type: "related",
      },
    });

    const exploreResult = await client.callTool({
      name: "explore_graph",
      arguments: { thought_id: idA, max_depth: 1 },
    });
    const graph = parseResult(exploreResult) as {
      nodes: Array<{
        id: string;
        edges: Array<{ edge_type: string; connected_to: string; direction: string }>;
      }>;
    };
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    const rootNode = graph.nodes.find((n) => n.id === idA);
    expect(rootNode).toBeDefined();
    const edge = rootNode!.edges.find(
      (e) => e.connected_to === idB && e.direction === "outgoing",
    );
    expect(edge).toBeDefined();
    expect(edge!.edge_type).toBe("related");
  });

  // ---- 8. Stats reflect data ----
  it("thought_stats reflects captured data", async () => {
    await client.callTool({
      name: "capture_thought",
      arguments: { content: "Stat thought 1", type: "note" },
    });
    await client.callTool({
      name: "capture_thought",
      arguments: { content: "Stat thought 2", type: "decision" },
    });

    const statsResult = await client.callTool({
      name: "thought_stats",
      arguments: {},
    });
    const stats = parseResult(statsResult) as { thought_count: number };
    expect(stats.thought_count).toBeGreaterThanOrEqual(2);
  });

  // ---- 9. Error on non-existent get ----
  it("get_thought with fake ID returns isError", async () => {
    const result = await client.callTool({
      name: "get_thought",
      arguments: { id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(result.isError).toBe(true);
  });

  // ---- 10. Search returns summaries not content ----
  it("search returns summaries but not full content", async () => {
    const longContent =
      "This is a very long piece of content that should NOT appear in search results because the design returns summaries only";
    await client.callTool({
      name: "capture_thought",
      arguments: {
        content: longContent,
        summary: "Brief summary for search",
        type: "insight",
      },
    });

    const searchResult = await client.callTool({
      name: "search_thoughts",
      arguments: { query: "summaries" },
    });
    const searched = parseResult(searchResult) as {
      results: Array<{ summary?: string; content?: string }>;
    };
    expect(searched.results.length).toBeGreaterThanOrEqual(1);
    const hit = searched.results[0];
    expect(hit.summary).toBe("Brief summary for search");
    // Search results should NOT include full content
    expect(hit.content).toBeUndefined();
  });

  // ---- 11. Expire edge and verify traversal ----
  it("expire hides edge from explore_graph", async () => {
    const r1 = await client.callTool({
      name: "capture_thought",
      arguments: { content: "Temporal root", summary: "Root" },
    });
    const r2 = await client.callTool({
      name: "capture_thought",
      arguments: { content: "Temporal child", summary: "Child" },
    });
    const idA = (parseResult(r1) as { id: string }).id;
    const idB = (parseResult(r2) as { id: string }).id;

    const linkResult = await client.callTool({
      name: "manage_edges",
      arguments: { action: "link", source_id: idA, target_id: idB, edge_type: "related" },
    });
    const edgeId = (parseResult(linkResult) as { edge_id: string }).edge_id;

    await client.callTool({
      name: "manage_edges",
      arguments: { action: "expire", edge_id: edgeId, valid_until: "2020-01-01T00:00:00.000Z" },
    });

    const exploreResult = await client.callTool({
      name: "explore_graph",
      arguments: { thought_id: idA, max_depth: 1 },
    });
    const graph = parseResult(exploreResult) as { node_count: number };
    expect(graph.node_count).toBe(1);

    const fullResult = await client.callTool({
      name: "explore_graph",
      arguments: { thought_id: idA, max_depth: 1, include_expired: true },
    });
    const fullGraph = parseResult(fullResult) as { node_count: number };
    expect(fullGraph.node_count).toBe(2);
  });
});
