import type { BriefCandidate } from "../db/brief-candidates.js";
import type { TrustLevel } from "../db/thoughts.js";

export const BRIEF_POLICY_VERSION = 2;
export type BriefScope = "essentials" | "recent" | "full";
export type BriefRole = "constraint" | "decision" | "milestone" | "blocker" | "preference" | "recent";
export type BriefOmissionReason =
  | "wrong_project" | "untrusted" | "consolidated" | "refuted"
  | "sensitive" | "ineligible" | "missing_summary" | "duplicate" | "over_budget";

export interface BriefItem {
  id: string;
  summary: string;
  role: BriefRole;
  source: string;
  trust_level: TrustLevel;
  updated_at: string;
  /**
   * Claims inside this thought that a claim-scoped `refuted_by` edge has superseded.
   * The thought itself still stands — only these claims are dead. Empty for most items.
   */
  refuted_claims: string[];
}

export interface BriefPolicyResult {
  items: BriefItem[];
  omitted_counts: Record<BriefOmissionReason, number>;
  policy_version: number;
}

export interface BriefPolicyInput {
  scope: BriefScope;
  project_id?: string;
  include_shared?: boolean;
  shared_only?: boolean;
  all_projects?: boolean;
  now: string;
}

const ROLES = new Set<BriefRole>(["constraint", "decision", "milestone", "blocker", "preference", "recent"]);
const LEGACY_TYPES = new Set(["decision", "reference", "insight"]);
const ESSENTIAL_ROLES = new Set<BriefRole>(["constraint", "decision", "milestone", "blocker", "preference"]);
const LANE: Record<BriefRole, number> = { constraint: 0, decision: 1, milestone: 2, blocker: 3, preference: 4, recent: 5 };

export function emptyOmissionCounts(): Record<BriefOmissionReason, number> {
  return {
    wrong_project: 0, untrusted: 0, consolidated: 0, refuted: 0,
    sensitive: 0, ineligible: 0, missing_summary: 0, duplicate: 0, over_budget: 0,
  };
}

interface EligibleItem extends BriefItem {
  explicitEligible: boolean;
  reinforcementCount: number;
}

function extraMetadata(candidate: BriefCandidate): Record<string, unknown> | null | undefined {
  if (!candidate.metadata || !("extra" in candidate.metadata)) return undefined;
  const extra = candidate.metadata.extra;
  return extra !== null && typeof extra === "object" && !Array.isArray(extra)
    ? extra as Record<string, unknown>
    : null;
}

const MARKDOWN_CONTROL_CHARS = new Set(["\\", "`", "*", "_", "[", "]", "<", ">", "#"]);

function removeControlCharacters(value: string): string {
  return Array.from(value).filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return !((codePoint >= 0 && codePoint <= 31) || (codePoint >= 127 && codePoint <= 159));
  }).join("");
}

/** Normalize, reject unsafe legacy summaries, then escape Markdown/control syntax. */
export function normalizeBriefSummary(summary: string): string | null {
  const normalized = removeControlCharacters(summary
    .normalize("NFC")
    .trim()
    .replace(/[\r\n\t]+/g, " "))
    .replace(/[ ]+/g, " ")
    .trim();
  if (!normalized) return null;

  const unsafe = [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?:\+?\d[\d .()-]{7,}\d)/,
    /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9_-]{8,})\b/i,
    /\b(?:api[_-]?key|token|password|secret)[=: ]+[A-Za-z0-9_./+-]{8,}\b/i,
    /(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+)/,
    /<\s*\/?\s*(?:system|assistant|developer|tool|context|instructions)\b/i,
    /^(?:(?:ignore|disregard|override|reveal|you must)\b|system:)/i,
    /^(?:#{1,6}\s|>\s|```|~~~)/,
  ];
  if (unsafe.some((pattern) => pattern.test(normalized))) return null;
  return Array.from(normalized, (character) =>
    MARKDOWN_CONTROL_CHARS.has(character) ? `\\${character}` : character
  ).join("");
}

/**
 * Claim text is free-form and reaches the brief, so it runs the same injection/PII gate
 * as summaries. A claim that fails the gate is dropped, never rendered unsanitized —
 * the thought keeps its remaining caveats and stays eligible either way.
 */
function sanitizeRefutedClaims(claims: string[]): string[] {
  const seen = new Set<string>();
  for (const claim of claims) {
    const safe = normalizeBriefSummary(claim);
    if (safe !== null) seen.add(safe);
  }
  return [...seen];
}

function classify(candidate: BriefCandidate): { role: BriefRole; explicitEligible: boolean; summary: string } | null {
  const extra = extraMetadata(candidate);
  if (extra === null) return null;
  const eligibleValue = extra?.briefEligible;
  if (eligibleValue !== undefined && typeof eligibleValue !== "boolean") return null;
  if (eligibleValue === false) return null;

  const sensitivity = extra?.sensitivity;
  if (sensitivity !== undefined && sensitivity !== "normal") return null;

  const roleValue = extra?.briefRole;
  if (roleValue !== undefined && (typeof roleValue !== "string" || !ROLES.has(roleValue as BriefRole))) return null;

  const explicitEligible = eligibleValue === true;
  let role: BriefRole;
  if (typeof roleValue === "string") role = roleValue as BriefRole;
  else if (LEGACY_TYPES.has(candidate.type)) role = "decision";
  else if (explicitEligible) role = "recent";
  else return null;

  const summary = candidate.summary === null ? null : normalizeBriefSummary(candidate.summary);
  if (summary === null) return null;
  return { role, explicitEligible, summary };
}

export function selectBriefItems(
  candidates: BriefCandidate[],
  input: BriefPolicyInput,
): BriefPolicyResult {
  const omitted = emptyOmissionCounts();
  const eligible: EligibleItem[] = [];
  const recentCutoff = new Date(new Date(input.now).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  for (const candidate of candidates) {
    const isShared = candidate.visibility === "shared";
    const wrongProject = input.shared_only === true
      ? !isShared
      : isShared
        ? input.include_shared === false
        : input.all_projects !== true && candidate.project_id !== input.project_id;
    if (wrongProject) { omitted.wrong_project++; continue; }
    if (candidate.trust_level !== "trusted") { omitted.untrusted++; continue; }
    if (candidate.consolidated_into !== null) { omitted.consolidated++; continue; }
    if (candidate.actively_refuted) { omitted.refuted++; continue; }

    const extra = extraMetadata(candidate);
    const sensitivity = extra && extra !== null ? extra.sensitivity : undefined;
    if (sensitivity !== undefined && sensitivity !== "normal") { omitted.sensitive++; continue; }
    if (isShared && (extra === null || extra?.briefEligible !== true)) { omitted.ineligible++; continue; }
    if (candidate.summary === null || candidate.summary.trim() === "") { omitted.missing_summary++; continue; }

    const classified = classify(candidate);
    if (!classified) {
      const unsafe = normalizeBriefSummary(candidate.summary) === null;
      omitted[unsafe ? "sensitive" : "ineligible"]++;
      continue;
    }

    const inEssentials = ESSENTIAL_ROLES.has(classified.role);
    const inRecent = candidate.updated_at >= recentCutoff;
    if (input.scope === "essentials" && !inEssentials) continue;
    if (input.scope === "recent" && !inRecent) continue;
    if (input.scope === "full" && !inEssentials && !inRecent) continue;

    eligible.push({
      id: candidate.id,
      summary: classified.summary,
      role: classified.role,
      source: candidate.source,
      trust_level: candidate.trust_level,
      updated_at: candidate.updated_at,
      refuted_claims: sanitizeRefutedClaims(candidate.refuted_claims),
      explicitEligible: classified.explicitEligible,
      reinforcementCount: candidate.reinforcement_count,
    });
  }

  eligible.sort((a, b) =>
    LANE[a.role] - LANE[b.role] ||
    Number(b.explicitEligible) - Number(a.explicitEligible) ||
    b.reinforcementCount - a.reinforcementCount ||
    b.updated_at.localeCompare(a.updated_at) ||
    a.id.localeCompare(b.id),
  );

  const ids = new Set<string>();
  const summaries = new Set<string>();
  const items: BriefItem[] = [];
  for (const item of eligible) {
    if (ids.has(item.id) || summaries.has(item.summary)) { omitted.duplicate++; continue; }
    ids.add(item.id);
    summaries.add(item.summary);
    const { explicitEligible: _, reinforcementCount: __, ...briefItem } = item;
    items.push(briefItem);
  }

  return { items, omitted_counts: omitted, policy_version: BRIEF_POLICY_VERSION };
}
