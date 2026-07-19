import type Database from "better-sqlite3";

export interface SearchResult {
  id: string;
  summary: string | null;
  type: string;
  project_id: string | null;
  project_identifier: string | null;
  topics: string[];
  created_at: string;
  rank: number;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  offset?: number;
  type?: string;
  project?: string;
  project_id?: string;
  include_shared?: boolean;
  shared_only?: boolean;
}

export interface SearchListResult {
  results: SearchResult[];
  total_count: number;
  has_more: boolean;
  offset: number;
}

// eslint-disable-next-line no-useless-escape
const FTS_SPECIAL_CHARS = /["\*\(\)\+\-\^:\{\}\[\]]/g;
const FTS_KEYWORDS = /\b(AND|OR|NOT|NEAR)\b/g;

export function sanitizeFTSQuery(query: string): string {
  let sanitized = query.replace(FTS_SPECIAL_CHARS, " ");
  sanitized = sanitized.replace(FTS_KEYWORDS, " ");
  const tokens = sanitized.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"*`).join(" ");
}

export function searchThoughts(
  db: Database.Database,
  options: SearchOptions,
): SearchListResult {
  const sanitized = sanitizeFTSQuery(options.query);
  if (sanitized === "") {
    return { results: [], total_count: 0, has_more: false, offset: 0 };
  }

  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const offset = options.offset ?? 0;

  const whereClauses: string[] = ["thoughts_fts MATCH ?"];
  const params: (string | number)[] = [sanitized];

  if (options.type) {
    whereClauses.push("t.type = ?");
    params.push(options.type);
  }
  if (options.project) {
    whereClauses.push("t.project = ?");
    params.push(options.project);
  }
  if (options.shared_only) {
    whereClauses.push("t.visibility = 'shared'");
  }
  if (options.project_id !== undefined) {
    if (options.include_shared) {
      whereClauses.push("(t.project_id = ? OR t.visibility = 'shared')");
    } else {
      whereClauses.push("t.project_id = ?");
    }
    params.push(options.project_id);
  }

  const whereSQL = whereClauses.join(" AND ");

  // Count total matches
  const countSQL = `SELECT COUNT(*) as cnt FROM thoughts_fts JOIN thoughts t ON thoughts_fts.rowid = t.rowid WHERE ${whereSQL}`;
  const countRow = db.prepare(countSQL).get(...params) as { cnt: number };
  const total_count = countRow.cnt;

  // Fetch results with BM25 ranking
  const selectSQL = `SELECT t.id, t.summary, t.type, t.project_id, COALESCE((SELECT current_slug FROM projects WHERE projects.project_id = t.project_id), t.project_identifier) AS project_identifier, t.topics, t.created_at, rank FROM thoughts_fts JOIN thoughts t ON thoughts_fts.rowid = t.rowid WHERE ${whereSQL} ORDER BY rank LIMIT ? OFFSET ?`;
  const rows = db
    .prepare(selectSQL)
    .all(...params, limit, offset) as Array<{
    id: string;
    summary: string | null;
    type: string;
    project_id: string | null;
    project_identifier: string | null;
    topics: string | null;
    created_at: string;
    rank: number;
  }>;

  const results: SearchResult[] = rows.map((row) => ({
    id: row.id,
    summary: row.summary,
    type: row.type,
    project_id: row.project_id,
    project_identifier: row.project_identifier,
    topics: (() => {
      try {
        const topics: unknown = row.topics ? JSON.parse(row.topics) : [];
        return Array.isArray(topics) ? topics : [];
      } catch {
        return [];
      }
    })(),
    created_at: row.created_at,
    rank: -row.rank, // Negate so higher = more relevant
  }));

  return {
    results,
    total_count,
    has_more: offset + results.length < total_count,
    offset,
  };
}
