import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function localTarget(target) {
  const value = target.startsWith("<") && target.endsWith(">")
    ? target.slice(1, -1)
    : target;
  if (!value || value.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  return value;
}

export function extractLinks(markdown) {
  const links = [];
  let fence;
  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    const marker = line.match(/^\s*(```+|~~~+)/)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      continue;
    }
    if (fence) continue;

    const targets = [];
    for (const match of line.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^)]*)?\)/g)) {
      targets.push(match[1]);
    }
    const definition = line.match(/^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/);
    if (definition) targets.push(definition[1]);
    for (const match of line.matchAll(/(?:href|src)=["']([^"']+)["']/g)) {
      targets.push(match[1]);
    }

    for (const target of targets) {
      const local = localTarget(target);
      if (local) links.push({ line: index + 1, target: local });
    }
  }
  return links;
}

export function headingAnchors(markdown) {
  const anchors = new Set();
  const counts = new Map();
  let fence;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.match(/^\s*(```+|~~~+)/)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      continue;
    }
    if (fence) continue;

    for (const match of line.matchAll(/<(?:a|[a-z][a-z0-9-]*)\s+[^>]*(?:id|name)=["']?([^\s"'>]+)["']?[^>]*>/gi)) {
      anchors.add(match[1]);
    }

    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
    if (!heading) continue;
    const base = heading
      .replace(/<[^>]*>/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[`*_~]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s+/g, "-");
    const duplicate = counts.get(base) ?? 0;
    counts.set(base, duplicate + 1);
    anchors.add(duplicate === 0 ? base : `${base}-${duplicate}`);
  }
  return anchors;
}

function decoded(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function checkDocuments(root, files) {
  const errors = [];
  for (const file of files) {
    const sourcePath = join(root, file);
    if (!existsSync(sourcePath)) continue;
    const markdown = readFileSync(sourcePath, "utf8");
    for (const link of extractLinks(markdown)) {
      const hashIndex = link.target.indexOf("#");
      const rawPath = hashIndex === -1 ? link.target : link.target.slice(0, hashIndex);
      const anchor = hashIndex === -1 ? "" : decoded(link.target.slice(hashIndex + 1));
      const pathPart = decoded(rawPath.split("?")[0]);
      const targetPath = pathPart
        ? pathPart.startsWith("/")
          ? join(root, pathPart.slice(1))
          : resolve(dirname(sourcePath), pathPart)
        : sourcePath;

      if (!existsSync(targetPath)) {
        errors.push(`${file}:${link.line}: missing target ${pathPart}`);
        continue;
      }
      if (anchor && statSync(targetPath).isFile() && [".md", ".markdown", ""].includes(extname(targetPath))) {
        const anchors = headingAnchors(readFileSync(targetPath, "utf8"));
        if (!anchors.has(anchor)) {
          errors.push(`${file}:${link.line}: missing anchor #${anchor} in ${relative(root, targetPath)}`);
        }
      }
    }
  }
  return errors;
}

function trackedMarkdownFiles() {
  const result = spawnSync("git", ["ls-files", "-z", "--", "*.md"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || "git ls-files failed");
  return result.stdout.split("\0").filter(Boolean);
}

const isEntryPoint = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isEntryPoint) {
  const errors = checkDocuments(repositoryRoot, trackedMarkdownFiles());
  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Documentation links passed\n");
  }
}
