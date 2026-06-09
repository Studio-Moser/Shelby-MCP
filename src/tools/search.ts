import type { ThoughtDatabase } from "../db/database.js";
import { fetchGraphRelated } from "../db/edges.js";
import { searchThoughts } from "../db/fts.js";
import { searchByEmbedding } from "../db/vectors.js";
import { toolSuccess, toolError, clampLimit, type ToolResult } from "./helpers.js";

interface SearchArgs {
  query?: string;
  embedding?: number[];
  limit?: number;
  offset?: number;
  type?: string;
  project?: string;
  project_identifier?: string;
  include_shared?: boolean;
  shared_only?: boolean;
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
      project_identifier: a.project_identifier,
      include_shared: a.include_shared,
      shared_only: a.shared_only,
    });
    const graph_related = fetchGraphRelated(db, ftsResult.results.map((r) => r.id), graphDepth);
    return toolSuccess({
      mode: "fts",
      ...ftsResult,
      ...(graphDepth > 0 ? { graph_related } : {}),
    });
  }

  // Hybrid: RRF (Reciprocal Rank Fusion) — run FTS and vector independently, fuse by rank
  if (a.query && a.embedding) {
    if (!Array.isArray(a.embedding) || a.embedding.length === 0) {
      return toolError("invalid_input", "embedding must be a non-empty number array");
    }

    const poolSize = Math.min(limit * 3, 100);

    const ftsResult = searchThoughts(db.db, {
      query: a.query,
      limit: poolSize,
      offset: 0,
      type: a.type,
      project: a.project,
      project_identifier: a.project_identifier,
      include_shared: a.include_shared,
      shared_only: a.shared_only,
    });

    const vectorResult = searchByEmbedding(db.db, a.embedding, poolSize);

    const ftsRanks = new Map<string, number>();
    ftsResult.results.forEach((r, i) => ftsRanks.set(r.id, i + 1));

    const vectorRanks = new Map<string, number>();
    vectorResult.forEach((r, i) => vectorRanks.set(r.id, i + 1));

    const metadataMap = new Map<string, { summary: string | null; type: string; topics: string[]; created_at: string; project: string | null; project_identifier: string | null; visibility: string }>();
    for (const r of ftsResult.results) {
      // FTS results are already filtered by project/project_identifier (if specified),
      // so those fields are not returned in SearchResult — mark as null/personal;
      // they will be overwritten by the DB lookup below if needed.
      metadataMap.set(r.id, { summary: r.summary, type: r.type, topics: r.topics, created_at: r.created_at, project: null, project_identifier: null, visibility: "personal" });
    }
    for (const r of vectorResult) {
      if (!metadataMap.has(r.id)) {
        metadataMap.set(r.id, { summary: r.summary, type: r.type, topics: r.topics, created_at: r.created_at, project: null, project_identifier: null, visibility: "personal" });
      }
    }

    // If project/project_identifier/shared filter is in play, fetch those fields
    // for all candidates from the DB. This is required because vector results
    // are not pre-filtered by project scope.
    if (a.project || a.project_identifier !== undefined || a.shared_only) {
      const allIds = Array.from(metadataMap.keys());
      const placeholders = allIds.map(() => "?").join(", ");
      const rows = db.db
        .prepare(`SELECT id, project, project_identifier, visibility FROM thoughts WHERE id IN (${placeholders})`)
        .all(...allIds) as Array<{ id: string; project: string | null; project_identifier: string | null; visibility: string }>;
      for (const row of rows) {
        const existing = metadataMap.get(row.id);
        if (existing) {
          existing.project = row.project;
          existing.project_identifier = row.project_identifier;
          existing.visibility = row.visibility;
        }
      }
    }

    const K = 60;
    const scored: Array<{ id: string; summary: string | null; type: string; topics: string[]; created_at: string; rrf_score: number }> = [];

    for (const [id, meta] of metadataMap) {
      const ftsRank = ftsRanks.get(id);
      const vecRank = vectorRanks.get(id);
      const rrf_score =
        (ftsRank ? 1 / (K + ftsRank) : 0) +
        (vecRank ? 1 / (K + vecRank) : 0);
      const { project: _project, ...rest } = meta;
      scored.push({ id, ...rest, rrf_score });
    }

    scored.sort((a, b) => b.rrf_score - a.rrf_score);

    // Post-fusion filter: enforce type and project constraints that were applied
    // to the FTS pool but bypassed by the vector pool.
    let filtered = scored as Array<{ id: string; summary: string | null; type: string; topics: string[]; created_at: string; rrf_score: number }>;
    if (a.type || a.project || a.project_identifier !== undefined || a.shared_only) {
      // Rebuild a project lookup from the metadata map for filtering.
      filtered = scored.filter((item) => {
        if (a.type && item.type !== a.type) return false;
        if (a.project) {
          const meta = metadataMap.get(item.id);
          if (!meta || meta.project !== a.project) return false;
        }
        if (a.shared_only) {
          const meta = metadataMap.get(item.id);
          if (!meta || meta.visibility !== "shared") return false;
        }
        if (a.project_identifier !== undefined) {
          const meta = metadataMap.get(item.id);
          if (!meta) return false;
          if (meta.project_identifier !== a.project_identifier) {
            if (!(a.include_shared && meta.visibility === "shared")) return false;
          }
        }
        return true;
      });
    }

    const total_count = filtered.length;
    const sliced = filtered.slice(offset, offset + limit);
    const graph_related = fetchGraphRelated(db, sliced.map((r) => r.id), graphDepth);

    return toolSuccess({
      mode: "hybrid",
      results: sliced,
      total_count,
      has_more: offset + sliced.length < total_count,
      offset,
      ...(graphDepth > 0 ? { graph_related } : {}),
    });
  }

  return toolError("invalid_input", "Unexpected search parameter combination");
}
