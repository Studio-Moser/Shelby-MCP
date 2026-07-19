import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { deriveExistingProjectId } from "../../src/db/project-identity.js";
import {
	getMigrations,
	getSchemaVersion,
	runMigrations,
	setSchemaVersion,
} from "../../src/db/migrations.js";

describe("Migration v5 — version-stamp alignment with Shelby-MacOS", () => {
	let db: ThoughtDatabase;

	beforeEach(() => {
		db = new ThoughtDatabase(":memory:");
	});

	afterEach(() => {
		db?.close();
	});

	it("schema version is 8 after all migrations", () => {
		expect(getSchemaVersion(db.db)).toBe(8);
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
		db.db
			.prepare(
				`INSERT INTO thoughts (id, content, type, source, visibility, created_at, updated_at)
       VALUES ('t1', 'test', 'note', 'test', 'personal', ?, ?)`,
			)
			.run(now, now);

		const thought = db.db
			.prepare("SELECT trust_level, source_agent FROM thoughts WHERE id = 't1'")
			.get() as Record<string, unknown>;
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
		const columns = db.db.prepare("PRAGMA table_info(edges)").all() as Array<{
			name: string;
		}>;
		const names = columns.map((c) => c.name);
		expect(names).toContain("valid_from");
		expect(names).toContain("valid_until");
	});

	it("idx_edges_valid_until index exists", () => {
		const indexes = db.db.prepare("PRAGMA index_list(edges)").all() as Array<{
			name: string;
		}>;
		const names = indexes.map((i) => i.name);
		expect(names).toContain("idx_edges_valid_until");
	});

	it("existing edges have null valid_from and valid_until", () => {
		const now = new Date().toISOString();
		db.db
			.prepare(
				`INSERT INTO thoughts (id, content, type, source, visibility, created_at, updated_at)
       VALUES ('t1', 'test', 'note', 'test', 'personal', ?, ?)`,
			)
			.run(now, now);
		db.db
			.prepare(
				`INSERT INTO thoughts (id, content, type, source, visibility, created_at, updated_at)
       VALUES ('t2', 'test', 'note', 'test', 'personal', ?, ?)`,
			)
			.run(now, now);
		db.db
			.prepare(
				`INSERT INTO edges (id, source_id, target_id, edge_type, created_at)
       VALUES ('e1', 't1', 't2', 'related', ?)`,
			)
			.run(now);

		const edge = db.db
			.prepare("SELECT valid_from, valid_until FROM edges WHERE id = 'e1'")
			.get() as Record<string, unknown>;
		expect(edge.valid_from).toBeNull();
		expect(edge.valid_until).toBeNull();
	});
});

describe("migration v6 — project identity", () => {
	it("adds project_identifier column and projects table at version 6", () => {
		const db = new Database(":memory:");
		runMigrations(db);

		expect(getSchemaVersion(db)).toBe(8);

		const thoughtCols = db
			.prepare("PRAGMA table_info(thoughts)")
			.all() as Array<{ name: string }>;
		expect(thoughtCols.map((c) => c.name)).toContain("project_identifier");

		const projectsCols = db
			.prepare("PRAGMA table_info(projects)")
			.all() as Array<{ name: string }>;
		expect(projectsCols.map((c) => c.name)).toEqual(
			expect.arrayContaining([
				"slug",
				"display_name",
				"member_repos",
				"member_paths",
				"provisional",
				"created_at",
				"updated_at",
			]),
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
		const ins = db.prepare(
			"INSERT INTO thoughts (id, content, type, source, created_at, updated_at, project_identifier) VALUES (?,?,?,?,?,?,?)",
		);
		ins.run("a", "x", "note", "t", now, now, "Shelby");
		ins.run("b", "y", "note", "t", now, now, "The Crooked Line");
		ins.run("c", "z", "note", "t", now, now, "");
		getMigrations()
			.find((migration) => migration.version === 7)
			?.up(db);
		const get = db.prepare(
			"SELECT project_identifier AS p FROM thoughts WHERE id = ?",
		);
		expect((get.get("a") as { p: string | null }).p).toBe("shelby");
		expect((get.get("b") as { p: string | null }).p).toBe("the-crooked-line");
		expect((get.get("c") as { p: string | null }).p).toBeNull();
		db.close();
	});
});

describe("migration v8 — canonical project identity", () => {
	const migrateThroughV7 = (db: Database.Database): void => {
		for (const migration of getMigrations().filter(
			({ version }) => version <= 7,
		)) {
			migration.up(db);
		}
		setSchemaVersion(db, 7);
	};

	const insertProject = (
		db: Database.Database,
		slug: string,
		displayName = "Legacy Project",
	): void => {
		db.prepare(
			`INSERT INTO projects
       (slug, display_name, member_repos, member_paths, provisional, created_at, updated_at)
       VALUES (?, ?, '["github.com/example/project"]', '["/tmp/project"]', 1, '2026-07-18T00:00:00Z', '2026-07-18T00:00:00Z')`,
		).run(slug, displayName);
	};

	const insertThought = (
		db: Database.Database,
		id: string,
		projectIdentifier: string | null,
	): void => {
		db.prepare(
			`INSERT INTO thoughts
       (id, content, type, source, project_identifier, created_at, updated_at)
       VALUES (?, 'content', 'note', 'test', ?, '2026-07-18T00:00:00Z', '2026-07-18T00:00:00Z')`,
		).run(id, projectIdentifier);
	};

	it("creates constrained v8 identity schema on fresh stores", () => {
		const db = new Database(":memory:");
		runMigrations(db);

		const projectColumns = db
			.prepare("PRAGMA table_info(projects)")
			.all() as Array<{
			name: string;
			notnull: number;
		}>;
		const projectColumn = (name: string) =>
			projectColumns.find((column) => column.name === name);
		expect(projectColumns.map(({ name }) => name)).toEqual(
			expect.arrayContaining([
				"slug",
				"display_name",
				"member_repos",
				"member_paths",
				"provisional",
				"created_at",
				"updated_at",
				"project_id",
				"current_slug",
				"identity_state",
			]),
		);
		expect(projectColumn("project_id")?.notnull).toBe(1);
		expect(projectColumn("current_slug")?.notnull).toBe(1);
		expect(projectColumn("identity_state")?.notnull).toBe(1);

		const projectIndexes = db
			.prepare("PRAGMA index_list(projects)")
			.all() as Array<{
			name: string;
			unique: number;
		}>;
		expect(projectIndexes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ unique: 1 }),
				expect.objectContaining({ unique: 1 }),
			]),
		);
		expect(db.prepare("PRAGMA index_list(thoughts)").all()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "idx_thoughts_project_id" }),
			]),
		);
		expect(
			db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all(),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "project_slug_aliases" }),
			]),
		);
		db.close();
	});

	it("deterministically backfills projects, aliases, and resolvable thoughts", () => {
		const db = new Database(":memory:");
		migrateThroughV7(db);
		insertProject(db, "legacy-project");
		insertThought(db, "known", "legacy-project");
		insertThought(db, "unknown", "unknown-project");
		insertThought(db, "unscoped", null);

		runMigrations(db);

		const expectedId = deriveExistingProjectId("legacy-project");
		const project = db.prepare("SELECT * FROM projects").get() as Record<
			string,
			unknown
		>;
		expect(project).toMatchObject({
			slug: "legacy-project",
			display_name: "Legacy Project",
			member_repos: '["github.com/example/project"]',
			member_paths: '["/tmp/project"]',
			provisional: 1,
			created_at: "2026-07-18T00:00:00Z",
			updated_at: "2026-07-18T00:00:00Z",
			project_id: expectedId,
			current_slug: "legacy-project",
			identity_state: "local_only",
		});
		expect(
			db.prepare("SELECT * FROM project_slug_aliases").get(),
		).toMatchObject({
			slug: "legacy-project",
			project_id: expectedId,
			status: "tentative",
			claimed_at: "2026-07-18T00:00:00Z",
			retired_at: null,
		});
		expect(
			db.prepare("SELECT id, project_id FROM thoughts ORDER BY id").all(),
		).toEqual([
			{ id: "known", project_id: expectedId },
			{ id: "unknown", project_id: null },
			{ id: "unscoped", project_id: null },
		]);
		db.close();
	});

	it("aborts without any mutation when a registered slug is malformed", () => {
		const db = new Database(":memory:");
		migrateThroughV7(db);
		insertProject(db, "valid-project", "Valid");
		insertProject(db, "Not Canonical", "Invalid");

		expect(() => runMigrations(db)).toThrow("invalid_legacy_slug");
		expect(getSchemaVersion(db)).toBe(7);
		expect(
			db.prepare("PRAGMA table_info(projects)").all() as Array<{
				name: string;
			}>,
		).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ name: "project_id" })]),
		);
		expect(
			db.prepare("PRAGMA table_info(thoughts)").all() as Array<{
				name: string;
			}>,
		).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ name: "project_id" })]),
		);
		expect(
			db
				.prepare(
					"SELECT name FROM sqlite_master WHERE name = 'project_slug_aliases'",
				)
				.get(),
		).toBeUndefined();
		expect(db.prepare("SELECT COUNT(*) AS count FROM projects").get()).toEqual({
			count: 2,
		});
		db.close();
	});

	it("is unchanged after closing and reopening an already migrated store", () => {
		const directory = mkdtempSync(join(tmpdir(), "shelby-migration-v8-"));
		const path = join(directory, "memory.db");
		try {
			const first = new Database(path);
			migrateThroughV7(first);
			insertProject(first, "legacy-project");
			insertThought(first, "known", "legacy-project");
			runMigrations(first);
			const before = first
				.prepare(
					"SELECT * FROM projects JOIN project_slug_aliases USING (project_id)",
				)
				.get();
			first.close();

			const reopened = new ThoughtDatabase(path);
			const after = reopened.db
				.prepare(
					"SELECT * FROM projects JOIN project_slug_aliases USING (project_id)",
				)
				.get();
			expect(after).toEqual(before);
			expect(reopened.getSchemaVersion()).toBe(8);
			reopened.close();
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
