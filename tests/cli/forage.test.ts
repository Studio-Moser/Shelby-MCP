import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { printForage } from "../../src/cli/forage.js";

describe("printForage", () => {
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

  it("outputs the Forage prompt to stdout", () => {
    printForage();

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Shelby Forage");
    expect(output).toContain("Task 1: Summary Backfill");
    expect(output).toContain("Task 2: Auto-Classify");
    expect(output).toContain("Task 3: Consolidation");
    expect(output).toContain("Task 4: Contradiction Detection");
    expect(output).toContain("Task 5: Connection Discovery");
    expect(output).toContain("Task 6: Stale Sweep");
    expect(output).toContain("Task 7: Digest");
    expect(output).toContain("Task 8: Forage Log");
    expect(output).toContain("Before You Start");
  });

  it("includes guidelines", () => {
    printForage();

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Be conservative");
    expect(output).toContain("Tag your work");
    expect(output).toContain("source: \"forage\"");
  });

  it("outputs instructions to stderr", () => {
    printForage();

    const stderrOutput = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(stderrOutput).toContain("Paste this into a scheduled task");
  });
});
