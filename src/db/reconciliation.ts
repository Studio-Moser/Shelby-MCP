import type Database from "better-sqlite3";

const MIN_TOKENS = 4;
const NOOP_THRESHOLD = 0.9;
const AUTO_EDGE_THRESHOLD = 0.8;
const SUGGEST_THRESHOLD = 0.3;
const CANDIDATE_LIMIT = 20;

export interface ReconciliationCandidate {
	id: string;
	content: string;
	type?: string;
	summary?: string | null;
	topics?: string[];
	people?: string[];
}

export interface SuggestedEdge {
	id: string;
	similarity: number;
	autoApply: boolean;
}

export type ReconciliationDecision =
	| { action: "noop"; existingId: string; suggestedEdges: [] }
	| { action: "add"; suggestedEdges: SuggestedEdge[] };

function tokens(content: string): Set<string> {
	return new Set(content.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function jaccard(left: Set<string>, right: Set<string>): number {
	let intersection = 0;
	for (const token of left) if (right.has(token)) intersection++;
	return intersection / (left.size + right.size - intersection);
}

export function reconcile(
	content: string,
	type: string,
	candidates: ReconciliationCandidate[],
): ReconciliationDecision {
	const inputTokens = tokens(content);
	if (inputTokens.size < MIN_TOKENS) return { action: "add", suggestedEdges: [] };

	const scored = candidates.flatMap((candidate) => {
		if (candidate.type !== undefined && candidate.type !== type) return [];
		const candidateTokens = tokens(candidate.content);
		if (candidateTokens.size < MIN_TOKENS) return [];
		return [{
			id: candidate.id,
			similarity: jaccard(inputTokens, candidateTokens),
			autoApply: false,
		}];
	}).sort((left, right) => right.similarity - left.similarity || left.id.localeCompare(right.id));

	const duplicate = scored.find(({ similarity }) => similarity >= NOOP_THRESHOLD);
	if (duplicate) {
		return { action: "noop", existingId: duplicate.id, suggestedEdges: [] };
	}

	return {
		action: "add",
		suggestedEdges: scored
			.filter(({ similarity }) => similarity >= SUGGEST_THRESHOLD)
			.map((edge) => ({
				...edge,
				autoApply: edge.similarity >= AUTO_EDGE_THRESHOLD,
			})),
	};
}

function parseArray(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value)
			? value.filter((item): item is string => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}

export function findReconciliationCandidates(
	db: Database.Database,
	content: string,
	type: string,
	projectIdentifier: string | null,
): ReconciliationCandidate[] {
	const inputTokens = tokens(content);
	if (inputTokens.size < MIN_TOKENS) return [];
	const ftsQuery = [...inputTokens].map((token) => `"${token}"`).join(" OR ");
	const rows = db.prepare(
		`SELECT t.id, t.content, t.type, t.summary, t.topics, t.people
		 FROM thoughts_fts
		 JOIN thoughts t ON thoughts_fts.rowid = t.rowid
		 WHERE thoughts_fts MATCH @query
		   AND t.type = @type
		   AND (t.project_identifier = @project_identifier
		        OR (t.project_identifier IS NULL AND @project_identifier IS NULL))
		 ORDER BY rank
		 LIMIT @limit`,
	).all({
		query: ftsQuery,
		type,
		project_identifier: projectIdentifier,
		limit: CANDIDATE_LIMIT,
	}) as Array<{
		id: string;
		content: string;
		type: string;
		summary: string | null;
		topics: string | null;
		people: string | null;
	}>;
	return rows.map((row) => ({
		...row,
		topics: parseArray(row.topics),
		people: parseArray(row.people),
	}));
}
