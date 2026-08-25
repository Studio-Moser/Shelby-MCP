import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { basename, dirname, join, parse, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const canonicalSkills = ["shelby-forage", "shelby-onboard"];
const packageClients = ["agent-plugin", "codex", "claude-code", "gemini", "antigravity"];
const allClients = [...packageClients, "claude-desktop", "devin"];
const sourceRoots = {
  "agent-plugin": join(repositoryRoot, "integrations", "agent-plugin"),
  codex: join(repositoryRoot, "integrations", "codex", "shelbymcp"),
  "claude-code": join(repositoryRoot, "integrations", "claude-code"),
  gemini: join(repositoryRoot, "integrations", "gemini"),
  antigravity: join(repositoryRoot, "integrations", "antigravity"),
  devin: join(repositoryRoot, "integrations", "devin"),
};
const archiveTimestamp = new Date("2000-01-01T00:00:00Z");

export function safeCopyTree(source, destination) {
  const metadata = lstatSync(source);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Refusing to copy symbolic link: ${source}`);
  }
  if (metadata.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source).sort()) {
      safeCopyTree(join(source, entry), join(destination, entry));
    }
    return;
  }
  if (!metadata.isFile()) throw new Error(`Unsupported integration source entry: ${source}`);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function copySkills(destination) {
  for (const skill of canonicalSkills) {
    safeCopyTree(
      join(repositoryRoot, "skills", skill),
      join(destination, "skills", skill),
    );
  }
}

function normalizeTimestamps(path) {
  const metadata = lstatSync(path);
  if (metadata.isDirectory()) {
    for (const entry of readdirSync(path).sort()) normalizeTimestamps(join(path, entry));
  }
  utimesSync(path, archiveTimestamp, archiveTimestamp);
}

function buildMcpb(binary, outputRoot) {
  if (!binary) throw new Error("Claude Desktop packaging requires --binary <path>");
  const binaryPath = resolve(binary);
  if (!existsSync(binaryPath)) throw new Error(`Native binary does not exist: ${binaryPath}`);

  const packageRoot = join(outputRoot, "claude-desktop");
  safeCopyTree(join(repositoryRoot, "integrations", "claude-desktop"), packageRoot);
  const serverDir = join(packageRoot, "server");
  mkdirSync(serverDir, { recursive: true });
  const destination = join(serverDir, "shelby-mcp");
  copyFileSync(binaryPath, destination);
  chmodSync(destination, 0o755);
  normalizeTimestamps(packageRoot);

  const archive = join(outputRoot, "shelbymcp.mcpb");
  const packed = spawnSync("zip", ["-X", "-q", "-r", archive, "manifest.json", "server"], {
    cwd: packageRoot,
    encoding: "utf8",
    shell: false,
  });
  if (packed.error) throw packed.error;
  if (packed.status !== 0) throw new Error(`zip failed (${packed.status}): ${packed.stderr}`);
}

export function buildIntegrationPackages({ clients, binary, output }) {
  const requested = clients.includes("all") ? allClients : [...new Set(clients)];
  if (requested.length === 0) throw new Error("Choose --all or at least one --client");
  for (const client of requested) {
    if (!allClients.includes(client)) throw new Error(`Unknown integration client: ${client}`);
  }

  const outputRoot = resolve(output);
  if (outputRoot === parse(outputRoot).root || outputRoot === repositoryRoot) {
    throw new Error(`Unsafe integration output path: ${outputRoot}`);
  }
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  for (const client of requested) {
    if (client === "claude-desktop") {
      buildMcpb(binary, outputRoot);
      continue;
    }
    const destination = join(outputRoot, client);
    safeCopyTree(sourceRoots[client], destination);
    if (packageClients.includes(client)) copySkills(destination);
  }
  return requested.map((client) => join(outputRoot, client));
}

function parseArgs(argv) {
  const clients = [];
  let binary;
  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
      case "--all":
        clients.push("all");
        break;
      case "--client":
        clients.push(argv[++index]);
        break;
      case "--binary":
        binary = argv[++index];
        break;
      default:
        throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  if (clients.some((client) => !client)) throw new Error("--client requires a name");
  return { clients, binary, output: join(repositoryRoot, "target", "integrations") };
}

const isEntryPoint = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isEntryPoint) {
  try {
    const outputs = buildIntegrationPackages(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${outputs.map((path) => basename(path)).join("\n")}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
