import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runMigrations } from "../../src/db/migrations.js";
import { upsertProject } from "../../src/db/projects.js";
import { resolveProjectScope } from "../../src/db/resolve-project.js";

type Fixture = {
  cases: Array<{
    name: string;
    projects: Array<{ slug: string; member_paths: string[]; member_repos: string[] }>;
    roots: string[];
    explicit?: string;
    expected: Record<string, unknown>;
  }>;
};

const fixturePath = fileURLToPath(new URL("../fixtures/project-scope-resolution.json", import.meta.url));
function loadFixture(): Fixture {
  try {
    return JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
  } catch (error) {
    throw new Error(`Invalid project-scope fixture: ${String(error)}`, { cause: error });
  }
}
const fixture = loadFixture();

describe("project scope conformance fixture", () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      const db = new Database(":memory:");
      runMigrations(db);
      for (const project of testCase.projects) {
        upsertProject(db, {
          slug: project.slug,
          displayName: project.slug,
          memberPaths: project.member_paths,
          memberRepos: project.member_repos,
          provisional: false,
        });
      }
      expect(resolveProjectScope(db, testCase.roots, testCase.explicit)).toMatchObject(testCase.expected);
      db.close();
    });
  }
});
