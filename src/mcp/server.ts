import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CompleteRequestSchema, SetLevelRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
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
import type { ToolResult } from "../tools/helpers.js";

const VERSION = "0.1.0";

// Logging levels in order of severity (syslog-style)
const LOG_LEVELS: LoggingLevel[] = [
  "debug", "info", "notice", "warning", "error", "critical", "alert", "emergency",
];

export function createServer(config: ShelbyConfig): { server: McpServer; db: ThoughtDatabase } {
  const db = new ThoughtDatabase(config.dbPath);
  return { server: createServerWithDb(db), db };
}

export function createServerWithDb(db: ThoughtDatabase): McpServer {
  const server = new McpServer({
    name: "shelbymcp",
    version: VERSION,
  });

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------
  // Register the logging capability so clients know we emit structured logs.
  // The client can adjust verbosity via logging/setLevel.

  let currentLogLevel: LoggingLevel = "info";

  server.server.registerCapabilities({ logging: {} });
  server.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
    currentLogLevel = request.params.level;
    return {};
  });

  function shouldLog(level: LoggingLevel): boolean {
    return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(currentLogLevel);
  }

  function log(level: LoggingLevel, logger: string, data: unknown): void {
    if (!shouldLog(level)) return;
    server.sendLoggingMessage({ level, logger, data }).catch(() => {
      // Swallow — client may have disconnected
    });
  }

  /**
   * Wrap a tool handler to emit structured log messages on invocation and completion.
   */
  function withLogging<T extends Record<string, unknown>>(
    toolName: string,
    handler: (args: T) => ToolResult | Promise<ToolResult>,
  ) {
    return async (args: T): Promise<ToolResult> => {
      log("debug", toolName, { event: "invoked", args });
      try {
        const result = await handler(args);
        if (result.isError) {
          log("warning", toolName, { event: "error", message: result.content[0]?.text });
        } else {
          log("info", toolName, { event: "completed" });
        }
        return result;
      } catch (err) {
        log("error", toolName, { event: "exception", message: String(err) });
        throw err;
      }
    };
  }

  // --- capture_thought ---

  server.registerTool(
    "capture_thought",
    {
      title: "Capture Thought",
      description: "Save a note, decision, insight, task, question, or reference to persistent memory. Supports rich metadata (topics, people, project, source) and bulk capture. Use this whenever you learn something worth remembering across sessions — decisions made, user preferences, architecture choices, or project context.",
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
    withLogging("capture_thought", (args) => handleCaptureThought(db, args as Record<string, unknown>)),
  );

  // --- search_thoughts ---

  server.registerTool(
    "search_thoughts",
    {
      title: "Search Thoughts",
      description: "Search persistent memory by keyword or semantic similarity. Use before starting work on any topic to recall prior decisions, context, and preferences. Returns summaries — call get_thought for full content. Supports filtering by type and project.",
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
    withLogging("search_thoughts", (args) => handleSearchThoughts(db, args as Record<string, unknown>)),
  );

  // --- list_thoughts ---

  server.registerTool(
    "list_thoughts",
    {
      title: "List Thoughts",
      description: "Browse and filter memories by type, topic, person, project, source, or date range. Use to see what's been captured recently, find all decisions for a project, or list thoughts mentioning a specific person. Complementary to search_thoughts — this filters by structured fields rather than free-text.",
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
    withLogging("list_thoughts", (args) => handleListThoughts(db, args as Record<string, unknown>)),
  );

  // --- get_thought ---

  server.registerTool(
    "get_thought",
    {
      title: "Get Thought",
      description: "Retrieve the full content of a specific memory by its UUID. Use after search_thoughts or list_thoughts return a summary you need to read in full. Returns all fields including content, metadata, topics, people, and timestamps.",
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
    withLogging("get_thought", (args) => handleGetThought(db, args as Record<string, unknown>)),
  );

  // --- update_thought ---

  server.registerTool(
    "update_thought",
    {
      title: "Update Thought",
      description: "Update an existing memory's content, summary, type, topics, people, project, or metadata. Use to correct outdated information instead of creating duplicates. Supports bulk updates by passing multiple IDs.",
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
    withLogging("update_thought", (args) => handleUpdateThought(db, args as Record<string, unknown>)),
  );

  // --- delete_thought ---

  server.registerTool(
    "delete_thought",
    {
      title: "Delete Thought",
      description: "Permanently delete a memory and all its relationship edges. Use to remove outdated, incorrect, or duplicate entries. This is destructive and cannot be undone.",
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
    withLogging("delete_thought", (args) => handleDeleteThought(db, args as Record<string, unknown>)),
  );

  // --- manage_edges ---

  server.registerTool(
    "manage_edges",
    {
      title: "Manage Edges",
      description: "Link or unlink two memories with a typed relationship (refines, cites, refuted_by, tags, related, follows). Use to build a knowledge graph — connect decisions to the tasks they affect, references to the insights they support, or chain a sequence of related thoughts.",
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
    withLogging("manage_edges", (args) => handleManageEdges(db, args as Record<string, unknown>)),
  );

  // --- explore_graph ---

  server.registerTool(
    "explore_graph",
    {
      title: "Explore Graph",
      description: "Walk the knowledge graph outward from a starting memory. Returns connected thoughts up to a configurable depth (max 5). Use to discover related context — e.g., find all decisions linked to a task, or trace how an insight connects to references and other notes.",
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
    withLogging("explore_graph", (args) => handleExploreGraph(db, args as Record<string, unknown>)),
  );

  // --- thought_stats ---

  server.registerTool(
    "thought_stats",
    {
      title: "Thought Stats",
      description: "Get a summary of the memory database — total thoughts, breakdowns by type/project/topic, edge counts, and recent activity. Use to understand the current state of memory or verify captures are working.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {},
    },
    withLogging("thought_stats", () => handleThoughtStats(db)),
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

  // ---------------------------------------------------------------------------
  // Completion
  // ---------------------------------------------------------------------------
  // Provides auto-complete suggestions for prompt arguments and resource
  // template variables. Agents can call completion/complete to get matching
  // topics, people, projects, types, and sources from the database.

  server.server.registerCapabilities({ completions: {} });
  server.server.setRequestHandler(CompleteRequestSchema, async (request) => {
    const { argument } = request.params;
    const prefix = argument.value ?? "";
    let values: string[] = [];

    switch (argument.name) {
      case "topic":
      case "topics":
        values = db.getDistinctArrayValues("topics", prefix);
        break;
      case "person":
      case "people":
        values = db.getDistinctArrayValues("people", prefix);
        break;
      case "project":
        values = db.getDistinctValues("project", prefix);
        break;
      case "type":
        // Static list — filter by prefix
        values = ["note", "decision", "task", "question", "reference", "insight"]
          .filter((t) => t.startsWith(prefix.toLowerCase()));
        break;
      case "source":
        values = db.getDistinctValues("source", prefix);
        break;
      case "edge_type":
        values = (VALID_EDGE_TYPES as readonly string[])
          .filter((t) => t.startsWith(prefix.toLowerCase()));
        break;
      default:
        break;
    }

    return {
      completion: {
        values,
        hasMore: false,
        total: values.length,
      },
    };
  });

  log("info", "server", { event: "started", version: VERSION });

  return server;
}
