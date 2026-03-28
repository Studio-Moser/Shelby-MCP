import type { ThoughtDatabase } from "../db/database.js";
import { linkThoughts, unlinkThoughts, VALID_EDGE_TYPES, traverseGraph } from "../db/edges.js";
import { toolSuccess, toolError, type ToolResult } from "./helpers.js";

// --- manage_edges ---

interface ManageEdgesArgs {
  action: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  metadata?: Record<string, unknown>;
}

export function handleManageEdges(
  db: ThoughtDatabase,
  args: Record<string, unknown>,
): ToolResult {
  const a = args as unknown as ManageEdgesArgs;

  if (a.action === "link") {
    try {
      const edgeId = linkThoughts(db, {
        source_id: a.source_id,
        target_id: a.target_id,
        edge_type: a.edge_type,
        metadata: a.metadata,
      });
      return toolSuccess({ edge_id: edgeId, action: "linked" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("does not exist")) {
        return toolError("not_found", msg);
      }
      if (msg.includes("already exists")) {
        return toolError("duplicate", msg);
      }
      if (msg.includes("Invalid edge type")) {
        return toolError(
          "invalid_input",
          `Edge type must be one of: ${VALID_EDGE_TYPES.join(", ")}`,
        );
      }
      return toolError("temporary_failure", msg);
    }
  }

  if (a.action === "unlink") {
    const removed = unlinkThoughts(db, a.source_id, a.target_id, a.edge_type);
    if (!removed) {
      return toolError(
        "not_found",
        `No edge found: ${a.source_id} -[${a.edge_type}]-> ${a.target_id}`,
      );
    }
    return toolSuccess({ action: "unlinked" });
  }

  return toolError(
    "invalid_input",
    'action must be "link" or "unlink"',
  );
}

// --- explore_graph ---

interface ExploreGraphArgs {
  thought_id: string;
  max_depth?: number;
  edge_types?: string[];
}

export function handleExploreGraph(
  db: ThoughtDatabase,
  args: Record<string, unknown>,
): ToolResult {
  const a = args as unknown as ExploreGraphArgs;

  if (!a.thought_id || typeof a.thought_id !== "string") {
    return toolError("invalid_input", "thought_id is required and must be a string");
  }

  const depth = a.max_depth ?? 1;
  const nodes = traverseGraph(db, a.thought_id, depth, a.edge_types);

  if (nodes.length === 0) {
    return toolError(
      "not_found",
      `Thought "${a.thought_id}" not found. Try search_thoughts to find it by content.`,
    );
  }

  return toolSuccess({
    root: a.thought_id,
    max_depth: depth,
    node_count: nodes.length,
    nodes,
  });
}
