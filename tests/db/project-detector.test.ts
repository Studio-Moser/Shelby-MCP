import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProject } from "../../src/db/project-detector.js";

function makeRepo(remote: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "pd-"));
  mkdirSync(join(root, ".git"));
  if (remote !== null) {
    writeFileSync(join(root, ".git", "config"), `[remote "origin"]\n\turl = ${remote}\n`);
  }
  return root;
}

describe("detectProject", () => {
  it("finds the repo root + normalized-ready remote from a nested cwd", () => {
    const root = makeRepo("git@github.com:Studio-Moser/Shelby-MCP.git");
    const nested = join(root, "src", "db");
    mkdirSync(nested, { recursive: true });
    const r = detectProject(nested);
    expect(r?.projectRoot).toBe(root);
    expect(r?.remote).toBe("git@github.com:Studio-Moser/Shelby-MCP.git");
    rmSync(root, { recursive: true, force: true });
  });

  it("returns remote null when repo has no origin", () => {
    const root = makeRepo(null);
    const r = detectProject(root);
    expect(r?.projectRoot).toBe(root);
    expect(r?.remote).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  it("returns null when no project marker is found", () => {
    const dir = mkdtempSync(join(tmpdir(), "pd-nomarker-"));
    expect(detectProject(dir)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});
