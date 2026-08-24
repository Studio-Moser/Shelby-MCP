//! Drives the real binary over stdio with raw JSON-RPC, the way an MCP client would.
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

use serde_json::{Value, json};

struct Client {
    child: std::process::Child,
    reader: BufReader<std::process::ChildStdout>,
    next_id: i64,
}

impl Client {
    fn spawn() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_shelby-mcp"))
            .args(["--db", ":memory:"])
            .env("HOME", std::env::temp_dir())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn shelby-mcp");
        let reader = BufReader::new(child.stdout.take().unwrap());
        Self {
            child,
            reader,
            next_id: 1,
        }
    }

    fn notify(&mut self, method: &str, params: Value) {
        let msg = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        writeln!(self.child.stdin.as_mut().unwrap(), "{msg}").unwrap();
    }

    fn request(&mut self, method: &str, params: Value) -> Value {
        let id = self.next_id;
        self.next_id += 1;
        let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        writeln!(self.child.stdin.as_mut().unwrap(), "{msg}").unwrap();
        loop {
            let mut line = String::new();
            assert!(
                self.reader.read_line(&mut line).unwrap() > 0,
                "server closed stdout"
            );
            let v: Value = serde_json::from_str(line.trim()).unwrap();
            if v["id"] == id {
                assert!(v.get("error").is_none(), "rpc error: {v}");
                return v["result"].clone();
            }
            if v.get("method").is_some() && v.get("id").is_some() {
                // server → client request (e.g. roots/list): answer with no roots
                let reply = json!({ "jsonrpc": "2.0", "id": v["id"], "result": { "roots": [] } });
                writeln!(self.child.stdin.as_mut().unwrap(), "{reply}").unwrap();
            }
        }
    }

    fn call(&mut self, name: &str, args: Value) -> (bool, Value) {
        let r = self.request("tools/call", json!({ "name": name, "arguments": args }));
        let text = r["content"][0]["text"].as_str().unwrap_or("{}");
        (
            r["isError"].as_bool().unwrap_or(false),
            serde_json::from_str(text).unwrap_or(Value::Null),
        )
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

#[test]
fn full_handshake_tools_prompts_and_scoped_capture() {
    let mut c = Client::spawn();
    let init = c.request("initialize", json!({ "protocolVersion": "2025-06-18", "capabilities": { "roots": { "listChanged": true } }, "clientInfo": { "name": "test", "version": "0" } }));
    assert_eq!(init["serverInfo"]["name"], "shelbymcp");
    assert!(
        init["capabilities"]["tools"].is_object() && init["capabilities"]["prompts"].is_object()
    );
    c.notify("notifications/initialized", json!({}));

    let tools = c.request("tools/list", json!({}));
    let mut names: Vec<&str> = tools["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    names.sort();
    assert_eq!(names.len(), 12);
    assert_eq!(names[0], "capture_thought");
    let capture = tools["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "capture_thought")
        .unwrap();
    assert_eq!(capture["annotations"]["readOnlyHint"], false);
    assert_eq!(capture["inputSchema"]["type"], "object");

    let prompts = c.request("prompts/list", json!({}));
    assert_eq!(prompts["prompts"].as_array().unwrap().len(), 3);
    let p = c.request("prompts/get", json!({ "name": "memory-protocol" }));
    assert!(
        p["messages"][0]["content"]["text"]
            .as_str()
            .unwrap()
            .contains("capture_thought")
    );

    let res = c.request("resources/read", json!({ "uri": "shelbymcp://status" }));
    assert!(
        res["contents"][0]["text"]
            .as_str()
            .unwrap()
            .contains("\"status\":\"ok\"")
    );

    // No roots → personal capture is rejected; shared capture succeeds; reads fail safe to shared-only.
    let (err, body) = c.call(
        "capture_thought",
        json!({ "content": "needs a project scope here" }),
    );
    assert!(err, "{body}");
    assert_eq!(body["error"], "project_scope_unresolved");
    let (err, body) = c.call("capture_thought", json!({ "content": "Prefer concise project context in briefs.", "summary": "Prefer concise project context.", "type": "decision", "visibility": "shared", "metadata": { "extra": { "briefEligible": true, "briefRole": "preference" } } }));
    assert!(!err, "{body}");
    assert_eq!(body["action"], "created");
    let (err, body) = c.call("get_brief", json!({}));
    assert!(!err, "{body}");
    assert_eq!(body["project_id"], Value::Null);
    assert_eq!(body["thought_count"], 1);
    assert!(
        body["brief"]
            .as_str()
            .unwrap()
            .contains("Prefer concise project context.")
    );
    let (err, body) = c.call("search_thoughts", json!({ "query": "concise" }));
    assert!(!err, "{body}");
    assert_eq!(body["total_count"], 1);
    let (_, stats) = c.call("thought_stats", json!({}));
    assert_eq!(stats["thought_count"], 1);
    let comp = c.request("completion/complete", json!({ "ref": { "type": "ref/prompt", "name": "memory-protocol" }, "argument": { "name": "type", "value": "de" } }));
    assert_eq!(comp["completion"]["values"], json!(["decision"]));
}
