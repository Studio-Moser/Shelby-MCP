//! Cross-engine parity: a database produced by the TypeScript engine must open and
//! query identically here. Runs only when `SHELBY_TS_DB` points at such a file.
use shelby_memory::fts::{SearchOptions, search_thoughts};
use shelby_memory::thoughts::{
    ListOptions, ThoughtInput, get_thought, insert_thought, list_thoughts,
};
use shelby_memory::{Memory, migrations::CURRENT_SCHEMA_VERSION};

#[test]
fn reads_and_extends_a_typescript_created_database() {
    let Ok(path) = std::env::var("SHELBY_TS_DB") else {
        eprintln!("SHELBY_TS_DB not set; skipping");
        return;
    };
    let m = Memory::open(&path).unwrap();
    assert_eq!(
        m.schema_version().unwrap(),
        CURRENT_SCHEMA_VERSION,
        "no migration needed on a TS-created db"
    );
    let listed = list_thoughts(&m.conn, &ListOptions::default()).unwrap();
    assert!(listed.total_count >= 1, "TS seed row visible");
    let seed = get_thought(&m.conn, &listed.results.last().unwrap().id)
        .unwrap()
        .unwrap();
    assert_eq!(
        seed.topics,
        vec!["knowledge-graph"],
        "TS canonicalized topics parse as an array"
    );
    assert_eq!(
        seed.project_identifier.as_deref(),
        Some("shelby"),
        "alias resolves through the TS-written registry"
    );
    let found = search_thoughts(
        &m.conn,
        &SearchOptions {
            query: "typescript".into(),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        found.total_count, 1,
        "FTS index written by TS triggers is queryable"
    );
    // Write back a row the TS engine will read in the second half of the check.
    let id = insert_thought(
        &m.conn,
        &ThoughtInput {
            content: "written by the rust engine".into(),
            summary: Some("rust row".into()),
            project_identifier: Some("shelby".into()),
            topics: Some(vec!["Cross Engine".into()]),
            ..Default::default()
        },
    )
    .unwrap();
    println!("RUST_ROW_ID={id}");
}
