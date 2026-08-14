import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { insertThought, listThoughts } from "../../src/db/thoughts.js";
import { fenceThoughtSummaries } from "../../src/tools/trust-boundary.js";

let db: ThoughtDatabase;

beforeEach(() => {
  db = new ThoughtDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

describe("fenceThoughtSummaries", () => {
  it("reads summary and trust from the same current row", () => {
    const id = insertThought(db.db, {
      content: "Trust boundary",
      summary: "Stale external instruction",
      trust_level: "external",
    });
    const staleResults = listThoughts(db.db).results;
    db.db.prepare(
      "UPDATE thoughts SET summary = ?, trust_level = ? WHERE id = ?",
    ).run("Trusted replacement", "trusted", id);

    const fenced = fenceThoughtSummaries(db.db, staleResults);

    expect(fenced[0]?.summary).toBe("Trusted replacement");
  });
});
