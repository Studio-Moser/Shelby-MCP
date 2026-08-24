//! `shelby-mcp`: the Shelby memory server binary (stdio by default, streamable HTTP optional).
mod config;
mod http;
mod prompts;
mod schemas;
mod server;

use std::sync::{Arc, Mutex};

use rmcp::ServiceExt;
use shelby_memory::Memory;

use crate::config::{Cli, parse_args};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[tokio::main]
async fn main() {
    let cli = match parse_args(std::env::args().skip(1).collect()) {
        Ok(cli) => cli,
        Err(msg) => {
            eprintln!("[ERROR] {msg}");
            std::process::exit(1);
        }
    };
    match cli {
        Cli::Version => println!("shelby-mcp v{VERSION}"),
        Cli::Help => print!("{}", config::HELP),
        Cli::NotPorted(cmd) => {
            eprintln!(
                "[ERROR] `{cmd}` is not available in shelby-mcp yet; use `npx shelbymcp {cmd}` for now."
            );
            std::process::exit(2);
        }
        Cli::Serve(cfg) => {
            if cfg.verbose {
                eprintln!("[INFO] Verbose mode enabled");
                eprintln!("[INFO] Database: {}", cfg.db_path);
            }
            let memory = match open_memory(&cfg.db_path) {
                Ok(m) => Arc::new(Mutex::new(m)),
                Err(e) => {
                    eprintln!("[FATAL] {e}");
                    std::process::exit(1);
                }
            };
            server::seed_registry(&memory);
            if cfg.transport == config::Transport::Http {
                if let Err(e) = http::serve(memory, &cfg).await {
                    eprintln!("[FATAL] {e}");
                    std::process::exit(1);
                }
                return;
            }
            let handler = server::ShelbyServer::new(memory);
            let service = match handler.serve(rmcp::transport::stdio()).await {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[FATAL] {e}");
                    std::process::exit(1);
                }
            };
            eprintln!("[INFO] shelby-mcp running on stdio");
            let _ = service.waiting().await;
        }
    }
}

fn open_memory(path: &str) -> shelby_memory::Result<Memory> {
    if path == ":memory:" {
        Memory::open_in_memory()
    } else {
        Memory::open(path)
    }
}
