import type Database from "better-sqlite3";

export interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: "Initial schema — thoughts, FTS5, edges",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS thoughts (
          id              TEXT PRIMARY KEY,
          content         TEXT NOT NULL,
          summary         TEXT,
          type            TEXT NOT NULL DEFAULT 'note',
          source          TEXT NOT NULL DEFAULT 'unknown',
          project         TEXT,
          topics          TEXT,
          people          TEXT,
          visibility      TEXT NOT NULL DEFAULT 'personal',
          metadata        TEXT,
          embedding       BLOB,
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL,
          consolidated_into TEXT,
          reinforcement_count INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_thoughts_type ON thoughts(type);
        CREATE INDEX IF NOT EXISTS idx_thoughts_project ON thoughts(project);
        CREATE INDEX IF NOT EXISTS idx_thoughts_created ON thoughts(created_at);
        CREATE INDEX IF NOT EXISTS idx_thoughts_updated ON thoughts(updated_at);
        CREATE INDEX IF NOT EXISTS idx_thoughts_consolidated ON thoughts(consolidated_into);

        CREATE VIRTUAL TABLE IF NOT EXISTS thoughts_fts USING fts5(
          content,
          content=thoughts,
          content_rowid=rowid,
          tokenize='porter unicode61'
        );

        CREATE TRIGGER IF NOT EXISTS thoughts_ai AFTER INSERT ON thoughts BEGIN
          INSERT INTO thoughts_fts(rowid, content) VALUES (new.rowid, new.content);
        END;

        CREATE TRIGGER IF NOT EXISTS thoughts_ad AFTER DELETE ON thoughts BEGIN
          INSERT INTO thoughts_fts(thoughts_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        END;

        CREATE TRIGGER IF NOT EXISTS thoughts_au AFTER UPDATE OF content ON thoughts BEGIN
          INSERT INTO thoughts_fts(thoughts_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
          INSERT INTO thoughts_fts(rowid, content) VALUES (new.rowid, new.content);
        END;

        CREATE TABLE IF NOT EXISTS edges (
          id          TEXT PRIMARY KEY,
          source_id   TEXT NOT NULL,
          target_id   TEXT NOT NULL,
          edge_type   TEXT NOT NULL DEFAULT 'related',
          metadata    TEXT,
          created_at  TEXT NOT NULL,
          FOREIGN KEY (source_id) REFERENCES thoughts(id) ON DELETE CASCADE,
          FOREIGN KEY (target_id) REFERENCES thoughts(id) ON DELETE CASCADE,
          UNIQUE(source_id, target_id, edge_type)
        );

        CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
        CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
        CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(edge_type);
      `);
    },
  },
];

export function getSchemaVersion(db: Database.Database): number {
  const row = db.pragma("user_version", { simple: true });
  return typeof row === "number" ? row : 0;
}

export function setSchemaVersion(db: Database.Database, version: number): void {
  db.pragma(`user_version = ${version}`);
}

export function runMigrations(db: Database.Database): void {
  const currentVersion = getSchemaVersion(db);

  const pending = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    console.error(`[INFO] Running migration v${migration.version}: ${migration.description}`);

    const runInTransaction = db.transaction(() => {
      migration.up(db);
      setSchemaVersion(db, migration.version);
    });

    runInTransaction();

    console.error(`[INFO] Migration v${migration.version} complete`);
  }
}

export function getMigrations(): Migration[] {
  return migrations;
}
