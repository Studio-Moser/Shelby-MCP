import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import {
  insertThought,
  getThought,
  listThoughts,
  updateThought,
} from "../../src/db/thoughts.js";

describe("source_agent and trust_level fields", () => {
  let tdb: ThoughtDatabase;

  beforeEach(() => {
    tdb = new ThoughtDatabase(":memory:");
  });

  afterEach(() => {
    tdb.close();
  });

  // --- #23 source_agent ---

  describe("source_agent (#23)", () => {
    it("defaults to null when not provided", () => {
      const id = insertThought(tdb.db, { content: "Test" });
      const thought = getThought(tdb.db, id)!;
      expect(thought.source_agent).toBeNull();
    });

    it("stores and retrieves source_agent", () => {
      const id = insertThought(tdb.db, {
        content: "Test",
        source_agent: "claude-code",
      });
      const thought = getThought(tdb.db, id)!;
      expect(thought.source_agent).toBe("claude-code");
    });

    it("stores various agent identifiers", () => {
      const agents = ["claude-code", "cursor", "windsurf", "copilot"];
      for (const agent of agents) {
        const id = insertThought(tdb.db, { content: `From ${agent}`, source_agent: agent });
        expect(getThought(tdb.db, id)!.source_agent).toBe(agent);
      }
    });

    it("can be updated via updateThought", () => {
      const id = insertThought(tdb.db, { content: "Test", source_agent: "cursor" });
      updateThought(tdb.db, id, { source_agent: "claude-code" });
      expect(getThought(tdb.db, id)!.source_agent).toBe("claude-code");
    });

    it("filters by source_agent in listThoughts", () => {
      insertThought(tdb.db, { content: "A", source_agent: "claude-code" });
      insertThought(tdb.db, { content: "B", source_agent: "cursor" });
      insertThought(tdb.db, { content: "C", source_agent: "claude-code" });
      insertThought(tdb.db, { content: "D" }); // no source_agent

      const result = listThoughts(tdb.db, { source_agent: "claude-code" });
      expect(result.total_count).toBe(2);
      expect(result.results).toHaveLength(2);
    });
  });

  // --- #35 trust_level ---

  describe("trust_level (#35)", () => {
    it("defaults to 'trusted' when not provided", () => {
      const id = insertThought(tdb.db, { content: "Test" });
      const thought = getThought(tdb.db, id)!;
      expect(thought.trust_level).toBe("trusted");
    });

    it("stores 'trusted' trust level", () => {
      const id = insertThought(tdb.db, { content: "Test", trust_level: "trusted" });
      expect(getThought(tdb.db, id)!.trust_level).toBe("trusted");
    });

    it("stores 'unverified' trust level", () => {
      const id = insertThought(tdb.db, { content: "Test", trust_level: "unverified" });
      expect(getThought(tdb.db, id)!.trust_level).toBe("unverified");
    });

    it("stores 'external' trust level", () => {
      const id = insertThought(tdb.db, { content: "Test", trust_level: "external" });
      expect(getThought(tdb.db, id)!.trust_level).toBe("external");
    });

    it("can be updated via updateThought", () => {
      const id = insertThought(tdb.db, { content: "Test", trust_level: "trusted" });
      updateThought(tdb.db, id, { trust_level: "unverified" });
      expect(getThought(tdb.db, id)!.trust_level).toBe("unverified");
    });

    it("filters by trust_level in listThoughts", () => {
      insertThought(tdb.db, { content: "A", trust_level: "trusted" });
      insertThought(tdb.db, { content: "B", trust_level: "unverified" });
      insertThought(tdb.db, { content: "C", trust_level: "external" });
      insertThought(tdb.db, { content: "D" }); // defaults to trusted

      const trusted = listThoughts(tdb.db, { trust_level: "trusted" });
      expect(trusted.total_count).toBe(2); // A + D

      const unverified = listThoughts(tdb.db, { trust_level: "unverified" });
      expect(unverified.total_count).toBe(1);

      const external = listThoughts(tdb.db, { trust_level: "external" });
      expect(external.total_count).toBe(1);
    });

    it("can combine source_agent and trust_level filters", () => {
      insertThought(tdb.db, { content: "A", source_agent: "claude-code", trust_level: "trusted" });
      insertThought(tdb.db, { content: "B", source_agent: "claude-code", trust_level: "unverified" });
      insertThought(tdb.db, { content: "C", source_agent: "cursor", trust_level: "trusted" });

      const result = listThoughts(tdb.db, { source_agent: "claude-code", trust_level: "trusted" });
      expect(result.total_count).toBe(1);
      expect(result.results[0].id).toBeDefined();
    });
  });
});
