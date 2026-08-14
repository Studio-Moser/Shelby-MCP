import type { ThoughtDatabase } from "../db/database.js";
import { fetchGraphRelated } from "../db/edges.js";
import { searchThoughts } from "../db/fts.js";
import { searchByEmbedding } from "../db/vectors.js";
import { toolSuccess, toolError, clampLimit, type ToolResult } from "./helpers.js";
import { resolveReadProjectScope } from "./project-scope.js";
import {
	canonicalizeTopic,
	topicLikePattern,
} from "../db/topic-canonicalization.js";
import {
	recordSearchTelemetry,
	type SearchMode,
} from "../db/search-telemetry.js";
import { fenceThoughtSummaries } from "./trust-boundary.js";

interface SearchArgs {
  query?: string;
  embedding?: number[];
  limit?: number;
  offset?: number;
  type?: string;
  project?: string;
  project_id?: string;
  project_identifier?: string;
  include_shared?: boolean;
  shared_only?: boolean;
  all_projects?: boolean;
  graph_depth?: number;
	topic?: string;
}

interface SearchMetadata {
  id: string;
  project: string | null;
  project_id: string | null;
  project_identifier: string | null;
  visibility: string;
}

function loadSearchMetadata(
  db: ThoughtDatabase,
  ids: string[],
): Map<string, SearchMetadata> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(", ");
  const rows = db.db.prepare(`
    SELECT t.id, t.project, t.project_id,
      COALESCE(p.current_slug, t.project_identifier) AS project_identifier,
      t.visibility
    FROM thoughts t
    LEFT JOIN projects p ON p.project_id = t.project_id
    WHERE t.id IN (${placeholders})
  `).all(...ids) as SearchMetadata[];
  return new Map(rows.map((row) => [row.id, row]));
}

function eligibleVectorThoughtIds(
  db: ThoughtDatabase,
  args: SearchArgs,
  projectId: string | undefined,
): ReadonlySet<string> | undefined {
  const whereClauses = ["embedding IS NOT NULL"];
  const params: string[] = [];
  if (args.type) {
    whereClauses.push("type = ?");
    params.push(args.type);
  }
  if (args.project) {
    whereClauses.push("project = ?");
    params.push(args.project);
  }
	if (args.topic) {
		whereClauses.push("topics LIKE ?");
		params.push(topicLikePattern(args.topic));
	}
  if (args.shared_only) whereClauses.push("visibility = 'shared'");
  if (projectId !== undefined) {
    whereClauses.push(args.include_shared
      ? "(project_id = ? OR visibility = 'shared')"
      : "project_id = ?");
    params.push(projectId);
  }
  if (whereClauses.length === 1) return undefined;
  const rows = db.db.prepare(
    `SELECT id FROM thoughts WHERE ${whereClauses.join(" AND ")}`,
  ).all(...params) as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

function matchesFilters(
  item: { id: string; type: string; topics: string[] },
  metadata: Map<string, SearchMetadata>,
  args: SearchArgs,
  projectId: string | undefined,
	canonicalTopic: string | undefined,
): boolean {
  if (args.type && item.type !== args.type) return false;
	if (canonicalTopic && !item.topics.includes(canonicalTopic)) return false;
  const meta = metadata.get(item.id);
  if (!meta) return false;
  if (args.project && meta.project !== args.project) return false;
  if (args.shared_only && meta.visibility !== "shared") return false;
  if (projectId !== undefined && meta.project_id !== projectId) {
    if (!(args.include_shared && meta.visibility === "shared")) return false;
  }
  return true;
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
  if (a.embedding && (!Array.isArray(a.embedding) || a.embedding.length === 0)) {
    return toolError("invalid_input", "embedding must be a non-empty number array");
  }

  const scope = resolveReadProjectScope(db.db, a);
  if (scope.kind === "error") return scope.result;
  const projectId = a.all_projects === true ? undefined : scope.projectId;
  const limit = clampLimit(a.limit);
  const offset = a.offset ?? 0;
  const graphDepth = Math.min(Math.max(a.graph_depth ?? 0, 0), 5);
	const canonicalTopic = a.topic ? canonicalizeTopic(a.topic) : undefined;
  const eligibleThoughtIds = a.embedding
    ? eligibleVectorThoughtIds(db, a, projectId)
    : undefined;
	const recordTelemetry = (
		mode: SearchMode,
		results: Array<{ id: string }>,
		resultCount: number,
	): void => {
		try {
			recordSearchTelemetry(db.db, {
				query: a.query ?? "",
				mode,
				resultCount,
				topIds: results.map(({ id }) => id),
				projectIdentifier: a.all_projects === true ? null : scope.currentSlug ?? null,
			});
		} catch {
			// Telemetry is best-effort and must not affect search availability.
		}
	};

  if (a.embedding && !a.query) {
    const poolSize = projectId !== undefined || a.type || a.project || a.shared_only ? 100 : limit;
    const candidates = searchByEmbedding(
      db.db,
      a.embedding,
      poolSize,
      undefined,
      eligibleThoughtIds,
    );
    const metadata = loadSearchMetadata(db, candidates.map((item) => item.id));
    const filtered = candidates
      .filter((item) => matchesFilters(item, metadata, a, projectId, canonicalTopic))
      .map((item) => ({ ...item, ...metadata.get(item.id)! }));
    const results = filtered.slice(0, limit);
    const graph_related = fetchGraphRelated(db, results.map((r) => r.id), graphDepth);
		recordTelemetry("vector", results, filtered.length);
    return toolSuccess({
      mode: "vector",
      results: fenceThoughtSummaries(db.db, results),
      total_count: filtered.length,
      has_more: filtered.length > results.length,
      offset: 0,
      ...(graphDepth > 0
        ? { graph_related: fenceThoughtSummaries(db.db, graph_related) }
        : {}),
    });
  }

  if (a.query && !a.embedding) {
    const ftsResult = searchThoughts(db.db, {
      query: a.query,
      limit,
      offset,
      type: a.type,
      project: a.project,
      project_id: projectId,
      include_shared: a.include_shared,
      shared_only: a.shared_only,
			topic: a.topic,
    });
    const graph_related = fetchGraphRelated(db, ftsResult.results.map((r) => r.id), graphDepth);
		recordTelemetry("fts", ftsResult.results, ftsResult.total_count);
    return toolSuccess({
      mode: "fts",
      ...ftsResult,
      results: fenceThoughtSummaries(db.db, ftsResult.results),
      ...(graphDepth > 0
        ? { graph_related: fenceThoughtSummaries(db.db, graph_related) }
        : {}),
    });
  }

  if (a.query && a.embedding) {
    const poolSize = Math.min(limit * 3, 100);
    const ftsResult = searchThoughts(db.db, {
      query: a.query,
      limit: poolSize,
      offset: 0,
      type: a.type,
      project: a.project,
      project_id: projectId,
      include_shared: a.include_shared,
      shared_only: a.shared_only,
			topic: a.topic,
    });
    const vectorResult = searchByEmbedding(
      db.db,
      a.embedding,
      poolSize,
      undefined,
      eligibleThoughtIds,
    );
    const ftsRanks = new Map(ftsResult.results.map((item, index) => [item.id, index + 1]));
    const vectorRanks = new Map(vectorResult.map((item, index) => [item.id, index + 1]));
    const resultById = new Map<string, (typeof ftsResult.results)[number] | (typeof vectorResult)[number]>();
    for (const item of ftsResult.results) resultById.set(item.id, item);
    for (const item of vectorResult) if (!resultById.has(item.id)) resultById.set(item.id, item);
    const metadata = loadSearchMetadata(db, [...resultById.keys()]);
    const K = 60;
    const scored = [...resultById.values()]
      .filter((item) => matchesFilters(item, metadata, a, projectId, canonicalTopic))
      .map((item) => {
        const ftsRank = ftsRanks.get(item.id);
        const vectorRank = vectorRanks.get(item.id);
        const meta = metadata.get(item.id)!;
        return {
          id: item.id,
          summary: item.summary,
          type: item.type,
          topics: item.topics,
          created_at: item.created_at,
          project_id: meta.project_id,
          project_identifier: meta.project_identifier,
          visibility: meta.visibility,
          rrf_score:
        (ftsRank ? 1 / (K + ftsRank) : 0) +
            (vectorRank ? 1 / (K + vectorRank) : 0),
        };
      })
      .sort((left, right) => right.rrf_score - left.rrf_score);

    const total_count = scored.length;
    const sliced = scored.slice(offset, offset + limit);
    const graph_related = fetchGraphRelated(db, sliced.map((r) => r.id), graphDepth);
		recordTelemetry("hybrid", sliced, total_count);
    return toolSuccess({
      mode: "hybrid",
      results: fenceThoughtSummaries(db.db, sliced),
      total_count,
      has_more: offset + sliced.length < total_count,
      offset,
      ...(graphDepth > 0
        ? { graph_related: fenceThoughtSummaries(db.db, graph_related) }
        : {}),
    });
  }

  return toolError("invalid_input", "Unexpected search parameter combination");
}
