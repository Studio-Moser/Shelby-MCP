import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { insertThought } from "../../src/db/thoughts.js";

describe("completion queries", () => {
  let thoughtDb: ThoughtDatabase;

  beforeEach(() => {
    thoughtDb = new ThoughtDatabase(":memory:");
    // Seed data with known topics, people, projects, sources
    insertThought(thoughtDb.db, {
      content: "Architecture decision",
      type: "decision",
      topics: ["auth", "api-design", "architecture"],
      people: ["Alice", "Bob"],
      project: "shelby",
      source: "claude-code",
    });
    insertThought(thoughtDb.db, {
      content: "Bug fix note",
      type: "note",
      topics: ["auth", "bugfix"],
      people: ["Alice", "Charlie"],
      project: "shelby-app",
      source: "cursor",
    });
    insertThought(thoughtDb.db, {
      content: "Research reference",
      type: "reference",
      topics: ["mcp", "api-design"],
      people: ["Bob"],
      project: "openbrain",
      source: "claude-code",
    });
  });

  afterEach(() => {
    thoughtDb.close();
  });

  describe("getDistinctArrayValues", () => {
    it("returns all distinct topics with empty prefix", () => {
      const topics = thoughtDb.getDistinctArrayValues("topics", "");
      expect(topics.sort()).toEqual(["api-design", "architecture", "auth", "bugfix", "mcp"]);
    });

    it("filters topics by prefix", () => {
      const topics = thoughtDb.getDistinctArrayValues("topics", "a");
      expect(topics.sort()).toEqual(["api-design", "architecture", "auth"]);
    });

    it("returns exact match for specific prefix", () => {
      const topics = thoughtDb.getDistinctArrayValues("topics", "bug");
      expect(topics).toEqual(["bugfix"]);
    });

    it("returns empty array for no match", () => {
      const topics = thoughtDb.getDistinctArrayValues("topics", "zzz");
      expect(topics).toEqual([]);
    });

    it("returns distinct people with prefix filter", () => {
      const people = thoughtDb.getDistinctArrayValues("people", "");
      expect(people.sort()).toEqual(["Alice", "Bob", "Charlie"]);
    });

    it("filters people by prefix", () => {
      const people = thoughtDb.getDistinctArrayValues("people", "A");
      expect(people).toEqual(["Alice"]);
    });

    it("respects the limit parameter", () => {
      const topics = thoughtDb.getDistinctArrayValues("topics", "", 2);
      expect(topics).toHaveLength(2);
    });
  });

  describe("getDistinctValues", () => {
    it("returns all distinct projects with empty prefix", () => {
      const projects = thoughtDb.getDistinctValues("project", "");
      expect(projects.sort()).toEqual(["openbrain", "shelby", "shelby-app"]);
    });

    it("filters projects by prefix", () => {
      const projects = thoughtDb.getDistinctValues("project", "shelby");
      expect(projects.sort()).toEqual(["shelby", "shelby-app"]);
    });

    it("returns distinct sources", () => {
      const sources = thoughtDb.getDistinctValues("source", "");
      expect(sources.sort()).toEqual(["claude-code", "cursor"]);
    });

    it("returns distinct types", () => {
      const types = thoughtDb.getDistinctValues("type", "");
      expect(types.sort()).toEqual(["decision", "note", "reference"]);
    });

    it("returns empty array for no match", () => {
      const projects = thoughtDb.getDistinctValues("project", "zzz");
      expect(projects).toEqual([]);
    });

    it("respects the limit parameter", () => {
      const projects = thoughtDb.getDistinctValues("project", "", 1);
      expect(projects).toHaveLength(1);
    });
  });
});
