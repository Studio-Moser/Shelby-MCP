import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { runUninstall } from "../../src/cli/uninstall.js";

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

describe("runUninstall", () => {
  it("prints usage when no agent is provided", () => {
    const logSpy = vi.spyOn(console, "log");
    runUninstall(undefined);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Usage: shelbymcp uninstall <agent>");
    expect(output).toContain("Does NOT delete your memory database");
  });

  it("exits with error for unknown agent", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    expect(() => runUninstall("fake-agent")).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("handles claude-desktop uninstall when config has no memory entry", () => {
    const logSpy = vi.spyOn(console, "log");
    runUninstall("claude-desktop");

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Should handle gracefully — either "not found" or "removed"
    expect(output).toContain("memory");
    expect(output).toContain("memories are safe");
  });

  it("prints manual cleanup steps for cursor", () => {
    const logSpy = vi.spyOn(console, "log");
    runUninstall("cursor");

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("shelbymcp.mdc");
    expect(output).toContain("memories are safe");
  });

  it("prints manual cleanup steps for gemini", () => {
    const logSpy = vi.spyOn(console, "log");
    runUninstall("gemini");

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("GEMINI.md");
    expect(output).toContain("memories are safe");
  });

  it("prints manual cleanup steps for codex", () => {
    const logSpy = vi.spyOn(console, "log");
    runUninstall("codex");

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("AGENTS.md");
    expect(output).toContain("memories are safe");
  });

  it("prints manual cleanup steps for windsurf", () => {
    const logSpy = vi.spyOn(console, "log");
    runUninstall("windsurf");

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain(".windsurfrules");
    expect(output).toContain("memories are safe");
  });
});
