import { describe, it, expect } from "vitest";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadProjectSeed,
  toProjects,
  sourceAliasMap,
  EMPTY_SEED,
} from "../../src/integrity/project-seed.js";

// #308: the project seed loads from a per-user config and defaults to EMPTY
// (no bundled projects/paths/topics) when the file is absent.

function tmpPath(): string {
  return join(tmpdir(), `seed-${Math.random().toString(36).slice(2)}.json`);
}

describe("loadProjectSeed", () => {
  it("returns EMPTY_SEED when the file is absent", () => {
    const seed = loadProjectSeed(tmpPath());
    expect(seed).toEqual(EMPTY_SEED);
    expect(seed.projects).toEqual([]);
    expect(seed.topicClusters).toEqual({});
    expect(sourceAliasMap(seed)).toEqual({});
  });

  it("returns EMPTY_SEED on malformed JSON", () => {
    const p = tmpPath();
    writeFileSync(p, "{ not valid json");
    try {
      expect(loadProjectSeed(p)).toEqual(EMPTY_SEED);
    } finally {
      rmSync(p, { force: true });
    }
  });

  it("loads projects, topicClusters, and lowercased source aliases", () => {
    const p = tmpPath();
    writeFileSync(
      p,
      JSON.stringify({
        projects: [
          {
            slug: "shelby",
            displayName: "Shelby",
            memberPaths: ["/p/shelby"],
            sourceAliases: ["shelby", "Graphify"],
          },
        ],
        topicClusters: { polymarket: "the-crooked-line" },
      }),
    );
    try {
      const seed = loadProjectSeed(p);
      expect(seed.projects).toHaveLength(1);
      expect(seed.projects[0]?.slug).toBe("shelby");
      expect(seed.topicClusters.polymarket).toBe("the-crooked-line");
      expect(toProjects(seed)[0]?.memberPaths).toEqual(["/p/shelby"]);

      const aliases = sourceAliasMap(seed);
      expect(aliases.shelby).toBe("shelby");
      expect(aliases.graphify).toBe("shelby"); // lowercased
    } finally {
      rmSync(p, { force: true });
    }
  });

  it("rejects the whole file to EMPTY when a project entry lacks a string slug", () => {
    // Parity with Swift's strict Codable: any malformed element → EMPTY (so no
    // phantom NULL-slug rows reach the registry).
    const p = tmpPath();
    writeFileSync(p, JSON.stringify({ projects: [{ displayName: "X" }] }));
    try {
      expect(loadProjectSeed(p)).toEqual(EMPTY_SEED);
    } finally {
      rmSync(p, { force: true });
    }
  });

  it("rejects the whole file to EMPTY when a topicCluster value is not a string", () => {
    const p = tmpPath();
    writeFileSync(p, JSON.stringify({ topicClusters: { x: 123 } }));
    try {
      expect(loadProjectSeed(p)).toEqual(EMPTY_SEED);
    } finally {
      rmSync(p, { force: true });
    }
  });

  it("rejects the whole file to EMPTY when a member field is mistyped", () => {
    const p = tmpPath();
    writeFileSync(p, JSON.stringify({ projects: [{ slug: "x", displayName: "X", memberPaths: "not-an-array" }] }));
    try {
      expect(loadProjectSeed(p)).toEqual(EMPTY_SEED);
    } finally {
      rmSync(p, { force: true });
    }
  });

  it("defaults optional project fields when omitted", () => {
    const p = tmpPath();
    writeFileSync(p, JSON.stringify({ projects: [{ slug: "x", displayName: "X" }] }));
    try {
      const projects = toProjects(loadProjectSeed(p));
      expect(projects[0]?.memberRepos).toEqual([]);
      expect(projects[0]?.memberPaths).toEqual([]);
      expect(projects[0]?.provisional).toBe(false);
    } finally {
      rmSync(p, { force: true });
    }
  });
});
