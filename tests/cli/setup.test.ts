import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
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
  it("registers MCP server and mentions prompts (no rules file)", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation(() => Buffer.from(""));

    runSetup("claude-code", false);

    expect(mockExec).toHaveBeenCalledWith("which claude", { stdio: "ignore" });
    expect(mockExec).toHaveBeenCalledWith(
      "claude mcp add -s user -t stdio shelbymcp -- npx shelbymcp",
      { stdio: "inherit" },
    );

    // Protocol should NOT be written to CLAUDE.md (served via MCP prompts)
    const claudeMdPath = resolve(tempDir, ".claude/CLAUDE.md");
    expect(existsSync(claudeMdPath)).toBe(false);

    expect(getOutput()).toContain("MCP prompts");
    expect(getOutput()).toContain("ShelbyMCP installed for Claude Code!");
  });

  it("prints fallback when claude CLI is not found", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation((cmd: string) => {
      if (cmd === "which claude") throw new Error("not found");
      return Buffer.from("");
    });

    runSetup("claude-code", false);

    expect(getOutput()).toContain("Claude Code CLI not found");
  });

  it("handles claude mcp add failure gracefully", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation((cmd: string) => {
      if (cmd.includes("mcp add")) throw new Error("already exists");
      return Buffer.from("");
    });

    runSetup("claude-code", false);

    expect(getOutput()).toContain("Could not add automatically");
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
  it("prints setup instructions and mentions MCP prompts", () => {
    runSetup("claude-desktop", false);

    expect(getOutput()).toContain("Claude Desktop setup");
    expect(getOutput()).toContain("Settings > Developer > Edit Config");
    expect(getOutput()).toContain("Quit and restart");
    // Protocol is served via MCP prompts, not manual paste
    expect(getOutput()).toContain("MCP prompts");
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
  it("merges mcp.json with stdio type and mentions MCP prompts", () => {
    runSetup("cursor", false);

    const configPath = resolve(tempDir, ".cursor/mcp.json");
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.mcpServers.shelbymcp).toEqual({ type: "stdio", command: "npx", args: ["shelbymcp"] });

    // Protocol is served via MCP prompts, not rules files
    expect(getOutput()).toContain("MCP prompts");
    expect(getOutput()).toContain("ShelbyMCP MCP server installed for Cursor!");
  });

  it("uses absolute node/npx paths when nvm is detected", () => {
    process.env.NVM_DIR = "/Users/fake/.nvm";

    runSetup("cursor", false);

    const configPath = resolve(tempDir, ".cursor/mcp.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.mcpServers.shelbymcp.type).toBe("stdio");
    // Should use absolute paths instead of bare "npx"
    expect(config.mcpServers.shelbymcp.command).toBe(process.execPath);
    // args[0] is the direct shelbymcp binary path (no npx wrapper)
    expect(config.mcpServers.shelbymcp.args[0]).toMatch(/\/shelbymcp$/);
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
  it("registers MCP server via CLI and mentions MCP prompts", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation(() => Buffer.from(""));

    runSetup("codex", false);

    expect(mockExec).toHaveBeenCalledWith("which codex", { stdio: "ignore" });
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("codex mcp add shelbymcp"),
      { stdio: "inherit" },
    );

    // Protocol should NOT be written to AGENTS.md (served via MCP prompts)
    const agentsMdPath = resolve(tempDir, ".codex/AGENTS.md");
    expect(existsSync(agentsMdPath)).toBe(false);

    expect(getOutput()).toContain("MCP prompts");
    expect(getOutput()).toContain("ShelbyMCP installed for Codex");
  });

  it("writes config.toml directly when codex CLI is not found", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation((cmd: string) => {
      if (cmd === "which codex") throw new Error("not found");
      return Buffer.from("");
    });

    runSetup("codex", false);

    // Should write config.toml directly instead of just printing instructions
    const configPath = resolve(tempDir, ".codex/config.toml");
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("[mcp_servers.shelbymcp]");
    expect(content).toContain('command = "npx"');

    expect(getOutput()).toContain("ShelbyMCP installed for Codex");
  });

  it("does not overwrite existing config.toml entry", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation((cmd: string) => {
      if (cmd === "which codex") throw new Error("not found");
      return Buffer.from("");
    });

    const configDir = resolve(tempDir, ".codex");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      resolve(configDir, "config.toml"),
      '[mcp_servers.shelbymcp]\ncommand = "custom"\n',
    );

    runSetup("codex", false);

    const content = readFileSync(resolve(configDir, "config.toml"), "utf-8");
    expect(content).toContain('command = "custom"');
    expect(getOutput()).toContain("already exists");
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
      "gemini mcp add shelbymcp npx --scope user -- shelbymcp",
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
