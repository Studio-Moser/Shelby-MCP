// The project seed is no longer bundled. It loads per-user from
// `~/.shelbymcp/projects.seed.json` via `project-seed.ts` (#308); a published
// package with no config seeds nothing. These exports remain as EMPTY defaults
// so callers that don't inject a seed contribute no projects/topics.

import type { Project } from "../db/projects.js";

/** Empty by default — real projects load from the per-user seed config. */
export const DEFAULT_KNOWN_PROJECTS: Project[] = [];

/** Empty by default — real topic clusters load from the per-user seed config. */
export const DEFAULT_TOPIC_CLUSTERS: Record<string, string> = {};
