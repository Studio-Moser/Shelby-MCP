import type { ThoughtDatabase } from "../db/database.js";
import { insertThought, getThought } from "../db/thoughts.js";
import { linkThoughts } from "../db/edges.js";
import { searchThoughts, sanitizeFTSQuery } from "../db/fts.js";
import {
	resolveProjectReference,
	resolveProjectScope,
	upsertProvisionalProject,
} from "../db/resolve-project.js";
import type { ProjectScopeResolution } from "../db/resolve-project.js";
import type { ProjectReferenceResolution } from "../db/project-identity.js";
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

const SUGGESTION_LIMIT = 5;
const SUGGESTION_MIN_RANK = 0.5; // BM25 rank threshold (higher = more relevant)

interface SuggestedConnection {
  id: string;
  summary: string | null;
  similarity_reason: string;
}

/**
 * Run a quick FTS search against existing thoughts to find potential connections.
 * Returns up to SUGGESTION_LIMIT results above the rank threshold, excluding
 * the newly captured thought itself.
 */
function findSuggestedConnections(
  db: ThoughtDatabase,
  content: string,
  summary: string | undefined,
  excludeId: string,
): SuggestedConnection[] {
  // Build a search query from the summary (preferred, more focused) or first 200 chars of content
  const searchText = summary ?? content.slice(0, 200);
  if (!searchText.trim()) return [];

  const sanitized = sanitizeFTSQuery(searchText);
  if (!sanitized) return [];

  const ftsResult = searchThoughts(db.db, {
    query: sanitized,
    limit: SUGGESTION_LIMIT + 1, // +1 to account for possible self-match
    offset: 0,
  });

  const suggestions: SuggestedConnection[] = [];
  for (const r of ftsResult.results) {
    if (r.id === excludeId) continue;
    if (r.rank < SUGGESTION_MIN_RANK) continue;
    suggestions.push({
      id: r.id,
      summary: r.summary,
      similarity_reason: `FTS match (relevance: ${r.rank.toFixed(2)})`,
    });
    if (suggestions.length >= SUGGESTION_LIMIT) break;
  }

  return suggestions;
}

type TrustLevel = "trusted" | "unverified" | "external";

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
): { id: string; linked: string[]; skipped: string[] } {
  // Default visibility: 'shared' for preference type, otherwise 'personal'
  const effectiveVisibility =
    args.visibility ?? (args.type === "preference" ? "shared" : undefined);

  const id = insertThought(db.db, {
    content: args.content,
    summary: args.summary,
    type: args.type,
    source: args.source,
    source_agent: args.source_agent,
    trust_level: args.trust_level,
    project: args.project,
		project_identifier: resolvedScope?.currentSlug,
    visibility: effectiveVisibility,
    topics: args.topics,
    people: args.people,
    metadata: args.metadata,
  });

	if (resolvedScope) {
		db.db
			.prepare("UPDATE thoughts SET project_id = ? WHERE id = ?")
			.run(resolvedScope.projectId, id);
	}

  const linked: string[] = [];
  const skipped: string[] = [];

  if (args.related_to && Array.isArray(args.related_to)) {
    for (const relatedId of args.related_to) {
      const exists = getThought(db.db, relatedId);
      if (!exists) {
        skipped.push(relatedId);
        continue;
      }
      try {
        linkThoughts(db, {
          source_id: id,
          target_id: relatedId,
          edge_type: "related",
        });
        linked.push(relatedId);
      } catch {
        skipped.push(relatedId);
      }
    }
  }

  return { id, linked, skipped };
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

  const suggested_connections = findSuggestedConnections(
    db,
    a.content,
    a.summary,
    result.id,
  );

  return toolSuccess({
    id: result.id,
    linked: result.linked,
    skipped: result.skipped,
    suggested_connections,
  });
}
