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
        has_summary: z.boolean().describe("Filter by summary presence: true = has summary, false = missing summary").optional(),
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

  // --- Resources ---
  // Stub so that clients calling resources/list (e.g. Codex) get an empty
  // list instead of "Method not found", which prevents them from registering
  // the server.

  server.registerResource("status", "shelbymcp://status", {
    description: "ShelbyMCP server status",
  }, async () => ({
    contents: [{
      uri: "shelbymcp://status",
      text: JSON.stringify({ status: "ok", tools: 8, prompts: 3 }),
      mimeType: "application/json",
    }],
  }));

  // --- MCP Prompts ---
  // These teach agents how to use ShelbyMCP effectively.
  // Agents that support prompts get this automatically; the protocol
  // appended to agent rules files (CLAUDE.md, AGENTS.md) is a fallback.

  server.registerPrompt("memory-protocol", {
    title: "Memory Protocol",
    description:
      "Core rules for when and how to use ShelbyMCP. Read this at the start of every session.",
  }, async () => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `# ShelbyMCP — Memory Protocol

You have persistent memory via ShelbyMCP tools. Memory survives across sessions and is shared across all AI tools the user works with. You MUST use it — do not rely on conversation context alone.

## When to SAVE (mandatory)

Call \`capture_thought\` after any of these events:

- **Decisions**: Architecture choices, library selections, tradeoffs
- **Preferences**: User likes/dislikes, workflow habits, coding style
- **People & roles**: Who does what
- **Project context**: Goals, deadlines, constraints, scope changes
- **Bugs & fixes**: Root cause discoveries, workarounds
- **Architecture & patterns**: System design, data flow, conventions
- **Insights**: Non-obvious learnings, things that surprised you

Always include: a \`summary\` (one-line, <100 chars), a \`type\`, relevant \`topics\`, and link to \`related_to\` thoughts when applicable.

## When to SEARCH (mandatory)

Call \`search_thoughts\` or \`list_thoughts\` before:

- Starting work on any task
- Making a decision — check for prior decisions on the same topic
- When something feels familiar — it probably is
- After context compaction — immediately search to recover session context
- When the user says "remember", "recall", "what do we know about", "what did we decide"

## What NOT to save

- Ephemeral debugging output (stack traces, log lines)
- Code content already in git — save the *decision*, not the code
- Transient conversation — save the conclusion, not the process
- Duplicates — search first, use \`update_thought\` instead of creating new ones`,
      },
    }],
  }));

  server.registerPrompt("save-guide", {
    title: "How to Save Thoughts Well",
    description:
      "Best practices for creating high-quality, searchable memories. Read when saving important information.",
  }, async () => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `# How to Save Thoughts Well

1. **Summary first.** Search results only show summaries. A thought without a summary is invisible to future searches. Keep summaries under 100 characters.

2. **Type accurately.** Use \`decision\`, \`task\`, \`question\`, \`reference\`, \`insight\`, or \`note\`. Don't default everything to \`note\`.

3. **Tag topics and people.** These are the primary filters for \`list_thoughts\`. Use consistent topic names across thoughts (e.g., always "auth" not sometimes "authentication").

4. **Link related thoughts.** Use \`manage_edges\` to connect decisions to the tasks they affect, references to the insights they support. Edge types: \`refines\`, \`cites\`, \`refuted_by\`, \`tags\`, \`related\`, \`follows\`.

5. **Update, don't duplicate.** If a thought exists but is outdated, use \`update_thought\`. Don't create a new one.

6. **Be specific.** "We discussed the API" is useless. "Chose REST over GraphQL for the public API because most consumers are mobile apps with bandwidth constraints" is searchable and actionable.

7. **Capture the why.** Facts change; reasoning persists. "Using SQLite" is a fact you can see in the code. "Chose SQLite over Postgres because all 4 machines need offline access without a central server" is the decision worth saving.`,
      },
    }],
  }));

  server.registerPrompt("tool-guide", {
    title: "ShelbyMCP Tool Guide",
    description:
      "Quick reference for all available tools and when to use each one.",
  }, async () => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `# ShelbyMCP Tool Guide

## Capture & Update
- \`capture_thought\` — Save a new thought. Supports bulk capture via the \`thoughts\` array parameter.
- \`update_thought\` — Modify an existing thought. Supports bulk update via \`ids\` array. Use this instead of deleting and recreating.
- \`delete_thought\` — Remove a thought and all its edges. Use sparingly — prefer updating.

## Search & Browse
- \`search_thoughts\` — Full-text search. Returns summaries only. Use \`get_thought\` to read full content of interesting results.
- \`list_thoughts\` — Filter by type, topic, person, project, date range, or summary presence. Good for browsing a category.
- \`get_thought\` — Fetch a single thought by ID with full content. Use after search/list to drill into details.

## Graph
- \`manage_edges\` — Create or remove typed relationships between thoughts. Actions: \`link\`, \`unlink\`. Types: \`refines\`, \`cites\`, \`refuted_by\`, \`tags\`, \`related\`, \`follows\`.
- \`explore_graph\` — Traverse relationships from a starting thought. Set \`max_depth\` (1-5) and optionally filter by \`edge_types\`.

## Stats
- \`thought_stats\` — Aggregate counts by type, top topics, recent activity. Good for understanding what's in memory.`,
      },
    }],
  }));

  return { server, db };
}
