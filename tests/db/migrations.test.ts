import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { getSchemaVersion } from "../../src/db/migrations.js";

describe("Migration v4 — source_agent and trust_level", () => {
  let db: ThoughtDatabase;

  beforeEach(() => {
    db = new ThoughtDatabase(":memory:");
  });

  afterEach(() => {
    db?.close();
  });

  it("schema version is 4 after all migrations", () => {
    expect(getSchemaVersion(db.db)).toBe(4);
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
