import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ThoughtDatabase } from "../../src/db/database.js";
import { getSchemaVersion, getMigrations, runMigrations, setSchemaVersion } from "../../src/db/migrations.js";

describe("Migration v5 — version-stamp alignment with Shelby-MacOS", () => {
  let db: ThoughtDatabase;

  beforeEach(() => {
    db = new ThoughtDatabase(":memory:");
  });

  afterEach(() => {
    db?.close();
  });

  it("schema version is 7 after all migrations", () => {
    expect(getSchemaVersion(db.db)).toBe(7);
  });

  it("thoughts table has source_agent column", () => {
    const columns = db.db
      .prepare("PRAGMA table_info(thoughts)")
      .all() as Array<{ name: string }>;
    const names = columns.map((c) => c.name);
    expect(names).toContain("source_agent");
  });

  it("thoughts table has trust_level column", () => {
    const columns = db.db
      .prepare("PRAGMA table_info(thoughts)")
      .all() as Array<{ name: string }>;
    const names = columns.map((c) => c.name);
    expect(names).toContain("trust_level");
  });

  it("existing thoughts have trust_level defaulting to 'trusted'", () => {
    const now = new Date().toISOString();
    db.db.prepare(
      `INSERT INTO thoughts (id, content, type, source, visibility, created_at, updated_at)
       VALUES ('t1', 'test', 'note', 'test', 'personal', ?, ?)`
    ).run(now, now);

    const thought = db.db.prepare("SELECT trust_level, source_agent FROM thoughts WHERE id = 't1'").get() as Record<string, unknown>;
    expect(thought.trust_level).toBe("trusted");
    expect(thought.source_agent).toBeNull();
  });
});

describe("Migration v3 — temporal edges", () => {
  let db: ThoughtDatabase;

  beforeEach(() => {
    db = new ThoughtDatabase(":memory:");
  });

  afterEach(() => {
    db?.close();
  });

  it("schema version is at least 3 after temporal edge migration", () => {
    expect(getSchemaVersion(db.db)).toBeGreaterThanOrEqual(3);
  });

  it("edges table has valid_from and valid_until columns", () => {
    const columns = db.db
      .prepare("PRAGMA table_info(edges)")
      .all() as Array<{ name: string }>;
    const names = columns.map((c) => c.name);
    expect(names).toContain("valid_from");
    expect(names).toContain("valid_until");
  });

  it("idx_edges_valid_until index exists", () => {
    const indexes = db.db
      .prepare("PRAGMA index_list(edges)")
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_edges_valid_until");
  });

  it("existing edges have null valid_from and valid_until", () => {
    const now = new Date().toISOString();
    db.db.prepare(
      `INSERT INTO thoughts (id, content, type, source, visibility, created_at, updated_at)
       VALUES ('t1', 'test', 'note', 'test', 'personal', ?, ?)`
    ).run(now, now);
    db.db.prepare(
      `INSERT INTO thoughts (id, content, type, source, visibility, created_at, updated_at)
       VALUES ('t2', 'test', 'note', 'test', 'personal', ?, ?)`
    ).run(now, now);
    db.db.prepare(
      `INSERT INTO edges (id, source_id, target_id, edge_type, created_at)
       VALUES ('e1', 't1', 't2', 'related', ?)`
    ).run(now);

    const edge = db.db.prepare("SELECT valid_from, valid_until FROM edges WHERE id = 'e1'").get() as Record<string, unknown>;
    expect(edge.valid_from).toBeNull();
    expect(edge.valid_until).toBeNull();
  });
});

describe("migration v6 — project identity", () => {
  it("adds project_identifier column and projects table at version 6", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    expect(getSchemaVersion(db)).toBe(7);

    const thoughtCols = db.prepare("PRAGMA table_info(thoughts)").all() as Array<{ name: string }>;
    expect(thoughtCols.map((c) => c.name)).toContain("project_identifier");

    const projectsCols = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
    expect(projectsCols.map((c) => c.name)).toEqual(
      expect.arrayContaining(["slug","display_name","member_repos","member_paths","provisional","created_at","updated_at"]),
    );
    db.close();
  });
});

describe("migration v7 — normalize legacy display-name project_identifiers", () => {
  it("v7 normalizes legacy display-name project_identifiers to slugs", () => {
    const db = new Database(":memory:");
    // Advance through v6 only, seed legacy rows, then let runMigrations apply v7 to them.
    for (const m of getMigrations().filter((x) => x.version <= 6)) m.up(db);
    setSchemaVersion(db, 6);
    const now = new Date().toISOString();
    const ins = db.prepare("INSERT INTO thoughts (id, content, type, source, created_at, updated_at, project_identifier) VALUES (?,?,?,?,?,?,?)");
    ins.run("a", "x", "note", "t", now, now, "Shelby");
    ins.run("b", "y", "note", "t", now, now, "The Crooked Line");
    ins.run("c", "z", "note", "t", now, now, "");
    runMigrations(db); // applies v7 only
    const get = db.prepare("SELECT project_identifier AS p FROM thoughts WHERE id = ?");
    expect((get.get("a") as any).p).toBe("shelby");
    expect((get.get("b") as any).p).toBe("the-crooked-line");
    expect((get.get("c") as any).p).toBeNull();
  });
});
