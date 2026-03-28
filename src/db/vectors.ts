import type Database from "better-sqlite3";

export interface VectorSearchResult {
  id: string;
  summary: string | null;
  type: string;
  topics: string[];
  created_at: string;
  similarity: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export function embeddingToBuffer(embedding: number[]): Buffer {
  const buf = Buffer.alloc(embedding.length * 4);
  for (let i = 0; i < embedding.length; i++) {
    buf.writeFloatLE(embedding[i]!, i * 4);
  }
  return buf;
}

export function bufferToEmbedding(buf: Buffer): number[] {
  const len = buf.length / 4;
  const result: number[] = new Array(len);
  for (let i = 0; i < len; i++) {
    result[i] = buf.readFloatLE(i * 4);
  }
  return result;
}

export function storeEmbedding(
  db: Database.Database,
  thoughtId: string,
  embedding: number[],
): boolean {
  const row = db
    .prepare("SELECT id FROM thoughts WHERE id = ?")
    .get(thoughtId) as { id: string } | undefined;
  if (!row) return false;

  const buf = embeddingToBuffer(embedding);
  db.prepare("UPDATE thoughts SET embedding = ? WHERE id = ?").run(
    buf,
    thoughtId,
  );
  return true;
}

export function getEmbedding(
  db: Database.Database,
  thoughtId: string,
): number[] | null {
  const row = db
    .prepare("SELECT embedding FROM thoughts WHERE id = ?")
    .get(thoughtId) as { embedding: Buffer | null } | undefined;
  if (!row || !row.embedding) return null;
  return bufferToEmbedding(row.embedding);
}

export function searchByEmbedding(
  db: Database.Database,
  queryEmbedding: number[],
  limit?: number,
  threshold?: number,
): VectorSearchResult[] {
  const effectiveLimit = Math.max(1, Math.min(limit ?? 20, 100));
  const effectiveThreshold = threshold ?? 0.3;

  const rows = db
    .prepare(
      "SELECT id, summary, type, topics, created_at, embedding FROM thoughts WHERE embedding IS NOT NULL",
    )
    .all() as Array<{
    id: string;
    summary: string | null;
    type: string;
    topics: string | null;
    created_at: string;
    embedding: Buffer;
  }>;

  const scored: VectorSearchResult[] = [];
  for (const row of rows) {
    const emb = bufferToEmbedding(row.embedding);
    const sim = cosineSimilarity(queryEmbedding, emb);
    if (sim >= effectiveThreshold) {
      scored.push({
        id: row.id,
        summary: row.summary,
        type: row.type,
        topics: row.topics ? JSON.parse(row.topics) : [],
        created_at: row.created_at,
        similarity: sim,
      });
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, effectiveLimit);
}
