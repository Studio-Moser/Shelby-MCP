pub mod commands;
pub mod config;
pub mod http;
pub mod oauth;
pub mod prompts;
pub mod schemas;
pub mod server;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn open_memory(path: &str) -> shelby_memory::Result<shelby_memory::Memory> {
    if path == ":memory:" {
        shelby_memory::Memory::open_in_memory()
    } else {
        shelby_memory::Memory::open(path)
    }
}
