import { resolve } from "node:path";
import { homedir } from "node:os";

export interface ShelbyConfig {
  dbPath: string;
  verbose: boolean;
  logFile: string | null;
}

export interface CliCommand {
  command: "help" | "setup" | "protocol" | "forage";
  agent?: string;
}

const DEFAULT_DB_DIR = resolve(homedir(), ".shelbymcp");
const DEFAULT_DB_PATH = resolve(DEFAULT_DB_DIR, "memory.db");

export function parseArgs(argv: string[]): ShelbyConfig | "version" | CliCommand {
  // Check for commands first (before flags)
  const first = argv[0];

  if (first === "help" || first === "--help" || first === "-h") {
    return { command: "help" };
  }

  if (first === "setup") {
    return { command: "setup", agent: argv[1] };
  }

  if (first === "protocol") {
    return { command: "protocol" };
  }

  if (first === "forage") {
    return { command: "forage" };
  }

  // Parse flags for server mode
  const config: ShelbyConfig = {
    dbPath: DEFAULT_DB_PATH,
    verbose: false,
    logFile: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--db":
        config.dbPath = resolve(argv[++i] ?? DEFAULT_DB_PATH);
        break;
      case "--verbose":
        config.verbose = true;
        break;
      case "--log-file":
        config.logFile = resolve(argv[++i] ?? "");
        break;
      case "--version":
        return "version";
    }
  }

  return config;
}

export function getDefaultDbPath(): string {
  return DEFAULT_DB_PATH;
}

export function getDefaultDbDir(): string {
  return DEFAULT_DB_DIR;
}
