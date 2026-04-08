import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { handleCaptureThought } from "../../src/tools/capture.js";
import { getThought } from "../../src/db/thoughts.js";

let db: ThoughtDatabase;

beforeEach(() => {
  db = new ThoughtDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

function parseResult(result: object): Record<string, unknown> {
  const r = result as { content: Array<{ text: string }> };
  return JSON.parse(r.content[0].text) as Record<string, unknown>;
}

describe("capture_thought — source_agent field (#23)", () => {
  it("captures source_agent and persists it", () => {
    const result = handleCaptureThought(db, {
      content: "Captured from Claude Code",
      source_agent: "claude-code",
    });
    const data = parseResult(result);
    const thought = getThought(db.db, data.id as string)!;
    expect(thought.source_agent).toBe("claude-code");
  });

  it("source_agent is null when not provided", () => {
    const result = handleCaptureThought(db, { content: "No agent specified" });
    const data = parseResult(result);
    const thought = getThought(db.db, data.id as string)!;
    expect(thought.source_agent).toBeNull();
  });

  it("captures source_agent in bulk mode", () => {
    const result = handleCaptureThought(db, {
      thoughts: [
        { content: "First", source_agent: "cursor" },
        { content: "Second", source_agent: "windsurf" },
      ],
    });
    const data = parseResult(result);
    const thoughts = data.thoughts as Array<{ id: string }>;
    expect(getThought(db.db, thoughts[0].id)!.source_agent).toBe("cursor");
    expect(getThought(db.db, thoughts[1].id)!.source_agent).toBe("windsurf");
  });
});

describe("capture_thought — trust_level field (#35)", () => {
  it("defaults trust_level to 'trusted'", () => {
    const result = handleCaptureThought(db, { content: "Default trust" });
    const data = parseResult(result);
    const thought = getThought(db.db, data.id as string)!;
    expect(thought.trust_level).toBe("trusted");
  });

  it("captures trust_level: unverified", () => {
    const result = handleCaptureThought(db, {
      content: "External memory",
      trust_level: "unverified",
    });
    const data = parseResult(result);
    const thought = getThought(db.db, data.id as string)!;
    expect(thought.trust_level).toBe("unverified");
  });

  it("captures trust_level: external", () => {
    const result = handleCaptureThought(db, {
      content: "External memory",
      trust_level: "external",
    });
    const data = parseResult(result);
    const thought = getThought(db.db, data.id as string)!;
    expect(thought.trust_level).toBe("external");
  });

  it("captures trust_level in bulk mode", () => {
    const result = handleCaptureThought(db, {
      thoughts: [
        { content: "Trusted thought", trust_level: "trusted" },
        { content: "External thought", trust_level: "external" },
      ],
    });
    const data = parseResult(result);
    const thoughts = data.thoughts as Array<{ id: string }>;
    expect(getThought(db.db, thoughts[0].id)!.trust_level).toBe("trusted");
    expect(getThought(db.db, thoughts[1].id)!.trust_level).toBe("external");
  });
});
