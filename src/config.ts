import { resolve } from "node:path";
import { homedir } from "node:os";

export interface ShelbyConfig {
  dbPath: string;
  verbose: boolean;
  logFile: string | null;
}

const DEFAULT_DB_DIR = resolve(homedir(), ".shelbymcp");
const DEFAULT_DB_PATH = resolve(DEFAULT_DB_DIR, "memory.db");

export function parseArgs(argv: string[]): ShelbyConfig | "version" {
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
