import { v4 as uuidv4 } from "uuid";
import type { ThoughtDatabase } from "./database.js";

// --- Types ---

export const VALID_EDGE_TYPES = [
  "refines",
  "cites",
  "refuted_by",
  "tags",
  "related",
  "follows",
] as const;

export type EdgeType = (typeof VALID_EDGE_TYPES)[number];

export interface EdgeInput {
  source_id: string;
  target_id: string;
  edge_type: string; // refines | cites | refuted_by | tags | related | follows
  metadata?: Record<string, unknown>;
}

export interface EdgeRecord {
  id: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ConnectedThought {
  thought_id: string;
  summary: string | null;
  type: string;
  edge_id: string;
  edge_type: string;
  direction: "outgoing" | "incoming";
}

export interface GraphNode {
  id: string;
  summary: string | null;
  type: string;
  depth: number;
  edges: Array<{
    edge_id: string;
    edge_type: string;
    connected_to: string;
    direction: "outgoing" | "incoming";
  }>;
}

// --- Helpers ---

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toEdgeRecord(row: Record<string, unknown>): EdgeRecord {
  return {
    id: row.id as string,
    source_id: row.source_id as string,
    target_id: row.target_id as string,
    edge_type: row.edge_type as string,
    metadata: parseMetadata(row.metadata as string | null),
    created_at: row.created_at as string,
  };
}

// --- Functions ---

/**
 * Create an edge between two thoughts. Returns the new edge's UUID.
 * Throws if source or target don't exist, or if a duplicate edge exists.
 */
export function linkThoughts(db: ThoughtDatabase, input: EdgeInput): string {
  const { source_id, target_id, edge_type, metadata } = input;

  if (!VALID_EDGE_TYPES.includes(edge_type as EdgeType)) {
    throw new Error(
      `Invalid edge type "${edge_type}". Must be one of: ${VALID_EDGE_TYPES.join(", ")}`
    );
  }

  // Verify both thoughts exist
  const sourceExists = db.db
    .prepare("SELECT 1 FROM thoughts WHERE id = ?")
    .get(source_id);
  if (!sourceExists) {
    throw new Error(`Source thought "${source_id}" does not exist`);
  }

  const targetExists = db.db
    .prepare("SELECT 1 FROM thoughts WHERE id = ?")
    .get(target_id);
  if (!targetExists) {
    throw new Error(`Target thought "${target_id}" does not exist`);
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  const metadataJson = metadata ? JSON.stringify(metadata) : null;

  try {
    db.db
      .prepare(
        `INSERT INTO edges (id, source_id, target_id, edge_type, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, source_id, target_id, edge_type, metadataJson, now);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNIQUE constraint failed")) {
      throw new Error(
        `Edge already exists: ${source_id} -[${edge_type}]-> ${target_id}`,
        { cause: err }
      );
    }
    throw err;
  }

  return id;
}

/**
 * Remove an edge between two thoughts. Returns true if an edge was deleted.
 */
export function unlinkThoughts(
  db: ThoughtDatabase,
  source_id: string,
  target_id: string,
  edge_type: string
): boolean {
  const result = db.db
    .prepare(
      "DELETE FROM edges WHERE source_id = ? AND target_id = ? AND edge_type = ?"
    )
    .run(source_id, target_id, edge_type);

  return result.changes > 0;
}

/**
 * Get a single edge by ID.
 */
export function getEdge(
  db: ThoughtDatabase,
  id: string
): EdgeRecord | null {
  const row = db.db
    .prepare("SELECT * FROM edges WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;

  return row ? toEdgeRecord(row) : null;
}

/**
 * Get all edges between two specific thoughts (any type).
 */
export function getEdgesBetween(
  db: ThoughtDatabase,
  source_id: string,
  target_id: string
): EdgeRecord[] {
  const rows = db.db
    .prepare(
      "SELECT * FROM edges WHERE source_id = ? AND target_id = ?"
    )
    .all(source_id, target_id) as Record<string, unknown>[];

  return rows.map(toEdgeRecord);
}

/**
 * Get direct connections for a thought (both outgoing and incoming).
 * Optionally filter by edge types.
 */
export function getConnections(
  db: ThoughtDatabase,
  thought_id: string,
  edge_types?: string[]
): ConnectedThought[] {
  const results: ConnectedThought[] = [];

  // Build edge type filter clause
  let typeFilter = "";
  const typeParams: string[] = [];
  if (edge_types && edge_types.length > 0) {
    const placeholders = edge_types.map(() => "?").join(", ");
    typeFilter = `AND e.edge_type IN (${placeholders})`;
    typeParams.push(...edge_types);
  }

  // Outgoing edges: this thought is the source
  const outgoing = db.db
    .prepare(
      `SELECT t.id AS thought_id, t.summary, t.type, e.id AS edge_id, e.edge_type
       FROM edges e
       JOIN thoughts t ON t.id = e.target_id
       WHERE e.source_id = ? ${typeFilter}`
    )
    .all(thought_id, ...typeParams) as Record<string, unknown>[];

  for (const row of outgoing) {
    results.push({
      thought_id: row.thought_id as string,
      summary: (row.summary as string) ?? null,
      type: row.type as string,
      edge_id: row.edge_id as string,
      edge_type: row.edge_type as string,
      direction: "outgoing",
    });
  }

  // Incoming edges: this thought is the target
  const incoming = db.db
    .prepare(
      `SELECT t.id AS thought_id, t.summary, t.type, e.id AS edge_id, e.edge_type
       FROM edges e
       JOIN thoughts t ON t.id = e.source_id
       WHERE e.target_id = ? ${typeFilter}`
    )
    .all(thought_id, ...typeParams) as Record<string, unknown>[];

  for (const row of incoming) {
    results.push({
      thought_id: row.thought_id as string,
      summary: (row.summary as string) ?? null,
      type: row.type as string,
      edge_id: row.edge_id as string,
      edge_type: row.edge_type as string,
      direction: "incoming",
    });
  }

  return results;
}

/**
 * BFS traversal from a starting thought up to max_depth (capped at 5).
 * Returns all discovered nodes with their depth and edges.
 */
export interface GraphRelatedThought {
  id: string;
  summary: string | null;
  type: string;
  depth: number;
  via_edge_type: string;
  direction: "outgoing" | "incoming";
}

/**
 * After retrieving a set of result IDs, traverse their graph edges up to
 * graphDepth hops and return related thoughts not already in the result set.
 */
export function fetchGraphRelated(
  db: ThoughtDatabase,
  resultIds: string[],
  graphDepth: number,
): GraphRelatedThought[] {
  if (graphDepth <= 0 || resultIds.length === 0) return [];

  const effectiveDepth = Math.min(Math.max(graphDepth, 1), 5);
  const seen = new Set<string>(resultIds);
  const related: GraphRelatedThought[] = [];

  // BFS from all result nodes simultaneously
  type QueueItem = { id: string; depth: number };
  const queue: QueueItem[] = resultIds.map((id) => ({ id, depth: 0 }));

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= effectiveDepth) continue;

    // Outgoing edges
    const outgoing = db.db
      .prepare(
        `SELECT e.edge_type, e.target_id, t.summary, t.type
         FROM edges e
         JOIN thoughts t ON t.id = e.target_id
         WHERE e.source_id = ?`,
      )
      .all(current.id) as Array<{
      edge_type: string;
      target_id: string;
      summary: string | null;
      type: string;
    }>;

    for (const row of outgoing) {
      if (!seen.has(row.target_id)) {
        seen.add(row.target_id);
        related.push({
          id: row.target_id,
          summary: row.summary,
          type: row.type,
          depth: current.depth + 1,
          via_edge_type: row.edge_type,
          direction: "outgoing",
        });
        queue.push({ id: row.target_id, depth: current.depth + 1 });
      }
    }

    // Incoming edges
    const incoming = db.db
      .prepare(
        `SELECT e.edge_type, e.source_id, t.summary, t.type
         FROM edges e
         JOIN thoughts t ON t.id = e.source_id
         WHERE e.target_id = ?`,
      )
      .all(current.id) as Array<{
      edge_type: string;
      source_id: string;
      summary: string | null;
      type: string;
    }>;

    for (const row of incoming) {
      if (!seen.has(row.source_id)) {
        seen.add(row.source_id);
        related.push({
          id: row.source_id,
          summary: row.summary,
          type: row.type,
          depth: current.depth + 1,
          via_edge_type: row.edge_type,
          direction: "incoming",
        });
        queue.push({ id: row.source_id, depth: current.depth + 1 });
      }
    }
  }

  return related;
}

export function traverseGraph(
  db: ThoughtDatabase,
  thought_id: string,
  max_depth: number,
  edge_types?: string[]
): GraphNode[] {
  const effectiveDepth = Math.min(Math.max(max_depth, 0), 5);

  // Verify starting thought exists
  const startRow = db.db
    .prepare("SELECT id, summary, type FROM thoughts WHERE id = ?")
    .get(thought_id) as Record<string, unknown> | undefined;

  if (!startRow) {
    return [];
  }

  const visited = new Map<string, GraphNode>();
  const queue: Array<{ id: string; depth: number }> = [
    { id: thought_id, depth: 0 },
  ];

  // Initialize root node
  visited.set(thought_id, {
    id: thought_id,
    summary: (startRow.summary as string) ?? null,
    type: startRow.type as string,
    depth: 0,
    edges: [],
  });

  // Build edge type filter
  let typeFilter = "";
  const typeParams: string[] = [];
  if (edge_types && edge_types.length > 0) {
    const placeholders = edge_types.map(() => "?").join(", ");
    typeFilter = `AND e.edge_type IN (${placeholders})`;
    typeParams.push(...edge_types);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.depth >= effectiveDepth) continue;

    // Outgoing edges
    const outgoing = db.db
      .prepare(
        `SELECT e.id AS edge_id, e.edge_type, e.target_id,
                t.id AS thought_id, t.summary, t.type
         FROM edges e
         JOIN thoughts t ON t.id = e.target_id
         WHERE e.source_id = ? ${typeFilter}`
      )
      .all(current.id, ...typeParams) as Record<string, unknown>[];

    for (const row of outgoing) {
      const neighborId = row.target_id as string;
      const edgeId = row.edge_id as string;
      const edgeType = row.edge_type as string;

      // Record edge on current node
      const currentNode = visited.get(current.id)!;
      currentNode.edges.push({
        edge_id: edgeId,
        edge_type: edgeType,
        connected_to: neighborId,
        direction: "outgoing",
      });

      // Discover new node
      if (!visited.has(neighborId)) {
        const newNode: GraphNode = {
          id: neighborId,
          summary: (row.summary as string) ?? null,
          type: row.type as string,
          depth: current.depth + 1,
          edges: [],
        };
        visited.set(neighborId, newNode);
        queue.push({ id: neighborId, depth: current.depth + 1 });
      }
    }

    // Incoming edges
    const incoming = db.db
      .prepare(
        `SELECT e.id AS edge_id, e.edge_type, e.source_id,
                t.id AS thought_id, t.summary, t.type
         FROM edges e
         JOIN thoughts t ON t.id = e.source_id
         WHERE e.target_id = ? ${typeFilter}`
      )
      .all(current.id, ...typeParams) as Record<string, unknown>[];

    for (const row of incoming) {
      const neighborId = row.source_id as string;
      const edgeId = row.edge_id as string;
      const edgeType = row.edge_type as string;

      // Record edge on current node
      const currentNode = visited.get(current.id)!;
      currentNode.edges.push({
        edge_id: edgeId,
        edge_type: edgeType,
        connected_to: neighborId,
        direction: "incoming",
      });

      // Discover new node
      if (!visited.has(neighborId)) {
        const newNode: GraphNode = {
          id: neighborId,
          summary: (row.summary as string) ?? null,
          type: row.type as string,
          depth: current.depth + 1,
          edges: [],
        };
        visited.set(neighborId, newNode);
        queue.push({ id: neighborId, depth: current.depth + 1 });
      }
    }
  }

  return Array.from(visited.values());
}
