import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const workflowPath = resolve(import.meta.dirname, "../.github/workflows/memory-eval.yml");

function workflowSteps() {
  const ruby = spawnSync("ruby", [
    "-e",
    [
      'require "json"',
      'require "yaml"',
      'workflow = YAML.safe_load(File.read(ARGV.fetch(0)), aliases: true)',
      'puts JSON.generate(workflow.fetch("jobs").fetch("evaluate").fetch("steps"))',
    ].join("; "),
    workflowPath,
  ], { encoding: "utf8" });

  assert.equal(ruby.status, 0, ruby.stderr);
  return JSON.parse(ruby.stdout);
}

test("approved oracle changes run and validate a candidate-owned rebaseline", () => {
  const steps = workflowSteps();
  const step = (name) => steps.find((candidate) => candidate.name === name);
  const names = [
    "Fetch approved rebaseline dataset",
    "Run approved candidate rebaseline twice",
    "Validate approved candidate rebaseline",
  ];

  for (const name of names) {
    assert.ok(step(name), `missing workflow step: ${name}`);
    assert.match(step(name).if, /steps\.oracle-changes\.outputs\.changed == 'true'/);
    assert.match(step(name).if, /memory-eval\/rebaseline-approved/);
  }

  const fetch = step(names[0]).run;
  assert.match(fetch, /--manifest-path candidate\/Cargo\.toml/);
  assert.match(fetch, /candidate\/tests\/fixtures\/LongMemEval PR-v1\.json/);

  const run = step(names[1]).run;
  assert.equal([...run.matchAll(/run --suite pr/g)].length, 2);
  assert.match(run, /--manifest-path candidate\/Cargo\.toml/);
  assert.match(run, /candidate\/tests\/fixtures\/Memory Eval Policy-v1\.json/);
  assert.match(run, /--output artifacts\/rebaseline-candidate\b/);
  assert.match(run, /--output artifacts\/rebaseline-candidate-repeat\b/);

  const validate = step(names[2]).run;
  assert.match(validate, /--manifest-path candidate\/Cargo\.toml/);
  assert.match(validate, /--base artifacts\/rebaseline-candidate\/results\.json/);
  assert.match(validate, /--candidate artifacts\/rebaseline-candidate\/results\.json/);
  assert.match(validate, /--candidate-repeat artifacts\/rebaseline-candidate-repeat\/results\.json/);
  assert.match(validate, /candidate\/tests\/fixtures\/Memory Eval Policy-v1\.json/);
  assert.match(validate, /--output artifacts\/rebaseline-comparison/);
});
