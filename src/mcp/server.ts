import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ShelbyConfig } from "../config.js";
import { ThoughtDatabase } from "../db/database.js";
import { VALID_EDGE_TYPES } from "../db/edges.js";
import { handleCaptureThought } from "../tools/capture.js";
import { handleSearchThoughts } from "../tools/search.js";
import { handleListThoughts } from "../tools/list.js";
import { handleGetThought } from "../tools/get.js";
import { handleUpdateThought } from "../tools/update.js";
import { handleDeleteThought } from "../tools/delete.js";
import { handleManageEdges, handleExploreGraph } from "../tools/graph.js";
import { handleThoughtStats } from "../tools/stats.js";

const VERSION = "0.1.0";

export function createServer(config: ShelbyConfig): { server: McpServer; db: ThoughtDatabase } {
  const server = new McpServer({
    name: "shelbymcp",
    version: VERSION,
  });

  const db = new ThoughtDatabase(config.dbPath);

  // --- capture_thought ---

  server.registerTool(
    "capture_thought",
    {
      title: "Capture Thought",
      description: "Store a thought with metadata, topics, and relationships",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        content: z.string().describe("The thought content").optional(),
        summary: z.string().describe("One-line summary for search results").optional(),
        type: z
          .enum(["note", "decision", "task", "question", "reference", "insight"])
          .describe("Thought type")
          .optional(),
        source: z.string().describe("Source tool or context").optional(),
        project: z.string().describe("Project association").optional(),
        topics: z.array(z.string()).describe("Topic tags").optional(),
        people: z.array(z.string()).describe("People mentioned").optional(),
        metadata: z.record(z.unknown()).describe("Arbitrary metadata").optional(),
        related_to: z.array(z.string()).describe("IDs of related thoughts to link").optional(),
        thoughts: z
          .array(
            z.object({
              content: z.string(),
              summary: z.string().optional(),
              type: z.string().optional(),
              source: z.string().optional(),
              project: z.string().optional(),
              topics: z.array(z.string()).optional(),
              people: z.array(z.string()).optional(),
              metadata: z.record(z.unknown()).optional(),
              related_to: z.array(z.string()).optional(),
            }),
          )
          .describe("Bulk capture: array of thoughts")
          .optional(),
      },
    },
    async (args) => {
      return handleCaptureThought(db, args as Record<string, unknown>);
    },
  );

  // --- search_thoughts ---

  server.registerTool(
    "search_thoughts",
    {
      title: "Search Thoughts",
      description:
        "Full-text search with optional vector reranking. Returns summaries, not full content.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        query: z.string().describe("Full-text search query").optional(),
        embedding: z
          .array(z.number())
          .describe("Embedding vector for similarity search")
          .optional(),
        limit: z.number().describe("Max results (default 20, max 100)").optional(),
        offset: z.number().describe("Pagination offset").optional(),
        type: z.string().describe("Filter by thought type").optional(),
        project: z.string().describe("Filter by project").optional(),
      },
    },
    async (args) => {
      return handleSearchThoughts(db, args as Record<string, unknown>);
    },
  );

  // --- list_thoughts ---

  server.registerTool(
    "list_thoughts",
    {
      title: "List Thoughts",
      description: "Browse and filter thoughts by type, topic, person, project, or date range",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        type: z.string().describe("Filter by thought type").optional(),
        project: z.string().describe("Filter by project").optional(),
        topic: z.string().describe("Filter by topic").optional(),
        person: z.string().describe("Filter by person mentioned").optional(),
        source: z.string().describe("Filter by source").optional(),
        since: z.string().describe("ISO 8601 start date").optional(),
        until: z.string().describe("ISO 8601 end date").optional(),
        limit: z.number().describe("Max results (default 20, max 100)").optional(),
        offset: z.number().describe("Pagination offset").optional(),
      },
    },
    async (args) => {
      return handleListThoughts(db, args as Record<string, unknown>);
    },
  );

  // --- get_thought ---

  server.registerTool(
    "get_thought",
    {
      title: "Get Thought",
      description: "Retrieve a specific thought by ID with full content",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        id: z.string().describe("Thought UUID"),
      },
    },
    async (args) => {
      return handleGetThought(db, args as Record<string, unknown>);
    },
  );

  // --- update_thought ---

  server.registerTool(
    "update_thought",
    {
      title: "Update Thought",
      description: "Update content or metadata on one or more thoughts",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        id: z.string().describe("Single thought ID to update").optional(),
        ids: z.array(z.string()).describe("Multiple thought IDs for bulk update").optional(),
        content: z.string().describe("New content").optional(),
        summary: z.string().describe("New summary").optional(),
        type: z.string().describe("New type").optional(),
        source: z.string().describe("New source").optional(),
        project: z.string().describe("New project").optional(),
        topics: z.array(z.string()).describe("New topics").optional(),
        people: z.array(z.string()).describe("New people").optional(),
        metadata: z.record(z.unknown()).describe("New metadata").optional(),
        visibility: z.string().describe("New visibility").optional(),
      },
    },
    async (args) => {
      return handleUpdateThought(db, args as Record<string, unknown>);
    },
  );

  // --- delete_thought ---

  server.registerTool(
    "delete_thought",
    {
      title: "Delete Thought",
      description: "Remove a thought and its edges",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        id: z.string().describe("Thought UUID to delete"),
      },
    },
    async (args) => {
      return handleDeleteThought(db, args as Record<string, unknown>);
    },
  );

  // --- manage_edges ---

  server.registerTool(
    "manage_edges",
    {
      title: "Manage Edges",
      description: "Create or remove typed relationships between thoughts",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        action: z.enum(["link", "unlink"]).describe("Action to perform"),
        source_id: z.string().describe("Source thought ID"),
        target_id: z.string().describe("Target thought ID"),
        edge_type: z
          .enum(VALID_EDGE_TYPES)
          .describe("Relationship type"),
        metadata: z.record(z.unknown()).describe("Edge metadata").optional(),
      },
    },
    async (args) => {
      return handleManageEdges(db, args as Record<string, unknown>);
    },
  );

  // --- explore_graph ---

  server.registerTool(
    "explore_graph",
    {
      title: "Explore Graph",
      description: "Traverse the knowledge graph from a starting thought",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        thought_id: z.string().describe("Starting thought ID"),
        max_depth: z
          .number()
          .describe("Traversal depth (default 1, max 5)")
          .optional(),
        edge_types: z
          .array(z.string())
          .describe("Filter by edge types")
          .optional(),
      },
    },
    async (args) => {
      return handleExploreGraph(db, args as Record<string, unknown>);
    },
  );

  // --- thought_stats ---

  server.registerTool(
    "thought_stats",
    {
      title: "Thought Stats",
      description: "Aggregate statistics about the memory database",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {},
    },
    async () => {
      return handleThoughtStats(db);
    },
  );

  return { server, db };
}
