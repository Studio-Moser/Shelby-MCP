import type { ThoughtDatabase } from "../db/database.js";
import { searchThoughts } from "../db/fts.js";
import { searchByEmbedding, bufferToEmbedding, cosineSimilarity } from "../db/vectors.js";
import { toolSuccess, toolError, clampLimit, type ToolResult } from "./helpers.js";

interface SearchArgs {
  query?: string;
  embedding?: number[];
  limit?: number;
  offset?: number;
  type?: string;
  project?: string;
  graph_depth?: number;
}

interface GraphRelatedThought {
  id: string;
  summary: string | null;
  type: string;
  depth: number;
  via_edge_type: string;
  direction: "outgoing" | "incoming";
}

/**
 * After retrieving a set of result IDs, traverse their graph edges up to
 * graph_depth hops and return related thoughts not already in the result set.
 */
function fetchGraphRelated(
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

export function handleSearchThoughts(
  db: ThoughtDatabase,
  args: Record<string, unknown>,
): ToolResult {
  const a = args as unknown as SearchArgs;

  if (!a.query && !a.embedding) {
    return toolError(
      "invalid_input",
      "Either query (for full-text search) or embedding (for vector search) is required.",
    );
  }

  const limit = clampLimit(a.limit);
  const offset = a.offset ?? 0;
  const graphDepth = Math.min(Math.max(a.graph_depth ?? 0, 0), 5);

  // Vector-only search
  if (a.embedding && !a.query) {
    if (!Array.isArray(a.embedding) || a.embedding.length === 0) {
      return toolError("invalid_input", "embedding must be a non-empty number array");
    }
    const results = searchByEmbedding(db.db, a.embedding, limit);
    const graph_related = fetchGraphRelated(db, results.map((r) => r.id), graphDepth);
    return toolSuccess({
      mode: "vector",
      results,
      total_count: results.length,
      has_more: false,
      offset: 0,
      ...(graphDepth > 0 ? { graph_related } : {}),
    });
  }

  // FTS search
  if (a.query && !a.embedding) {
    const ftsResult = searchThoughts(db.db, {
      query: a.query,
      limit,
      offset,
      type: a.type,
      project: a.project,
    });
    const graph_related = fetchGraphRelated(db, ftsResult.results.map((r) => r.id), graphDepth);
    return toolSuccess({
      mode: "fts",
      ...ftsResult,
      ...(graphDepth > 0 ? { graph_related } : {}),
    });
  }

  // Hybrid: FTS first, then rerank by embedding similarity
  if (a.query && a.embedding) {
    // Get a larger FTS pool to rerank from
    const ftsPool = searchThoughts(db.db, {
      query: a.query,
      limit: Math.min(limit * 3, 100),
      offset: 0,
      type: a.type,
      project: a.project,
    });

    // Rerank by embedding similarity
    const reranked = ftsPool.results.map((r) => {
      const row = db.db
        .prepare("SELECT embedding FROM thoughts WHERE id = ?")
        .get(r.id) as { embedding: Buffer | null } | undefined;

      let similarity = 0;
      if (row?.embedding) {
        const emb = bufferToEmbedding(row.embedding);
        similarity = cosineSimilarity(a.embedding!, emb);
      }

      return { ...r, similarity };
    });

    reranked.sort((x, y) => y.similarity - x.similarity);
    const sliced = reranked.slice(offset, offset + limit);
    const graph_related = fetchGraphRelated(db, sliced.map((r) => r.id), graphDepth);

    return toolSuccess({
      mode: "hybrid",
      results: sliced,
      total_count: ftsPool.total_count,
      has_more: offset + sliced.length < ftsPool.total_count,
      offset,
      ...(graphDepth > 0 ? { graph_related } : {}),
    });
  }

  return toolError("invalid_input", "Unexpected search parameter combination");
}
