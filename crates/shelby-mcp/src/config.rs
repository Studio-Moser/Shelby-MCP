//! CLI flags and environment, mirroring the TypeScript `config.ts` so existing
//! launch configs (`SHELBY_DB_PATH`, `--db`, `--transport http`, `PORT`, `HOST`,
//! `SHELBY_API_KEY`) keep working unchanged.
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    Stdio,
    Http,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ServeConfig {
    pub db_path: String,
    pub verbose: bool,
    pub transport: Transport,
    pub http_port: u16,
    pub http_host: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Cli {
    Serve(ServeConfig),
    Version,
    Help,
    NotPorted(String),
}

pub const HELP: &str = "shelby-mcp — Knowledge-graph memory for AI tools

Usage:
  shelby-mcp                   Start the MCP server (stdio)
  shelby-mcp --transport http  Start the streamable HTTP server (default 0.0.0.0:3100/mcp)
  shelby-mcp help              Show this help

Flags:
  --db <path>        Database path (default: ~/.shelbymcp/memory.db; env SHELBY_DB_PATH)
  --transport <t>    stdio | http (env SHELBY_TRANSPORT)
  --port <n>         HTTP port (env PORT, default 3100)
  --host <h>         HTTP bind host (env HOST; default 0.0.0.0 for http)
  --verbose          Enable verbose logging
  --version          Print version

Environment:
  SHELBY_API_KEY     Bearer token required on /mcp when set

Not yet ported from `npx shelbymcp`: setup, uninstall, protocol, forage, onboard, migrate, repair-projects.
";

pub fn default_db_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default()
        .join(".shelbymcp")
}

pub fn default_db_path() -> String {
    default_db_dir()
        .join("memory.db")
        .to_string_lossy()
        .into_owned()
}

fn resolve(p: &str) -> String {
    if p == ":memory:" {
        return p.to_string();
    }
    shelby_memory::projects::canonical_path(p)
        .to_string_lossy()
        .into_owned()
}

pub fn parse_args(argv: Vec<String>) -> Result<Cli, String> {
    parse_with_env(argv, &|k| std::env::var(k).ok())
}

pub fn parse_with_env(
    argv: Vec<String>,
    env: &dyn Fn(&str) -> Option<String>,
) -> Result<Cli, String> {
    match argv.first().map(String::as_str) {
        Some("help") | Some("--help") | Some("-h") => return Ok(Cli::Help),
        Some(
            cmd @ ("setup" | "uninstall" | "protocol" | "forage" | "onboard" | "migrate"
            | "repair-projects"),
        ) => return Ok(Cli::NotPorted(cmd.to_string())),
        _ => {}
    }
    let env_transport = env("SHELBY_TRANSPORT");
    let mut cfg = ServeConfig {
        db_path: env("SHELBY_DB_PATH")
            .map(|p| resolve(&p))
            .unwrap_or_else(default_db_path),
        verbose: false,
        transport: if env_transport.as_deref() == Some("http") {
            Transport::Http
        } else {
            Transport::Stdio
        },
        http_port: env("PORT").and_then(|p| p.parse().ok()).unwrap_or(3100),
        http_host: env("HOST").unwrap_or_else(|| "127.0.0.1".into()),
        api_key: env("SHELBY_API_KEY"),
    };
    let mut explicit_host = false;
    let mut i = 0;
    while i < argv.len() {
        match argv[i].as_str() {
            "--db" => {
                i += 1;
                cfg.db_path = argv
                    .get(i)
                    .map(|p| resolve(p))
                    .unwrap_or_else(default_db_path);
            }
            "--verbose" => cfg.verbose = true,
            "--log-file" => i += 1, // accepted for compatibility; logs go to stderr
            "--transport" => {
                i += 1;
                cfg.transport = match argv.get(i).map(String::as_str) {
                    Some("stdio") => Transport::Stdio,
                    Some("http") => Transport::Http,
                    other => {
                        return Err(format!(
                            "Invalid transport {:?}. Use \"stdio\" or \"http\".",
                            other.unwrap_or("")
                        ));
                    }
                };
            }
            "--port" => {
                i += 1;
                cfg.http_port = argv.get(i).and_then(|p| p.parse().ok()).unwrap_or(3100);
            }
            "--host" => {
                i += 1;
                cfg.http_host = argv.get(i).cloned().unwrap_or_else(|| "127.0.0.1".into());
                explicit_host = true;
            }
            "--version" => return Ok(Cli::Version),
            _ => {}
        }
        i += 1;
    }
    if cfg.transport == Transport::Http && env("HOST").is_none() && !explicit_host {
        cfg.http_host = "0.0.0.0".into();
    }
    Ok(Cli::Serve(cfg))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn defaults_and_flags() {
        let Cli::Serve(c) = parse_with_env(vec![], &no_env).unwrap() else {
            panic!()
        };
        assert!(c.db_path.ends_with(".shelbymcp/memory.db"));
        assert_eq!(
            (c.transport, c.http_port, c.http_host.as_str()),
            (Transport::Stdio, 3100, "127.0.0.1")
        );
        let Cli::Serve(c) = parse_with_env(
            vec![
                "--transport".into(),
                "http".into(),
                "--port".into(),
                "4000".into(),
                "--db".into(),
                "/tmp/x.db".into(),
            ],
            &no_env,
        )
        .unwrap() else {
            panic!()
        };
        assert_eq!(
            (
                c.transport,
                c.http_port,
                c.http_host.as_str(),
                c.db_path.as_str()
            ),
            (Transport::Http, 4000, "0.0.0.0", "/tmp/x.db")
        );
        assert!(
            parse_with_env(vec!["--transport".into(), "carrier-pigeon".into()], &no_env).is_err()
        );
        assert_eq!(
            parse_with_env(vec!["--version".into()], &no_env).unwrap(),
            Cli::Version
        );
        assert_eq!(
            parse_with_env(vec!["setup".into(), "claude-code".into()], &no_env).unwrap(),
            Cli::NotPorted("setup".into())
        );
    }

    #[test]
    fn env_provides_defaults_and_flags_override() {
        let env = |k: &str| match k {
            "SHELBY_TRANSPORT" => Some("http".to_string()),
            "HOST" => Some("10.0.0.5".to_string()),
            "SHELBY_API_KEY" => Some("k".to_string()),
            _ => None,
        };
        let Cli::Serve(c) = parse_with_env(vec![], &env).unwrap() else {
            panic!()
        };
        assert_eq!(
            (c.transport, c.http_host.as_str(), c.api_key.as_deref()),
            (Transport::Http, "10.0.0.5", Some("k"))
        );
        let Cli::Serve(c) =
            parse_with_env(vec!["--host".into(), "127.0.0.1".into()], &env).unwrap()
        else {
            panic!()
        };
        assert_eq!(c.http_host, "127.0.0.1");
    }
}
