import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { deriveExistingProjectId } from "../../src/db/project-identity.js";
import {
	createLocalOnlyProject,
  upsertProject,
	getProjectByAlias,
	getProjectById,
  getProjectBySlug,
  findProjectByRepo,
  findProjectByPath,
  listProjects,
  normalizeGitRemote,
} from "../../src/db/projects.js";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

describe("normalizeGitRemote", () => {
  it("normalizes https and ssh and strips .git", () => {
		expect(
			normalizeGitRemote("https://github.com/Studio-Moser/Shelby-MCP.git"),
		).toBe("github.com/Studio-Moser/Shelby-MCP");
		expect(
			normalizeGitRemote("git@github.com:Studio-Moser/Shelby-MCP.git"),
		).toBe("github.com/Studio-Moser/Shelby-MCP");
  });
});

describe("projects registry", () => {
	it("looks up immutable IDs and tentative, current, and retired aliases while freezing the legacy key", () => {
		upsertProject(db, {
			slug: "legacy-project",
			displayName: "Legacy Project",
			memberRepos: [],
			memberPaths: [],
			provisional: false,
		});
		const projectId = deriveExistingProjectId("legacy-project");
		db.prepare(
			"UPDATE project_slug_aliases SET status = 'current' WHERE slug = ?",
		).run("legacy-project");
		db.prepare(
			`INSERT INTO project_slug_aliases (slug, project_id, status, claimed_at, retired_at)
			 VALUES ('old-project', ?, 'retired', ?, ?)`,
		).run(projectId, new Date().toISOString(), new Date().toISOString());
		db.prepare(
			`INSERT INTO project_slug_aliases (slug, project_id, status, claimed_at)
			 VALUES ('next-project', ?, 'tentative', ?)`,
		).run(projectId, new Date().toISOString());
		db.prepare("UPDATE projects SET current_slug = ? WHERE project_id = ?").run(
			"legacy-project",
			projectId,
		);

		expect(getProjectById(db, projectId)).toMatchObject({
			slug: "legacy-project",
			projectId,
			currentSlug: "legacy-project",
			identityState: "local_only",
		});
		expect(getProjectByAlias(db, "legacy-project")?.projectId).toBe(projectId);
		expect(getProjectByAlias(db, "next-project")?.projectId).toBe(projectId);
		expect(getProjectByAlias(db, "old-project")?.projectId).toBe(projectId);
		expect(
			getProjectById(db, "00000000-0000-4000-8000-000000000000"),
		).toBeNull();
		expect(getProjectByAlias(db, "unknown-project")).toBeNull();
	});

	it("creates UUIDv4 local-only projects with one tentative alias", () => {
		const created = createLocalOnlyProject(db, {
			slug: "requested-project",
			displayName: "Requested Project",
			memberRepos: ["github.com/example/requested"],
			memberPaths: ["/p/requested"],
			provisional: true,
		});

		expect(created.projectId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		expect(created).toMatchObject({
			slug: created.projectId,
			currentSlug: "requested-project",
			identityState: "local_only",
		});
		expect(getProjectById(db, created.projectId)).toEqual(created);
		expect(
			db
				.prepare("SELECT slug, project_id, status FROM project_slug_aliases")
				.all(),
		).toEqual([
			{
				slug: "requested-project",
				project_id: created.projectId,
				status: "tentative",
			},
		]);
	});

	it("rolls back local-only project creation when alias insertion fails", () => {
		db.exec(`
			CREATE TRIGGER reject_local_alias
			BEFORE INSERT ON project_slug_aliases
			WHEN NEW.slug = 'rollback-local'
			BEGIN
				SELECT RAISE(ABORT, 'reject local alias');
			END;
		`);

		expect(() =>
			createLocalOnlyProject(db, {
				slug: "rollback-local",
				displayName: "Rollback",
				memberRepos: [],
				memberPaths: [],
				provisional: false,
			}),
		).toThrow("reject local alias");
		expect(db.prepare("SELECT COUNT(*) AS count FROM projects").get()).toEqual({
			count: 0,
		});
	});

	it("keeps legacy upserts compatible and identity writes atomic after v8", () => {
		const project = {
			slug: "shelby",
			displayName: "Shelby",
			memberRepos: ["github.com/Studio-Moser/Shelby-MCP"],
			memberPaths: [],
			provisional: false,
		};

		upsertProject(db, project);
		const created = db
			.prepare("SELECT * FROM projects WHERE slug = ?")
			.get(project.slug) as Record<string, unknown>;
		const alias = db
			.prepare("SELECT * FROM project_slug_aliases WHERE slug = ?")
			.get(project.slug) as Record<string, unknown>;
		const expectedId = deriveExistingProjectId(project.slug);
		expect(created).toMatchObject({
			project_id: expectedId,
			current_slug: project.slug,
			identity_state: "local_only",
		});
		expect(alias).toMatchObject({
			slug: project.slug,
			project_id: expectedId,
			status: "tentative",
			retired_at: null,
		});

		db.prepare(
			"UPDATE projects SET current_slug = 'renamed-shelby', identity_state = 'active' WHERE slug = ?",
		).run(project.slug);
		upsertProject(db, { ...project, displayName: "Shelby Updated" });
		expect(
			db
				.prepare(
					"SELECT project_id, current_slug, identity_state FROM projects WHERE slug = ?",
				)
				.get(project.slug),
		).toEqual({
			project_id: created.project_id,
			current_slug: "renamed-shelby",
			identity_state: "active",
		});
		expect(
			db
				.prepare("SELECT * FROM project_slug_aliases WHERE slug = ?")
				.get(project.slug),
		).toEqual(alias);

		db.exec(`
      CREATE TRIGGER reject_test_alias
      BEFORE INSERT ON project_slug_aliases
      WHEN NEW.slug = 'rollback-test'
      BEGIN
        SELECT RAISE(ABORT, 'reject test alias');
      END;
    `);
		expect(() =>
			upsertProject(db, { ...project, slug: "rollback-test" }),
		).toThrow("reject test alias");
		expect(
			db.prepare("SELECT 1 FROM projects WHERE slug = 'rollback-test'").get(),
		).toBeUndefined();
	});

  it("upserts and reads back by slug", () => {
		upsertProject(db, {
			slug: "shelby",
			displayName: "Shelby",
			memberRepos: ["github.com/Studio-Moser/Shelby-MCP"],
			memberPaths: [],
			provisional: false,
		});
    const p = getProjectBySlug(db, "shelby");
    expect(p?.displayName).toBe("Shelby");
    expect(p?.memberRepos).toEqual(["github.com/Studio-Moser/Shelby-MCP"]);
    expect(p?.provisional).toBe(false);
  });

  it("finds a project by a member repo remote (normalized)", () => {
		upsertProject(db, {
			slug: "shelby",
			displayName: "Shelby",
			memberRepos: ["github.com/Studio-Moser/Shelby-MCP"],
			memberPaths: [],
			provisional: false,
		});
		const p = findProjectByRepo(
			db,
			"git@github.com:Studio-Moser/Shelby-MCP.git",
		);
    expect(p?.slug).toBe("shelby");
    expect(findProjectByRepo(db, "github.com/other/unknown")).toBeNull();
  });

  it("upsert is idempotent on slug and updates fields", () => {
		upsertProject(db, {
			slug: "x",
			displayName: "X",
			memberRepos: [],
			memberPaths: [],
			provisional: true,
		});
		upsertProject(db, {
			slug: "x",
			displayName: "X2",
			memberRepos: ["github.com/a/b"],
			memberPaths: [],
			provisional: false,
		});
    expect(listProjects(db)).toHaveLength(1);
    const p = getProjectBySlug(db, "x");
    expect(p?.displayName).toBe("X2");
    expect(p?.provisional).toBe(false);
  });
});

describe("findProjectByPath", () => {
  it("matches the project whose member_path is the longest prefix of dir", () => {
		upsertProject(db, {
			slug: "shelby",
			displayName: "Shelby",
			memberRepos: [],
			memberPaths: ["/Users/tim/Projects/Shelby"],
			provisional: false,
		});
		upsertProject(db, {
			slug: "tcl",
			displayName: "TCL",
			memberRepos: [],
			memberPaths: ["/Users/tim/Projects/The Crooked Line"],
			provisional: false,
		});

		expect(findProjectByPath(db, "/Users/tim/Projects/Shelby")?.slug).toBe(
			"shelby",
		);
		expect(
			findProjectByPath(db, "/Users/tim/Projects/Shelby/Shelby-MCP/src")?.slug,
		).toBe("shelby");
    expect(findProjectByPath(db, "/Users/tim/Projects/Other")).toBeNull();
  });

  it("prefers the longest matching member_path when paths nest", () => {
		upsertProject(db, {
			slug: "outer",
			displayName: "Outer",
			memberRepos: [],
			memberPaths: ["/Users/tim/Projects"],
			provisional: false,
		});
		upsertProject(db, {
			slug: "inner",
			displayName: "Inner",
			memberRepos: [],
			memberPaths: ["/Users/tim/Projects/Shelby"],
			provisional: false,
		});
		expect(findProjectByPath(db, "/Users/tim/Projects/Shelby/x")?.slug).toBe(
			"inner",
		);
  });
});
