import type Database from "better-sqlite3";

export interface SearchResult {
  id: string;
  summary: string | null;
  type: string;
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
}

export interface SearchListResult {
  results: SearchResult[];
  total_count: number;
  has_more: boolean;
  offset: number;
}

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

  const whereSQL = whereClauses.join(" AND ");

  // Count total matches
  const countSQL = `SELECT COUNT(*) as cnt FROM thoughts_fts JOIN thoughts t ON thoughts_fts.rowid = t.rowid WHERE ${whereSQL}`;
  const countRow = db.prepare(countSQL).get(...params) as { cnt: number };
  const total_count = countRow.cnt;

  // Fetch results with BM25 ranking
  const selectSQL = `SELECT t.id, t.summary, t.type, t.topics, t.created_at, rank FROM thoughts_fts JOIN thoughts t ON thoughts_fts.rowid = t.rowid WHERE ${whereSQL} ORDER BY rank LIMIT ? OFFSET ?`;
  const rows = db
    .prepare(selectSQL)
    .all(...params, limit, offset) as Array<{
    id: string;
    summary: string | null;
    type: string;
    topics: string | null;
    created_at: string;
    rank: number;
  }>;

  const results: SearchResult[] = rows.map((row) => ({
    id: row.id,
    summary: row.summary,
    type: row.type,
    topics: row.topics ? JSON.parse(row.topics) : [],
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
