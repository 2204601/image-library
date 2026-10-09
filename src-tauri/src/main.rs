// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Started by Claude Desktop as its MCP server: relay to the running app (mcp/bridge.rs).
    if std::env::args().any(|a| a == "--mcp") {
        std::process::exit(image_library_lib::mcp::bridge::run());
    }
    image_library_lib::run()
}
