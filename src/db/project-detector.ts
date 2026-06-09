import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MARKERS = [".git", "package.json", "Cargo.toml", "pyproject.toml", "go.mod", "Package.swift", "Makefile"];

export interface DetectedProject {
  projectRoot: string;
  remote: string | null;
}

/**
 * Walk up from `cwd` to the nearest project root (a dir containing a marker),
 * returning its path and the raw git origin remote (or null). Returns null if
 * no marker is found before reaching the filesystem root or home dir. Mirrors
 * Shelby-MacOS ProjectDetector.detect.
 */
export function detectProject(cwd: string): DetectedProject | null {
  let dir = path.resolve(cwd);
  const home = os.homedir();
  for (;;) {
    if (MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) {
      return { projectRoot: dir, remote: readOriginRemote(dir) };
    }
    const parent = path.dirname(dir);
    if (dir === path.parse(dir).root || dir === home || parent === dir) break;
    dir = parent;
  }
  return null;
}

function readOriginRemote(projectRoot: string): string | null {
  const cfgPath = path.join(projectRoot, ".git", "config");
  let text: string;
  try {
    text = fs.readFileSync(cfgPath, "utf8");
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/);
  let inOrigin = false;
  for (const line of lines) {
    const t = line.trim();
    if (t === '[remote "origin"]') { inOrigin = true; continue; }
    if (t.startsWith("[") && inOrigin) break;
    if (inOrigin && t.startsWith("url")) {
      const eq = t.indexOf("=");
      if (eq >= 0) {
        const v = t.slice(eq + 1).trim();
        if (v) return v;
      }
    }
  }
  return null;
}
