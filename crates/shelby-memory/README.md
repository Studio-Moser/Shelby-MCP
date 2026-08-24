# shelby-memory

The Shelby memory engine as a Rust library: SQLite + FTS5 keyword search, float32 vector search, typed knowledge-graph edges with temporal validity, write-path reconciliation, trust fencing, and Project Identity v2 primitives. It implements the shared contract in Shelby's ADR 0001 and opens databases created by the TypeScript engine unchanged (same migration sequence, currently v18).

Status: engine core, project registry/scope resolution, capture actions, brief policy, and all 12 tool handlers are ported and fixture-verified. The MCP server binary is next; the TypeScript implementation in `src/` remains the shipping server until parity.

```bash
cargo test -p shelby-memory
```

Cross-engine check (needs the TS build in `dist/`): seed a database with the TypeScript engine, then run `SHELBY_TS_DB=/path/to/memory.db cargo test -p shelby-memory --test cross_engine`.
