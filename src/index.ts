#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseArgs, getDefaultDbPath } from "./config.js";
import { createServer } from "./mcp/server.js";
import { startHttpTransport } from "./mcp/http-transport.js";
import { printHelp } from "./cli/help.js";
import { printProtocol } from "./cli/protocol.js";
import { printForage } from "./cli/forage.js";
import { printOnboard } from "./cli/onboard.js";
import { printMigrate } from "./cli/migrate.js";
import { runSetup } from "./cli/setup.js";
import { runUninstall } from "./cli/uninstall.js";
import { runRepairProjects } from "./cli/repair-projects.js";

async function main() {
  const config = parseArgs(process.argv.slice(2));

  if (config === "version") {
    console.log("shelbymcp v0.1.0");
    process.exit(0);
  }

  if (typeof config === "object" && "command" in config) {
    switch (config.command) {
      case "help":
        printHelp();
        break;
      case "setup":
        runSetup(config.agent, config.forage ?? false, config.onboard);
        break;
      case "uninstall":
        runUninstall(config.agent);
        break;
      case "protocol":
        printProtocol();
        break;
      case "forage":
        printForage();
        break;
      case "onboard":
        printOnboard();
        break;
      case "migrate":
        printMigrate();
        break;
      case "repair-projects": {
        // Resolve dbPath the same way the server does: env var → default.
        // getDefaultDbPath() returns ~/.shelbymcp/memory.db; SHELBY_DB_PATH
        // is the override env var (config.ts uses the same logic for the server).
        const dbPath = process.env.SHELBY_DB_PATH ?? getDefaultDbPath();
        runRepairProjects(dbPath, config.apply ?? false);
        break;
      }
    }
    process.exit(0);
  }

  if (config.verbose) {
    console.error("[INFO] Verbose mode enabled");
    console.error(`[INFO] Database: ${config.dbPath}`);
  }

  const { server, db } = createServer(config);

  if (config.transport === "http") {
    await startHttpTransport(db, config.httpHost, config.httpPort, config.apiKey);
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[INFO] ShelbyMCP running on stdio");
  }
}

main().catch((error) => {
  console.error("[FATAL]", error);
  process.exit(1);
});
