//! Runs the browser-extension server (webimport.rs) against a library without
//! the app, for working on the extension. Writes `config.json` into the
//! extension folder so the extension loaded from there connects; any other
//! copy that asks to connect ("アプリと接続") is let in without asking.
//!   cargo run --example webserver -- <path/to/X.library> [extension dir] [port]
//! (another port leaves a running app alone; the extension then needs the
//! config.json written here, which names the port)
use image_library_lib::import::ImportSummary;
use image_library_lib::library::Library;
use image_library_lib::webimport::{Host, Server, PORT};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

struct Print(Mutex<Option<Library>>);

impl Host for Print {
    fn library(&self) -> &Mutex<Option<Library>> {
        &self.0
    }
    fn imported(&self, s: &ImportSummary) {
        println!("imported {} / duplicates {} / failed {:?}", s.imported, s.duplicates, s.failed);
    }
    /// No one to ask here: connects every extension that asks.
    fn approve_pairing(&self, code: &str) -> bool {
        println!("pairing approved (code {code})");
        true
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let root = PathBuf::from(args.next().expect("usage: webserver <library> [extension dir] [port]"));
    let ext = args.next().map(PathBuf::from).unwrap_or_else(|| PathBuf::from("../extension"));
    let port: u16 = args.next().map(|p| p.parse().expect("port")).unwrap_or(PORT);
    let token = format!("dev-{}", std::process::id());
    let config = format!("{{ \"port\": {port}, \"token\": \"{token}\" }}\n");
    std::fs::write(ext.join("config.json"), config).expect("write config.json");

    let host = Arc::new(Print(Mutex::new(Some(Library::create(&root).unwrap()))));
    let _server = Server::start(port, token, host).unwrap();
    println!("listening on 127.0.0.1:{port} for {}", root.display());
    loop {
        std::thread::park();
    }
}
