import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ThoughtDatabase } from "../dist/db/database.js";
import { createFixture } from "./Create TypeScript Fixture.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(scriptPath, "../..");
const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "shelby-cross-engine-"));
const databasePath = resolve(temporaryDirectory, "memory.sqlite");

try {
  createFixture(databasePath);
  const result = spawnSync(
    "cargo",
    ["test", "-p", "shelby-memory", "--test", "cross_engine", "--", "--nocapture"],
    {
      cwd: repositoryRoot,
      env: { ...process.env, SHELBY_TS_DB: databasePath },
      encoding: "utf8",
      shell: false,
    },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`Rust compatibility test exited ${result.status}`);
  }

  const markers = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.match(/RUST_ROW_ID=([0-9a-f-]+)/g) ?? [];
  assert.equal(markers.length, 1, "Rust test must emit exactly one row marker");
  const rustRowId = markers[0].slice("RUST_ROW_ID=".length);

  const database = new ThoughtDatabase(databasePath);
  try {
    const row = database.db
      .prepare("SELECT project_id, project_identifier, topics FROM thoughts WHERE id = ?")
      .get(rustRowId);
    assert.ok(row, "TypeScript engine can read the Rust-written row");
    assert.equal(row.project_identifier, "shelby");
    assert.ok(row.project_id);
    assert.deepEqual(JSON.parse(row.topics), ["cross-engine"]);
  } finally {
    database.close();
  }
  process.stderr.write("Cross-engine parity passed in both directions\n");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
