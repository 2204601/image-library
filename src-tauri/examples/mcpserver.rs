//! Runs the MCP server (mcp/) against a library without the app, for trying
//! it from Claude Code. Prints the command that connects Claude Code to it.
//!   cargo run --example mcpserver -- <path/to/X.library> [port]
//! (another port leaves a running app alone)
use image_library_lib::changes::Change;
use image_library_lib::library::Library;
use image_library_lib::mcp::{Host, Server, PORT};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

struct Print(Mutex<Option<Library>>);

impl Host for Print {
    fn library(&self) -> &Mutex<Option<Library>> {
        &self.0
    }
    fn changed(&self, c: &Change) {
        println!("change {}: {}", c.id, c.summary);
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let root = PathBuf::from(args.next().expect("usage: mcpserver <library> [port]"));
    let port: u16 = args.next().map(|p| p.parse().expect("port")).unwrap_or(PORT);
    let token = format!("dev-{}", std::process::id());

    let host = Arc::new(Print(Mutex::new(Some(Library::create(&root).unwrap()))));
    let _server = Server::start(port, token.clone(), host).unwrap();
    println!("listening on 127.0.0.1:{port}");
    println!(
        "claude mcp add --transport http image-library-dev http://127.0.0.1:{port}/mcp --header \"Authorization: Bearer {token}\""
    );
    loop {
        std::thread::park();
    }
}
