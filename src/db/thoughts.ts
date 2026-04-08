import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

export type TrustLevel = "trusted" | "unverified" | "external";

export interface ThoughtInput {
  content: string;
  summary?: string;
  type?: string;
  source?: string;
  source_agent?: string;
  trust_level?: TrustLevel;
  project?: string;
  topics?: string[];
  people?: string[];
  visibility?: string;
  metadata?: Record<string, unknown>;
}

export interface ThoughtRecord {
  id: string;
  content: string;
  summary: string | null;
  type: string;
  source: string;
  source_agent: string | null;
  trust_level: TrustLevel;
  project: string | null;
  topics: string[];
  people: string[];
  visibility: string;
  metadata: Record<string, unknown> | null;
  embedding: Buffer | null;
  created_at: string;
  updated_at: string;
  consolidated_into: string | null;
  reinforcement_count: number;
}

export interface ThoughtSummary {
  id: string;
  summary: string | null;
  type: string;
  topics: string[];
  created_at: string;
}

export interface ListOptions {
  type?: string;
  project?: string;
  topic?: string;
  person?: string;
  source?: string;
  source_agent?: string;
  trust_level?: TrustLevel;
  since?: string;
  until?: string;
  has_summary?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListResult {
  results: ThoughtSummary[];
  total_count: number;
  has_more: boolean;
  offset: number;
}

interface RawThoughtRow {
  id: string;
  content: string;
  summary: string | null;
  type: string;
  source: string;
  source_agent: string | null;
  trust_level: TrustLevel;
  project: string | null;
  topics: string | null;
  people: string | null;
  visibility: string;
  metadata: string | null;
  embedding: Buffer | null;
  created_at: string;
  updated_at: string;
  consolidated_into: string | null;
  reinforcement_count: number;
}

interface RawSummaryRow {
  id: string;
  summary: string | null;
  type: string;
  topics: string | null;
  created_at: string;
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function rowToRecord(row: RawThoughtRow): ThoughtRecord {
  return {
    id: row.id,
    content: row.content,
    summary: row.summary,
    type: row.type,
    source: row.source,
    source_agent: row.source_agent,
    trust_level: row.trust_level ?? "trusted",
    project: row.project,
    topics: parseJsonArray(row.topics),
    people: parseJsonArray(row.people),
    visibility: row.visibility,
    metadata: parseJsonObject(row.metadata),
    embedding: row.embedding,
    created_at: row.created_at,
    updated_at: row.updated_at,
    consolidated_into: row.consolidated_into,
    reinforcement_count: row.reinforcement_count,
  };
}

function rowToSummary(row: RawSummaryRow): ThoughtSummary {
  return {
    id: row.id,
    summary: row.summary,
    type: row.type,
    topics: parseJsonArray(row.topics),
    created_at: row.created_at,
  };
}

export function insertThought(db: Database.Database, input: ThoughtInput): string {
  const id = uuidv4();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO thoughts (id, content, summary, type, source, source_agent, trust_level, project, topics, people, visibility, metadata, created_at, updated_at)
    VALUES (@id, @content, @summary, @type, @source, @source_agent, @trust_level, @project, @topics, @people, @visibility, @metadata, @created_at, @updated_at)
  `);

  stmt.run({
    id,
    content: input.content,
    summary: input.summary ?? null,
    type: input.type ?? "note",
    source: input.source ?? "unknown",
    source_agent: input.source_agent ?? null,
    trust_level: input.trust_level ?? "trusted",
    project: input.project ?? null,
    topics: input.topics ? JSON.stringify(input.topics) : null,
    people: input.people ? JSON.stringify(input.people) : null,
    visibility: input.visibility ?? "personal",
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    created_at: now,
    updated_at: now,
  });

  return id;
}

export function getThought(db: Database.Database, id: string): ThoughtRecord | null {
  const row = db.prepare("SELECT * FROM thoughts WHERE id = ?").get(id) as RawThoughtRow | undefined;
  if (!row) return null;
  return rowToRecord(row);
}

export function updateThought(
  db: Database.Database,
  id: string,
  updates: Partial<ThoughtInput>,
): boolean {
  const setClauses: string[] = [];
  const params: Record<string, unknown> = { id };

  if (updates.content !== undefined) {
    setClauses.push("content = @content");
    params.content = updates.content;
  }
  if (updates.summary !== undefined) {
    setClauses.push("summary = @summary");
    params.summary = updates.summary;
  }
  if (updates.type !== undefined) {
    setClauses.push("type = @type");
    params.type = updates.type;
  }
  if (updates.source !== undefined) {
    setClauses.push("source = @source");
    params.source = updates.source;
  }
  if (updates.project !== undefined) {
    setClauses.push("project = @project");
    params.project = updates.project;
  }
  if (updates.topics !== undefined) {
    setClauses.push("topics = @topics");
    params.topics = JSON.stringify(updates.topics);
  }
  if (updates.people !== undefined) {
    setClauses.push("people = @people");
    params.people = JSON.stringify(updates.people);
  }
  if (updates.visibility !== undefined) {
    setClauses.push("visibility = @visibility");
    params.visibility = updates.visibility;
  }
  if (updates.metadata !== undefined) {
    setClauses.push("metadata = @metadata");
    params.metadata = JSON.stringify(updates.metadata);
  }
  if (updates.source_agent !== undefined) {
    setClauses.push("source_agent = @source_agent");
    params.source_agent = updates.source_agent;
  }
  if (updates.trust_level !== undefined) {
    setClauses.push("trust_level = @trust_level");
    params.trust_level = updates.trust_level;
  }

  if (setClauses.length === 0) return false;

  setClauses.push("updated_at = @updated_at");
  params.updated_at = new Date().toISOString();

  const sql = `UPDATE thoughts SET ${setClauses.join(", ")} WHERE id = @id`;
  const result = db.prepare(sql).run(params);
  return result.changes > 0;
}

export function deleteThought(db: Database.Database, id: string): boolean {
  const result = db.prepare("DELETE FROM thoughts WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listThoughts(db: Database.Database, options: ListOptions = {}): ListResult {
  const whereClauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (options.type) {
    whereClauses.push("type = @type");
    params.type = options.type;
  }
  if (options.project) {
    whereClauses.push("project = @project");
    params.project = options.project;
  }
  if (options.topic) {
    whereClauses.push("topics LIKE @topic");
    params.topic = `%"${options.topic}"%`;
  }
  if (options.person) {
    whereClauses.push("people LIKE @person");
    params.person = `%"${options.person}"%`;
  }
  if (options.source) {
    whereClauses.push("source = @source");
    params.source = options.source;
  }
  if (options.source_agent) {
    whereClauses.push("source_agent = @source_agent");
    params.source_agent = options.source_agent;
  }
  if (options.trust_level) {
    whereClauses.push("trust_level = @trust_level");
    params.trust_level = options.trust_level;
  }
  if (options.since) {
    whereClauses.push("created_at >= @since");
    params.since = options.since;
  }
  if (options.until) {
    whereClauses.push("created_at <= @until");
    params.until = options.until;
  }
  if (options.has_summary === true) {
    whereClauses.push("summary IS NOT NULL AND summary != ''");
  } else if (options.has_summary === false) {
    whereClauses.push("(summary IS NULL OR summary = '')");
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  // Clamp limit
  let limit = options.limit ?? 20;
  if (limit < 1) limit = 1;
  if (limit > 100) limit = 100;

  const offset = options.offset ?? 0;

  // Count query
  const countRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM thoughts ${whereStr}`)
    .get(params) as { cnt: number };
  const totalCount = countRow.cnt;

  // Data query
  const rows = db
    .prepare(
      `SELECT id, summary, type, topics, created_at FROM thoughts ${whereStr} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit, offset }) as RawSummaryRow[];

  const results = rows.map(rowToSummary);

  return {
    results,
    total_count: totalCount,
    has_more: offset + results.length < totalCount,
    offset,
  };
}

export function countThoughts(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) AS cnt FROM thoughts").get() as { cnt: number };
  return row.cnt;
}
