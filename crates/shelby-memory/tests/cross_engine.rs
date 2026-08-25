//! Cross-engine parity: a database produced by the TypeScript engine must open and
//! query identically here. The committed fixture is mandatory; `SHELBY_TS_DB` is
//! reserved for the two-way parity driver, which needs the Rust-written row.
use std::path::{Path, PathBuf};

use shelby_memory::fts::{SearchOptions, search_thoughts};
use shelby_memory::thoughts::{ThoughtInput, get_thought, insert_thought};
use shelby_memory::{Memory, migrations::CURRENT_SCHEMA_VERSION};

const SEED_ID: &str = "018f4c66-7c4e-7a4d-8e7a-6a74af7fd001";

fn fixture_path() -> PathBuf {
    std::env::var_os("SHELBY_TS_DB")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../tests/fixtures/TypeScript-v18.sqlite")
        })
}

fn remove_sqlite_files(path: &Path) {
    for candidate in [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ] {
        let _ = std::fs::remove_file(candidate);
    }
}

#[test]
fn reads_and_extends_a_typescript_created_database() {
    let source = fixture_path();
    assert!(
        source.is_file(),
        "missing TypeScript-v18 compatibility fixture: {}",
        source.display()
    );
    let supplied = std::env::var_os("SHELBY_TS_DB").is_some();
    let path = if supplied {
        source
    } else {
        let destination = std::env::temp_dir().join(format!(
            "shelby-typescript-v18-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        std::fs::copy(&source, &destination).expect("copy TypeScript fixture");
        destination
    };

    let m = Memory::open(&path).unwrap();
    assert_eq!(
        m.schema_version().unwrap(),
        CURRENT_SCHEMA_VERSION,
        "no migration needed on a TS-created db"
    );
    let seed = get_thought(&m.conn, SEED_ID)
        .unwrap()
        .expect("fixed TS seed row visible");
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

    drop(m);
    if !supplied {
        remove_sqlite_files(&path);
    }
}
