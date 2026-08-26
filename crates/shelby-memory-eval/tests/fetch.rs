use std::fs;

use sha2::{Digest, Sha256};
use shelby_memory_eval::fetch::fetch_dataset;
use shelby_memory_eval::longmemeval::{Dataset, LongMemEvalManifest};
use uuid::Uuid;

fn temporary_path() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("shelby-memory-eval-{}.json", Uuid::new_v4()))
}

fn manifest(content: &[u8], license: &str) -> LongMemEvalManifest {
    LongMemEvalManifest {
        schema_version: 1,
        suite_version: "test".into(),
        dataset: Dataset {
            name: "test".into(),
            source: "https://invalid.example/should-not-be-read".into(),
            revision: "a".repeat(40),
            sha256: format!("{:x}", Sha256::digest(content)),
            license: license.into(),
        },
        cases: vec![],
    }
}

#[test]
fn fetch_reuses_a_verified_cache_without_network_access() {
    let path = temporary_path();
    fs::write(&path, b"verified").unwrap();

    let result = fetch_dataset(&manifest(b"verified", "MIT"), &path).unwrap();

    assert_eq!(result, path);
    assert_eq!(fs::read(&path).unwrap(), b"verified");
    fs::remove_file(path).unwrap();
}

#[test]
fn fetch_rejects_an_unapproved_license_before_using_the_cache() {
    let path = temporary_path();
    fs::write(&path, b"verified").unwrap();

    let error = fetch_dataset(&manifest(b"verified", "unknown"), &path).unwrap_err();

    assert!(error.to_string().contains("license"));
    fs::remove_file(path).unwrap();
}
