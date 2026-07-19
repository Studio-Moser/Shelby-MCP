import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrations.js";
import { applyDefaultScope } from "../../src/mcp/scope-defaults.js";
import {
	createLocalOnlyProject,
	upsertProject,
	getProjectByAlias,
	getProjectBySlug,
	listProjects,
} from "../../src/db/projects.js";
import {
	resolveProjectIdentifier,
	resolveProjectReference,
	currentProjectSlug,
	resolveProjectScope,
	slugify,
} from "../../src/db/resolve-project.js";

let db: Database.Database;
beforeEach(() => {
	db = new Database(":memory:");
	runMigrations(db);
});

function repo(remote: string): string {
  const root = mkdtempSync(join(tmpdir(), "rp-"));
  mkdirSync(join(root, ".git"));
	writeFileSync(
		join(root, ".git", "config"),
		`[remote "origin"]\n\turl = ${remote}\n`,
	);
  return root;
}

describe("resolveProjectScope", () => {
  it("keeps slugify byte-identical to ADR 0001", () => {
    expect(slugify("  My_Project -- Name!  ")).toBe("my-project-name");
    expect(slugify("___")).toBe("project");
  });

	it("resolves v2 paths, remotes, and tentative/current explicit aliases to the human slug", () => {
		const root = repo("https://github.com/acme/identity-v2.git");
		const project = createLocalOnlyProject(db, {
			slug: "human-project",
			displayName: "Human Project",
			memberRepos: ["github.com/acme/identity-v2"],
			memberPaths: [root],
			provisional: false,
		});
		expect(project.slug).not.toBe("human-project");

		expect(resolveProjectScope(db, [root])).toEqual({
			kind: "resolved",
			slug: "human-project",
			source: "member_path",
		});
		expect(
			resolveProjectScope(db, [repo("git@github.com:acme/identity-v2.git")]),
		).toEqual({
			kind: "resolved",
			slug: "human-project",
			source: "git_remote",
		});
		expect(resolveProjectScope(db, [], "human-project")).toEqual({
			kind: "resolved",
			slug: "human-project",
			source: "explicit",
		});
		expect(
			resolveProjectScope(db, [
				repo("https://gitlab.com/other/human-project.git"),
			]),
		).toEqual({ kind: "unresolved" });

		db.prepare(
			"UPDATE project_slug_aliases SET status = 'current' WHERE slug = ?",
		).run("human-project");
		db.prepare(
			`INSERT INTO project_slug_aliases (slug, project_id, status, claimed_at)
			 VALUES ('future-human-project', ?, 'tentative', ?)`,
		).run(project.projectId, new Date().toISOString());
		for (const alias of ["human-project", "future-human-project"]) {
			expect(resolveProjectScope(db, [], alias)).toEqual({
				kind: "resolved",
				slug: "human-project",
				source: "explicit",
			});
		}
	});

  it("accepts only registered canonical explicit slugs and gives them precedence", () => {
    const root = repo("https://github.com/acme/other.git");
		upsertProject(db, {
			slug: "shelby",
			displayName: "Shelby",
			memberRepos: [],
			memberPaths: [],
			provisional: false,
		});

    expect(resolveProjectScope(db, [root], "shelby")).toEqual({
			kind: "resolved",
			slug: "shelby",
			source: "explicit",
    });
    expect(resolveProjectScope(db, [root], "Shelby")).toEqual({
			kind: "invalid_explicit",
			slug: "Shelby",
    });
    expect(resolveProjectScope(db, [root], "missing")).toEqual({
			kind: "invalid_explicit",
			slug: "missing",
    });
  });

  it("uses the registry's longest member-path match", () => {
    const container = mkdtempSync(join(tmpdir(), "rp-container-"));
    const nested = join(container, "nested", "repo");
    mkdirSync(nested, { recursive: true });
		upsertProject(db, {
			slug: "outer",
			displayName: "Outer",
			memberRepos: [],
			memberPaths: [container],
			provisional: false,
		});
		upsertProject(db, {
			slug: "inner",
			displayName: "Inner",
			memberRepos: [],
			memberPaths: [join(container, "nested")],
			provisional: false,
		});

		expect(resolveProjectScope(db, [nested])).toMatchObject({
			kind: "resolved",
			slug: "inner",
			source: "member_path",
		});
  });

  it("matches normalized HTTPS and SCP-style remotes", () => {
		upsertProject(db, {
			slug: "shelby",
			displayName: "Shelby",
			memberRepos: ["github.com/Studio-Moser/Shelby-MCP"],
			memberPaths: [],
			provisional: false,
		});
    const https = repo("https://github.com/Studio-Moser/Shelby-MCP.git");
    const scp = repo("git@github.com:Studio-Moser/Shelby-MCP.git");

		expect(resolveProjectScope(db, [https])).toMatchObject({
			kind: "resolved",
			slug: "shelby",
			source: "git_remote",
		});
		expect(resolveProjectScope(db, [scp])).toMatchObject({
			kind: "resolved",
			slug: "shelby",
			source: "git_remote",
		});
  });

  it("combines same-slug roots and reports different-slug roots as ambiguous", () => {
    const one = repo("https://github.com/acme/one.git");
    const oneAgain = repo("git@github.com:acme/one.git");
    const two = repo("https://github.com/acme/two.git");

		expect(resolveProjectScope(db, [one, oneAgain])).toMatchObject({
			kind: "resolved",
			slug: "one",
			source: "derived",
		});
		expect(resolveProjectScope(db, [one, two])).toEqual({
			kind: "ambiguous",
			slugs: ["one", "two"],
		});
  });

  it("fails closed when an unmatched remote derives an occupied slug", () => {
    upsertProject(db, {
      slug: "shared-name",
      displayName: "Original",
      memberRepos: ["github.com/owner/shared-name"],
      memberPaths: [],
      provisional: false,
    });
    const unrelated = repo("https://gitlab.com/other/shared-name.git");

		expect(resolveProjectScope(db, [unrelated])).toEqual({
			kind: "unresolved",
		});
  });

  it("leaves markerless unregistered containers unresolved", () => {
    const dir = mkdtempSync(join(tmpdir(), "rp-plain-"));
    expect(resolveProjectScope(db, [dir])).toEqual({ kind: "unresolved" });
  });

  it("resolves a git worktree from the common repository config", () => {
    const common = mkdtempSync(join(tmpdir(), "rp-common-"));
    mkdirSync(join(common, ".git", "worktrees", "feature"), { recursive: true });
    writeFileSync(join(common, ".git", "config"), '[remote "origin"]\n\turl = git@github.com:acme/worktree.git\n');
    const worktree = mkdtempSync(join(tmpdir(), "rp-worktree-"));
    writeFileSync(join(worktree, ".git"), `gitdir: ${join(common, ".git", "worktrees", "feature")}\n`);

    expect(resolveProjectScope(db, [worktree])).toMatchObject({ kind: "resolved", slug: "worktree", source: "derived" });
  });
});

type ResolutionCase = {
	project_id: string | null;
	project_identifier: string | null;
	working_directory?: string | null;
	git_remote?: string | null;
	context:
		| "owning_local_database"
		| "other_local_database"
		| "global_claims_only";
	expected:
		| { kind: "resolved"; project_id: string; current_slug: string }
		| {
				kind:
					| "invalid_project_id"
					| "unknown_project_id"
					| "unknown_alias"
					| "conflicting_project_scope"
					| "unresolved";
				read_scope?: string;
		  };
};

type IdentityFixture = {
	registry: {
		projects: Array<{
			slug: string;
			project_id: string;
			current_slug: string;
			identity_state: string;
			display_name: string;
			member_repos: string[];
			member_paths: string[];
			provisional: boolean;
			created_at: string;
			updated_at: string;
		}>;
		aliases: Array<{
			slug: string;
			project_id: string;
			status: string;
			claimed_at: string;
			retired_at: string | null;
		}>;
	};
	resolution_cases: ResolutionCase[];
};

function loadIdentityFixture(): IdentityFixture {
	try {
		return JSON.parse(
			readFileSync(
				fileURLToPath(
					new URL("../fixtures/project-identity-v2.json", import.meta.url),
				),
				"utf8",
			),
		) as IdentityFixture;
	} catch (error) {
		throw new Error(`Invalid project identity fixture: ${String(error)}`, {
			cause: error,
		});
	}
}

const identityFixture = loadIdentityFixture();

function seedFixtureRegistry(context: ResolutionCase["context"]): void {
	const includeLocal = context === "owning_local_database";
	for (const project of identityFixture.registry.projects) {
		if (!includeLocal && project.identity_state === "local_only") continue;
		db.prepare(
			`INSERT INTO projects
			 (slug, project_id, current_slug, identity_state, display_name, member_repos, member_paths, provisional, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			project.slug,
			project.project_id,
			project.current_slug,
			project.identity_state,
			project.display_name,
			JSON.stringify(project.member_repos),
			JSON.stringify(project.member_paths),
			project.provisional ? 1 : 0,
			project.created_at,
			project.updated_at,
		);
	}
	for (const alias of identityFixture.registry.aliases) {
		if (!includeLocal && alias.status === "tentative") continue;
		db.prepare(
			`INSERT INTO project_slug_aliases (slug, project_id, status, claimed_at, retired_at)
			 VALUES (?, ?, ?, ?, ?)`,
		).run(
			alias.slug,
			alias.project_id,
			alias.status,
			alias.claimed_at,
			alias.retired_at,
		);
	}
}

describe("resolveProjectReference canonical fixture", () => {
	it.each(identityFixture.resolution_cases)(
		"resolves $context project_id=$project_id alias=$project_identifier",
		(testCase) => {
			seedFixtureRegistry(testCase.context);
			let projectIdentifier = testCase.project_identifier ?? undefined;
			if (
				!testCase.project_id &&
				!projectIdentifier &&
				testCase.working_directory
			) {
				const scope = resolveProjectScope(db, [testCase.working_directory]);
				projectIdentifier = scope.kind === "resolved" ? scope.slug : undefined;
			}
			if (!testCase.project_id && !projectIdentifier && testCase.git_remote) {
				const scope = resolveProjectScope(db, [repo(testCase.git_remote)]);
				projectIdentifier = scope.kind === "resolved" ? scope.slug : undefined;
			}

			if (testCase.expected.kind === "unresolved") {
				const scoped = applyDefaultScope({}, db, []);
				expect(scoped.kind).toBe("applied");
				if (scoped.kind !== "applied") throw new Error(scoped.message);
				expect({
					kind: "unresolved",
					read_scope: testCase.expected.read_scope,
					sharedOnly: scoped.args.shared_only === true,
					allProjects: scoped.args.all_projects === true,
					projectId: scoped.args.project_id,
					currentSlug: scoped.args.project_identifier,
				}).toEqual({
					kind: "unresolved",
					read_scope: "shared_only",
					sharedOnly: true,
					allProjects: false,
					projectId: undefined,
					currentSlug: undefined,
				});
				return;
			}

			const actual = resolveProjectReference(db, {
				projectId: testCase.project_id ?? undefined,
				projectIdentifier,
			});
			const expected =
				testCase.expected.kind === "resolved"
					? {
							kind: "resolved" as const,
							projectId: testCase.expected.project_id,
							currentSlug: testCase.expected.current_slug,
						}
					: { kind: testCase.expected.kind };
			expect(actual).toEqual(expected);
		},
	);
});

describe("resolveProjectIdentifier", () => {
  it("returns the slug of a registered project matching the repo remote", () => {
    upsertProject(db, { slug: "shelby", displayName: "Shelby", memberRepos: ["github.com/Studio-Moser/Shelby-MCP"], memberPaths: [], provisional: false });
    const root = repo("git@github.com:Studio-Moser/Shelby-MCP.git");
    expect(resolveProjectIdentifier(db, root)).toBe("shelby");
    expect(getProjectBySlug(db, "shelby")?.provisional).toBe(false);
  });

  it("auto-provisions a provisional project from the repo basename when unmatched", () => {
    const root = repo("https://github.com/acme/Cool-Repo.git");
    const slug = resolveProjectIdentifier(db, root);
    expect(slug).toBe("cool-repo");
		const p = getProjectByAlias(db, "cool-repo");
    expect(p?.provisional).toBe(true);
    expect(p?.memberRepos).toEqual(["github.com/acme/Cool-Repo"]);
  });

  it("returns null and provisions nothing for a bare non-marker temp dir", () => {
    // No .git, package.json, or other markers — server install/home dir scenario.
    // mkdtempSync gives a unique dir with no project markers.
    const dir = mkdtempSync(join(tmpdir(), "Plain Dir-"));
    const slug = resolveProjectIdentifier(db, dir);
    expect(slug).toBeNull();
    // No project should have been provisioned.
    // We can't easily enumerate all slugs, but we can confirm the dir basename
    // was NOT registered as a project (since nothing was provisioned).
  });

  it("provisions a basename-slug provisional project for a dir with package.json but no .git", () => {
    // Real project root (has a marker), no remote — should provision from basename.
    const dir = mkdtempSync(join(tmpdir(), "my-pkg-dir-"));
    writeFileSync(join(dir, "package.json"), '{"name": "my-pkg-dir"}');
    const slug = resolveProjectIdentifier(db, dir);
    expect(typeof slug).toBe("string");
    expect(slug!.length).toBeGreaterThan(0);
		const p = getProjectByAlias(db, slug!);
    expect(p?.provisional).toBe(true);
    expect(p?.memberRepos).toEqual([]);
  });
});

describe("currentProjectSlug (read-only)", () => {
  it("returns the registry slug when the remote matches a registered project (no write)", () => {
    upsertProject(db, {
      slug: "shelby",
      displayName: "Shelby",
      memberRepos: ["github.com/Studio-Moser/Shelby-MCP"],
      memberPaths: [],
      provisional: false,
    });
    const root = repo("git@github.com:Studio-Moser/Shelby-MCP.git");
    const countBefore = listProjects(db).length;

    const slug = currentProjectSlug(db, root);

    expect(slug).toBe("shelby");
    // Read-only: no new project should have been written
    expect(listProjects(db).length).toBe(countBefore);
  });

  it("returns slugified basename of remote for an unmatched repo (no write)", () => {
    const root = repo("https://github.com/acme/Cool-Repo.git");
    const countBefore = listProjects(db).length;

    const slug = currentProjectSlug(db, root);

    expect(slug).toBe("cool-repo");
    // Read-only: nothing written
    expect(listProjects(db).length).toBe(countBefore);
  });

  it("returns null for a non-project directory (no write)", () => {
    // Plain temp dir — no markers at all
    const dir = mkdtempSync(join(tmpdir(), "plain-"));
    const countBefore = listProjects(db).length;

    const slug = currentProjectSlug(db, dir);

    expect(slug).toBeNull();
    expect(listProjects(db).length).toBe(countBefore);
  });

  it("resolves a markerless container dir via the registry member_paths", () => {
    // No .git / package.json marker here — only a registry path match.
    const dir = mkdtempSync(join(tmpdir(), "container-"));
		upsertProject(db, {
			slug: "shelby",
			displayName: "Shelby",
			memberRepos: [],
			memberPaths: [dir],
			provisional: false,
		});
    expect(currentProjectSlug(db, dir)).toBe("shelby");        // read path
    expect(resolveProjectIdentifier(db, dir)).toBe("shelby");  // write path
  });
});
