import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

// Mock child_process
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

// Mock os.homedir
const mockHomedir = vi.fn();
vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => mockHomedir() };
});

const { runUninstall } = await import("../../src/cli/uninstall.js");

let tempDir: string;

function getOutput(): string {
  const logSpy = vi.mocked(console.log);
  return logSpy.mock.calls.map((c) => String(c[0])).join("\n");
}

beforeEach(() => {
  tempDir = resolve(tmpdir(), `shelbymcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
  mockHomedir.mockReturnValue(tempDir);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  (execSync as ReturnType<typeof vi.fn>).mockReset();
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true });
  }
});

describe("runUninstall", () => {
  it("prints usage when no agent is provided", () => {
    runUninstall(undefined);

    expect(getOutput()).toContain("Usage: shelbymcp uninstall <agent>");
    expect(getOutput()).toContain("Does NOT delete your memory database");
    expect(getOutput()).toContain("antigravity");
  });

  it("exits with error for unknown agent", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    expect(() => runUninstall("fake-agent")).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("uninstallClaudeCode", () => {
  it("calls claude mcp remove and mentions manual CLAUDE.md cleanup", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation(() => Buffer.from(""));

    runUninstall("claude-code");

    expect(mockExec).toHaveBeenCalledWith("which claude", { stdio: "ignore" });
    expect(mockExec).toHaveBeenCalledWith("claude mcp remove shelbymcp", { stdio: "inherit" });
    expect(getOutput()).toContain("CLAUDE.md");
    expect(getOutput()).toContain("memories are safe");
  });

  it("removes forage skill directory if it exists", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation(() => Buffer.from(""));

    const skillPath = resolve(tempDir, ".claude/scheduled-tasks/shelby-forage");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(resolve(skillPath, "SKILL.md"), "forage");

    runUninstall("claude-code");

    expect(existsSync(skillPath)).toBe(false);
    expect(getOutput()).toContain("Removed Forage skill");
  });
});

describe("uninstallClaudeDesktop", () => {
  it("handles missing config gracefully and mentions manual steps", () => {
    runUninstall("claude-desktop");

    expect(getOutput()).toContain("memory");
    expect(getOutput()).toContain("memories are safe");
  });
});

describe("uninstallCursor", () => {
  it("removes memory entry from mcp.json and mentions User Rules cleanup", () => {
    const configPath = resolve(tempDir, ".cursor/mcp.json");
    mkdirSync(resolve(tempDir, ".cursor"), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ mcpServers: { shelbymcp: { command: "npx" } } }));

    runUninstall("cursor");

    expect(getOutput()).toContain("Removed");
    expect(getOutput()).toContain("User Rules");
    expect(getOutput()).toContain("memories are safe");
  });
});

describe("uninstallCodex", () => {
  it("uses codex mcp remove CLI when available", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation(() => Buffer.from(""));

    runUninstall("codex");

    expect(mockExec).toHaveBeenCalledWith("which codex", { stdio: "ignore" });
    expect(mockExec).toHaveBeenCalledWith("codex mcp remove shelbymcp", { stdio: "inherit" });
    expect(getOutput()).toContain("~/.codex/AGENTS.md");
    expect(getOutput()).toContain("memories are safe");
  });

  it("falls back to TOML removal when codex CLI is not found", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation((cmd: string) => {
      if (cmd === "which codex") throw new Error("not found");
      return Buffer.from("");
    });

    const configPath = resolve(tempDir, ".codex/config.toml");
    mkdirSync(resolve(tempDir, ".codex"), { recursive: true });
    writeFileSync(configPath, '[mcp_servers.shelbymcp]\ncommand = "npx"\nargs = ["shelbymcp"]\n');

    runUninstall("codex");

    expect(getOutput()).toContain("Removed [mcp_servers.shelbymcp]");
    expect(getOutput()).toContain("memories are safe");
  });
});

describe("uninstallWindsurf", () => {
  it("removes memory entry and mentions global_rules.md cleanup", () => {
    const configPath = resolve(tempDir, ".codeium/windsurf/mcp_config.json");
    mkdirSync(resolve(tempDir, ".codeium/windsurf"), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ mcpServers: { shelbymcp: { command: "npx" } } }));

    runUninstall("windsurf");

    expect(getOutput()).toContain("Removed");
    expect(getOutput()).toContain("global_rules.md");
    expect(getOutput()).toContain("memories are safe");
  });
});

describe("uninstallGemini", () => {
  it("uses gemini mcp remove CLI when available", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation(() => Buffer.from(""));

    runUninstall("gemini");

    expect(mockExec).toHaveBeenCalledWith("which gemini", { stdio: "ignore" });
    expect(mockExec).toHaveBeenCalledWith("gemini mcp remove shelbymcp", { stdio: "inherit" });
    expect(getOutput()).toContain("GEMINI.md");
    expect(getOutput()).toContain("memories are safe");
  });

  it("falls back to JSON removal when gemini CLI is not found", () => {
    const mockExec = execSync as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation((cmd: string) => {
      if (cmd === "which gemini") throw new Error("not found");
      return Buffer.from("");
    });

    const configPath = resolve(tempDir, ".gemini/settings.json");
    mkdirSync(resolve(tempDir, ".gemini"), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ mcpServers: { shelbymcp: { command: "npx" } } }));

    runUninstall("gemini");

    expect(getOutput()).toContain("Removed");
    expect(getOutput()).toContain("memories are safe");
  });
});

describe("uninstallAntigravity", () => {
  it("removes memory entry from antigravity mcp_config.json", () => {
    const configPath = resolve(tempDir, ".gemini/antigravity/mcp_config.json");
    mkdirSync(resolve(tempDir, ".gemini/antigravity"), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ mcpServers: { shelbymcp: { command: "npx" } } }));

    runUninstall("antigravity");

    expect(getOutput()).toContain("Removed");
    expect(getOutput()).toContain("GEMINI.md");
    expect(getOutput()).toContain("memories are safe");
  });
});
