import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { handleGetThought } from "../../src/tools/get.js";
import { handleCaptureThought } from "../../src/tools/capture.js";
import { getThought } from "../../src/db/thoughts.js";

let db: ThoughtDatabase;

beforeEach(() => {
  db = new ThoughtDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

function parseResult(result: object): any {
  const r = result as any;
  return JSON.parse(r.content[0].text);
}

describe("handleGetThought", () => {
  it("returns a full thought record by ID", () => {
    const captureResult = handleCaptureThought(db, {
      content: "Get me",
      summary: "sum",
      type: "insight",
      topics: ["a", "b"],
    });
    const id = parseResult(captureResult).id;

    const result = handleGetThought(db, { id });
    const data = parseResult(result);
    expect(data.id).toBe(id);
    expect(data.content).toBe("Get me");
    expect(data.summary).toBe("sum");
    expect(data.type).toBe("insight");
    expect(data.topics).toEqual(["a", "b"]);
    expect(data.has_embedding).toBe(false);
    // embedding buffer should not be in response
    expect(data.embedding).toBeUndefined();
  });

  it("returns error for missing id", () => {
    const result = handleGetThought(db, {});
    const r = result as any;
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0].text);
    expect(data.error).toBe("invalid_input");
  });

  it("returns error for non-existent thought", () => {
    const result = handleGetThought(db, { id: "does-not-exist" });
    const r = result as any;
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0].text);
    expect(data.error).toBe("not_found");
  });

	it("reinforces a retrieved thought without confirming it", () => {
		const id = parseResult(handleCaptureThought(db, { content: "Frequently useful" })).id;

		handleGetThought(db, { id });

		const thought = getThought(db.db, id)!;
		expect(thought.reinforcement_count).toBe(1);
		expect(thought.last_confirmed_at).toBeNull();
		expect(parseResult(handleGetThought(db, { id })).reinforcement_count).toBe(2);
	});

	it("still returns the thought when reinforcement fails", () => {
		const id = parseResult(handleCaptureThought(db, { content: "Readable regardless" })).id;
		db.db.exec(`CREATE TRIGGER reject_reinforcement BEFORE UPDATE OF reinforcement_count ON thoughts
			BEGIN SELECT RAISE(ABORT, 'blocked'); END`);

		const data = parseResult(handleGetThought(db, { id }));

		expect(data.id).toBe(id);
		expect(data.content).toBe("Readable regardless");
	});
});
