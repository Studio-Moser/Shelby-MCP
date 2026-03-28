import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import {
  insertThought,
  getThought,
  updateThought,
  deleteThought,
  listThoughts,
  countThoughts,
} from "../../src/db/thoughts.js";
import type Database from "better-sqlite3";

describe("thoughts CRUD", () => {
  let thoughtDb: ThoughtDatabase;
  let db: Database.Database;

  beforeEach(() => {
    thoughtDb = new ThoughtDatabase(":memory:");
    db = thoughtDb.db;
  });

  afterEach(() => {
    thoughtDb.close();
  });

  describe("insertThought + getThought", () => {
    it("inserts and retrieves a thought with defaults", () => {
      const id = insertThought(db, { content: "Hello world" });
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      const thought = getThought(db, id);
      expect(thought).not.toBeNull();
      expect(thought!.content).toBe("Hello world");
      expect(thought!.type).toBe("note");
      expect(thought!.source).toBe("unknown");
      expect(thought!.visibility).toBe("personal");
      expect(thought!.summary).toBeNull();
      expect(thought!.project).toBeNull();
      expect(thought!.topics).toEqual([]);
      expect(thought!.people).toEqual([]);
      expect(thought!.metadata).toBeNull();
      expect(thought!.embedding).toBeNull();
      expect(thought!.consolidated_into).toBeNull();
      expect(thought!.reinforcement_count).toBe(0);
      expect(thought!.created_at).toBeTruthy();
      expect(thought!.updated_at).toBeTruthy();
    });

    it("inserts with all optional fields", () => {
      const id = insertThought(db, {
        content: "Full thought",
        summary: "A summary",
        type: "decision",
        source: "claude",
        project: "shelbymcp",
        topics: ["architecture", "database"],
        people: ["Tim"],
        visibility: "team",
        metadata: { priority: "high", version: 2 },
      });

      const thought = getThought(db, id)!;
      expect(thought.summary).toBe("A summary");
      expect(thought.type).toBe("decision");
      expect(thought.source).toBe("claude");
      expect(thought.project).toBe("shelbymcp");
      expect(thought.topics).toEqual(["architecture", "database"]);
      expect(thought.people).toEqual(["Tim"]);
      expect(thought.visibility).toBe("team");
      expect(thought.metadata).toEqual({ priority: "high", version: 2 });
    });
  });

  describe("getThought", () => {
    it("returns null for non-existent thought", () => {
      const result = getThought(db, "00000000-0000-0000-0000-000000000000");
      expect(result).toBeNull();
    });
  });

  describe("updateThought", () => {
    it("updates content", () => {
      const id = insertThought(db, { content: "Original" });
      const updated = updateThought(db, id, { content: "Updated" });
      expect(updated).toBe(true);

      const thought = getThought(db, id)!;
      expect(thought.content).toBe("Updated");
    });

    it("updates summary", () => {
      const id = insertThought(db, { content: "Test" });
      updateThought(db, id, { summary: "New summary" });

      const thought = getThought(db, id)!;
      expect(thought.summary).toBe("New summary");
    });

    it("updates type", () => {
      const id = insertThought(db, { content: "Test" });
      updateThought(db, id, { type: "decision" });

      const thought = getThought(db, id)!;
      expect(thought.type).toBe("decision");
    });

    it("updates topics", () => {
      const id = insertThought(db, { content: "Test", topics: ["old"] });
      updateThought(db, id, { topics: ["new", "topics"] });

      const thought = getThought(db, id)!;
      expect(thought.topics).toEqual(["new", "topics"]);
    });

    it("updates updated_at timestamp", () => {
      const id = insertThought(db, { content: "Test" });
      const before = getThought(db, id)!.updated_at;

      // Small delay to ensure different timestamp
      const start = Date.now();
      while (Date.now() - start < 5) {
        /* spin */
      }

      updateThought(db, id, { content: "Changed" });
      const after = getThought(db, id)!.updated_at;
      expect(after >= before).toBe(true);
    });

    it("returns false for non-existent thought", () => {
      const result = updateThought(db, "00000000-0000-0000-0000-000000000000", {
        content: "Nope",
      });
      expect(result).toBe(false);
    });

    it("returns false when no fields provided", () => {
      const id = insertThought(db, { content: "Test" });
      const result = updateThought(db, id, {});
      expect(result).toBe(false);
    });
  });

  describe("deleteThought", () => {
    it("deletes a thought", () => {
      const id = insertThought(db, { content: "To delete" });
      const deleted = deleteThought(db, id);
      expect(deleted).toBe(true);

      const thought = getThought(db, id);
      expect(thought).toBeNull();
    });

    it("returns false for non-existent thought", () => {
      const result = deleteThought(db, "00000000-0000-0000-0000-000000000000");
      expect(result).toBe(false);
    });
  });

  describe("listThoughts", () => {
    function seedThoughts() {
      insertThought(db, {
        content: "Note 1",
        type: "note",
        project: "alpha",
        topics: ["design"],
        people: ["Alice"],
        source: "claude",
      });
      insertThought(db, {
        content: "Decision 1",
        type: "decision",
        project: "beta",
        topics: ["architecture", "database"],
        people: ["Bob"],
        source: "cursor",
      });
      insertThought(db, {
        content: "Task 1",
        type: "task",
        project: "alpha",
        topics: ["database"],
        people: ["Alice", "Bob"],
        source: "claude",
      });
    }

    it("lists with no filters", () => {
      seedThoughts();
      const result = listThoughts(db);
      expect(result.results).toHaveLength(3);
      expect(result.total_count).toBe(3);
      expect(result.has_more).toBe(false);
      expect(result.offset).toBe(0);
    });

    it("returns ThoughtSummary shape", () => {
      insertThought(db, {
        content: "Test",
        summary: "A test thought",
        type: "note",
        topics: ["testing"],
      });
      const result = listThoughts(db);
      const item = result.results[0];
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("summary");
      expect(item).toHaveProperty("type");
      expect(item).toHaveProperty("topics");
      expect(item).toHaveProperty("created_at");
      // Should NOT have content
      expect(item).not.toHaveProperty("content");
    });

    it("filters by type", () => {
      seedThoughts();
      const result = listThoughts(db, { type: "decision" });
      expect(result.results).toHaveLength(1);
      expect(result.total_count).toBe(1);
      expect(result.results[0].type).toBe("decision");
    });

    it("filters by project", () => {
      seedThoughts();
      const result = listThoughts(db, { project: "alpha" });
      expect(result.results).toHaveLength(2);
      expect(result.total_count).toBe(2);
    });

    it("filters by topic", () => {
      seedThoughts();
      const result = listThoughts(db, { topic: "database" });
      expect(result.results).toHaveLength(2);
      expect(result.total_count).toBe(2);
    });

    it("filters by person", () => {
      seedThoughts();
      const result = listThoughts(db, { person: "Alice" });
      expect(result.results).toHaveLength(2);
      expect(result.total_count).toBe(2);
    });

    it("filters by source", () => {
      seedThoughts();
      const result = listThoughts(db, { source: "claude" });
      expect(result.results).toHaveLength(2);
      expect(result.total_count).toBe(2);
    });

    it("filters by date range (since/until)", () => {
      // Insert with known timestamps by directly manipulating DB
      const past = "2024-01-01T00:00:00.000Z";
      const recent = "2025-06-15T00:00:00.000Z";
      const future = "2026-12-01T00:00:00.000Z";

      db.prepare(
        `INSERT INTO thoughts (id, content, type, source, visibility, created_at, updated_at, reinforcement_count)
         VALUES ('id-old', 'Old thought', 'note', 'unknown', 'personal', @created_at, @updated_at, 0)`,
      ).run({ created_at: past, updated_at: past });

      db.prepare(
        `INSERT INTO thoughts (id, content, type, source, visibility, created_at, updated_at, reinforcement_count)
         VALUES ('id-recent', 'Recent thought', 'note', 'unknown', 'personal', @created_at, @updated_at, 0)`,
      ).run({ created_at: recent, updated_at: recent });

      db.prepare(
        `INSERT INTO thoughts (id, content, type, source, visibility, created_at, updated_at, reinforcement_count)
         VALUES ('id-future', 'Future thought', 'note', 'unknown', 'personal', @created_at, @updated_at, 0)`,
      ).run({ created_at: future, updated_at: future });

      const result = listThoughts(db, {
        since: "2025-01-01T00:00:00.000Z",
        until: "2026-01-01T00:00:00.000Z",
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].id).toBe("id-recent");
    });

    it("paginates with limit and offset", () => {
      seedThoughts();
      const page1 = listThoughts(db, { limit: 2, offset: 0 });
      expect(page1.results).toHaveLength(2);
      expect(page1.total_count).toBe(3);
      expect(page1.has_more).toBe(true);
      expect(page1.offset).toBe(0);

      const page2 = listThoughts(db, { limit: 2, offset: 2 });
      expect(page2.results).toHaveLength(1);
      expect(page2.total_count).toBe(3);
      expect(page2.has_more).toBe(false);
      expect(page2.offset).toBe(2);
    });

    it("has_more is correct when results exactly fill limit", () => {
      seedThoughts();
      const result = listThoughts(db, { limit: 3 });
      expect(result.results).toHaveLength(3);
      expect(result.has_more).toBe(false);
    });

    it("clamps limit to [1, 100]", () => {
      seedThoughts();
      const low = listThoughts(db, { limit: 0 });
      expect(low.results.length).toBeGreaterThanOrEqual(1);

      const high = listThoughts(db, { limit: 200 });
      // All 3 returned (under the clamped 100)
      expect(high.results).toHaveLength(3);
    });

    it("sorts by created_at DESC", () => {
      db.prepare(
        `INSERT INTO thoughts (id, content, type, source, visibility, created_at, updated_at, reinforcement_count)
         VALUES ('id-a', 'First', 'note', 'unknown', 'personal', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z', 0)`,
      ).run();
      db.prepare(
        `INSERT INTO thoughts (id, content, type, source, visibility, created_at, updated_at, reinforcement_count)
         VALUES ('id-b', 'Second', 'note', 'unknown', 'personal', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 0)`,
      ).run();

      const result = listThoughts(db);
      expect(result.results[0].id).toBe("id-b");
      expect(result.results[1].id).toBe("id-a");
    });
  });

  describe("countThoughts", () => {
    it("returns 0 for empty database", () => {
      expect(countThoughts(db)).toBe(0);
    });

    it("returns correct count", () => {
      insertThought(db, { content: "One" });
      insertThought(db, { content: "Two" });
      insertThought(db, { content: "Three" });
      expect(countThoughts(db)).toBe(3);
    });
  });
});
