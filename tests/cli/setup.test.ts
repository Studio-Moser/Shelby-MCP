import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { runSetup } from "../../src/cli/setup.js";

// Use a real temp directory for file I/O tests
let tempDir: string;

beforeEach(() => {
  tempDir = resolve(tmpdir(), `shelbymcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true });
  }
});

describe("runSetup", () => {
  it("prints usage when no agent is provided", () => {
    const logSpy = vi.spyOn(console, "log");
    runSetup(undefined, false);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Usage: shelbymcp setup <agent>");
    expect(output).toContain("--forage");
  });

  it("exits with error for unknown agent", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    expect(() => runSetup("unknown-agent", false)).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("prints instructions for claude-desktop", () => {
    const logSpy = vi.spyOn(console, "log");
    runSetup("claude-desktop", false);

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Claude Desktop setup");
    expect(output).toContain("Settings > Developer > Edit Config");
    expect(output).toContain("shelbymcp");
    expect(output).toContain("Quit and restart");
  });

  it("prints forage instructions for claude-desktop when --forage", () => {
    const logSpy = vi.spyOn(console, "log");
    runSetup("claude-desktop", true);

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Forage Skill");
    expect(output).toContain("Schedule page");
    expect(output).toContain("needs-attention");
  });

  it("prints no-scheduler message for windsurf --forage", () => {
    const logSpy = vi.spyOn(console, "log");
    runSetup("windsurf", true);

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Forage Skill");
    expect(output).toContain("no scheduler");
  });

  it("prints Cursor Automations instructions for cursor --forage", () => {
    const logSpy = vi.spyOn(console, "log");
    runSetup("cursor", true);

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Forage Skill");
    expect(output).toContain("Cursor Automations");
  });
});
