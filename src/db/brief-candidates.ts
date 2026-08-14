import type Database from "better-sqlite3";
import type { TrustLevel } from "./thoughts.js";

export const BRIEF_CANDIDATE_LIMIT = 250;

export interface BriefCandidate {
  id: string;
  project_id: string | null;
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
  /** A whole-thought refutation is live: every claim in this thought is superseded. */
  actively_refuted: boolean;
  /** Claims superseded by claim-scoped refutations. The rest of the thought still stands. */
  refuted_claims: string[];
}

interface CandidateRow extends Omit<BriefCandidate, "metadata" | "actively_refuted" | "refuted_claims"> {
  metadata: string | null;
  actively_refuted: number;
  refuted_claims: string | null;
}

function parseRefutedClaims(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((claim): claim is string => typeof claim === "string") : [];
  } catch {
    return [];
  }
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

export interface BriefCandidateScope {
  project_id?: string;
  include_shared?: boolean;
  shared_only?: boolean;
  all_projects?: boolean;
}

/**
 * A `refuted_by` edge whose metadata carries a non-empty string `claim` refutes only
 * that claim; the rest of the source thought stands (ADR-0001 §Claim-scoped refutation).
 * Any other `refuted_by` edge — no `claim`, a blank one, or a non-string — refutes the
 * whole thought. Evaluates to the claim text, or NULL for a whole-thought refutation.
 */
const SCOPED_CLAIM = `(CASE
    WHEN json_valid(e.metadata)
      AND json_type(e.metadata, '$.claim') = 'text'
      AND trim(json_extract(e.metadata, '$.claim')) != ''
    THEN trim(json_extract(e.metadata, '$.claim'))
  END)`;

const ELIGIBLE_SHARED = `visibility = 'shared' AND json_valid(metadata)
  AND json_type(metadata, '$.extra.briefEligible') = 'true'`;

const VALID_EXPLICIT_METADATA = `json_valid(t.metadata)
  AND json_type(t.metadata) = 'object'
  AND json_type(t.metadata, '$.extra') = 'object'
  AND json_type(t.metadata, '$.extra.briefEligible') = 'true'
  AND (
    json_type(t.metadata, '$.extra.briefRole') IS NULL OR
    (json_type(t.metadata, '$.extra.briefRole') = 'text' AND
      json_extract(t.metadata, '$.extra.briefRole') IN
        ('constraint', 'decision', 'milestone', 'blocker', 'preference', 'recent'))
  )
  AND (
    json_type(t.metadata, '$.extra.sensitivity') IS NULL OR
    (json_type(t.metadata, '$.extra.sensitivity') = 'text' AND
      json_extract(t.metadata, '$.extra.sensitivity') = 'normal')
  )`;

// `preference` is retained as a legacy alias for rows captured before preferences
// were folded into the canonical `decision` type.
const LEGACY_SAFE = `t.type IN ('decision', 'reference', 'insight', 'preference')
  AND json_valid(t.metadata)
  AND json_type(t.metadata) = 'object'
  AND (
    json_type(t.metadata, '$.extra') IS NULL OR
    (json_type(t.metadata, '$.extra') = 'object'
      AND (
        json_type(t.metadata, '$.extra.briefEligible') IS NULL OR
        json_type(t.metadata, '$.extra.briefEligible') = 'true'
      )
      AND (
        json_type(t.metadata, '$.extra.briefRole') IS NULL OR
        (json_type(t.metadata, '$.extra.briefRole') = 'text' AND
          json_extract(t.metadata, '$.extra.briefRole') IN
            ('constraint', 'decision', 'milestone', 'blocker', 'preference', 'recent'))
      )
      AND (
        json_type(t.metadata, '$.extra.sensitivity') IS NULL OR
        (json_type(t.metadata, '$.extra.sensitivity') = 'text' AND
          json_extract(t.metadata, '$.extra.sensitivity') = 'normal')
      )
    )
  )`;

function scopePriority(scope: BriefCandidateScope): string {
  if (scope.all_projects === true) {
    return `(visibility != 'shared' OR (${ELIGIBLE_SHARED}))`;
  }
  if (scope.shared_only === true || scope.project_id === undefined) {
    return `(${ELIGIBLE_SHARED})`;
  }
  if (scope.include_shared === false) {
    return `(visibility != 'shared' AND project_id = @project_id)`;
  }
  return `((visibility != 'shared' AND project_id = @project_id) OR (${ELIGIBLE_SHARED}))`;
}

/** Load bounded candidates with potentially eligible requested-scope rows before diagnostics. */
export function loadBriefCandidates(
  db: Database.Database,
  now: string,
  scope: BriefCandidateScope = {},
): BriefCandidate[] {
  const requestedScope = scopePriority(scope);
  const rows = db.prepare(`
    SELECT
      t.id, t.project_id,
      COALESCE((SELECT current_slug FROM projects WHERE projects.project_id = t.project_id), t.project_identifier) AS project_identifier,
      t.visibility, t.trust_level, t.type,
      t.summary, t.source, t.reinforcement_count, t.consolidated_into,
      t.metadata, t.created_at, t.updated_at,
      EXISTS (
        SELECT 1 FROM edges e
        WHERE e.source_id = t.id
          AND e.edge_type = 'refuted_by'
          AND ${SCOPED_CLAIM} IS NULL
          AND (e.valid_from IS NULL OR e.valid_from <= @now)
          AND (e.valid_until IS NULL OR e.valid_until > @now)
      ) AS actively_refuted,
      (
        SELECT json_group_array(${SCOPED_CLAIM})
        FROM edges e
        WHERE e.source_id = t.id
          AND e.edge_type = 'refuted_by'
          AND ${SCOPED_CLAIM} IS NOT NULL
          AND (e.valid_from IS NULL OR e.valid_from <= @now)
          AND (e.valid_until IS NULL OR e.valid_until > @now)
      ) AS refuted_claims
    FROM thoughts t
    ORDER BY
      CASE WHEN ${requestedScope} THEN 1 ELSE 0 END DESC,
      CASE
        WHEN ${VALID_EXPLICIT_METADATA} THEN 2
        WHEN ${LEGACY_SAFE} THEN 1
        ELSE 0
      END DESC,
      t.reinforcement_count DESC,
      t.updated_at DESC,
      t.id ASC
    LIMIT @limit
  `).all({
    now,
    limit: BRIEF_CANDIDATE_LIMIT,
    project_id: scope.project_id ?? null,
  }) as CandidateRow[];

  return rows.map((row) => ({
    ...row,
    metadata: parseMetadata(row.metadata),
    actively_refuted: row.actively_refuted !== 0,
    refuted_claims: parseRefutedClaims(row.refuted_claims),
  }));
}
