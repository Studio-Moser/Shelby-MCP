import { resolve } from "node:path";
import { homedir } from "node:os";

export interface ShelbyConfig {
  dbPath: string;
  verbose: boolean;
  logFile: string | null;
  transport: "stdio" | "http";
  httpPort: number;
  httpHost: string;
  apiKey: string | null;
}

export interface CliCommand {
  command: "help" | "setup" | "uninstall" | "protocol" | "forage" | "onboard" | "migrate";
  agent?: string;
  forage?: boolean;
  onboard?: boolean;
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
    const forage = argv.includes("--forage");
    const onboard = argv.includes("--onboard");
    const agent = argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined;
    return { command: "setup", agent, forage, onboard };
  }

  if (first === "uninstall") {
    const agent = argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined;
    return { command: "uninstall", agent };
  }

  if (first === "protocol") {
    return { command: "protocol" };
  }

  if (first === "forage") {
    return { command: "forage" };
  }

  if (first === "onboard") {
    return { command: "onboard" };
  }

  if (first === "migrate") {
    return { command: "migrate" };
  }

  // Parse flags for server mode — env vars provide defaults, CLI flags override
  const envTransport = process.env.SHELBY_TRANSPORT;
  const config: ShelbyConfig = {
    dbPath: process.env.SHELBY_DB_PATH ? resolve(process.env.SHELBY_DB_PATH) : DEFAULT_DB_PATH,
    verbose: false,
    logFile: null,
    transport: envTransport === "http" || envTransport === "stdio" ? envTransport : "stdio",
    httpPort: parseInt(process.env.PORT ?? "3100", 10),
    httpHost: process.env.HOST ?? "127.0.0.1",
    apiKey: process.env.SHELBY_API_KEY ?? null,
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
      case "--transport": {
        const val = argv[++i];
        if (val === "stdio" || val === "http") {
          config.transport = val;
        } else {
          console.error(`[ERROR] Invalid transport "${val}". Use "stdio" or "http".`);
          process.exit(1);
        }
        break;
      }
      case "--port":
        config.httpPort = parseInt(argv[++i] ?? "3100", 10);
        break;
      case "--host":
        config.httpHost = argv[++i] ?? "127.0.0.1";
        break;
      case "--version":
        return "version";
    }
  }

  // Default to 0.0.0.0 for HTTP transport (needed for containers) unless explicitly set
  if (config.transport === "http" && !process.env.HOST && !argv.includes("--host")) {
    config.httpHost = "0.0.0.0";
  }

  return config;
}

export function getDefaultDbPath(): string {
  return DEFAULT_DB_PATH;
}

export function getDefaultDbDir(): string {
  return DEFAULT_DB_DIR;
}
