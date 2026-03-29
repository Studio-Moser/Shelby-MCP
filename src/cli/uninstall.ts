import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const isWindows = process.platform === "win32";

function whichCmd(bin: string): string {
  return isWindows ? `where ${bin}` : `which ${bin}`;
}

const AGENTS = [
  "claude-code",
  "claude-desktop",
  "cursor",
  "codex",
  "windsurf",
  "gemini",
  "antigravity",
] as const;

type AgentName = (typeof AGENTS)[number];

function isAgent(name: string): name is AgentName {
  return (AGENTS as readonly string[]).includes(name);
}

/** Remove the Memory Protocol section from a file where setup auto-appended it */
function removeProtocolFromFile(filePath: string): void {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, "utf-8");
  if (!content.includes("## Memory (ShelbyMCP)")) return;

  // Match from "## Memory (ShelbyMCP)" to the next level-2 heading or end of file.
  // Protocol subsections use ### so they won't terminate the match early.
  const cleaned = content.replace(/\n*## Memory \(ShelbyMCP\)\n[\s\S]*?(?=\n## (?!#)|$)/, "").trimEnd();

  if (cleaned.length === 0) {
    // File contained only the protocol — remove the file
    rmSync(filePath);
    console.log(`Removed ${filePath} (was only the Memory Protocol)`);
  } else {
    writeFileSync(filePath, cleaned + "\n");
    console.log(`Removed Memory Protocol from ${filePath}`);
  }
}

function removeFromJsonConfig(filePath: string, serverKey = "shelbymcp"): boolean {
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
    execSync(whichCmd("claude"), { stdio: "ignore" });
    console.log("Removing ShelbyMCP from Claude Code CLI...\n");
    try {
      execSync("claude mcp remove shelbymcp", { stdio: "inherit" });
      console.log("\nRemoved MCP server from Claude Code CLI.");
    } catch {
      console.log("\nCould not remove automatically. Run manually:");
      console.log("  claude mcp remove shelbymcp");
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

  // Remove Memory Protocol from ~/.claude/CLAUDE.md
  const claudeMdPath = resolve(homedir(), ".claude/CLAUDE.md");
  removeProtocolFromFile(claudeMdPath);

  console.log("\nThe database at ~/.shelbymcp/memory.db is NOT deleted — your memories are safe.");
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

  removeFromJsonConfig(configPath);

  console.log("\nIMPORTANT: Quit and restart Claude Desktop after editing.");
  console.log("\nManual steps:");
  console.log("  - Remove the Memory Protocol from Settings > General > \"What personal preferences should Claude consider in responses?\"");
  console.log("  - Delete the Forage scheduled task from the Schedule page (if added)");
  console.log("\nThe database at ~/.shelbymcp/memory.db is NOT deleted — your memories are safe.");
}

function uninstallCursor(): void {
  const globalPath = resolve(homedir(), ".cursor/mcp.json");
  removeFromJsonConfig(globalPath);

  console.log("\nManual steps:");
  console.log("  - Remove the Memory Protocol from Cursor Settings > Rules > User Rules");
  console.log("  - Or delete .cursor/rules/shelbymcp.mdc if using per-project rules");
  console.log("  - Remove any Cursor Automations for Forage (if added)");
  console.log("\nThe database at ~/.shelbymcp/memory.db is NOT deleted — your memories are safe.");
}

function uninstallCodex(): void {
  // Try CLI removal first
  try {
    execSync(whichCmd("codex"), { stdio: "ignore" });
    try {
      execSync("codex mcp remove shelbymcp", { stdio: "inherit" });
      console.log("Removed MCP server from Codex.");
    } catch {
      console.log("Could not remove via CLI. Check ~/.codex/config.toml manually.");
    }
  } catch {
    // Fall back to manual TOML removal
    const configPath = resolve(homedir(), ".codex/config.toml");
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf-8");
      const cleaned = content.replace(/\[mcp_servers\.shelbymcp\]\n(?:.*\n)*?(?=\[|$)/g, "").trim();
      if (cleaned !== content.trim()) {
        writeFileSync(configPath, cleaned + "\n");
        console.log(`Removed [mcp_servers.shelbymcp] from ${configPath}`);
      } else {
        console.log(`"shelbymcp" server not found in ${configPath}`);
      }
    } else {
      console.log(`Config file not found: ${configPath}`);
    }
  }

  // Remove Memory Protocol from ~/.codex/AGENTS.md
  const agentsMdPath = resolve(homedir(), ".codex/AGENTS.md");
  removeProtocolFromFile(agentsMdPath);

  console.log("\nThe database at ~/.shelbymcp/memory.db is NOT deleted — your memories are safe.");
}

function uninstallWindsurf(): void {
  const configPath = resolve(homedir(), ".codeium/windsurf/mcp_config.json");
  removeFromJsonConfig(configPath);

  // Remove Memory Protocol from global rules
  const globalRulesPath = resolve(homedir(), ".codeium/windsurf/memories/global_rules.md");
  removeProtocolFromFile(globalRulesPath);

  console.log("\nThe database at ~/.shelbymcp/memory.db is NOT deleted — your memories are safe.");
}

function uninstallGemini(): void {
  // Try CLI removal first
  try {
    execSync(whichCmd("gemini"), { stdio: "ignore" });
    try {
      execSync("gemini mcp remove shelbymcp --scope user", { stdio: "inherit" });
      console.log("Removed MCP server from Gemini CLI.");
    } catch {
      console.log("Could not remove via CLI.");
    }
  } catch {
    // Fall back to manual JSON removal
    const configPath = resolve(homedir(), ".gemini/settings.json");
    removeFromJsonConfig(configPath);
  }

  // Remove Memory Protocol from ~/.gemini/GEMINI.md
  const geminiMdPath = resolve(homedir(), ".gemini/GEMINI.md");
  removeProtocolFromFile(geminiMdPath);

  console.log("\nManual steps:");
  console.log("  - Delete any Forage scheduled actions (if added)");
  console.log("\nThe database at ~/.shelbymcp/memory.db is NOT deleted — your memories are safe.");
}

function uninstallAntigravity(): void {
  const configPath = resolve(homedir(), ".gemini/antigravity/mcp_config.json");
  removeFromJsonConfig(configPath);

  // Remove Memory Protocol from ~/.gemini/GEMINI.md (shared with Gemini CLI)
  const geminiMdPath2 = resolve(homedir(), ".gemini/GEMINI.md");
  removeProtocolFromFile(geminiMdPath2);

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
    console.log("  antigravity       Antigravity (Google)");
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
    case "antigravity":
      uninstallAntigravity();
      break;
  }
}
