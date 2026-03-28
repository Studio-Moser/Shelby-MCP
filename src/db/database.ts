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

  close(): void {
    this.db.close();
  }
}
