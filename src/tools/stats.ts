import type { ThoughtDatabase } from "../db/database.js";
import { countThoughts } from "../db/thoughts.js";
import { toolSuccess, type ToolResult } from "./helpers.js";

export function handleThoughtStats(
  db: ThoughtDatabase,
): ToolResult {
  const thoughtCount = countThoughts(db.db);

  const edgeCount = (
    db.db.prepare("SELECT COUNT(*) AS cnt FROM edges").get() as { cnt: number }
  ).cnt;

  // Type breakdown
  const typeRows = db.db
    .prepare("SELECT type, COUNT(*) AS cnt FROM thoughts GROUP BY type ORDER BY cnt DESC")
    .all() as Array<{ type: string; cnt: number }>;

  const byType: Record<string, number> = {};
  for (const row of typeRows) {
    byType[row.type] = row.cnt;
  }

  // Edge type breakdown
  const edgeTypeRows = db.db
    .prepare("SELECT edge_type, COUNT(*) AS cnt FROM edges GROUP BY edge_type ORDER BY cnt DESC")
    .all() as Array<{ edge_type: string; cnt: number }>;

  const byEdgeType: Record<string, number> = {};
  for (const row of edgeTypeRows) {
    byEdgeType[row.edge_type] = row.cnt;
  }

  // Count thoughts with embeddings
  const embeddingCount = (
    db.db
      .prepare("SELECT COUNT(*) AS cnt FROM thoughts WHERE embedding IS NOT NULL")
      .get() as { cnt: number }
  ).cnt;

  return toolSuccess({
    thought_count: thoughtCount,
    edge_count: edgeCount,
    embedding_count: embeddingCount,
    by_type: byType,
    by_edge_type: byEdgeType,
  });
}
