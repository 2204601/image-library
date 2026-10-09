//! `image-library --mcp`: what Claude Desktop starts as its MCP server
//! (it only starts stdio servers from its local config). Reads JSON-RPC
//! messages from stdin, one per line, and answers on stdout.
//!
//! Tool calls are passed on to the running app's server (mod.rs) with the
//! token from the app's settings; everything else (initialize, tools/list)
//! is answered here, so Claude Desktop can start up while the app is closed
//! and is told to open it when a tool is used. Runs without Tauri.

use super::{respond, ToolOutput, PORT};
use serde_json::{json, Value};
use std::io::{BufRead, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::Duration;

/// `identifier` in tauri.conf.json: the app's settings live in a folder of that name.
const APP_ID: &str = "com.local.imagelibrary";

/// Runs until stdin closes; returns the exit code.
pub fn run() -> i32 {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(msg) if msg.get("method").and_then(Value::as_str) == Some("tools/call") => forward(&msg),
            Ok(msg) => respond(&msg, &|_, _| ToolOutput::error("このツールは使えません")),
            Err(_) => Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "JSON として読めません" } })),
        };
        if let Some(r) = reply {
            if writeln!(out, "{r}").and_then(|_| out.flush()).is_err() {
                break;
            }
        }
    }
    0
}

/// The app's settings folder (Tauri's `app_config_dir`).
fn config_dir() -> Option<PathBuf> {
    let home = || std::env::var_os("HOME").map(PathBuf::from);
    let base = if cfg!(target_os = "macos") {
        home()?.join("Library/Application Support")
    } else if cfg!(windows) {
        PathBuf::from(std::env::var_os("APPDATA")?)
    } else {
        std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| home().map(|h| h.join(".config")))?
    };
    Some(base.join(APP_ID))
}

/// The token, if the user has turned the server on.
fn token() -> Result<String, String> {
    let off = "Image Library で Claude との連携がオフになっています。アプリのライブラリメニュー →「Claude と連携…」でオンにしてください";
    let path = config_dir().ok_or(off)?.join("settings.json");
    let settings: Value = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).ok_or(off)?;
    let mcp = &settings["mcp"];
    match (mcp["enabled"].as_bool(), mcp["token"].as_str()) {
        (Some(true), Some(t)) if !t.is_empty() => Ok(t.to_string()),
        _ => Err(off.into()),
    }
}

/// A tool call answered with an error the user can act on.
fn tool_error(id: &Value, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": { "content": [{ "type": "text", "text": message }], "isError": true } })
}

fn forward(msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    let token = match token() {
        Ok(t) => t,
        Err(m) => return Some(tool_error(&id, &m)),
    };
    match post(&msg.to_string(), &token) {
        Ok((200, body)) => Some(serde_json::from_str(&body).unwrap_or_else(|_| tool_error(&id, "アプリからの応答を読めませんでした"))),
        Ok((202, _)) => None,
        Ok((401, _)) => Some(tool_error(
            &id,
            "Image Library に接続できませんでした（トークンが違います）。アプリを再起動してから、もう一度試してください",
        )),
        Ok((status, body)) => Some(tool_error(&id, &format!("Image Library がエラーを返しました（{status}）: {body}"))),
        Err(_) => Some(tool_error(&id, "Image Library が起動していません。アプリを開いてから、もう一度試してください")),
    }
}

/// POSTs `body` to the app's server; returns the status and the body.
fn post(body: &str, token: &str) -> std::io::Result<(u16, String)> {
    let mut s = TcpStream::connect_timeout(&([127, 0, 0, 1], PORT).into(), Duration::from_secs(3))?;
    // Rendering images can take a while.
    s.set_read_timeout(Some(Duration::from_secs(300)))?;
    let head = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nAuthorization: Bearer {token}\r\n\
         Content-Type: application/json\r\nAccept: application/json, text/event-stream\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    s.write_all(head.as_bytes())?;
    s.write_all(body.as_bytes())?;
    let mut raw = Vec::new();
    s.read_to_end(&mut raw)?;
    let bad = || std::io::Error::new(std::io::ErrorKind::InvalidData, "bad response");
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n").ok_or_else(bad)?;
    let head = String::from_utf8_lossy(&raw[..split]).to_string();
    let mut body = raw[split + 4..].to_vec();
    let status = head.split(' ').nth(1).and_then(|s| s.parse().ok()).ok_or_else(bad)?;
    if head.lines().any(|l| l.to_ascii_lowercase().starts_with("transfer-encoding:") && l.to_ascii_lowercase().contains("chunked")) {
        body = unchunk(&body).ok_or_else(bad)?;
    }
    Ok((status, String::from_utf8_lossy(&body).into_owned()))
}

/// Joins a chunked HTTP body.
fn unchunk(mut data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let end = data.windows(2).position(|w| w == b"\r\n")?;
        let size_line = std::str::from_utf8(&data[..end]).ok()?;
        let size = usize::from_str_radix(size_line.split(';').next()?.trim(), 16).ok()?;
        data = &data[end + 2..];
        if size == 0 {
            return Some(out);
        }
        out.extend_from_slice(data.get(..size)?);
        data = data.get(size + 2..)?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_chunks() {
        assert_eq!(unchunk(b"5\r\nhello\r\n6;x=1\r\n world\r\n0\r\n\r\n").unwrap(), b"hello world");
        assert!(unchunk(b"5\r\nhel").is_none());
    }

    #[test]
    fn answers_the_handshake_without_the_app() {
        let init = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18" } });
        let r = respond(&init, &|_, _| ToolOutput::error("x")).unwrap();
        assert_eq!(r["result"]["serverInfo"]["name"], "image-library");
        let list = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" });
        assert!(respond(&list, &|_, _| ToolOutput::error("x")).unwrap()["result"]["tools"].as_array().unwrap().len() > 5);
    }
}
