#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseArgs } from "./config.js";
import { createServer } from "./mcp/server.js";
import { printHelp } from "./cli/help.js";
import { printProtocol } from "./cli/protocol.js";
import { printForage } from "./cli/forage.js";
import { runSetup } from "./cli/setup.js";

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
        runSetup(config.agent, config.forage ?? false);
        break;
      case "protocol":
        printProtocol();
        break;
      case "forage":
        printForage();
        break;
    }
    process.exit(0);
  }

  if (config.verbose) {
    console.error("[INFO] Verbose mode enabled");
    console.error(`[INFO] Database: ${config.dbPath}`);
  }

  const { server } = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[INFO] ShelbyMCP running on stdio");
}

main().catch((error) => {
  console.error("[FATAL]", error);
  process.exit(1);
});
