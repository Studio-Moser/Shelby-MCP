//! Typed edges and graph traversal (ADR 0001 §§4, 5, 7).
use rusqlite::{Connection, OptionalExtension, params, types::Value};
use serde::Serialize;
use serde_json::Map;
use std::collections::{HashMap, HashSet, VecDeque};

use crate::error::{Error, Result};
use crate::now_iso;

pub const VALID_EDGE_TYPES: [&str; 6] = [
    "refines",
    "cites",
    "refuted_by",
    "tags",
    "related",
    "follows",
];

pub fn is_valid_edge_type(t: &str) -> bool {
    VALID_EDGE_TYPES.contains(&t)
}

#[derive(Debug, Clone, Default)]
pub struct EdgeInput {
    pub source_id: String,
    pub target_id: String,
    pub edge_type: String,
    pub metadata: Option<Map<String, serde_json::Value>>,
    pub valid_from: Option<String>,
    pub valid_until: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct EdgeRecord {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub edge_type: String,
    pub metadata: Option<Map<String, serde_json::Value>>,
    pub created_at: String,
    pub valid_from: Option<String>,
    pub valid_until: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Outgoing,
    Incoming,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ConnectedThought {
    pub thought_id: String,
    pub summary: Option<String>,
    pub r#type: String,
    pub edge_id: String,
    pub edge_type: String,
    pub direction: Direction,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GraphEdge {
    pub edge_id: String,
    pub edge_type: String,
    pub connected_to: String,
    pub direction: Direction,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GraphNode {
    pub id: String,
    pub summary: Option<String>,
    pub r#type: String,
    pub depth: i64,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GraphRelatedThought {
    pub id: String,
    pub summary: Option<String>,
    pub r#type: String,
    pub depth: i64,
    pub via_edge_type: String,
    pub direction: Direction,
}

/// (neighbor_id, edge_id, edge_type, neighbor_summary, neighbor_type, direction)
type Hop = (String, String, String, Option<String>, String, Direction);

const ACTIVE: &str = "(e.valid_until IS NULL OR e.valid_until > datetime('now'))";

pub fn link_thoughts(conn: &Connection, input: &EdgeInput) -> Result<String> {
    if !is_valid_edge_type(&input.edge_type) {
        return Err(Error::InvalidInput(format!(
            "Invalid edge type \"{}\". Must be one of: {}",
            input.edge_type,
            VALID_EDGE_TYPES.join(", ")
        )));
    }
    for (label, id) in [("Source", &input.source_id), ("Target", &input.target_id)] {
        if !crate::thoughts::thought_exists(conn, id)? {
            return Err(Error::NotFound(format!(
                "{label} thought \"{id}\" does not exist"
            )));
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let metadata = input
        .metadata
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;
    let res = conn.execute(
        "INSERT INTO edges (id, source_id, target_id, edge_type, metadata, created_at, valid_from, valid_until)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, input.source_id, input.target_id, input.edge_type, metadata, now_iso(), input.valid_from, input.valid_until],
    );
    match res {
        Ok(_) => Ok(id),
        Err(rusqlite::Error::SqliteFailure(e, _))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            Err(Error::Duplicate(format!(
                "Edge already exists: {} -[{}]-> {}",
                input.source_id, input.edge_type, input.target_id
            )))
        }
        Err(e) => Err(e.into()),
    }
}

pub fn unlink_thoughts(
    conn: &Connection,
    source_id: &str,
    target_id: &str,
    edge_type: &str,
) -> Result<bool> {
    Ok(conn.execute(
        "DELETE FROM edges WHERE source_id = ?1 AND target_id = ?2 AND edge_type = ?3",
        params![source_id, target_id, edge_type],
    )? > 0)
}

pub fn expire_edge(conn: &Connection, edge_id: &str, valid_until: Option<&str>) -> Result<()> {
    let ts = valid_until.map(str::to_owned).unwrap_or_else(now_iso);
    if conn.execute(
        "UPDATE edges SET valid_until = ?1 WHERE id = ?2",
        params![ts, edge_id],
    )? == 0
    {
        return Err(Error::NotFound(format!(
            "Edge \"{edge_id}\" does not exist"
        )));
    }
    Ok(())
}

fn row_to_edge(r: &rusqlite::Row) -> rusqlite::Result<EdgeRecord> {
    let metadata: Option<String> = r.get("metadata")?;
    Ok(EdgeRecord {
        id: r.get("id")?,
        source_id: r.get("source_id")?,
        target_id: r.get("target_id")?,
        edge_type: r.get("edge_type")?,
        metadata: crate::thoughts::parse_json_object(metadata.as_deref()),
        created_at: r.get("created_at")?,
        valid_from: r.get("valid_from")?,
        valid_until: r.get("valid_until")?,
    })
}

pub fn get_edge(conn: &Connection, id: &str) -> Result<Option<EdgeRecord>> {
    Ok(conn
        .query_row(
            "SELECT * FROM edges WHERE id = ?1",
            params![id],
            row_to_edge,
        )
        .optional()?)
}

pub fn get_edges_between(
    conn: &Connection,
    source_id: &str,
    target_id: &str,
) -> Result<Vec<EdgeRecord>> {
    let mut stmt = conn.prepare("SELECT * FROM edges WHERE source_id = ?1 AND target_id = ?2")?;
    let rows = stmt.query_map(params![source_id, target_id], row_to_edge)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

fn type_filter(edge_types: Option<&[String]>) -> (String, Vec<Value>) {
    match edge_types {
        Some(types) if !types.is_empty() => (
            format!("AND e.edge_type IN ({})", vec!["?"; types.len()].join(", ")),
            types.iter().map(|t| Value::Text(t.clone())).collect(),
        ),
        _ => (String::new(), vec![]),
    }
}

/// One hop: (neighbor_id, edge_id, edge_type, summary, type, direction) for both directions.
fn neighbors(
    conn: &Connection,
    id: &str,
    type_sql: &str,
    type_vals: &[Value],
    temporal_sql: &str,
) -> Result<Vec<Hop>> {
    let mut out = Vec::new();
    for (direction, join_col, where_col) in [
        (Direction::Outgoing, "target_id", "source_id"),
        (Direction::Incoming, "source_id", "target_id"),
    ] {
        let sql = format!(
            "SELECT e.id, e.edge_type, e.{join_col}, t.summary, t.type FROM edges e
             JOIN thoughts t ON t.id = e.{join_col} WHERE e.{where_col} = ? {temporal_sql} {type_sql}"
        );
        let mut vals = vec![Value::Text(id.to_string())];
        vals.extend(type_vals.iter().cloned());
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(vals), |r| {
            Ok((
                r.get::<_, String>(2)?,
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?;
        for row in rows {
            let (nid, eid, et, summary, ty) = row?;
            out.push((nid, eid, et, summary, ty, direction));
        }
    }
    Ok(out)
}

pub fn get_connections(
    conn: &Connection,
    thought_id: &str,
    edge_types: Option<&[String]>,
) -> Result<Vec<ConnectedThought>> {
    let (type_sql, type_vals) = type_filter(edge_types);
    let temporal = format!("AND {ACTIVE}");
    Ok(
        neighbors(conn, thought_id, &type_sql, &type_vals, &temporal)?
            .into_iter()
            .map(|(nid, eid, et, summary, ty, direction)| ConnectedThought {
                thought_id: nid,
                summary,
                r#type: ty,
                edge_id: eid,
                edge_type: et,
                direction,
            })
            .collect(),
    )
}

/// BFS from every result id up to `graph_depth` hops (clamped 1..=5), excluding the seeds.
pub fn fetch_graph_related(
    conn: &Connection,
    result_ids: &[String],
    graph_depth: i64,
) -> Result<Vec<GraphRelatedThought>> {
    if graph_depth <= 0 || result_ids.is_empty() {
        return Ok(vec![]);
    }
    let depth_cap = graph_depth.clamp(1, 5);
    let mut seen: HashSet<String> = result_ids.iter().cloned().collect();
    let mut related = Vec::new();
    let mut queue: VecDeque<(String, i64)> = result_ids.iter().map(|id| (id.clone(), 0)).collect();
    let temporal = format!("AND {ACTIVE}");
    while let Some((id, depth)) = queue.pop_front() {
        if depth >= depth_cap {
            continue;
        }
        for (nid, _eid, et, summary, ty, direction) in neighbors(conn, &id, "", &[], &temporal)? {
            if seen.insert(nid.clone()) {
                related.push(GraphRelatedThought {
                    id: nid.clone(),
                    summary,
                    r#type: ty,
                    depth: depth + 1,
                    via_edge_type: et,
                    direction,
                });
                queue.push_back((nid, depth + 1));
            }
        }
    }
    Ok(related)
}

/// BFS from one thought (depth clamped 0..=5). Empty when the root doesn't exist.
pub fn traverse_graph(
    conn: &Connection,
    thought_id: &str,
    max_depth: i64,
    edge_types: Option<&[String]>,
    include_expired: bool,
) -> Result<Vec<GraphNode>> {
    let depth_cap = max_depth.clamp(0, 5);
    let Some((summary, ty)) = conn
        .query_row(
            "SELECT summary, type FROM thoughts WHERE id = ?1",
            params![thought_id],
            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()?
    else {
        return Ok(vec![]);
    };
    let (type_sql, type_vals) = type_filter(edge_types);
    let temporal = if include_expired {
        String::new()
    } else {
        format!("AND {ACTIVE}")
    };
    let mut order: Vec<String> = vec![thought_id.to_string()];
    let mut visited: HashMap<String, GraphNode> = HashMap::new();
    visited.insert(
        thought_id.to_string(),
        GraphNode {
            id: thought_id.to_string(),
            summary,
            r#type: ty,
            depth: 0,
            edges: vec![],
        },
    );
    let mut queue: VecDeque<(String, i64)> = VecDeque::from([(thought_id.to_string(), 0)]);
    while let Some((id, depth)) = queue.pop_front() {
        if depth >= depth_cap {
            continue;
        }
        for (nid, eid, et, summary, ty, direction) in
            neighbors(conn, &id, &type_sql, &type_vals, &temporal)?
        {
            visited
                .get_mut(&id)
                .expect("current node visited")
                .edges
                .push(GraphEdge {
                    edge_id: eid,
                    edge_type: et,
                    connected_to: nid.clone(),
                    direction,
                });
            if !visited.contains_key(&nid) {
                visited.insert(
                    nid.clone(),
                    GraphNode {
                        id: nid.clone(),
                        summary,
                        r#type: ty,
                        depth: depth + 1,
                        edges: vec![],
                    },
                );
                order.push(nid.clone());
                queue.push_back((nid, depth + 1));
            }
        }
    }
    Ok(order
        .into_iter()
        .filter_map(|id| visited.remove(&id))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Memory;
    use crate::thoughts::{ThoughtInput, insert_thought};

    fn chain(m: &Memory, n: usize) -> Vec<String> {
        let ids: Vec<String> = (0..n)
            .map(|i| {
                insert_thought(
                    &m.conn,
                    &ThoughtInput {
                        content: format!("n{i}"),
                        ..Default::default()
                    },
                )
                .unwrap()
            })
            .collect();
        for w in ids.windows(2) {
            link_thoughts(
                &m.conn,
                &EdgeInput {
                    source_id: w[0].clone(),
                    target_id: w[1].clone(),
                    edge_type: "follows".into(),
                    ..Default::default()
                },
            )
            .unwrap();
        }
        ids
    }

    #[test]
    fn link_validation_duplicates_and_cascade() {
        let m = Memory::open_in_memory().unwrap();
        let ids = chain(&m, 2);
        let dup = link_thoughts(
            &m.conn,
            &EdgeInput {
                source_id: ids[0].clone(),
                target_id: ids[1].clone(),
                edge_type: "follows".into(),
                ..Default::default()
            },
        );
        assert!(matches!(dup, Err(Error::Duplicate(_))));
        let bad = link_thoughts(
            &m.conn,
            &EdgeInput {
                source_id: ids[0].clone(),
                target_id: ids[1].clone(),
                edge_type: "loves".into(),
                ..Default::default()
            },
        );
        assert!(matches!(bad, Err(Error::InvalidInput(_))));
        let missing = link_thoughts(
            &m.conn,
            &EdgeInput {
                source_id: ids[0].clone(),
                target_id: "nope".into(),
                edge_type: "cites".into(),
                ..Default::default()
            },
        );
        assert!(matches!(missing, Err(Error::NotFound(_))));
        let meta: Map<String, serde_json::Value> =
            serde_json::from_str(r#"{"claim":"x"}"#).unwrap();
        let eid = link_thoughts(
            &m.conn,
            &EdgeInput {
                source_id: ids[1].clone(),
                target_id: ids[0].clone(),
                edge_type: "refuted_by".into(),
                metadata: Some(meta.clone()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            get_edge(&m.conn, &eid).unwrap().unwrap().metadata,
            Some(meta)
        );
        assert_eq!(
            get_edges_between(&m.conn, &ids[1], &ids[0]).unwrap().len(),
            1
        );
        crate::thoughts::delete_thought(&m.conn, &ids[0]).unwrap();
        let n: i64 = m
            .conn
            .query_row("SELECT COUNT(*) FROM edges", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "FK cascade removed both edges");
    }

    #[test]
    fn traversal_depth_types_and_expiry() {
        let m = Memory::open_in_memory().unwrap();
        let ids = chain(&m, 4); // 0->1->2->3
        let nodes = traverse_graph(&m.conn, &ids[0], 2, None, false).unwrap();
        assert_eq!(nodes.len(), 3);
        assert_eq!(nodes[0].depth, 0);
        assert_eq!(nodes[2].depth, 2);
        assert_eq!(
            traverse_graph(&m.conn, &ids[0], 10, None, false)
                .unwrap()
                .len(),
            4,
            "clamped to 5, reaches all"
        );
        assert!(
            traverse_graph(&m.conn, "missing", 1, None, false)
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            traverse_graph(&m.conn, &ids[0], 3, Some(&["cites".to_string()]), false)
                .unwrap()
                .len(),
            1
        );
        // expire the 1->2 edge: traversal stops unless include_expired
        let e = get_edges_between(&m.conn, &ids[1], &ids[2])
            .unwrap()
            .remove(0);
        expire_edge(&m.conn, &e.id, Some("2000-01-01T00:00:00.000Z")).unwrap();
        assert_eq!(
            traverse_graph(&m.conn, &ids[0], 5, None, false)
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            traverse_graph(&m.conn, &ids[0], 5, None, true)
                .unwrap()
                .len(),
            4
        );
        assert!(matches!(
            expire_edge(&m.conn, "nope", None),
            Err(Error::NotFound(_))
        ));
        // incoming direction from the tail
        let conns = get_connections(&m.conn, &ids[3], None).unwrap();
        assert_eq!(conns.len(), 1);
        assert_eq!(conns[0].direction, Direction::Incoming);
        let related = fetch_graph_related(&m.conn, &[ids[3].clone()], 1).unwrap();
        assert_eq!(related.len(), 1);
        assert_eq!(related[0].id, ids[2]);
        assert!(
            fetch_graph_related(&m.conn, &[ids[3].clone()], 0)
                .unwrap()
                .is_empty()
        );
        assert!(unlink_thoughts(&m.conn, &ids[2], &ids[3], "follows").unwrap());
        assert!(!unlink_thoughts(&m.conn, &ids[2], &ids[3], "follows").unwrap());
    }
}
