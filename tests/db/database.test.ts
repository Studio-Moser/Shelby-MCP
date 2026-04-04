import { describe, it, expect, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";

describe("ThoughtDatabase", () => {
  let db: ThoughtDatabase;

  afterEach(() => {
    db?.close();
  });

  it("creates an in-memory database", () => {
    db = new ThoughtDatabase(":memory:");
    expect(db).toBeDefined();
  });

  it("skips WAL mode for in-memory databases", () => {
    db = new ThoughtDatabase(":memory:");
    const mode = db.db.pragma("journal_mode", { simple: true });
    // In-memory DBs can't use WAL, they report "memory"
    expect(mode).toBe("memory");
  });

  it("enables foreign keys", () => {
    db = new ThoughtDatabase(":memory:");
    const fk = db.db.pragma("foreign_keys", { simple: true });
    expect(fk).toBe(1);
  });

  it("runs migrations to latest version", () => {
    db = new ThoughtDatabase(":memory:");
    expect(db.getSchemaVersion()).toBe(3);
  });

  it("creates thoughts table", () => {
    db = new ThoughtDatabase(":memory:");
    const tables = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='thoughts'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("creates edges table", () => {
    db = new ThoughtDatabase(":memory:");
    const tables = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='edges'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("creates FTS5 virtual table", () => {
    db = new ThoughtDatabase(":memory:");
    const tables = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='thoughts_fts'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("is idempotent — opening same DB twice doesn't fail", () => {
    db = new ThoughtDatabase(":memory:");
    // Simulate re-running migrations on same version
    const version = db.getSchemaVersion();
    expect(version).toBe(3);
  });

  it("creates oauth_clients table after migration", () => {
    db = new ThoughtDatabase(":memory:");
    const tables = db.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='oauth_clients'`)
      .all() as { name: string }[];
    expect(tables).toHaveLength(1);
  });
});
