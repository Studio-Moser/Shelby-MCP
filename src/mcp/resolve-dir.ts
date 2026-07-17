import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface RootRef { uri: string }

export type ResolutionRootResult =
  | { kind: "resolved"; paths: string[] }
  | { kind: "unresolved" }
  | { kind: "ambiguous"; paths: string[] };

/** Decode, standardize and deduplicate every file:// root advertised by a client. */
export function normalizeFileRoots(roots: RootRef[] | undefined): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const root of roots ?? []) {
    let decoded: string;
    try {
      const url = new URL(root.uri);
      if (url.protocol !== "file:") continue;
      decoded = fileURLToPath(url);
    } catch {
      continue;
    }

    const standardized = existsSync(decoded)
      ? realpathSync.native(decoded)
      : path.resolve(decoded);
    const normalized = standardized === path.parse(standardized).root
      ? standardized
      : standardized.replace(/[\\/]+$/, "");
    if (!seen.has(normalized)) {
      seen.add(normalized);
      paths.push(normalized);
    }
  }

  return paths;
}

/** Use cwd only for no-roots clients, and never treat production / as a project. */
export function fallbackResolutionRoots(cwd: string): ResolutionRootResult {
  if (!path.isAbsolute(cwd) || cwd === path.parse(cwd).root || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
    return { kind: "unresolved" };
  }
  return { kind: "resolved", paths: [realpathSync.native(cwd)] };
}
