import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { printHelp } from "../../src/cli/help.js";

describe("printHelp", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("lists all commands", () => {
    printHelp();

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("setup <agent>");
    expect(output).toContain("uninstall <agent>");
    expect(output).toContain("protocol");
    expect(output).toContain("forage");
    expect(output).toContain("help");
  });

  it("lists all agents", () => {
    printHelp();

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("claude-code");
    expect(output).toContain("claude-desktop");
    expect(output).toContain("cursor");
    expect(output).toContain("codex");
    expect(output).toContain("windsurf");
    expect(output).toContain("gemini");
  });

  it("documents --forage flag", () => {
    printHelp();

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("--forage");
  });

  it("lists server flags", () => {
    printHelp();

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("--db");
    expect(output).toContain("--verbose");
    expect(output).toContain("--version");
  });
});
