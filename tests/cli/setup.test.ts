import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { MEMORY_PROTOCOL } from "../../src/cli/protocol.js";

// Mock child_process so execSync doesn't run real commands
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

// Mock os.homedir to point at our temp directory
const mockHomedir = vi.fn();
vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => mockHomedir() };
});

// Must import after mocks are declared
const { runSetup } = await import("../../src/cli/setup.js");

let tempDir: string;
let savedNvmDir: string | undefined;

function getOutput(): string {
  const logSpy = vi.mocked(console.log);
  return logSpy.mock.calls.map((c) => String(c[0])).join("\n");
}

beforeEach(() => {
  tempDir = resolve(tmpdir(), `shelbymcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
  mockHomedir.mockReturnValue(tempDir);
  // Ensure nvm detection is off by default so tests get predictable command entries
  savedNvmDir = process.env.NVM_DIR;
  delete process.env.NVM_DIR;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  (execSync as ReturnType<typeof vi.fn>).mockReset();
  // Restore NVM_DIR
  if (savedNvmDir !== undefined) {
    process.env.NVM_DIR = savedNvmDir;
  } else {
    delete process.env.NVM_DIR;
  }
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true });
  }
});

describe("runSetup", () => {
  it("prints usage when no agent is provided", () => {
    runSetup(undefined, false);
    expect(getOutput()).toContain("Usage: shelbymcp setup <agent>");
    expect(getOutput()).toContain("--forage");
    expect(getOutput()).toContain("antigravity");
  });

  it("exits with error for unknown agent", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    expect(() => runSetup("unknown-agent", false)).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("setupClaudeCode", () => {
  it("registers MCP server, appends protocol, and prints completion", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation(() => Buffer.from(""));

    runSetup("claude-code", false);

    expect(mockExec).toHaveBeenCalledWith("which claude", { stdio: "ignore" });
    expect(mockExec).toHaveBeenCalledWith(
      "claude mcp add -s user -t stdio shelbymcp -- npx shelbymcp",
      { stdio: "inherit" },
    );

    const claudeMdPath = resolve(tempDir, ".claude/CLAUDE.md");
    expect(existsSync(claudeMdPath)).toBe(true);
    const content = readFileSync(claudeMdPath, "utf-8");
    expect(content).toContain("## Memory (ShelbyMCP)");
    expect(content).toContain("capture_thought");

    expect(getOutput()).toContain("Memory Protocol added to");
    expect(getOutput()).toContain("ShelbyMCP installed for Claude Code!");
  });

  it("does not duplicate protocol if already present", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation(() => Buffer.from(""));

    const claudeDir = resolve(tempDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(resolve(claudeDir, "CLAUDE.md"), "# My Rules\n\n" + MEMORY_PROTOCOL + "\n");

    runSetup("claude-code", false);

    expect(getOutput()).toContain("Memory Protocol already present");
    const content = readFileSync(resolve(claudeDir, "CLAUDE.md"), "utf-8");
    expect(content.match(/## Memory \(ShelbyMCP\)/g)).toHaveLength(1);
  });

  it("appends protocol to existing CLAUDE.md without overwriting", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation(() => Buffer.from(""));

    const claudeDir = resolve(tempDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(resolve(claudeDir, "CLAUDE.md"), "# Existing Rules\n\nDo not delete this.\n");

    runSetup("claude-code", false);

    const content = readFileSync(resolve(claudeDir, "CLAUDE.md"), "utf-8");
    expect(content).toContain("# Existing Rules");
    expect(content).toContain("Do not delete this.");
    expect(content).toContain("## Memory (ShelbyMCP)");
  });

  it("prints fallback when claude CLI is not found and does not write protocol", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation((cmd: string) => {
      if (cmd === "which claude") throw new Error("not found");
      return Buffer.from("");
    });

    runSetup("claude-code", false);

    expect(getOutput()).toContain("Claude Code CLI not found");
    expect(existsSync(resolve(tempDir, ".claude/CLAUDE.md"))).toBe(false);
  });

  it("still writes protocol when claude mcp add fails", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation((cmd: string) => {
      if (cmd.includes("mcp add")) throw new Error("already exists");
      return Buffer.from("");
    });

    runSetup("claude-code", false);

    expect(getOutput()).toContain("Could not add automatically");
    const content = readFileSync(resolve(tempDir, ".claude/CLAUDE.md"), "utf-8");
    expect(content).toContain("## Memory (ShelbyMCP)");
  });

  it("installs forage skill when --forage and prints completion", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation(() => Buffer.from(""));

    runSetup("claude-code", true);

    expect(getOutput()).toContain("Forage");
    expect(getOutput()).toContain("ShelbyMCP installed for Claude Code!");
  });

  it("skips forage install when skill already exists", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation(() => Buffer.from(""));

    const skillDest = resolve(tempDir, ".claude/scheduled-tasks/shelby-forage");
    mkdirSync(skillDest, { recursive: true });
    writeFileSync(resolve(skillDest, "SKILL.md"), "# Existing forage skill");

    runSetup("claude-code", true);

    expect(getOutput()).toContain("already installed");
  });
});

describe("setupClaudeDesktop", () => {
  it("prints setup instructions with clear protocol steps", () => {
    runSetup("claude-desktop", false);

    expect(getOutput()).toContain("Claude Desktop setup");
    expect(getOutput()).toContain("Settings > Developer > Edit Config");
    expect(getOutput()).toContain("Quit and restart");
    expect(getOutput()).toContain("Run: shelbymcp protocol");
    expect(getOutput()).toContain("Copy the output");
    expect(getOutput()).toContain("Paste the protocol text");
    expect(getOutput()).toContain("Follow the steps above to finish installing ShelbyMCP");
  });

  it("prints forage instructions when --forage", () => {
    runSetup("claude-desktop", true);

    expect(getOutput()).toContain("Forage Skill");
    expect(getOutput()).toContain("Schedule page");
    expect(getOutput()).toContain("needs-attention");
  });
});

describe("setupCursor", () => {
  it("merges mcp.json with stdio type and prints protocol instructions", () => {
    runSetup("cursor", false);

    const configPath = resolve(tempDir, ".cursor/mcp.json");
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.mcpServers.shelbymcp).toEqual({ type: "stdio", command: "npx", args: ["shelbymcp"] });

    expect(getOutput()).toContain("Cursor Settings > Rules");
    expect(getOutput()).toContain("User Rules");
    expect(getOutput()).toContain("shelbymcp protocol");
    expect(getOutput()).toContain("ShelbyMCP MCP server installed for Cursor!");
  });

  it("uses login shell wrapper when nvm is detected", () => {
    process.env.NVM_DIR = "/Users/fake/.nvm";

    runSetup("cursor", false);

    const configPath = resolve(tempDir, ".cursor/mcp.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.mcpServers.shelbymcp).toEqual({
      type: "stdio",
      command: "/bin/bash",
      args: ["-l", "-c", "npx shelbymcp"],
    });
  });

  it("does not overwrite existing memory MCP entry", () => {
    const configPath = resolve(tempDir, ".cursor/mcp.json");
    mkdirSync(resolve(tempDir, ".cursor"), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ mcpServers: { shelbymcp: { command: "custom" } } }));

    runSetup("cursor", false);

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.mcpServers.shelbymcp.command).toBe("custom");
    expect(getOutput()).toContain("already exists");
  });

  it("prints forage instructions when --forage", () => {
    runSetup("cursor", true);

    expect(getOutput()).toContain("Forage Skill");
    expect(getOutput()).toContain("Cursor Automations");
  });
});

describe("setupCodex", () => {
  it("registers MCP server and appends protocol to ~/.codex/AGENTS.md", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation(() => Buffer.from(""));

    runSetup("codex", false);

    expect(mockExec).toHaveBeenCalledWith("which codex", { stdio: "ignore" });
    expect(mockExec).toHaveBeenCalledWith("codex mcp add shelbymcp -- npx shelbymcp", { stdio: "inherit" });

    // Protocol should go to ~/.codex/AGENTS.md, not cwd
    const agentsMdPath = resolve(tempDir, ".codex/AGENTS.md");
    expect(existsSync(agentsMdPath)).toBe(true);
    const content = readFileSync(agentsMdPath, "utf-8");
    expect(content).toContain("## Memory (ShelbyMCP)");

    expect(getOutput()).toContain("ShelbyMCP installed for Codex!");
  });

  it("still appends protocol when codex CLI is not found", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation((cmd: string) => {
      if (cmd === "which codex") throw new Error("not found");
      return Buffer.from("");
    });

    runSetup("codex", false);

    expect(getOutput()).toContain("Codex CLI not found");
    expect(getOutput()).toContain("config.toml");

    const agentsMdPath = resolve(tempDir, ".codex/AGENTS.md");
    expect(existsSync(agentsMdPath)).toBe(true);

    expect(getOutput()).toContain("ShelbyMCP installed for Codex!");
  });
});

describe("setupWindsurf", () => {
  it("merges mcp config and appends protocol to global_rules.md", () => {
    runSetup("windsurf", false);

    // MCP config
    const configPath = resolve(tempDir, ".codeium/windsurf/mcp_config.json");
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.mcpServers.shelbymcp).toEqual({ command: "npx", args: ["shelbymcp"] });

    // Protocol goes to global_rules.md, not .windsurfrules
    const rulesPath = resolve(tempDir, ".codeium/windsurf/memories/global_rules.md");
    expect(existsSync(rulesPath)).toBe(true);
    const content = readFileSync(rulesPath, "utf-8");
    expect(content).toContain("## Memory (ShelbyMCP)");

    expect(getOutput()).toContain("ShelbyMCP installed for Windsurf!");
  });

  it("prints no-scheduler message for windsurf --forage", () => {
    runSetup("windsurf", true);

    expect(getOutput()).toContain("Forage Skill");
    expect(getOutput()).toContain("no scheduler");
  });
});

describe("setupGemini", () => {
  it("uses gemini mcp add CLI when available and appends protocol to ~/.gemini/GEMINI.md", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation(() => Buffer.from(""));

    runSetup("gemini", false);

    expect(mockExec).toHaveBeenCalledWith("which gemini", { stdio: "ignore" });
    expect(mockExec).toHaveBeenCalledWith(
      "gemini mcp add shelbymcp --scope user -- npx shelbymcp",
      { stdio: "inherit" },
    );

    // Protocol goes to ~/.gemini/GEMINI.md, not cwd
    const geminiMdPath = resolve(tempDir, ".gemini/GEMINI.md");
    expect(existsSync(geminiMdPath)).toBe(true);
    const content = readFileSync(geminiMdPath, "utf-8");
    expect(content).toContain("## Memory (ShelbyMCP)");

    expect(getOutput()).toContain("ShelbyMCP installed for Gemini CLI!");
  });

  it("falls back to manual JSON when gemini CLI is not found", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation((cmd: string) => {
      if (cmd === "which gemini") throw new Error("not found");
      return Buffer.from("");
    });

    runSetup("gemini", false);

    const configPath = resolve(tempDir, ".gemini/settings.json");
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.mcpServers.shelbymcp).toEqual({ command: "npx", args: ["shelbymcp"] });

    expect(getOutput()).toContain("ShelbyMCP installed for Gemini CLI!");
  });

  it("does not overwrite existing memory entry in manual fallback", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation((cmd: string) => {
      if (cmd === "which gemini") throw new Error("not found");
      return Buffer.from("");
    });

    const configPath = resolve(tempDir, ".gemini/settings.json");
    mkdirSync(resolve(tempDir, ".gemini"), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ mcpServers: { shelbymcp: { command: "custom" } } }));

    runSetup("gemini", false);

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.mcpServers.shelbymcp.command).toBe("custom");
    expect(getOutput()).toContain("already exists");
  });

  it("prints forage instructions when --forage", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation(() => Buffer.from(""));

    runSetup("gemini", true);

    expect(getOutput()).toContain("Forage Skill");
    expect(getOutput()).toContain("scheduled action");
  });
});

describe("setupAntigravity", () => {
  it("merges mcp config and appends protocol to ~/.gemini/GEMINI.md", () => {
    runSetup("antigravity", false);

    // MCP config at ~/.gemini/antigravity/mcp_config.json
    const configPath = resolve(tempDir, ".gemini/antigravity/mcp_config.json");
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.mcpServers.shelbymcp).toEqual({ command: "npx", args: ["shelbymcp"] });

    // Protocol at ~/.gemini/GEMINI.md (shared with Gemini CLI)
    const geminiMdPath = resolve(tempDir, ".gemini/GEMINI.md");
    expect(existsSync(geminiMdPath)).toBe(true);
    const content = readFileSync(geminiMdPath, "utf-8");
    expect(content).toContain("## Memory (ShelbyMCP)");

    expect(getOutput()).toContain("ShelbyMCP installed for Antigravity!");
  });

  it("does not overwrite existing memory MCP entry", () => {
    const configPath = resolve(tempDir, ".gemini/antigravity/mcp_config.json");
    mkdirSync(resolve(tempDir, ".gemini/antigravity"), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ mcpServers: { shelbymcp: { command: "custom" } } }));

    runSetup("antigravity", false);

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.mcpServers.shelbymcp.command).toBe("custom");
    expect(getOutput()).toContain("already exists");
  });

  it("prints forage instructions when --forage", () => {
    runSetup("antigravity", true);

    expect(getOutput()).toContain("Forage Skill");
    expect(getOutput()).toContain("no scheduler");
  });
});
