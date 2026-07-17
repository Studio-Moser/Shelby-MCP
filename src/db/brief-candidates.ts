import type Database from "better-sqlite3";
import type { TrustLevel } from "./thoughts.js";

export const BRIEF_CANDIDATE_LIMIT = 250;

export interface BriefCandidate {
  id: string;
  project_identifier: string | null;
  visibility: string;
  trust_level: TrustLevel;
  type: string;
  summary: string | null;
  source: string;
  reinforcement_count: number;
  consolidated_into: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  actively_refuted: boolean;
}

interface CandidateRow extends Omit<BriefCandidate, "metadata" | "actively_refuted"> {
  metadata: string | null;
  actively_refuted: number;
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** Load the bounded, deterministically prioritized input to the brief policy. */
export function loadBriefCandidates(
  db: Database.Database,
  now: string,
): BriefCandidate[] {
  const rows = db.prepare(`
    SELECT
      t.id, t.project_identifier, t.visibility, t.trust_level, t.type,
      t.summary, t.source, t.reinforcement_count, t.consolidated_into,
      t.metadata, t.created_at, t.updated_at,
      EXISTS (
        SELECT 1 FROM edges e
        WHERE e.source_id = t.id
          AND e.edge_type = 'refuted_by'
          AND (e.valid_from IS NULL OR e.valid_from <= @now)
          AND (e.valid_until IS NULL OR e.valid_until > @now)
      ) AS actively_refuted
    FROM thoughts t
    ORDER BY
      CASE WHEN json_valid(t.metadata) AND (
        json_extract(t.metadata, '$.extra.briefEligible') = 1 OR
        json_extract(t.metadata, '$.extra.briefRole') IN
          ('constraint', 'decision', 'milestone', 'blocker', 'preference')
      ) THEN 1 ELSE 0 END DESC,
      t.reinforcement_count DESC,
      t.updated_at DESC,
      t.id ASC
    LIMIT @limit
  `).all({ now, limit: BRIEF_CANDIDATE_LIMIT }) as CandidateRow[];

  return rows.map((row) => ({
    ...row,
    metadata: parseMetadata(row.metadata),
    actively_refuted: row.actively_refuted !== 0,
  }));
}
