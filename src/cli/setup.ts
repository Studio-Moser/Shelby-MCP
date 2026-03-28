import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
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

function setupClaudeCode(): void {
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
}

function setupClaudeDesktop(): void {
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
}

function setupCursor(): void {
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
}

function setupCodex(): void {
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
}

function setupWindsurf(): void {
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
}

function setupGemini(): void {
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
}

export function runSetup(agent: string | undefined): void {
  if (!agent) {
    console.log("Usage: shelbymcp setup <agent>\n");
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
      setupClaudeCode();
      break;
    case "claude-desktop":
      setupClaudeDesktop();
      break;
    case "cursor":
      setupCursor();
      break;
    case "codex":
      setupCodex();
      break;
    case "windsurf":
      setupWindsurf();
      break;
    case "gemini":
      setupGemini();
      break;
  }
}
