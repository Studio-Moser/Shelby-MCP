# Memory evaluation

Shelby's PR memory gate is deterministic, model-free, and tied directly to the Rust production handlers. It combines exact product contracts with a small public retrieval benchmark so a change cannot trade away project scope, trust safety, token bounds, or reproducibility for one opaque score.

## What runs

The `shelby-memory-eval` crate runs two suites against a fresh in-memory Shelby database for every case:

1. The five-case Shelby contract corpus calls the production `search_thoughts`, `get_brief`, and `select_context` handlers. It checks exact IDs, project isolation, trust fencing, lifecycle exclusions, and token-budget behavior.
2. The 36-case LongMemEval-S subset calls the production `search_thoughts` handler. It contains six evidence-bearing cases from each of the six upstream question types and measures session retrieval with Precision@5, Recall@5, NDCG@10, and MRR@10.

The public source is pinned to an immutable dataset commit, SHA-256 checksum, and MIT license in `tests/fixtures/LongMemEval PR-v1.json`. The 265 MB dataset stays in an external cache; it is never committed. Result artifacts contain case IDs, evidence IDs, ranked IDs, metrics, and resource counts—not question, answer, or conversation text.

## Gate policy

`tests/fixtures/Memory Eval Policy-v1.json` is the reviewed policy. A comparison fails when any of these conditions is true:

- A Shelby contract case fails.
- Overall Recall@5 or NDCG@10 falls below the base revision.
- A public category falls below its absolute policy floor.
- The two candidate runs produce different deterministic digests.
- Dataset provenance, suite version, policy version, or retrieval configuration drifts from the base revision.
- Total or per-case estimated tokens or serialized bytes exceed policy ceilings.

There is deliberately no composite quality score. The comparison report lists the two primary deltas and every public case whose ranking changed, even when the gate passes.

The public suite is a retrieval proxy, not a complete measure of memory quality or answer quality. Its initial FTS baseline is low outside the knowledge-update category; that is visible rather than normalized away. Future retrieval work should raise the category metrics, while the contract corpus protects Shelby-specific correctness that LongMemEval does not cover.

## Run locally

Choose a cache location outside the repository, then fetch the pinned dataset once:

```bash
cargo run -p shelby-memory-eval -- \
  fetch longmemeval-pr --cache /tmp/shelby-memory-eval/longmemeval-s.json
```

Run the candidate twice. `run` never downloads data or calls a model:

```bash
cargo run -p shelby-memory-eval -- \
  run --suite pr \
  --dataset /tmp/shelby-memory-eval/longmemeval-s.json \
  --output target/memory-eval/candidate

cargo run -p shelby-memory-eval -- \
  run --suite pr \
  --dataset /tmp/shelby-memory-eval/longmemeval-s.json \
  --output target/memory-eval/candidate-repeat
```

Compare saved result manifests:

```bash
cargo run -p shelby-memory-eval -- \
  compare \
  --base target/memory-eval/base/results.json \
  --candidate target/memory-eval/candidate/results.json \
  --candidate-repeat target/memory-eval/candidate-repeat/results.json \
  --policy "tests/fixtures/Memory Eval Policy-v1.json" \
  --output target/memory-eval/comparison
```

Each run writes `results.json` and `report.md`; comparison writes `comparison.json` and `comparison.md`. CI uploads all four directories as the `memory-evaluation` artifact and places the comparison report in the workflow summary.

On the evaluator's first merge only, the base branch cannot run a crate it does not contain. CI therefore compares the repeated candidate runs against the reviewed absolute floors. After that bootstrap, every affected pull request runs the base and candidate implementations separately and applies the full regression gate.
