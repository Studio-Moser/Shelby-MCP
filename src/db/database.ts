import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { runMigrations, getSchemaVersion } from "./migrations.js";

export class ThoughtDatabase {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.db = new Database(dbPath);
    if (dbPath !== ":memory:") {
      this.db.pragma("journal_mode = WAL");
    }
    this.db.pragma("foreign_keys = ON");

    runMigrations(this.db);
  }

  getSchemaVersion(): number {
    return getSchemaVersion(this.db);
  }

  /**
   * Return distinct values for a JSON array column (topics, people) that
   * start with the given prefix.  Used by MCP completion.
   */
  getDistinctArrayValues(column: "topics" | "people", prefix: string, limit = 20): string[] {
    // topics and people are stored as JSON arrays, so we use json_each to
    // explode them and then filter/dedupe.
    const rows = this.db
      .prepare(
        `SELECT DISTINCT je.value AS val
         FROM thoughts, json_each(thoughts.${column}) AS je
         WHERE je.value LIKE @prefix
         ORDER BY je.value
         LIMIT @limit`,
      )
      .all({ prefix: `${prefix}%`, limit }) as { val: string }[];

    return rows.map((r) => r.val);
  }

  /**
   * Return distinct scalar column values that start with the given prefix.
   * Used by MCP completion for project, source, type.
   */
  getDistinctValues(column: "project" | "source" | "type", prefix: string, limit = 20): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT ${column} AS val
         FROM thoughts
         WHERE ${column} IS NOT NULL AND ${column} LIKE @prefix
         ORDER BY ${column}
         LIMIT @limit`,
      )
      .all({ prefix: `${prefix}%`, limit }) as { val: string }[];

    return rows.map((r) => r.val);
  }

  close(): void {
    this.db.close();
  }
}
