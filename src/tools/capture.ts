import type { ThoughtDatabase } from "../db/database.js";
import {
	getThought,
	incrementReinforcement,
	insertThought,
	updateThought,
	type ThoughtInput,
	type TrustLevel,
} from "../db/thoughts.js";
import { linkThoughts } from "../db/edges.js";
import {
	resolveProjectReference,
	resolveProjectScope,
	upsertProvisionalProject,
} from "../db/resolve-project.js";
import type { ProjectScopeResolution } from "../db/resolve-project.js";
import type { ProjectReferenceResolution } from "../db/project-identity.js";
import {
	findReconciliationCandidates,
	reconcile,
	tokenize,
} from "../db/reconciliation.js";
import { canonicalizeTopics } from "../db/topic-canonicalization.js";
import {
  toolSuccess,
  toolError,
  type ToolResult,
  MAX_CONTENT_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_TOPIC_LENGTH,
  MAX_TOPICS_COUNT,
  MAX_PEOPLE_COUNT,
  MAX_PERSON_LENGTH,
  MAX_BULK_THOUGHTS,
} from "./helpers.js";
import { canReconcileCapture, fenceThoughtSummaries } from "./trust-boundary.js";

interface SuggestedConnection {
  id: string;
  summary: string | null;
  similarity_reason: string;
	edge_type?: "refuted_by";
	source_id?: string;
	target_id?: string;
}

const SUGGESTION_LIMIT = 5;

type CaptureAction = "created" | "reinforced" | "merged" | "superseded" | "stored_unverified";

interface CaptureArgs {
  content?: string;
  summary?: string;
  type?: string;
  source?: string;
  source_agent?: string;
  trust_level?: TrustLevel;
  project?: string;
	project_id?: string;
  project_identifier?: string;
  visibility?: string;
  topics?: string[];
  people?: string[];
  metadata?: Record<string, unknown>;
  related_to?: string[];
  thoughts?: Array<{
    content: string;
    summary?: string;
    type?: string;
    source?: string;
    source_agent?: string;
    trust_level?: TrustLevel;
    project?: string;
		project_id?: string;
    project_identifier?: string;
    visibility?: string;
    topics?: string[];
    people?: string[];
    metadata?: Record<string, unknown>;
    related_to?: string[];
  }>;
}

function stricterSensitivity(
	existing: Record<string, unknown> | null,
	incoming: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	const sensitivityRank = (value: unknown): number => {
		if (value === undefined || value === "normal") return 0;
		if (value === "private") return 1;
		if (value === "secret") return 2;
		return 0;
	};
	const existingExtra = existing?.extra;
	const incomingExtra = incoming?.extra;
	const existingSensitivity = existingExtra !== null && typeof existingExtra === "object" && !Array.isArray(existingExtra)
		? (existingExtra as Record<string, unknown>).sensitivity
		: undefined;
	const incomingSensitivity = incomingExtra !== null && typeof incomingExtra === "object" && !Array.isArray(incomingExtra)
		? (incomingExtra as Record<string, unknown>).sensitivity
		: undefined;
	if (
		typeof incomingSensitivity !== "string" ||
		sensitivityRank(incomingSensitivity) <= sensitivityRank(existingSensitivity)
	) return undefined;
	return {
		...(existing ?? {}),
		extra: {
			...(existingExtra !== null && typeof existingExtra === "object" && !Array.isArray(existingExtra)
				? existingExtra as Record<string, unknown>
				: {}),
			sensitivity: incomingSensitivity,
		},
	};
}

function trustRank(value: TrustLevel): number {
	if (value === "trusted") return 2;
	if (value === "unverified") return 1;
	return 0;
}

/**
 * Validate input fields for a single thought against OWASP ASI06 memory poisoning limits.
 * Returns an error string if any limit is exceeded, or null if valid.
 */
function validateThoughtInput(t: {
  content: string;
  summary?: string;
  topics?: string[];
  people?: string[];
}): string | null {
  if (t.content.length > MAX_CONTENT_LENGTH) {
    return `content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters (got ${t.content.length})`;
  }
  if (t.summary !== undefined && t.summary.length > MAX_SUMMARY_LENGTH) {
    return `summary exceeds maximum length of ${MAX_SUMMARY_LENGTH} characters (got ${t.summary.length})`;
  }
  if (t.topics !== undefined) {
    if (t.topics.length > MAX_TOPICS_COUNT) {
      return `topics array exceeds maximum of ${MAX_TOPICS_COUNT} entries`;
    }
    for (const topic of t.topics) {
      if (topic.length > MAX_TOPIC_LENGTH) {
        return `topic "${topic.slice(0, 30)}..." exceeds maximum length of ${MAX_TOPIC_LENGTH} characters`;
      }
    }
  }
  if (t.people !== undefined) {
    if (t.people.length > MAX_PEOPLE_COUNT) {
      return `people array exceeds maximum of ${MAX_PEOPLE_COUNT} entries`;
    }
    for (const person of t.people) {
      if (person.length > MAX_PERSON_LENGTH) {
        return `person "${person.slice(0, 30)}..." exceeds maximum length of ${MAX_PERSON_LENGTH} characters`;
      }
    }
  }
  return null;
}

function captureSingle(
  db: ThoughtDatabase,
  args: {
    content: string;
    summary?: string;
    type?: string;
    source?: string;
    source_agent?: string;
    trust_level?: TrustLevel;
    project?: string;
    project_identifier?: string;
    visibility?: string;
    topics?: string[];
    people?: string[];
    metadata?: Record<string, unknown>;
    related_to?: string[];
  },
	resolvedScope: Extract<
		ProjectReferenceResolution,
		{ kind: "resolved" }
	> | null,
): {
	id: string;
	action: CaptureAction;
	linked: string[];
	skipped: string[];
	suggested_connections: SuggestedConnection[];
} {
  // Default visibility: 'shared' for preference type, otherwise 'personal'
  const effectiveVisibility =
    args.visibility ?? (args.type === "preference" ? "shared" : "personal");
	const effectiveType = args.type === "preference" ? "decision" : args.type;
	const type = effectiveType ?? "note";
	const projectIdentifier = resolvedScope?.currentSlug ?? null;
	const topics = canonicalizeTopics(args.topics ?? []);
	const contentTokens = tokenize(args.content);
	const incomingTrust = args.trust_level ?? "trusted";
	const allCandidates = findReconciliationCandidates(
		db.db,
		args.content,
		resolvedScope?.projectId ?? null,
		args.project ?? null,
		contentTokens,
	);
	const candidates = allCandidates.filter((candidate) => canReconcileCapture(
		incomingTrust,
		candidate.trust_level,
	));
	const blockedCandidates = allCandidates.filter((candidate) => !canReconcileCapture(
		incomingTrust,
		candidate.trust_level,
	));
	const decision = reconcile(args.content, type, candidates, contentTokens);
	const blockedDecision = reconcile(args.content, type, blockedCandidates, contentTokens);
	const trustGatePreventedReconciliation = blockedDecision.action === "noop" ||
		blockedDecision.suggestedEdges.some(({ edgeType }) => edgeType === "refuted_by");

	if (decision.action === "noop") {
		const existing = getThought(db.db, decision.existingId)!;
		const mergedTopics = [...new Set([...existing.topics, ...topics])];
		const mergedPeople = [...new Set([...existing.people, ...(args.people ?? [])])];
		const updates: Partial<ThoughtInput> = {};
		if (mergedTopics.length !== existing.topics.length) updates.topics = mergedTopics;
		if (mergedPeople.length !== existing.people.length) updates.people = mergedPeople;
		if (args.summary?.trim() && args.summary !== existing.summary) updates.summary = args.summary;
		if (existing.visibility === "shared" && effectiveVisibility === "personal") {
			updates.visibility = "personal";
		}
		if (trustRank(incomingTrust) > trustRank(existing.trust_level)) {
			updates.trust_level = incomingTrust;
		}
		const metadata = stricterSensitivity(existing.metadata, args.metadata);
		if (metadata) updates.metadata = metadata;
		const action: CaptureAction = Object.keys(updates).length > 0 ? "merged" : "reinforced";
		incrementReinforcement(db.db, existing.id, 1, true);
		if (Object.keys(updates).length > 0) updateThought(db.db, existing.id, updates);
		const links = attachRelated(db, existing.id, args.related_to);
		return {
			id: existing.id,
			action,
			...links,
			suggested_connections: [],
		};
	}

  const id = insertThought(db.db, {
    content: args.content,
    summary: args.summary,
		type,
    source: args.source,
    source_agent: args.source_agent,
    trust_level: args.trust_level,
    project: args.project,
		project_identifier: projectIdentifier ?? undefined,
    visibility: effectiveVisibility,
		topics: topics,
    people: args.people,
    metadata: args.metadata,
  });

	if (resolvedScope) {
		db.db
			.prepare("UPDATE thoughts SET project_id = ? WHERE id = ?")
			.run(resolvedScope.projectId, id);
	}
	const reversals = decision.suggestedEdges.filter(({ edgeType }) => edgeType === "refuted_by");
	for (const { id: supersededId } of reversals) {
		linkThoughts(db, {
			source_id: supersededId,
			target_id: id,
			edge_type: "refuted_by",
		});
	}

	const links = attachRelated(db, id, [
		...(args.related_to ?? []),
		...decision.suggestedEdges.filter(({ autoApply }) => autoApply).map(({ id }) => id),
	], new Set(candidates.map((candidate) => candidate.id)));
	const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
	const suggested_connections = fenceThoughtSummaries(db.db, decision.suggestedEdges
		.filter(({ autoApply }) => !autoApply)
		.slice(0, SUGGESTION_LIMIT)
		.map(({ id: candidateId, similarity, edgeType }) => ({
			id: candidateId,
			summary: byId.get(candidateId)?.summary ?? null,
			similarity_reason: `Jaccard token similarity: ${similarity.toFixed(2)}`,
			...(edgeType ? {
				edge_type: edgeType,
				source_id: candidateId,
				target_id: id,
			} : {}),
		})));

	const action: CaptureAction = reversals.length > 0
		? "superseded"
		: trustGatePreventedReconciliation
			? "stored_unverified"
			: "created";
	return { id, action, ...links, suggested_connections };
}

function attachRelated(
	db: ThoughtDatabase,
	sourceId: string,
	relatedIds: string[] | undefined,
	knownExistingIds: ReadonlySet<string> = new Set(),
): { linked: string[]; skipped: string[] } {
	const linked: string[] = [];
	const skipped: string[] = [];
	const uniqueIds = [...new Set(relatedIds ?? [])];
	const idsToCheck = uniqueIds.filter(
		(id) => id !== sourceId && !knownExistingIds.has(id),
	);
	const existingIds = new Set(knownExistingIds);
	if (idsToCheck.length > 0) {
		const placeholders = idsToCheck.map(() => "?").join(", ");
		const rows = db.db
			.prepare(`SELECT id FROM thoughts WHERE id IN (${placeholders})`)
			.all(...idsToCheck) as Array<{ id: string }>;
		for (const { id } of rows) existingIds.add(id);
	}
	for (const relatedId of uniqueIds) {
		if (relatedId === sourceId || !existingIds.has(relatedId)) {
			skipped.push(relatedId);
			continue;
		}
		try {
			linkThoughts(db, {
				source_id: sourceId,
				target_id: relatedId,
				edge_type: "related",
			});
			linked.push(relatedId);
		} catch {
			skipped.push(relatedId);
		}
	}
	return { linked, skipped };
}

type ResolvedReference = Extract<
	ProjectReferenceResolution,
	{ kind: "resolved" }
>;
type CaptureScope = {
	reference: ResolvedReference | null;
	resolution?: Extract<ProjectScopeResolution, { kind: "resolved" }>;
};

function captureScopeError(
	resolution: Exclude<ProjectReferenceResolution, { kind: "resolved" }>,
): ToolResult {
	return toolError(
		"project_scope_invalid",
		`Project scope could not be resolved (${resolution.kind}). Pass a registered project_id or project_identifier.`,
	);
}

function captureScope(
  db: ThoughtDatabase,
	args: {
		project_id?: string;
		project_identifier?: string;
		visibility?: string;
		type?: string;
	},
  detectedScope: ProjectScopeResolution,
): CaptureScope | ToolResult {
	const hasExplicitScope =
		args.project_id !== undefined || args.project_identifier !== undefined;
	if (hasExplicitScope) {
		const reference = resolveProjectReference(db.db, {
			projectId: args.project_id,
			projectIdentifier: args.project_identifier,
		});
		return reference.kind === "resolved"
			? { reference }
			: captureScopeError(reference);
  }

	const visibility =
		args.visibility ?? (args.type === "preference" ? "shared" : "personal");
	if (visibility === "shared") return { reference: null };
	if (detectedScope.kind === "unresolved") {
		return toolError(
			"project_scope_unresolved",
			"Personal captures require a project. Pass a registered project_id or project_identifier, or configure MCP client roots.",
		);
  }
	if (detectedScope.kind === "ambiguous") {
		return toolError(
			"project_scope_ambiguous",
			`Client roots resolve to multiple projects (${detectedScope.slugs.join(", ")}). Pass a registered project_id or project_identifier.`,
		);
	}
	if (detectedScope.kind === "invalid_explicit") {
		return toolError(
			"project_scope_invalid",
			`project_identifier "${detectedScope.slug}" is unknown or noncanonical.`,
		);
  }

	const reference = resolveProjectReference(db.db, {
		projectIdentifier: detectedScope.slug,
	});
	if (reference.kind === "resolved") {
		return { reference, resolution: detectedScope };
	}
	if (detectedScope.source !== "derived") return captureScopeError(reference);
	return { reference: null, resolution: detectedScope };
}

function isToolError(value: CaptureScope | ToolResult): value is ToolResult {
  return "content" in value;
}

function resolveCaptureScope(
	db: ThoughtDatabase,
	scope: CaptureScope,
): ResolvedReference | null {
	if (scope.reference || !scope.resolution) return scope.reference;
	upsertProvisionalProject(db.db, scope.resolution);
	const reference = resolveProjectReference(db.db, {
		projectIdentifier: scope.resolution.slug,
	});
	if (reference.kind !== "resolved")
		throw new Error("project_scope_resolution_failed");
	return reference;
}

export function handleCaptureThought(
  db: ThoughtDatabase,
  args: Record<string, unknown>,
	detectedScope: ProjectScopeResolution = resolveProjectScope(db.db, [
		process.cwd(),
	]),
): ToolResult {
  const a = args as unknown as CaptureArgs;

  // Bulk capture mode
  if (a.thoughts && Array.isArray(a.thoughts)) {
    if (a.thoughts.length === 0) {
      return toolError("invalid_input", "thoughts array is empty");
    }

    if (a.thoughts.length > MAX_BULK_THOUGHTS) {
      return toolError(
        "invalid_input",
        `bulk capture exceeds maximum of ${MAX_BULK_THOUGHTS} thoughts per call (got ${a.thoughts.length})`,
      );
    }

    for (const thought of a.thoughts) {
      if (!thought.content || typeof thought.content !== "string") {
				return toolError(
					"invalid_input",
					"Each thought in bulk capture must have a content string",
				);
      }
      const err = validateThoughtInput(thought);
      if (err) return toolError("invalid_input", err);
    }

		const scopes = a.thoughts.map((thought) =>
			captureScope(db, thought, detectedScope),
		);
    const scopeError = scopes.find(isToolError);
    if (scopeError) return scopeError;

		const results = db.db.transaction(() =>
			a.thoughts!.map((thought, index) => {
				const scope = scopes[index] as CaptureScope;
				return captureSingle(db, thought, resolveCaptureScope(db, scope));
			}),
		)();

    return toolSuccess({
      captured: results.length,
      thoughts: results,
    });
  }

  // Single capture mode
  if (!a.content || typeof a.content !== "string") {
    return toolError(
      "invalid_input",
      "content is required and must be a string. For bulk capture, provide a thoughts array.",
    );
  }

  const singleErr = validateThoughtInput({
    content: a.content,
    summary: a.summary,
    topics: a.topics,
    people: a.people,
  });
  if (singleErr) {
    return toolError("invalid_input", singleErr);
  }

  const scope = captureScope(db, a, detectedScope);
  if (isToolError(scope)) return scope;
  const content = a.content;

  const result = db.db.transaction(() => {
		return captureSingle(
			db,
			{
      content,
      summary: a.summary,
      type: a.type,
      source: a.source,
      source_agent: a.source_agent,
      trust_level: a.trust_level,
      project: a.project,
      project_identifier: a.project_identifier,
      visibility: a.visibility,
      topics: a.topics,
      people: a.people,
      metadata: a.metadata,
      related_to: a.related_to,
			},
			resolveCaptureScope(db, scope),
		);
  })();

  return toolSuccess({
    id: result.id,
		action: result.action,
    linked: result.linked,
    skipped: result.skipped,
		suggested_connections: result.suggested_connections,
  });
}
