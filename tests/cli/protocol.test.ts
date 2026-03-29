import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { printProtocol } from "../../src/cli/protocol.js";

describe("printProtocol", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("outputs the Memory Protocol to stdout", () => {
    printProtocol();

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("## Memory (ShelbyMCP)");
    expect(output).toContain("When to SAVE (mandatory)");
    expect(output).toContain("When to SEARCH (mandatory)");
    expect(output).toContain("What NOT to save");
    expect(output).toContain("capture_thought");
  });

  it("shows hint on stderr only when stdout is a TTY", () => {
    // Non-TTY (piped): no stderr hint
    printProtocol();
    expect(errorSpy).not.toHaveBeenCalled();

    // TTY: shows hint
    const originalIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = true;
    printProtocol();
    const stderrOutput = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(stderrOutput).toContain("Copy the output below");
    expect(stderrOutput).toContain("shelbymcp protocol >> CLAUDE.md");
    process.stdout.isTTY = originalIsTTY;
  });
});
