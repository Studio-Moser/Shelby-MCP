import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const AGENTS = [
  "claude-code",
  "claude-desktop",
  "cursor",
  "codex",
  "windsurf",
  "gemini",
] as const;

type AgentName = (typeof AGENTS)[number];

function isAgent(name: string): name is AgentName {
  return (AGENTS as readonly string[]).includes(name);
}

/** Resolve the package root (where skills/ lives) from the compiled dist/ output */
function getPackageRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // thisFile is dist/cli/setup.js → go up to dist/, then up to package root
  return resolve(dirname(thisFile), "..", "..");
}

function getSkillSourcePath(): string {
  return resolve(getPackageRoot(), "skills", "shelby-forage");
}

function mergeJsonConfig(filePath: string, serverEntry: Record<string, unknown>): boolean {
  let config: Record<string, unknown> = {};

  if (existsSync(filePath)) {
    try {
      config = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      console.error(`Warning: Could not parse ${filePath}. Creating new file.`);
    }
  }

  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }

  const servers = config.mcpServers as Record<string, unknown>;

  if (servers.memory) {
    console.log(`"memory" server already exists in ${filePath}`);
    console.log("To reconfigure, remove the existing entry first.");
    return false;
  }

  servers.memory = serverEntry;

  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n");
  console.log(`Added ShelbyMCP to ${filePath}`);
  return true;
}

function printForageInstructions(agent: string): void {
  console.log("\n--- Forage Skill ---\n");

  switch (agent) {
    case "claude-desktop":
      console.log("To set up Forage on Claude Desktop:");
      console.log("  1. Open the Schedule page");
      console.log("  2. Create a new local task, set frequency to Daily");
      console.log("  3. Paste the Forage prompt: run `shelbymcp forage` to get it");
      console.log("");
      console.log("Also add this to your Profile Preferences (alongside the Memory Protocol):");
      console.log("");
      console.log("  When starting a conversation, check ShelbyMCP for items that need attention:");
      console.log('  use `list_thoughts` with `topic: "needs-attention"` and `limit: 5`.');
      console.log("  If there are any, briefly mention them to the user.");
      console.log("  If the user resolves one, delete the needs-attention thought.");
      break;

    case "cursor":
      console.log("To set up Forage on Cursor:");
      console.log("  1. Open Cursor Automations settings");
      console.log("  2. Create a new automation with a Daily cron schedule");
      console.log("  3. Paste the Forage prompt: run `shelbymcp forage` to get it");
      console.log("");
      console.log("Note: Cursor Automations are cloud-based. MCP access to local");
      console.log("servers may not work. Test to confirm.");
      break;

    case "codex":
      console.log("Codex automation support is still evolving.");
      console.log("To run Forage manually, paste the output of `shelbymcp forage`");
      console.log("into a Codex conversation.");
      break;

    case "windsurf":
      console.log("Windsurf has no scheduler. To run Forage manually, paste the");
      console.log("output of `shelbymcp forage` into a Windsurf conversation");
      console.log("whenever you want to maintain your memories.");
      break;

    case "gemini":
      console.log("To set up Forage on Gemini:");
      console.log("  1. Create a scheduled action set to Daily");
      console.log("  2. Paste the Forage prompt: run `shelbymcp forage` to get it");
      console.log("");
      console.log("Note: Gemini has a max of 10 active scheduled actions.");
      console.log("MCP tool access in scheduled actions is uncertain — test to confirm.");
      break;
  }
}

function setupClaudeCode(forage: boolean): void {
  try {
    execSync("which claude", { stdio: "ignore" });
  } catch {
    console.log("Claude Code CLI not found. Install it from https://code.claude.com\n");
    console.log("Once installed, run:");
    console.log("  claude mcp add -s user -t stdio memory -- npx shelbymcp");
    return;
  }

  console.log("Adding ShelbyMCP to Claude Code CLI (user scope)...\n");

  try {
    execSync("claude mcp add -s user -t stdio memory -- npx shelbymcp", {
      stdio: "inherit",
    });
    console.log("\nShelbyMCP added to Claude Code CLI.");
  } catch {
    console.log("\nCould not add automatically. Run manually:");
    console.log("  claude mcp add -s user -t stdio memory -- npx shelbymcp");
  }

  console.log("\nNext: Add the Memory Protocol to your rules file:");
  console.log("  shelbymcp protocol >> ~/.claude/CLAUDE.md");

  if (forage) {
    const skillSource = getSkillSourcePath();
    const skillDest = resolve(homedir(), ".claude/scheduled-tasks/shelby-forage");

    if (existsSync(resolve(skillDest, "SKILL.md"))) {
      console.log("\n--- Forage Skill ---\n");
      console.log(`Forage skill already installed at ${skillDest}`);
    } else if (existsSync(resolve(skillSource, "SKILL.md"))) {
      mkdirSync(skillDest, { recursive: true });
      cpSync(skillSource, skillDest, { recursive: true });
      console.log("\n--- Forage Skill ---\n");
      console.log(`Forage skill installed to ${skillDest}`);
      console.log("It will run daily via Claude Code's scheduler.");
      console.log("\nNote: Claude Code CLI scheduled tasks auto-expire after 7 days.");
      console.log("Use Claude Desktop for persistent scheduling.");
    } else {
      console.log("\n--- Forage Skill ---\n");
      console.log("Could not find skills/shelby-forage/SKILL.md in the package.");
      console.log("Install manually: shelbymcp forage > ~/.claude/scheduled-tasks/shelby-forage/SKILL.md");
    }
  }
}

function setupClaudeDesktop(forage: boolean): void {
  const platform = process.platform;
  let configPath: string;

  if (platform === "darwin") {
    configPath = resolve(homedir(), "Library/Application Support/Claude/claude_desktop_config.json");
  } else if (platform === "win32") {
    configPath = resolve(process.env.APPDATA ?? "", "Claude/claude_desktop_config.json");
  } else {
    configPath = resolve(homedir(), ".config/Claude/claude_desktop_config.json");
  }

  console.log("Claude Desktop setup\n");
  console.log(`Config file: ${configPath}\n`);
  console.log("Open Claude Desktop > Settings > Developer > Edit Config");
  console.log("Add this to the mcpServers object:\n");
  console.log(JSON.stringify({
    memory: {
      command: "npx",
      args: ["shelbymcp"],
    },
  }, null, 2));
  console.log("\nIMPORTANT: Quit and restart Claude Desktop after editing.");
  console.log("\nNote: Claude Desktop and Claude Code CLI have separate configs.");
  console.log("Setting up one does NOT configure the other.");
  console.log("\nNext: Add the Memory Protocol to your Desktop profile:");
  console.log("  Settings > Profile > \"What preferences should Claude consider?\"");
  console.log("  Run: shelbymcp protocol");

  if (forage) {
    printForageInstructions("claude-desktop");
  }
}

function setupCursor(forage: boolean): void {
  const configPath = resolve(homedir(), ".cursor/mcp.json");

  const entry = {
    command: "npx",
    args: ["shelbymcp"],
  };

  mergeJsonConfig(configPath, entry);

  console.log("\nOr add via UI: Settings > Tools & MCP > New MCP Server");
  console.log("\nNext: Add the Memory Protocol for Cursor:");
  console.log("  mkdir -p .cursor/rules");
  console.log("  echo '---\\nalwaysApply: true\\n---' > .cursor/rules/shelbymcp.mdc");
  console.log("  shelbymcp protocol >> .cursor/rules/shelbymcp.mdc");

  if (forage) {
    printForageInstructions("cursor");
  }
}

function setupCodex(forage: boolean): void {
  try {
    execSync("which codex", { stdio: "ignore" });
  } catch {
    console.log("Codex CLI not found.\n");
    console.log("Add this to ~/.codex/config.toml:\n");
    console.log("[mcp_servers.memory]");
    console.log('command = "npx"');
    console.log('args = ["shelbymcp"]');
    console.log("\nNext: Add the Memory Protocol:");
    console.log("  shelbymcp protocol >> AGENTS.md");
    if (forage) {
      printForageInstructions("codex");
    }
    return;
  }

  console.log("Adding ShelbyMCP to Codex...\n");

  try {
    execSync("codex mcp add memory -- npx shelbymcp", { stdio: "inherit" });
    console.log("\nShelbyMCP added to Codex.");
  } catch {
    console.log("\nCould not add automatically. Add to ~/.codex/config.toml:\n");
    console.log("[mcp_servers.memory]");
    console.log('command = "npx"');
    console.log('args = ["shelbymcp"]');
  }

  console.log("\nNext: Add the Memory Protocol:");
  console.log("  shelbymcp protocol >> AGENTS.md");

  if (forage) {
    printForageInstructions("codex");
  }
}

function setupWindsurf(forage: boolean): void {
  const platform = process.platform;
  let configPath: string;

  if (platform === "win32") {
    configPath = resolve(process.env.USERPROFILE ?? homedir(), ".codeium/windsurf/mcp_config.json");
  } else {
    configPath = resolve(homedir(), ".codeium/windsurf/mcp_config.json");
  }

  const entry = {
    command: "npx",
    args: ["shelbymcp"],
  };

  mergeJsonConfig(configPath, entry);

  console.log("\nOr add via UI: Settings > Cascade > MCP Servers");
  console.log("\nNext: Add the Memory Protocol:");
  console.log("  shelbymcp protocol >> .windsurfrules");

  if (forage) {
    printForageInstructions("windsurf");
  }
}

function setupGemini(forage: boolean): void {
  const configPath = resolve(homedir(), ".gemini/settings.json");

  const entry = {
    command: "npx",
    args: ["shelbymcp"],
  };

  // Gemini stores mcpServers inside settings.json alongside other settings
  let config: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      console.error(`Warning: Could not parse ${configPath}. Creating new file.`);
    }
  }

  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }

  const servers = config.mcpServers as Record<string, unknown>;

  if (servers["shelby-memory"]) {
    console.log(`"shelby-memory" server already exists in ${configPath}`);
    console.log("To reconfigure, remove the existing entry first.");
  } else {
    servers["shelby-memory"] = entry;

    const dir = dirname(configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    console.log(`Added ShelbyMCP as "shelby-memory" to ${configPath}`);
    console.log('(Using hyphens, not underscores — Gemini\'s parser breaks on underscores)');
  }

  console.log("\nNext: Add the Memory Protocol:");
  console.log("  shelbymcp protocol >> GEMINI.md");

  if (forage) {
    printForageInstructions("gemini");
  }
}

export function runSetup(agent: string | undefined, forage: boolean): void {
  if (!agent) {
    console.log("Usage: shelbymcp setup <agent> [--forage]\n");
    console.log("Agents:");
    console.log("  claude-code       Claude Code CLI");
    console.log("  claude-desktop    Claude Desktop app");
    console.log("  cursor            Cursor IDE");
    console.log("  codex             OpenAI Codex");
    console.log("  windsurf          Windsurf (Codeium)");
    console.log("  gemini            Gemini CLI");
    console.log("\nFlags:");
    console.log("  --forage          Also set up the Forage enrichment skill");
    return;
  }

  if (!isAgent(agent)) {
    console.error(`Unknown agent: "${agent}"\n`);
    console.error("Available agents: " + AGENTS.join(", "));
    process.exit(1);
  }

  switch (agent) {
    case "claude-code":
      setupClaudeCode(forage);
      break;
    case "claude-desktop":
      setupClaudeDesktop(forage);
      break;
    case "cursor":
      setupCursor(forage);
      break;
    case "codex":
      setupCodex(forage);
      break;
    case "windsurf":
      setupWindsurf(forage);
      break;
    case "gemini":
      setupGemini(forage);
      break;
  }
}
