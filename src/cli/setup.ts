import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, cpSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MEMORY_PROTOCOL } from "./protocol.js";

const isWindows = process.platform === "win32";

/** Use `where` on Windows, `which` elsewhere to locate a CLI binary */
function whichCmd(bin: string): string {
  return isWindows ? `where ${bin}` : `which ${bin}`;
}

/**
 * Detect whether nvm (Node Version Manager) is active.
 * On macOS/Linux, nvm sets NVM_DIR and modifies PATH in the shell profile.
 * Apps that launch processes directly (Claude Desktop, Cursor, Windsurf, Antigravity)
 * don't source the shell profile, so `npx` resolves to the wrong Node version.
 */
function hasNvm(): boolean {
  if (isWindows) return false; // nvm-windows modifies system PATH directly
  return Boolean(process.env.NVM_DIR) || existsSync(resolve(homedir(), ".nvm"));
}

/**
 * Build the MCP server command entry for JSON configs.
 * When nvm is detected, uses absolute paths to the current Node binary and npx,
 * and sets PATH so that child processes spawned by npx also find the correct Node.
 * Without the PATH override, npx's child `node` resolves to an old nvm version
 * that doesn't support modern syntax like `?.` or `??`.
 */
function buildServerCommand(): { command: string; args: string[]; env?: Record<string, string> } {
  if (hasNvm()) {
    const nodePath = process.execPath;
    const nodeBinDir = dirname(nodePath);
    // Use the direct shelbymcp binary instead of going through npx.
    // npx internally spawns `sh` which fails in Claude Desktop's restricted environment.
    const shelbymcpBin = resolve(nodeBinDir, "shelbymcp");
    return {
      command: nodePath,
      args: [shelbymcpBin],
    };
  }
  return { command: "npx", args: ["shelbymcp"] };
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

/** Resolve the package root (where skills/ lives) from the compiled dist/ output */
function getPackageRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // thisFile is dist/cli/setup.js → go up to dist/, then up to package root
  return resolve(dirname(thisFile), "..", "..");
}

function getSkillSourcePath(): string {
  return resolve(getPackageRoot(), "skills", "shelby-forage");
}

function appendProtocolToFile(filePath: string): void {
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf-8");
    if (existing.includes("## Memory (ShelbyMCP)")) {
      console.log(`\nMemory Protocol already present in ${filePath}`);
      return;
    }
  }

  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  appendFileSync(filePath, "\n" + MEMORY_PROTOCOL + "\n");
  console.log(`\nMemory Protocol added to ${filePath}`);
}

function mergeJsonConfig(filePath: string, serverEntry: Record<string, unknown>, serverKey = "shelbymcp"): boolean {
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

  if (servers[serverKey]) {
    console.log(`"${serverKey}" server already exists in ${filePath}`);
    console.log("To reconfigure, remove the existing entry first.");
    return false;
  }

  servers[serverKey] = serverEntry;

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

    case "antigravity":
      console.log("Antigravity has no scheduler. To run Forage manually, paste the");
      console.log("output of `shelbymcp forage` into an Antigravity conversation");
      console.log("whenever you want to maintain your memories.");
      break;
  }
}

// ---------------------------------------------------------------------------
// Agent setup functions
// ---------------------------------------------------------------------------

function setupClaudeCode(forage: boolean): void {
  try {
    execSync(whichCmd("claude"), { stdio: "ignore" });
  } catch {
    console.log("Claude Code CLI not found. Install it from https://code.claude.com\n");
    console.log("Once installed, run:");
    console.log("  claude mcp add -s user -t stdio shelbymcp -- npx shelbymcp");
    return;
  }

  console.log("Adding ShelbyMCP to Claude Code CLI (user scope)...\n");

  try {
    execSync("claude mcp add -s user -t stdio shelbymcp -- npx shelbymcp", {
      stdio: "inherit",
    });
    console.log("\nShelbyMCP added to Claude Code CLI.");
  } catch {
    console.log("\nCould not add automatically. Run manually:");
    console.log("  claude mcp add -s user -t stdio shelbymcp -- npx shelbymcp");
  }

  // Auto-append Memory Protocol to ~/.claude/CLAUDE.md
  const claudeMdPath = resolve(homedir(), ".claude/CLAUDE.md");
  appendProtocolToFile(claudeMdPath);

  if (!forage) {
    console.log("\nShelbyMCP installed for Claude Code!");
  }

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

    console.log("\nShelbyMCP installed for Claude Code!");
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
  const fullJson = JSON.stringify({ shelbymcp: buildServerCommand() }, null, 2);
  // Strip the outer { } and unindent so the user can paste just the key-value
  // pair directly into the existing mcpServers object.
  const snippet = fullJson
    .split("\n")
    .slice(1, -1)
    .map((line) => line.slice(2))
    .join("\n");
  console.log(snippet + ",");
  console.log("\nIMPORTANT: Quit and restart Claude Desktop after editing.");
  console.log("\nNote: Claude Desktop and Claude Code CLI have separate configs.");
  console.log("Setting up one does NOT configure the other.");
  console.log("\nNext: Add the Memory Protocol to your Desktop profile:");
  console.log("  1. Run: shelbymcp protocol");
  console.log("  2. Copy the output");
  console.log("  3. Open Settings > General > \"What personal preferences should Claude consider in responses?\"");
  console.log("  4. Paste the protocol text into that field");

  if (forage) {
    printForageInstructions("claude-desktop");
  }

  console.log("\nFollow the steps above to finish installing ShelbyMCP for Claude Desktop.");
}

function setupCursor(forage: boolean): void {
  const configPath = resolve(homedir(), ".cursor/mcp.json");

  const entry = { type: "stdio", ...buildServerCommand() };

  mergeJsonConfig(configPath, entry);

  console.log("\nOr add via UI: Settings > Tools & MCP > New MCP Server");

  console.log("\nNext: Add the Memory Protocol to Cursor:");
  console.log("  1. Open Cursor Settings > Rules");
  console.log("  2. Under \"User Rules\", paste the output of: shelbymcp protocol");
  console.log("  (This applies the Memory Protocol to all your Cursor projects)");
  console.log("");
  console.log("  Or, to add per-project instead, run from your project root:");
  console.log("  mkdir -p .cursor/rules");
  console.log("  shelbymcp protocol > .cursor/rules/shelbymcp.mdc");
  console.log("  (Then prepend '---\\nalwaysApply: true\\n---\\n' to the file)");

  if (forage) {
    printForageInstructions("cursor");
  }

  console.log("\nShelbyMCP MCP server installed for Cursor!");
}

function setupCodex(forage: boolean): void {
  try {
    execSync(whichCmd("codex"), { stdio: "ignore" });
  } catch {
    console.log("Codex CLI not found.\n");
    console.log("Add this to ~/.codex/config.toml:\n");
    console.log("[mcp_servers.shelbymcp]");
    console.log('command = "npx"');
    console.log('args = ["shelbymcp"]');

    // Auto-append Memory Protocol to ~/.codex/AGENTS.md
    const agentsMdPath = resolve(homedir(), ".codex/AGENTS.md");
    appendProtocolToFile(agentsMdPath);

    if (forage) {
      printForageInstructions("codex");
    }

    console.log("\nShelbyMCP installed for Codex!");
    return;
  }

  console.log("Adding ShelbyMCP to Codex...\n");

  try {
    execSync("codex mcp add shelbymcp -- npx shelbymcp", { stdio: "inherit" });
    console.log("\nShelbyMCP added to Codex.");
  } catch {
    console.log("\nCould not add automatically. Add to ~/.codex/config.toml:\n");
    console.log("[mcp_servers.shelbymcp]");
    console.log('command = "npx"');
    console.log('args = ["shelbymcp"]');
  }

  // Auto-append Memory Protocol to ~/.codex/AGENTS.md
  const agentsMdPath = resolve(homedir(), ".codex/AGENTS.md");
  appendProtocolToFile(agentsMdPath);

  if (forage) {
    printForageInstructions("codex");
  }

  console.log("\nShelbyMCP installed for Codex!");
}

function setupWindsurf(forage: boolean): void {
  const configPath = resolve(homedir(), ".codeium/windsurf/mcp_config.json");

  mergeJsonConfig(configPath, buildServerCommand());

  console.log("\nOr add via UI: Settings > Cascade > MCP Servers");

  // Auto-append Memory Protocol to global rules
  const globalRulesPath = resolve(homedir(), ".codeium/windsurf/memories/global_rules.md");
  appendProtocolToFile(globalRulesPath);

  if (forage) {
    printForageInstructions("windsurf");
  }

  console.log("\nShelbyMCP installed for Windsurf!");
}

function setupGemini(forage: boolean): void {
  try {
    execSync(whichCmd("gemini"), { stdio: "ignore" });
  } catch {
    // Gemini CLI not found — fall back to manual JSON config
    const configPath = resolve(homedir(), ".gemini/settings.json");
    const entry = buildServerCommand();

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
    if (servers.shelbymcp) {
      console.log(`"shelbymcp" server already exists in ${configPath}`);
      console.log("To reconfigure, remove the existing entry first.");
    } else {
      servers.shelbymcp = entry;
      const dir = dirname(configPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
      console.log(`Added ShelbyMCP to ${configPath}`);
    }

    // Auto-append Memory Protocol to ~/.gemini/GEMINI.md
    const geminiMdPath = resolve(homedir(), ".gemini/GEMINI.md");
    appendProtocolToFile(geminiMdPath);

    if (forage) {
      printForageInstructions("gemini");
    }

    console.log("\nShelbyMCP installed for Gemini CLI!");
    return;
  }

  console.log("Adding ShelbyMCP to Gemini CLI (user scope)...\n");

  try {
    execSync("gemini mcp add shelbymcp npx --scope user -- shelbymcp", { stdio: "inherit" });
    console.log("\nShelbyMCP added to Gemini CLI.");
  } catch {
    console.log("\nCould not add automatically. Run manually:");
    console.log("  gemini mcp add shelbymcp npx --scope user -- shelbymcp");
  }

  // Auto-append Memory Protocol to ~/.gemini/GEMINI.md
  const geminiMdPath = resolve(homedir(), ".gemini/GEMINI.md");
  appendProtocolToFile(geminiMdPath);

  if (forage) {
    printForageInstructions("gemini");
  }

  console.log("\nShelbyMCP installed for Gemini CLI!");
}

function setupAntigravity(forage: boolean): void {
  const configPath = resolve(homedir(), ".gemini/antigravity/mcp_config.json");

  mergeJsonConfig(configPath, buildServerCommand());

  console.log("\nOr add via UI: Agent panel > MCP Servers > Manage MCP Servers");

  // Auto-append Memory Protocol to ~/.gemini/GEMINI.md (shared with Gemini CLI)
  const geminiMdPath = resolve(homedir(), ".gemini/GEMINI.md");
  appendProtocolToFile(geminiMdPath);

  if (forage) {
    printForageInstructions("antigravity");
  }

  console.log("\nShelbyMCP installed for Antigravity!");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

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
    console.log("  antigravity       Antigravity (Google)");
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
    case "antigravity":
      setupAntigravity(forage);
      break;
  }
}
