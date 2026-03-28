import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

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

function removeFromJsonConfig(filePath: string, serverKey: string): boolean {
  if (!existsSync(filePath)) {
    console.log(`Config file not found: ${filePath}`);
    return false;
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    console.error(`Could not parse ${filePath}`);
    return false;
  }

  const servers = config.mcpServers as Record<string, unknown> | undefined;
  if (!servers || !servers[serverKey]) {
    console.log(`"${serverKey}" not found in ${filePath}`);
    return false;
  }

  delete servers[serverKey];
  writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n");
  console.log(`Removed "${serverKey}" from ${filePath}`);
  return true;
}

function uninstallClaudeCode(): void {
  // Remove MCP server via CLI
  try {
    execSync("which claude", { stdio: "ignore" });
    console.log("Removing ShelbyMCP from Claude Code CLI...\n");
    try {
      execSync("claude mcp remove memory", { stdio: "inherit" });
      console.log("\nRemoved MCP server from Claude Code CLI.");
    } catch {
      console.log("\nCould not remove automatically. Run manually:");
      console.log("  claude mcp remove memory");
    }
  } catch {
    console.log("Claude Code CLI not found — skipping MCP server removal.");
  }

  // Remove Forage skill
  const skillPath = resolve(homedir(), ".claude/scheduled-tasks/shelby-forage");
  if (existsSync(skillPath)) {
    rmSync(skillPath, { recursive: true });
    console.log(`\nRemoved Forage skill from ${skillPath}`);
  }

  console.log("\nNote: The Memory Protocol in ~/.claude/CLAUDE.md must be removed manually.");
  console.log("The database at ~/.shelbymcp/memory.db is NOT deleted — your memories are safe.");
}

function uninstallClaudeDesktop(): void {
  const platform = process.platform;
  let configPath: string;

  if (platform === "darwin") {
    configPath = resolve(homedir(), "Library/Application Support/Claude/claude_desktop_config.json");
  } else if (platform === "win32") {
    configPath = resolve(process.env.APPDATA ?? "", "Claude/claude_desktop_config.json");
  } else {
    configPath = resolve(homedir(), ".config/Claude/claude_desktop_config.json");
  }

  removeFromJsonConfig(configPath, "memory");

  console.log("\nIMPORTANT: Quit and restart Claude Desktop after editing.");
  console.log("\nManual steps:");
  console.log("  - Remove the Memory Protocol from Settings > Profile");
  console.log("  - Delete the Forage scheduled task from the Schedule page (if added)");
  console.log("\nThe database at ~/.shelbymcp/memory.db is NOT deleted — your memories are safe.");
}

function uninstallCursor(): void {
  const globalPath = resolve(homedir(), ".cursor/mcp.json");
  removeFromJsonConfig(globalPath, "memory");

  console.log("\nManual steps:");
  console.log("  - Delete .cursor/rules/shelbymcp.mdc (if created)");
  console.log("  - Remove any Cursor Automations for Forage (if added)");
  console.log("\nThe database at ~/.shelbymcp/memory.db is NOT deleted — your memories are safe.");
}

function uninstallCodex(): void {
  const configPath = resolve(homedir(), ".codex/config.toml");

  if (existsSync(configPath)) {
    const content = readFileSync(configPath, "utf-8");
    // Remove the [mcp_servers.memory] section
    const cleaned = content.replace(/\[mcp_servers\.memory\]\n(?:.*\n)*?(?=\[|$)/g, "").trim();
    if (cleaned !== content.trim()) {
      writeFileSync(configPath, cleaned + "\n");
      console.log(`Removed [mcp_servers.memory] from ${configPath}`);
    } else {
      console.log(`"memory" server not found in ${configPath}`);
    }
  } else {
    console.log(`Config file not found: ${configPath}`);
  }

  console.log("\nManual steps:");
  console.log("  - Remove the Memory Protocol from AGENTS.md");
  console.log("\nThe database at ~/.shelbymcp/memory.db is NOT deleted — your memories are safe.");
}

function uninstallWindsurf(): void {
  const platform = process.platform;
  let configPath: string;

  if (platform === "win32") {
    configPath = resolve(process.env.USERPROFILE ?? homedir(), ".codeium/windsurf/mcp_config.json");
  } else {
    configPath = resolve(homedir(), ".codeium/windsurf/mcp_config.json");
  }

  removeFromJsonConfig(configPath, "memory");

  console.log("\nManual steps:");
  console.log("  - Remove the Memory Protocol from .windsurfrules");
  console.log("\nThe database at ~/.shelbymcp/memory.db is NOT deleted — your memories are safe.");
}

function uninstallGemini(): void {
  const configPath = resolve(homedir(), ".gemini/settings.json");
  removeFromJsonConfig(configPath, "shelby-memory");

  console.log("\nManual steps:");
  console.log("  - Remove the Memory Protocol from GEMINI.md");
  console.log("  - Delete any Forage scheduled actions (if added)");
  console.log("\nThe database at ~/.shelbymcp/memory.db is NOT deleted — your memories are safe.");
}

export function runUninstall(agent: string | undefined): void {
  if (!agent) {
    console.log("Usage: shelbymcp uninstall <agent>\n");
    console.log("Removes ShelbyMCP config from the specified agent.");
    console.log("Does NOT delete your memory database.\n");
    console.log("Agents:");
    console.log("  claude-code       Claude Code CLI");
    console.log("  claude-desktop    Claude Desktop app");
    console.log("  cursor            Cursor IDE");
    console.log("  codex             OpenAI Codex");
    console.log("  windsurf          Windsurf (Codeium)");
    console.log("  gemini            Gemini CLI");
    return;
  }

  if (!isAgent(agent)) {
    console.error(`Unknown agent: "${agent}"\n`);
    console.error("Available agents: " + AGENTS.join(", "));
    process.exit(1);
  }

  switch (agent) {
    case "claude-code":
      uninstallClaudeCode();
      break;
    case "claude-desktop":
      uninstallClaudeDesktop();
      break;
    case "cursor":
      uninstallCursor();
      break;
    case "codex":
      uninstallCodex();
      break;
    case "windsurf":
      uninstallWindsurf();
      break;
    case "gemini":
      uninstallGemini();
      break;
  }
}
