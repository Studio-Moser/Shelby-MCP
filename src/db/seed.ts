import type Database from "better-sqlite3";
import { DEFAULT_KNOWN_PROJECTS } from "../integrity/seed-data.js";
import {
	createLocalOnlyProject,
	getProjectById,
	type Project,
	type ProjectSeed,
} from "./projects.js";

function getSeedProject(db: Database.Database, slug: string): Project | null {
	const row = db
		.prepare(
			`SELECT project_id
       FROM project_slug_aliases
       WHERE slug = ? AND status IN ('tentative', 'current')`,
		)
		.get(slug) as { project_id: string } | undefined;
	return row ? getProjectById(db, row.project_id) : null;
}

/** Idempotently seed known projects without changing established identity fields. */
export function ensureSeedProjects(
	db: Database.Database,
	projects: ProjectSeed[] = DEFAULT_KNOWN_PROJECTS,
): void {
	const update = db.prepare(
		`UPDATE projects
     SET display_name = @display_name,
         member_repos = @member_repos,
         member_paths = @member_paths,
         provisional = @provisional,
         updated_at = @updated_at
     WHERE project_id = @project_id`,
	);
	for (const project of projects) {
		const existing = getSeedProject(db, project.slug);
		if (!existing) {
			createLocalOnlyProject(db, project);
			continue;
		}
		if (
			!existing.provisional &&
			(existing.memberRepos.length > 0 || existing.memberPaths.length > 0)
		) {
			continue;
		}
		update.run({
			project_id: existing.projectId,
			display_name: project.displayName,
			member_repos: JSON.stringify(project.memberRepos),
			member_paths: JSON.stringify(project.memberPaths),
			provisional: project.provisional ? 1 : 0,
			updated_at: new Date().toISOString(),
		});
  }
}
