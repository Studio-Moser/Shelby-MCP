import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fallbackResolutionRoots, normalizeFileRoots } from "../../src/mcp/resolve-dir.js";

describe("normalizeFileRoots", () => {
  it("decodes file URIs, removes trailing slashes and duplicates", () => {
    const root = mkdtempSync(join(tmpdir(), "roots with spaces-"));
    const uri = pathToFileURL(root).href;

    expect(normalizeFileRoots([{ uri }, { uri: `${uri}/` }])).toEqual([realpathSync.native(root)]);
  });

  it("ignores malformed and non-file roots", () => {
    expect(normalizeFileRoots([
      { uri: "https://example.com/repo" },
      { uri: "file:///tmp/%ZZ" },
      { uri: "not a uri" },
    ])).toEqual([]);
  });

  it("canonicalizes existing symlinks", () => {
    const container = mkdtempSync(join(tmpdir(), "roots-symlink-"));
    const target = join(container, "target");
    const link = join(container, "link");
    mkdirSync(target);
    symlinkSync(target, link);

    expect(normalizeFileRoots([{ uri: pathToFileURL(link).href }])).toEqual([realpathSync.native(target)]);
  });

  it("keeps every distinct valid file root", () => {
    const one = mkdtempSync(join(tmpdir(), "roots-one-"));
    const two = mkdtempSync(join(tmpdir(), "roots-two-"));
    expect(normalizeFileRoots([
      { uri: pathToFileURL(one).href },
      { uri: pathToFileURL(two).href },
    ])).toEqual([realpathSync.native(one), realpathSync.native(two)]);
  });
});

describe("fallbackResolutionRoots", () => {
  it("uses an existing absolute cwd other than the filesystem root", () => {
    const cwd = mkdtempSync(join(tmpdir(), "roots-cwd-"));
    expect(existsSync(cwd)).toBe(true);
    expect(fallbackResolutionRoots(cwd)).toEqual({ kind: "resolved", paths: [realpathSync.native(cwd)] });
  });

  it("rejects root, relative, missing, and regular-file cwd values", () => {
    const file = join(mkdtempSync(join(tmpdir(), "roots-file-")), "not-a-directory");
    writeFileSync(file, "x");

    expect(fallbackResolutionRoots("/")).toEqual({ kind: "unresolved" });
    expect(fallbackResolutionRoots("relative/path")).toEqual({ kind: "unresolved" });
    expect(fallbackResolutionRoots(join(tmpdir(), "missing-roots-cwd"))).toEqual({ kind: "unresolved" });
    expect(fallbackResolutionRoots(file)).toEqual({ kind: "unresolved" });
  });
});
