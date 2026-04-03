import type { ThoughtDatabase } from "../db/database.js";
import { fetchGraphRelated } from "../db/edges.js";
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
