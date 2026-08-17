import type Database from "better-sqlite3";
import { sanitizeFTSQuery } from "./fts.js";
import type { TrustLevel } from "./thoughts.js";

const MIN_TOKENS = 4;
const NOOP_THRESHOLD = 0.9;
const AUTO_EDGE_THRESHOLD = 0.8;
const SUGGEST_THRESHOLD = 0.3;
const CANDIDATE_LIMIT = 20;

export interface ReconciliationCandidate {
	id: string;
	content: string;
	type: string;
	summary?: string | null;
	trust_level?: TrustLevel | null;
}

export interface SuggestedEdge {
	id: string;
	similarity: number;
	autoApply: boolean;
	edgeType?: "refuted_by";
}

export type ReconciliationDecision =
	| { action: "noop"; existingId: string; suggestedEdges: [] }
	| { action: "add"; suggestedEdges: SuggestedEdge[] };

export function tokenize(content: string): Set<string> {
	return new Set(tokenSequence(content));
}

function tokenSequence(content: string): string[] {
	return content.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
	let intersection = 0;
	for (const token of left) if (right.has(token)) intersection++;
	return intersection / (left.size + right.size - intersection);
}

function orderedSimilarity(left: string, right: string): number {
	const bigrams = (content: string): Set<string> => {
		const tokens = tokenSequence(content);
		return new Set(tokens.slice(1).map((token, index) => `${tokens[index]}\0${token}`));
	};
	return jaccard(bigrams(left), bigrams(right));
}

export function reconcile(
	content: string,
	type: string,
	candidates: ReconciliationCandidate[],
	inputTokens: ReadonlySet<string> = tokenize(content),
): ReconciliationDecision {
	if (inputTokens.size < MIN_TOKENS) return { action: "add", suggestedEdges: [] };

	const scored = candidates.map((candidate) => {
		const candidateTokens = tokenize(candidate.content);
		return {
			id: candidate.id,
			similarity: jaccard(inputTokens, candidateTokens),
			orderedSimilarity: orderedSimilarity(content, candidate.content),
			type: candidate.type,
		};
	}).sort((left, right) => right.similarity - left.similarity || left.id.localeCompare(right.id));

	const duplicate = scored.find(({ similarity, orderedSimilarity, type: candidateType }) =>
		candidateType === type && similarity >= NOOP_THRESHOLD && orderedSimilarity >= NOOP_THRESHOLD,
	);
	if (duplicate) {
		return { action: "noop", existingId: duplicate.id, suggestedEdges: [] };
	}

	return {
		action: "add",
		suggestedEdges: scored
			.filter(({ similarity }) => similarity >= SUGGEST_THRESHOLD)
			.map(({ id, similarity, orderedSimilarity, type: candidateType }) => ({
				id,
				similarity,
				autoApply: similarity >= AUTO_EDGE_THRESHOLD && !(
					candidateType === type && similarity >= NOOP_THRESHOLD && orderedSimilarity < NOOP_THRESHOLD
				),
				...(candidateType === type && similarity >= NOOP_THRESHOLD && orderedSimilarity < NOOP_THRESHOLD
					? { edgeType: "refuted_by" as const }
					: {}),
			})),
	};
}

export function findReconciliationCandidates(
	db: Database.Database,
	content: string,
	projectId: string | null,
	project: string | null,
	inputTokens: ReadonlySet<string> = tokenize(content),
): ReconciliationCandidate[] {
	if (inputTokens.size < MIN_TOKENS) return [];
	const ftsQuery = sanitizeFTSQuery(content.slice(0, 200));
	if (ftsQuery === "") return [];
	if (projectId === null && project !== null) return [];
	const scopeClause = projectId === null
		? `t.project_id IS NULL
		   AND t.project_identifier IS NULL
		   AND t.project IS NULL
		   AND t.visibility = 'personal'`
		: `t.project_id = @project_id
		   AND (t.project_identifier IS NULL OR EXISTS (
		     SELECT 1 FROM project_slug_aliases alias
		     WHERE alias.slug = t.project_identifier
		       AND alias.project_id = t.project_id
		   ))`;
	const rows = db.prepare(
		`SELECT t.id, t.content, t.type, t.summary, t.trust_level
		 FROM thoughts_fts
		 JOIN thoughts t ON thoughts_fts.rowid = t.rowid
		 WHERE thoughts_fts MATCH @query
		   AND ${scopeClause}
		 ORDER BY rank
		 LIMIT @limit`,
	).all({
		query: ftsQuery,
		project_id: projectId,
		limit: CANDIDATE_LIMIT,
	}) as Array<{
		id: string;
		content: string;
		type: string;
		summary: string | null;
		trust_level: TrustLevel | null;
	}>;
	return rows;
}
