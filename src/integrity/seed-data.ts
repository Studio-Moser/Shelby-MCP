// OPERATOR BOOTSTRAP DATA — contains machine-specific paths + a hand-curated topic map.
// TODO before npm publish: load this from ~/.shelbymcp/projects.seed.json (or a --seed flag)
// instead of bundling, so the published package ships no literal home paths.

import type { Project } from "../db/projects.js";

// Known projects seed. member_repos are normalized git remotes; member_paths are
// machine-local hints (used to map legacy absolute-path `project` values to slugs).
export const DEFAULT_KNOWN_PROJECTS: Project[] = [
  {
    slug: "shelby",
    displayName: "Shelby",
    provisional: false,
    memberRepos: [
      "github.com/Studio-Moser/Shelby-MCP",
      "github.com/Studio-Moser/Shelby-MacOS",
      "github.com/Studio-Moser/Shelby-Strategy",
      "github.com/Studio-Moser/Shelby-Website",
    ],
    memberPaths: ["/Users/timmoser/Projects/Shelby"],
  },
  {
    slug: "kuow-games",
    displayName: "KUOW Games",
    provisional: false,
    memberRepos: [],
    memberPaths: [
      "/Users/timmoser/Projects/KUOW-Games",
      "/Users/timmoser/Projects/KUOW-Core",
      "/Users/timmoser/Projects/KUOW-Connect",
      "/Users/timmoser/Projects/KUOW-Website",
    ],
  },
  {
    slug: "the-crooked-line",
    displayName: "The Crooked Line",
    provisional: false,
    memberRepos: ["github.com/The-Crooked-Line/website"],
    memberPaths: ["/Users/timmoser/Projects/The Crooked Line"],
  },
  {
    slug: "ausra-photos",
    displayName: "Ausra Photos",
    provisional: false,
    memberRepos: [],
    memberPaths: ["/Users/timmoser/Projects/Ausra Photos"],
  },
];

// Distinctive topic → slug. Only topics that unambiguously identify a project.
export const DEFAULT_TOPIC_CLUSTERS: Record<string, string> = {
  "kuow-games": "kuow-games",
  "foggy-find": "kuow-games",
  "game-shell": "kuow-games",
  "game-takeover": "kuow-games",
  "player-progress": "kuow-games",
  "daily-puzzle-pipeline": "kuow-games",
  "overnight-worker": "the-crooked-line",
  "polymarket": "the-crooked-line",
  "prediction-market": "the-crooked-line",
  "prediction-markets": "the-crooked-line",
  "cftc": "the-crooked-line",
  "sec-edgar": "the-crooked-line",
  "market-manipulation": "the-crooked-line",
  "government-contracts": "the-crooked-line",
  "congressional-trading": "the-crooked-line",
  "unusual-whales": "the-crooked-line",
  "the-crooked-line": "the-crooked-line",
  "ausra-photos": "ausra-photos",
  "ausra-research": "ausra-photos",
  "shelby-daily-research": "shelby",
  "shelby-macos": "shelby",
  "shelby-mcp": "shelby",
  "shelby-strategy": "shelby",
  "shelby-research": "shelby",
  "shelby-mac-ui": "shelby",
};
