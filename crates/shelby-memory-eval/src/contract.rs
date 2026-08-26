use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;
use serde_json::{Map, Value};
use shelby_memory::brief::estimate_brief_tokens;
use shelby_memory::projects::{ProjectSeed, upsert_project};
use shelby_memory::rusqlite::params;
use shelby_memory::tools::{get_brief_tool, search_thoughts_tool, select_context_tool};
use shelby_memory::vectors::embedding_to_bytes;
use shelby_memory::{Memory, identity::derive_existing_project_id};
use thiserror::Error;

use crate::manifest::CaseResult;

#[derive(Debug, Error)]
pub enum ContractError {
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Memory(#[from] shelby_memory::Error),
    #[error(transparent)]
    Sqlite(#[from] shelby_memory::rusqlite::Error),
    #[error("unsupported contract schema version: {0}")]
    UnsupportedSchema(u32),
    #[error("duplicate project slug: {0}")]
    DuplicateProject(String),
    #[error("duplicate thought ID: {0}")]
    DuplicateThought(String),
    #[error("duplicate edge ID: {0}")]
    DuplicateEdge(String),
    #[error("duplicate case ID: {0}")]
    DuplicateCase(String),
    #[error("unknown project slug on thought {thought_id}: {project}")]
    UnknownProject { thought_id: String, project: String },
    #[error("edge {edge_id} refers to unknown thought: {thought_id}")]
    UnknownEdgeThought { edge_id: String, thought_id: String },
    #[error("thought {0} has an invalid trust level")]
    InvalidTrust(String),
    #[error("invalid timestamp on {entity}: {value}")]
    InvalidTimestamp { entity: String, value: String },
    #[error("case {case_id} expects unknown thought ID: {thought_id}")]
    UnknownExpectedThought { case_id: String, thought_id: String },
}

#[derive(Debug, Deserialize)]
struct ContractSuite {
    schema_version: u32,
    suite_version: String,
    projects: Vec<String>,
    thoughts: Vec<FixtureThought>,
    #[serde(default)]
    edges: Vec<FixtureEdge>,
    cases: Vec<ContractCase>,
}

#[derive(Debug, Deserialize)]
struct FixtureThought {
    id: String,
    content: String,
    summary: Option<String>,
    #[serde(rename = "type")]
    kind: String,
    source: String,
    trust_level: String,
    project_identifier: Option<String>,
    visibility: String,
    #[serde(default)]
    metadata: Map<String, Value>,
    embedding: Option<Vec<f32>>,
    created_at: String,
    updated_at: String,
    consolidated_into: Option<String>,
    #[serde(default)]
    reinforcement_count: i64,
    last_confirmed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FixtureEdge {
    id: String,
    source_id: String,
    target_id: String,
    edge_type: String,
    #[serde(default)]
    metadata: Map<String, Value>,
    created_at: String,
    valid_from: Option<String>,
    valid_until: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Handler {
    SearchThoughts,
    GetBrief,
    SelectContext,
}

#[derive(Debug, Deserialize)]
struct ContractCase {
    id: String,
    category: String,
    handler: Handler,
    arguments: Value,
    expected: Expected,
}

#[derive(Debug, Default, Deserialize)]
struct Expected {
    ranked_ids: Option<Vec<String>>,
    #[serde(default)]
    forbidden_ids: Vec<String>,
    #[serde(default)]
    json_values: BTreeMap<String, Value>,
    #[serde(default)]
    minimum_numbers: BTreeMap<String, f64>,
    #[serde(default)]
    required_text: Vec<String>,
    #[serde(default)]
    forbidden_text: Vec<String>,
    max_estimated_tokens: Option<u64>,
}

#[derive(Debug)]
pub struct ContractSuiteResult {
    pub suite_version: String,
    pub cases: Vec<CaseResult>,
}

pub fn run_contract_suite(input: &str) -> Result<ContractSuiteResult, ContractError> {
    let suite: ContractSuite = serde_json::from_str(input)?;
    validate(&suite)?;
    let mut cases = Vec::with_capacity(suite.cases.len());
    for case in &suite.cases {
        cases.push(run_case(&suite, case)?);
    }
    Ok(ContractSuiteResult {
        suite_version: suite.suite_version,
        cases,
    })
}

fn validate(suite: &ContractSuite) -> Result<(), ContractError> {
    if suite.schema_version != 1 {
        return Err(ContractError::UnsupportedSchema(suite.schema_version));
    }
    reject_duplicate(
        suite.projects.iter().map(String::as_str),
        ContractError::DuplicateProject,
    )?;
    reject_duplicate(
        suite.thoughts.iter().map(|thought| thought.id.as_str()),
        ContractError::DuplicateThought,
    )?;
    reject_duplicate(
        suite.edges.iter().map(|edge| edge.id.as_str()),
        ContractError::DuplicateEdge,
    )?;
    reject_duplicate(
        suite.cases.iter().map(|case| case.id.as_str()),
        ContractError::DuplicateCase,
    )?;

    let projects: BTreeSet<&str> = suite.projects.iter().map(String::as_str).collect();
    let thoughts: BTreeSet<&str> = suite
        .thoughts
        .iter()
        .map(|thought| thought.id.as_str())
        .collect();
    for thought in &suite.thoughts {
        if shelby_memory::thoughts::TrustLevel::parse(&thought.trust_level).is_none() {
            return Err(ContractError::InvalidTrust(thought.id.clone()));
        }
        if let Some(project) = thought.project_identifier.as_deref()
            && !projects.contains(project)
        {
            return Err(ContractError::UnknownProject {
                thought_id: thought.id.clone(),
                project: project.to_string(),
            });
        }
        validate_timestamp(&format!("thought {}", thought.id), &thought.created_at)?;
        validate_timestamp(&format!("thought {}", thought.id), &thought.updated_at)?;
        if let Some(timestamp) = thought.last_confirmed_at.as_deref() {
            validate_timestamp(&format!("thought {}", thought.id), timestamp)?;
        }
    }
    for edge in &suite.edges {
        for thought_id in [&edge.source_id, &edge.target_id] {
            if !thoughts.contains(thought_id.as_str()) {
                return Err(ContractError::UnknownEdgeThought {
                    edge_id: edge.id.clone(),
                    thought_id: thought_id.clone(),
                });
            }
        }
        validate_timestamp(&format!("edge {}", edge.id), &edge.created_at)?;
        for timestamp in [edge.valid_from.as_deref(), edge.valid_until.as_deref()]
            .into_iter()
            .flatten()
        {
            validate_timestamp(&format!("edge {}", edge.id), timestamp)?;
        }
    }
    for case in &suite.cases {
        for thought_id in case
            .expected
            .ranked_ids
            .iter()
            .flatten()
            .chain(&case.expected.forbidden_ids)
        {
            if !thoughts.contains(thought_id.as_str()) {
                return Err(ContractError::UnknownExpectedThought {
                    case_id: case.id.clone(),
                    thought_id: thought_id.clone(),
                });
            }
        }
    }
    Ok(())
}

fn validate_timestamp(entity: &str, value: &str) -> Result<(), ContractError> {
    chrono::DateTime::parse_from_rfc3339(value).map_err(|_| ContractError::InvalidTimestamp {
        entity: entity.to_string(),
        value: value.to_string(),
    })?;
    Ok(())
}

fn reject_duplicate<'a>(
    values: impl Iterator<Item = &'a str>,
    error: impl Fn(String) -> ContractError,
) -> Result<(), ContractError> {
    let mut seen = BTreeSet::new();
    for value in values {
        if !seen.insert(value) {
            return Err(error(value.to_string()));
        }
    }
    Ok(())
}

fn seeded_memory(suite: &ContractSuite) -> Result<Memory, ContractError> {
    let memory = Memory::open_in_memory()?;
    for slug in &suite.projects {
        upsert_project(
            &memory.conn,
            &ProjectSeed {
                slug: slug.clone(),
                display_name: slug.clone(),
                ..Default::default()
            },
        )?;
    }

    for thought in &suite.thoughts {
        let project_id = thought
            .project_identifier
            .as_deref()
            .and_then(derive_existing_project_id);
        let metadata = serde_json::to_string(&thought.metadata)?;
        let embedding = thought.embedding.as_deref().map(embedding_to_bytes);
        memory.conn.execute(
            "INSERT INTO thoughts (id, content, summary, type, source, trust_level, project_id, project_identifier,
               visibility, metadata, embedding, created_at, updated_at, consolidated_into, reinforcement_count, last_confirmed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                thought.id,
                thought.content,
                thought.summary,
                thought.kind,
                thought.source,
                thought.trust_level,
                project_id,
                thought.project_identifier,
                thought.visibility,
                metadata,
                embedding,
                thought.created_at,
                thought.updated_at,
                thought.consolidated_into,
                thought.reinforcement_count,
                thought.last_confirmed_at,
            ],
        )?;
    }
    for edge in &suite.edges {
        let metadata = serde_json::to_string(&edge.metadata)?;
        memory.conn.execute(
            "INSERT INTO edges (id, source_id, target_id, edge_type, metadata, created_at, valid_from, valid_until)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                edge.id,
                edge.source_id,
                edge.target_id,
                edge.edge_type,
                metadata,
                edge.created_at,
                edge.valid_from,
                edge.valid_until,
            ],
        )?;
    }
    Ok(memory)
}

fn run_case(suite: &ContractSuite, case: &ContractCase) -> Result<CaseResult, ContractError> {
    let memory = seeded_memory(suite)?;
    let result = match case.handler {
        Handler::SearchThoughts => search_thoughts_tool(&memory, &case.arguments),
        Handler::GetBrief => get_brief_tool(&memory, &case.arguments),
        Handler::SelectContext => select_context_tool(&memory, &case.arguments),
    };
    let output = result.json();
    let ranked_ids = ranked_ids(&case.handler, &output);
    let estimated_tokens = output["estimated_tokens"]
        .as_u64()
        .unwrap_or_else(|| estimate_brief_tokens(&result.text).max(0) as u64);
    let mut failures = Vec::new();
    if result.is_error {
        failures.push(format!("handler returned an error: {}", result.text));
    }
    if let Some(expected) = &case.expected.ranked_ids
        && &ranked_ids != expected
    {
        failures.push(format!(
            "ranked IDs differ: expected {expected:?}, got {ranked_ids:?}"
        ));
    }
    for forbidden in &case.expected.forbidden_ids {
        if ranked_ids.contains(forbidden) {
            failures.push(format!("forbidden ID returned: {forbidden}"));
        }
    }
    for (pointer, expected) in &case.expected.json_values {
        if output.pointer(pointer) != Some(expected) {
            failures.push(format!(
                "JSON value at {pointer} differs: expected {expected}, got {:?}",
                output.pointer(pointer)
            ));
        }
    }
    for (pointer, minimum) in &case.expected.minimum_numbers {
        let actual = output.pointer(pointer).and_then(Value::as_f64);
        if actual.is_none_or(|actual| actual < *minimum) {
            failures.push(format!(
                "JSON number at {pointer} is below {minimum}: got {actual:?}"
            ));
        }
    }
    for required in &case.expected.required_text {
        if !value_contains_text(&output, required) {
            failures.push(format!("required text missing: {required}"));
        }
    }
    for forbidden in &case.expected.forbidden_text {
        if value_contains_text(&output, forbidden) {
            failures.push(format!("forbidden text returned: {forbidden}"));
        }
    }
    if let Some(maximum) = case.expected.max_estimated_tokens
        && estimated_tokens > maximum
    {
        failures.push(format!(
            "estimated tokens exceed {maximum}: got {estimated_tokens}"
        ));
    }

    Ok(CaseResult {
        id: case.id.clone(),
        suite: "shelby-contract".into(),
        category: case.category.clone(),
        passed: failures.is_empty(),
        ranked_ids,
        relevant_ids: case.expected.ranked_ids.clone().unwrap_or_default(),
        forbidden_ids: case.expected.forbidden_ids.clone(),
        metrics: None,
        estimated_tokens,
        serialized_bytes: result.text.len() as u64,
        failures,
        output,
    })
}

fn ranked_ids(handler: &Handler, output: &Value) -> Vec<String> {
    let key = match handler {
        Handler::SearchThoughts => "results",
        Handler::GetBrief => "items",
        Handler::SelectContext => return Vec::new(),
    };
    output[key]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item["id"].as_str().map(str::to_owned))
        .collect()
}

fn value_contains_text(value: &Value, needle: &str) -> bool {
    match value {
        Value::String(text) => text.contains(needle),
        Value::Array(items) => items.iter().any(|item| value_contains_text(item, needle)),
        Value::Object(object) => object
            .values()
            .any(|value| value_contains_text(value, needle)),
        _ => false,
    }
}
