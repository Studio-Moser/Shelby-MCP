import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { handleDeleteThought } from "../../src/tools/delete.js";
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

describe("handleDeleteThought", () => {
  it("deletes an existing thought", () => {
    const captureResult = handleCaptureThought(db, { content: "Delete me" });
    const id = parseResult(captureResult).id;

    const result = handleDeleteThought(db, { id });
    const data = parseResult(result);
    expect(data.deleted).toBe(true);
    expect(data.id).toBe(id);

    // Verify it's gone
    expect(getThought(db.db, id)).toBeNull();
  });

  it("returns error for missing id", () => {
    const result = handleDeleteThought(db, {});
    const r = result as any;
    expect(r.isError).toBe(true);
  });

  it("returns error for non-existent thought", () => {
    const result = handleDeleteThought(db, { id: "no-such-id" });
    const r = result as any;
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0].text);
    expect(data.error).toBe("not_found");
  });
});
