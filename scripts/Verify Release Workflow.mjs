import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = resolve(root, ".github", "workflows", "release.yml");
const workflow = readFileSync(workflowPath, "utf8");

for (const target of [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "aarch64-unknown-linux-gnu",
  "x86_64-unknown-linux-gnu",
  "x86_64-pc-windows-msvc",
]) {
  assert.match(workflow, new RegExp(`target: ${target}`), `missing target ${target}`);
}

assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /publish:\s*\n\s*description:.*\n\s*type: boolean\s*\n\s*required: true\s*\n\s*default: false/);
assert.doesNotMatch(workflow, /\bpull_request:/);
assert.match(workflow, /sha256sum|Get-FileHash|shasum -a 256/);
assert.match(workflow, /actions\/upload-artifact@v\d+/);
assert.match(workflow, /environment: release/);
assert.match(workflow, /inputs\.publish == true/);
assert.match(workflow, /startsWith\(github\.ref, 'refs\/tags\/v0\.4\.0-'\)/);
assert.match(workflow, /npm publish[\s\S]+npm publish/, "platform packages must publish before the wrapper");
assert.match(workflow, /cargo publish/);
assert.match(workflow, /gh release (create|upload)/);
assert.doesNotMatch(workflow, /echo.*(?:NPM_TOKEN|CARGO_REGISTRY_TOKEN|GITHUB_TOKEN)/i);

process.stdout.write("Release workflow contract passed\n");
