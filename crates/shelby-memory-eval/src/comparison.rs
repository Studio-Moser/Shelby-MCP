use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::manifest::ResultManifest;

const FLOAT_EPSILON: f64 = 1e-12;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MetricFloor {
    pub recall_at_5: f64,
    pub ndcg_at_10: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResourceBudget {
    pub max_total_estimated_tokens: u64,
    pub max_total_serialized_bytes: u64,
    pub max_case_estimated_tokens: u64,
    pub max_case_serialized_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GatePolicy {
    pub schema_version: u32,
    pub policy_version: u32,
    pub category_floors: BTreeMap<String, MetricFloor>,
    pub resources: ResourceBudget,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MetricDelta {
    pub base: f64,
    pub candidate: f64,
    pub delta: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComparisonReport {
    pub passed: bool,
    pub failures: Vec<String>,
    pub metric_deltas: BTreeMap<String, MetricDelta>,
    pub case_changes: Vec<String>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ComparisonError {
    #[error("{manifest} result manifest is missing the aggregate `{aggregate}`")]
    MissingAggregate {
        manifest: &'static str,
        aggregate: String,
    },
    #[error("{manifest} result manifest has an invalid deterministic digest")]
    InvalidDigest { manifest: &'static str },
}

pub fn compare(
    base: &ResultManifest,
    candidate: &ResultManifest,
    candidate_repeat: &ResultManifest,
    policy: &GatePolicy,
) -> Result<ComparisonReport, ComparisonError> {
    validate_digest("base", base)?;
    validate_digest("candidate", candidate)?;
    validate_digest("candidate repeat", candidate_repeat)?;

    let base_overall = aggregate("base", base, "overall")?;
    let candidate_overall = aggregate("candidate", candidate, "overall")?;
    let mut failures = Vec::new();

    let metric_deltas = BTreeMap::from([
        (
            "Recall@5".into(),
            MetricDelta {
                base: base_overall.recall_at_5,
                candidate: candidate_overall.recall_at_5,
                delta: candidate_overall.recall_at_5 - base_overall.recall_at_5,
            },
        ),
        (
            "NDCG@10".into(),
            MetricDelta {
                base: base_overall.ndcg_at_10,
                candidate: candidate_overall.ndcg_at_10,
                delta: candidate_overall.ndcg_at_10 - base_overall.ndcg_at_10,
            },
        ),
    ]);

    if candidate_overall.recall_at_5 + FLOAT_EPSILON < base_overall.recall_at_5 {
        failures.push(format!(
            "Recall@5 regressed from {:.6} to {:.6}",
            base_overall.recall_at_5, candidate_overall.recall_at_5
        ));
    }
    if candidate_overall.ndcg_at_10 + FLOAT_EPSILON < base_overall.ndcg_at_10 {
        failures.push(format!(
            "NDCG@10 regressed from {:.6} to {:.6}",
            base_overall.ndcg_at_10, candidate_overall.ndcg_at_10
        ));
    }

    if base.schema_version != candidate.schema_version
        || base.suite_version != candidate.suite_version
        || base.policy_version != candidate.policy_version
        || candidate.policy_version != policy.policy_version
        || base.provenance != candidate.provenance
        || base.configuration != candidate.configuration
    {
        failures.push("configuration drift between base, candidate, or policy".into());
    }

    if candidate.deterministic_digest != candidate_repeat.deterministic_digest {
        failures.push("candidate deterministic digest changed between repeated runs".into());
    }

    for case in candidate
        .cases
        .iter()
        .filter(|case| case.suite == "shelby-contract" && !case.passed)
    {
        failures.push(format!("contract case {} failed", case.id));
    }

    for (category, floor) in &policy.category_floors {
        let metrics = aggregate("candidate", candidate, category)?;
        if metrics.recall_at_5 + FLOAT_EPSILON < floor.recall_at_5 {
            failures.push(format!(
                "category floor failed for {category}: Recall@5 {:.6} < {:.6}",
                metrics.recall_at_5, floor.recall_at_5
            ));
        }
        if metrics.ndcg_at_10 + FLOAT_EPSILON < floor.ndcg_at_10 {
            failures.push(format!(
                "category floor failed for {category}: NDCG@10 {:.6} < {:.6}",
                metrics.ndcg_at_10, floor.ndcg_at_10
            ));
        }
    }

    check_resource_budgets(candidate, policy, &mut failures);

    let base_public: BTreeMap<_, _> = base
        .cases
        .iter()
        .filter(|case| case.suite == "longmemeval-pr")
        .map(|case| (&case.id, &case.ranked_ids))
        .collect();
    let case_changes = candidate
        .cases
        .iter()
        .filter(|case| case.suite == "longmemeval-pr")
        .filter_map(|case| {
            base_public
                .get(&case.id)
                .filter(|base_ids| **base_ids != &case.ranked_ids)
                .map(|_| case.id.clone())
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    Ok(ComparisonReport {
        passed: failures.is_empty(),
        failures,
        metric_deltas,
        case_changes,
    })
}

fn validate_digest(name: &'static str, manifest: &ResultManifest) -> Result<(), ComparisonError> {
    if manifest.compute_digest().ok().as_ref() != Some(&manifest.deterministic_digest) {
        return Err(ComparisonError::InvalidDigest { manifest: name });
    }
    Ok(())
}

fn aggregate<'a>(
    name: &'static str,
    manifest: &'a ResultManifest,
    aggregate_name: &str,
) -> Result<&'a crate::metrics::RetrievalMetrics, ComparisonError> {
    manifest
        .aggregates
        .get(aggregate_name)
        .ok_or_else(|| ComparisonError::MissingAggregate {
            manifest: name,
            aggregate: aggregate_name.into(),
        })
}

fn check_resource_budgets(
    candidate: &ResultManifest,
    policy: &GatePolicy,
    failures: &mut Vec<String>,
) {
    let budget = &policy.resources;
    if candidate.efficiency.estimated_tokens > budget.max_total_estimated_tokens {
        failures.push(format!(
            "resource budget exceeded: total estimated tokens {} > {}",
            candidate.efficiency.estimated_tokens, budget.max_total_estimated_tokens
        ));
    }
    if candidate.efficiency.serialized_bytes > budget.max_total_serialized_bytes {
        failures.push(format!(
            "resource budget exceeded: total serialized bytes {} > {}",
            candidate.efficiency.serialized_bytes, budget.max_total_serialized_bytes
        ));
    }
    for case in &candidate.cases {
        if case.estimated_tokens > budget.max_case_estimated_tokens {
            failures.push(format!(
                "resource budget exceeded for {}: estimated tokens {} > {}",
                case.id, case.estimated_tokens, budget.max_case_estimated_tokens
            ));
        }
        if case.serialized_bytes > budget.max_case_serialized_bytes {
            failures.push(format!(
                "resource budget exceeded for {}: serialized bytes {} > {}",
                case.id, case.serialized_bytes, budget.max_case_serialized_bytes
            ));
        }
    }
}
