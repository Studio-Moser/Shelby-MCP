import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import {
	createLocalOnlyProject,
	getProjectByAlias,
	listProjects,
	upsertProject,
	type ProjectSeed,
} from "../../src/db/projects.js";
import { ensureSeedProjects } from "../../src/db/seed.js";

let db: Database.Database;
beforeEach(() => {
	db = new Database(":memory:");
	runMigrations(db);
});

// Neutral, depersonalized fixture seed (stands in for a user-authored
// `~/.shelbymcp/projects.seed.json`). After #308 the seed is injected, not
// bundled.
const TEST_PROJECTS: ProjectSeed[] = [
	{
		slug: "shelby",
		displayName: "Shelby",
		memberRepos: ["github.com/example/shelby"],
		memberPaths: ["/p/shelby"],
		provisional: false,
	},
	{
		slug: "kuow-games",
		displayName: "KUOW Games",
		memberRepos: [],
		memberPaths: ["/p/kuow"],
		provisional: false,
	},
	{
		slug: "the-crooked-line",
		displayName: "The Crooked Line",
		memberRepos: [],
		memberPaths: ["/p/tcl"],
		provisional: false,
	},
	{
		slug: "ausra-photos",
		displayName: "Ausra Photos",
		memberRepos: [],
		memberPaths: ["/p/ausra"],
		provisional: false,
	},
];

describe("ensureSeedProjects", () => {
	it("seeds nothing when no projects are injected (fresh install, #308)", () => {
		ensureSeedProjects(db);
		expect(listProjects(db).length).toBe(0);
	});

	it("seeds missing projects through UUIDv4 local-only creation", () => {
		ensureSeedProjects(db, TEST_PROJECTS);
		const seeded = getProjectByAlias(db, "shelby");
		expect(seeded?.memberPaths.length).toBeGreaterThan(0);
		expect(seeded?.slug).toBe(seeded?.projectId);
		expect(seeded?.currentSlug).toBe("shelby");
		expect(seeded?.projectId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		expect(listProjects(db).length).toBe(4);
	});

	it.each(["tentative", "current"] as const)(
		"resolves an existing %s alias without overwriting frozen identity",
		(status) => {
			const alias = `${status}-project`;
			const existing = createLocalOnlyProject(db, {
				slug: alias,
				displayName: "Provisional",
				memberRepos: [],
				memberPaths: [],
				provisional: true,
			});
			if (status === "current") {
				db.prepare(
					"UPDATE project_slug_aliases SET status = 'current' WHERE slug = ?",
				).run(alias);
			}

			ensureSeedProjects(db, [
				{
					slug: alias,
					displayName: "Seeded Details",
					memberRepos: ["github.com/example/project"],
					memberPaths: ["/p/project"],
					provisional: false,
				},
			]);

			expect(listProjects(db)).toHaveLength(1);
			expect(getProjectByAlias(db, alias)).toMatchObject({
				slug: existing.slug,
				projectId: existing.projectId,
				currentSlug: existing.currentSlug,
				identityState: existing.identityState,
				displayName: "Seeded Details",
			});
		},
	);

	it("does not clobber a human-confirmed (non-provisional, edited) project", () => {
		upsertProject(db, {
			slug: "shelby",
			displayName: "My Shelby",
			memberRepos: ["x"],
			memberPaths: ["/custom"],
			provisional: false,
		});
		ensureSeedProjects(db, TEST_PROJECTS);
		expect(getProjectByAlias(db, "shelby")?.displayName).toBe("My Shelby");
	});
});
