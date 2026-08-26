import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ThoughtDatabase } from "../dist/db/database.js";
import { upsertProject } from "../dist/db/projects.js";
import { insertThought } from "../dist/db/thoughts.js";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");

export const FIXTURE = resolve(repositoryRoot, "tests/fixtures/TypeScript-v18.sqlite");
export const SEED_ID = "018f4c66-7c4e-7a4d-8e7a-6a74af7fd001";
export const FIXED_TIME = "2026-08-25T00:00:00.000Z";

function removeSqliteFiles(path) {
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    rmSync(candidate, { force: true });
  }
}

export function createFixture(outputPath = FIXTURE) {
  const target = resolve(outputPath);
  mkdirSync(dirname(target), { recursive: true });
  removeSqliteFiles(target);

  const database = new ThoughtDatabase(target);
  try {
    upsertProject(database.db, {
      slug: "shelby",
      displayName: "Shelby",
      memberRepos: ["github.com/Studio-Moser/Shelby-MCP"],
      memberPaths: [],
      provisional: false,
    });
    const generatedId = insertThought(database.db, {
      content: "created by the TypeScript engine",
      summary: "TypeScript v18 seed",
      type: "reference",
      source: "typescript",
      project_identifier: "shelby",
      topics: ["Knowledge Graph"],
    });
    database.db
      .prepare("UPDATE thoughts SET id = ?, created_at = ?, updated_at = ? WHERE id = ?")
      .run(SEED_ID, FIXED_TIME, FIXED_TIME, generatedId);
    database.db
      .prepare("UPDATE projects SET created_at = ?, updated_at = ?")
      .run(FIXED_TIME, FIXED_TIME);
    database.db
      .prepare("UPDATE project_slug_aliases SET claimed_at = ?")
      .run(FIXED_TIME);
    database.db.pragma("wal_checkpoint(TRUNCATE)");
    database.db.exec("VACUUM");
  } finally {
    database.close();
  }
  rmSync(`${target}-wal`, { force: true });
  rmSync(`${target}-shm`, { force: true });
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const target = createFixture(process.argv[2] ?? FIXTURE);
  process.stderr.write(`Created ${target}\n`);
}
