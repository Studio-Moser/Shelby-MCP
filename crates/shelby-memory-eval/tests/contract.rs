use shelby_memory_eval::contract::run_contract_suite;

const FIXTURE: &str = include_str!("../../../tests/fixtures/Contract Corpus-v1.json");

#[test]
fn contract_suite_exercises_production_handlers_and_exact_expectations() {
    let result = run_contract_suite(FIXTURE).expect("valid contract suite");

    assert_eq!(result.suite_version, "shelby-contract-v1");
    assert_eq!(result.cases.len(), 5);
    assert!(
        result.cases.iter().all(|case| case.passed),
        "{:#?}",
        result
            .cases
            .iter()
            .filter(|case| !case.passed)
            .collect::<Vec<_>>()
    );
    assert_eq!(
        result
            .cases
            .iter()
            .map(|case| case.output["mode"].as_str().unwrap_or("non-search"))
            .collect::<Vec<_>>(),
        vec!["fts", "vector", "non-search", "non-search", "non-search"]
    );
}

#[test]
fn contract_fixture_validation_rejects_duplicate_thought_ids() {
    let mut fixture: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
    let duplicate = fixture["thoughts"][0].clone();
    fixture["thoughts"].as_array_mut().unwrap().push(duplicate);

    let error = run_contract_suite(&fixture.to_string()).unwrap_err();
    assert_eq!(
        error.to_string(),
        "duplicate thought ID: 00000000-0000-4000-8000-000000000001"
    );
}

#[test]
fn contract_fixture_validation_rejects_invalid_timestamps_and_expectations() {
    let mut bad_time: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
    bad_time["thoughts"][0]["created_at"] = "yesterday".into();
    assert_eq!(
        run_contract_suite(&bad_time.to_string())
            .unwrap_err()
            .to_string(),
        "invalid timestamp on thought 00000000-0000-4000-8000-000000000001: yesterday"
    );

    let mut unknown_expected: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
    unknown_expected["cases"][0]["expected"]["ranked_ids"][0] = "missing".into();
    assert_eq!(
        run_contract_suite(&unknown_expected.to_string())
            .unwrap_err()
            .to_string(),
        "case search-project-scope expects unknown thought ID: missing"
    );
}
