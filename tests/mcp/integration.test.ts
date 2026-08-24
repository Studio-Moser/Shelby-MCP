import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import type { ThoughtDatabase } from "../../src/db/database.js";
import { getProjectByAlias, upsertProject } from "../../src/db/projects.js";
import { insertThought } from "../../src/db/thoughts.js";

/** Parse the JSON text from an MCP tool result. */
function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const content = result.content as Array<{ type: string; text: string }>;
  try {
    return JSON.parse(content[0]?.text ?? "");
  } catch (error) {
    throw new Error("Invalid MCP tool result JSON", { cause: error });
  }
}

describe("MCP Integration", () => {
  let client: Client;
  let db: ThoughtDatabase;

  beforeEach(async () => {
    const created = createServer({
      dbPath: ":memory:",
      verbose: false,
      logFile: null,
      transport: "stdio",
      httpPort: 3100,
      httpHost: "127.0.0.1",
      apiKey: null,
    });
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

  // ---- 1. Lists all 12 tools ----
  // (9 original memory tools + get_brief + select_context + expand_neighbors ported from the Mac app)
  it("lists all 12 tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "capture_thought",
      "delete_thought",
      "expand_neighbors",
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
    expect(tools).toHaveLength(12);
  });

	it("marks search and get as write-capable because they record usage", async () => {
		const { tools } = await client.listTools();

		for (const name of ["search_thoughts", "get_thought"]) {
			expect(tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint).toBe(false);
		}
	});

  it("accepts preference captures and stores the canonical decision type", async () => {
    const result = parseResult(await client.callTool({
      name: "capture_thought",
      arguments: {
        content: "Prefer focused diffs over broad refactors",
        summary: "Prefer focused diffs",
        type: "preference",
      },
    })) as { id: string };

    const stored = db.db
      .prepare("SELECT type, visibility FROM thoughts WHERE id = ?")
      .get(result.id) as { type: string; visibility: string };
    expect(stored).toEqual({ type: "decision", visibility: "shared" });
  });

  it.each([
    ["single missing", { content: "Missing summary" }],
    ["single blank", { content: "Blank summary", summary: "   " }],
    ["single non-string", { content: "Non-string summary", summary: 42 }],
    ["bulk missing", { thoughts: [{ content: "Missing summary" }] }],
    ["bulk blank", { thoughts: [{ content: "Blank summary", summary: "   " }] }],
    ["bulk non-string", { thoughts: [{ content: "Non-string summary", summary: 42 }] }],
  ])("rejects %s summaries at the MCP schema boundary", async (_case, arguments_) => {
    const result = await client.callTool({ name: "capture_thought", arguments: arguments_ });

    expect(result.isError).toBe(true);
  });

  it("allows bulk capture without a root summary", async () => {
    const result = await client.callTool({
      name: "capture_thought",
      arguments: {
        thoughts: [{ content: "Bulk item", summary: "Bulk item summary" }],
      },
    });

    expect(result.isError).toBeFalsy();
  });

  it("exposes include_shared and applies shared/all-project brief scope", async () => {
    upsertProject(db.db, {
      slug: "shelby",
      displayName: "Shelby",
      memberRepos: [],
      memberPaths: [],
      provisional: false,
    });
    insertThought(db.db, {
      content: "local",
      summary: "Local Shelby decision",
      type: "decision",
      project_identifier: "shelby",
    });
    insertThought(db.db, {
      content: "other",
      summary: "Other project decision",
      type: "decision",
      project_identifier: "other-project",
    });
    insertThought(db.db, {
      content: "shared",
      summary: "Shared eligible preference",
      type: "decision",
      visibility: "shared",
      metadata: { extra: { briefEligible: true, briefRole: "preference" } },
    });

    const tools = await client.listTools();
    const briefTool = tools.tools.find((tool) => tool.name === "get_brief");
    expect(briefTool?.inputSchema).toHaveProperty("properties.include_shared");

    const localOnly = parseResult(await client.callTool({
      name: "get_brief",
      arguments: { project_identifier: "shelby", include_shared: false },
    })) as { brief: string };
    expect(localOnly.brief).toContain("Local Shelby decision");
    expect(localOnly.brief).not.toContain("Shared eligible preference");
    expect(localOnly.brief).not.toContain("Other project decision");

    const withShared = parseResult(await client.callTool({
      name: "get_brief",
      arguments: { project_identifier: "shelby", include_shared: true },
    })) as { brief: string };
    expect(withShared.brief).toContain("Local Shelby decision");
    expect(withShared.brief).toContain("Shared eligible preference");
    expect(withShared.brief).not.toContain("Other project decision");

    const allProjects = parseResult(await client.callTool({
      name: "get_brief",
      arguments: { all_projects: true },
    })) as { brief: string; project_identifier: string | null };
    expect(allProjects.project_identifier).toBeNull();
    expect(allProjects.brief).toContain("Local Shelby decision");
    expect(allProjects.brief).toContain("Other project decision");
    expect(allProjects.brief).toContain("Shared eligible preference");
  });

  it("advertises and enforces canonical project references on every structured tool", async () => {
    upsertProject(db.db, { slug: "schema-project", displayName: "Schema", memberRepos: [], memberPaths: [], provisional: false });
    upsertProject(db.db, { slug: "other-project", displayName: "Other", memberRepos: [], memberPaths: [], provisional: false });
    const projectId = getProjectByAlias(db.db, "schema-project")!.projectId;
    const thoughtId = insertThought(db.db, {
      content: "schema identity",
      summary: "Schema identity",
      project_id: projectId,
      project_identifier: "schema-project",
    });
    const calls = [
      { name: "search_thoughts", arguments: { query: "schema" } },
      { name: "list_thoughts", arguments: {} },
      { name: "update_thought", arguments: { id: thoughtId, summary: "Schema identity" } },
      { name: "get_brief", arguments: {} },
      { name: "select_context", arguments: {} },
    ];
    const { tools } = await client.listTools();
    for (const call of calls) {
      const schema = tools.find((tool) => tool.name === call.name)?.inputSchema as {
        required?: string[];
        properties?: Record<string, { pattern?: string; format?: string }>;
      };
      expect(schema.properties?.project_id).toBeDefined();
      expect(schema.required ?? []).not.toContain("project_id");
      expect(schema.properties?.project_id?.pattern ?? schema.properties?.project_id?.format).toBeTruthy();

      for (const scope of [
        { project_id: projectId },
        { project_id: projectId, project_identifier: "schema-project" },
      ]) {
        const accepted = await client.callTool({
          name: call.name,
          arguments: { ...call.arguments, ...scope },
        });
        expect(accepted.isError, `${call.name} should accept ${JSON.stringify(scope)}`).not.toBe(true);
      }

      const malformed = await client.callTool({
        name: call.name,
        arguments: { ...call.arguments, project_id: "bad" },
      });
      expect(malformed.isError).toBe(true);

      for (const scope of [
        { project_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        { project_id: projectId, project_identifier: "other-project" },
      ]) {
        const rejected = await client.callTool({
          name: call.name,
          arguments: { ...call.arguments, ...scope },
        });
        expect(rejected.isError, `${call.name} should reject ${JSON.stringify(scope)}`).toBe(true);
        expect(parseResult(rejected)).toMatchObject({ error: "project_scope_invalid" });
      }
    }
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
      arguments: { content: "A decision was made", summary: "Decision", type: "decision" },
    });
    await client.callTool({
      name: "capture_thought",
      arguments: { content: "A task to do", summary: "Task", type: "task" },
    });
    await client.callTool({
      name: "capture_thought",
      arguments: { content: "Another task", summary: "Another task", type: "task" },
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
      arguments: { content: "To be deleted", summary: "Delete this" },
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
      arguments: { content: "Stat thought 1", summary: "First stat", type: "note" },
    });
    await client.callTool({
      name: "capture_thought",
      arguments: { content: "Stat thought 2", summary: "Second stat", type: "decision" },
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
