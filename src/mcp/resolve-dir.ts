import { fileURLToPath } from "node:url";

export interface RootRef { uri: string }

/** Choose the directory to resolve the project from: first file:// root, else fallback cwd. */
export function pickResolutionDir(roots: RootRef[] | undefined, fallbackCwd: string): string {
  for (const r of roots ?? []) {
    if (r.uri.startsWith("file://")) {
      try { return fileURLToPath(r.uri); } catch { /* ignore malformed */ }
    }
  }
  return fallbackCwd;
}
