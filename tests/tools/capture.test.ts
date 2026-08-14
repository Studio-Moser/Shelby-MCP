import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThoughtDatabase } from "../../src/db/database.js";
import { handleCaptureThought } from "../../src/tools/capture.js";
import { getThought } from "../../src/db/thoughts.js";
import { getEdgesBetween } from "../../src/db/edges.js";
import { getProjectByAlias, listProjects, upsertProject } from "../../src/db/projects.js";
import { resolveProjectScope } from "../../src/db/resolve-project.js";

function makeGitRepo(remote: string): string {
  const root = mkdtempSync(join(tmpdir(), "cap-"));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "config"), `[remote "origin"]\n\turl = ${remote}\n`);
  return root;
}

let db: ThoughtDatabase;

beforeEach(() => {
  db = new ThoughtDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

function parseResult(result: object): any {
  const r = result as { content?: Array<{ text?: string }> };
  const text = r.content?.[0]?.text;
  if (!text) throw new Error("Expected tool result text");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON tool result: ${text}`, { cause: error });
  }
}

describe("handleCaptureThought", () => {
  it("captures a single thought with minimal fields", () => {
    const result = handleCaptureThought(db, { content: "Hello world" });
    const data = parseResult(result);
    expect(data.id).toBeDefined();
    expect(typeof data.id).toBe("string");
    expect(data.linked).toEqual([]);
    expect(data.skipped).toEqual([]);

    // Verify in DB
    const thought = getThought(db.db, data.id);
    expect(thought).not.toBeNull();
    expect(thought!.content).toBe("Hello world");
    expect(thought!.type).toBe("note");
  });

  it("captures a thought with all optional fields", () => {
    const result = handleCaptureThought(db, {
      content: "Full thought",
      summary: "A full thought",
      type: "decision",
      source: "claude",
      project: "shelbymcp",
      topics: ["testing", "mcp"],
      people: ["tim"],
      metadata: { key: "value" },
    });
    const data = parseResult(result);
    const thought = getThought(db.db, data.id);
    expect(thought!.summary).toBe("A full thought");
    expect(thought!.type).toBe("decision");
    expect(thought!.source).toBe("claude");
    expect(thought!.project).toBe("shelbymcp");
    expect(thought!.topics).toEqual(["testing", "mcp"]);
    expect(thought!.people).toEqual(["tim"]);
    expect(thought!.metadata).toEqual({ key: "value" });
  });

	it("canonicalizes and deduplicates topics before insert", () => {
		const data = parseResult(handleCaptureThought(db, {
			content: "Canonical topics",
			topics: [" Knowledge Graph ", "knowledge_graph", "API  Design"],
		}));

		expect(getThought(db.db, data.id)?.topics).toEqual(["knowledge-graph", "api-design"]);
	});

  it("creates related edges for existing thoughts", () => {
    // Create a target thought first
    const target = handleCaptureThought(db, { content: "Target thought" });
    const targetId = parseResult(target).id;

    const result = handleCaptureThought(db, {
      content: "Source thought",
      related_to: [targetId],
    });
    const data = parseResult(result);
    expect(data.linked).toEqual([targetId]);
    expect(data.skipped).toEqual([]);

    // Verify edge exists
    const edges = getEdgesBetween(db, data.id, targetId);
    expect(edges.length).toBe(1);
    expect(edges[0].edge_type).toBe("related");
  });

  it("skips non-existent related_to IDs without failing", () => {
    const result = handleCaptureThought(db, {
      content: "Some thought",
      related_to: ["nonexistent-id"],
    });
    const data = parseResult(result);
    expect(data.id).toBeDefined();
    expect(data.linked).toEqual([]);
    expect(data.skipped).toEqual(["nonexistent-id"]);
  });

  it("handles bulk capture via thoughts array", () => {
    const result = handleCaptureThought(db, {
      thoughts: [
        { content: "First" },
        { content: "Second", type: "task" },
        { content: "Third", summary: "third one" },
      ],
    });
    const data = parseResult(result);
    expect(data.captured).toBe(3);
    expect(data.thoughts).toHaveLength(3);

    // Verify each was saved
    for (const t of data.thoughts) {
      const thought = getThought(db.db, t.id);
      expect(thought).not.toBeNull();
    }
  });

  it("returns error when content is missing", () => {
    const result = handleCaptureThought(db, {});
    const r = result as any;
    expect(r.isError).toBe(true);
    const data = parseResult(result);
    expect(data.error).toBe("invalid_input");
  });

  it("returns error when bulk thoughts array is empty", () => {
    const result = handleCaptureThought(db, { thoughts: [] });
    const r = result as any;
    expect(r.isError).toBe(true);
  });

  it("returns suggested_connections as empty array when no similar thoughts exist", () => {
    const result = handleCaptureThought(db, { content: "An absolutely unique xyzzy thought" });
    const data = parseResult(result);
    expect(Array.isArray(data.suggested_connections)).toBe(true);
    expect(data.suggested_connections.length).toBe(0);
  });

  it("returns suggested_connections with id and summary when similar thoughts exist", () => {
    // Pre-populate a similar thought
    const preResult = handleCaptureThought(db, {
      content: "Machine learning is a subset of artificial intelligence",
      summary: "ML is a subset of AI",
    });
    const preId = parseResult(preResult).id;

    // Capture a new thought with overlapping content
    const result = handleCaptureThought(db, {
      content: "Machine learning techniques for classification tasks",
      summary: "ML classification techniques",
    });
    const data = parseResult(result);

    expect(Array.isArray(data.suggested_connections)).toBe(true);
    // The pre-existing thought may appear as a suggestion
    if (data.suggested_connections.length > 0) {
      const suggestion = data.suggested_connections[0];
      expect(suggestion).toHaveProperty("id");
      expect(suggestion).toHaveProperty("summary");
      expect(suggestion).toHaveProperty("similarity_reason");
      expect(suggestion.id).not.toBe(data.id); // never self-reference
    }
    // preId variable used to confirm different ID
    expect(data.id).not.toBe(preId);
  });

  it("does not self-reference in suggested_connections", () => {
    const result = handleCaptureThought(db, {
      content: "Recursive self-referencing thought test",
      summary: "Self-reference test",
    });
    const data = parseResult(result);
    const selfSuggestion = data.suggested_connections?.find(
      (s: { id: string }) => s.id === data.id,
    );
    expect(selfSuggestion).toBeUndefined();
  });

	it("NOOPs an exact same-type unscoped duplicate and merges confirmation metadata", () => {
		const target = parseResult(handleCaptureThought(db, {
			content: "unrelated target memory words",
			visibility: "shared",
		})).id;
		const existing = parseResult(handleCaptureThought(db, {
			content: "alpha bravo charlie delta echo",
			type: "insight",
			visibility: "shared",
			topics: ["Original Topic"],
			people: ["Alice"],
		})).id;

		const data = parseResult(handleCaptureThought(db, {
			content: "alpha bravo charlie delta echo",
			type: "insight",
			visibility: "shared",
			topics: ["New Topic"],
			people: ["Bob"],
			related_to: [target],
		}));

		expect(data).toMatchObject({ id: existing, action: "noop", linked: [target] });
		expect(db.db.prepare("SELECT COUNT(*) AS count FROM thoughts").get()).toEqual({ count: 2 });
		expect(getThought(db.db, existing)).toMatchObject({
			topics: ["original-topic", "new-topic"],
			people: ["Alice", "Bob"],
			reinforcement_count: 1,
		});
		expect(getThought(db.db, existing)?.last_confirmed_at).toBeTruthy();
		expect(getEdgesBetween(db, existing, target)).toHaveLength(1);
	});

	it("auto-links at 0.8 and suggests matches from 0.3", () => {
		const autoTarget = parseResult(handleCaptureThought(db, {
			content: "alpha bravo charlie delta",
			visibility: "shared",
		})).id;
		const auto = parseResult(handleCaptureThought(db, {
			content: "alpha bravo charlie delta echo",
			visibility: "shared",
		}));
		expect(auto.action).toBe("add");
		expect(auto.linked).toContain(autoTarget);
		expect(getEdgesBetween(db, auto.id, autoTarget)).toHaveLength(1);

		const suggestionTarget = parseResult(handleCaptureThought(db, {
			content: "kilo lima mike november",
			visibility: "shared",
		})).id;
		const suggested = parseResult(handleCaptureThought(db, {
			content: "kilo lima oscar papa",
			visibility: "shared",
		}));
		expect(suggested.action).toBe("add");
		expect(getEdgesBetween(db, suggested.id, suggestionTarget)).toHaveLength(0);
		expect(suggested.suggested_connections).toEqual([
			expect.objectContaining({ id: suggestionTarget }),
		]);
	});

	it("never reconciles across thought type or project slug", () => {
		upsertProject(db.db, { slug: "alpha-project", displayName: "Alpha", memberRepos: [], memberPaths: [], provisional: false });
		upsertProject(db.db, { slug: "beta-project", displayName: "Beta", memberRepos: [], memberPaths: [], provisional: false });
		const content = "same exact content across strict scopes";
		const first = parseResult(handleCaptureThought(db, {
			content,
			type: "note",
			project_identifier: "alpha-project",
		})).id;
		const differentType = parseResult(handleCaptureThought(db, {
			content,
			type: "decision",
			project_identifier: "alpha-project",
		}));
		const differentProject = parseResult(handleCaptureThought(db, {
			content,
			type: "note",
			project_identifier: "beta-project",
		}));

		expect(differentType).toMatchObject({ action: "add" });
		expect(differentProject).toMatchObject({ action: "add" });
		expect(new Set([first, differentType.id, differentProject.id]).size).toBe(3);
	});

  it("stamps project_identifier from cwd when not provided explicitly", () => {
    const root = makeGitRepo("git@github.com:acme/My-Project.git");
    try {
      const result = handleCaptureThought(db, { content: "Auto-resolved project" }, resolveProjectScope(db.db, [root]));
      const data = parseResult(result);
      const thought = getThought(db.db, data.id);
      expect(thought!.project_identifier).toBe("my-project");
      expect(db.db.prepare("SELECT project_id FROM thoughts WHERE id = ?").get(data.id)).toEqual({
        project_id: getProjectByAlias(db.db, "my-project")?.projectId,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("defaults visibility to 'shared' for preference type when not specified", () => {
    const result = handleCaptureThought(db, {
      content: "I prefer dark mode",
      type: "preference",
    });
    const data = parseResult(result);
    const thought = getThought(db.db, data.id);
    expect(thought!.visibility).toBe("shared");
		expect(thought!.type).toBe("decision");
  });

  it("defaults visibility to 'personal' for note type when not specified", () => {
    const result = handleCaptureThought(db, {
      content: "A regular note",
      type: "note",
    });
    const data = parseResult(result);
    const thought = getThought(db.db, data.id);
    expect(thought!.visibility).toBe("personal");
  });

  it("does NOT create a new projects row when explicit project_identifier is provided", () => {
    // Even when cwd is a temp git repo with an unknown remote, capturing with
    // an explicit project_identifier must skip the filesystem walk + registry write.
    const root = makeGitRepo("git@github.com:acme/UnknownProject.git");
    upsertProject(db.db, { slug: "shelby", displayName: "Shelby", memberRepos: [], memberPaths: [], provisional: false });
    const beforeCount = listProjects(db.db).length;
    try {
      const result = handleCaptureThought(
        db,
        { content: "Explicit slug thought", project_identifier: "shelby" },
        resolveProjectScope(db.db, [root]),
      );
      expect(result.isError).toBeFalsy();
      const afterCount = listProjects(db.db).length;
      expect(afterCount).toBe(beforeCount); // no new project row provisioned
      const data = parseResult(result);
      const thought = getThought(db.db, data.id);
      expect(thought!.project_identifier).toBe("shelby");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
