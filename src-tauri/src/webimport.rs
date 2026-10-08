//! Saving from the browser: a small HTTP server on 127.0.0.1 that the Chrome
//! extension in `extension/` talks to. It runs only while the app is open and
//! the user has turned it on.
//!
//! - Listens on the loopback interface only, on a fixed port the extension knows.
//! - Every request must carry `Authorization: Bearer <token>`; the token is
//!   made by the app and handed to the extension in its `config.json`.
//! - Requests from web pages are refused: an `Origin` other than an extension's,
//!   or a `Host` other than 127.0.0.1 / localhost (DNS rebinding).
//!
//! The extension downloads images itself (with the browser's cookies and
//! proxy settings) and sends the bytes, so the app never fetches URLs.
//!
//!   GET  /info     app version and the open library's name
//!   GET  /folders  [{ id, name, parentId }] in sidebar order
//!   GET  /tags     tag names
//!   POST /import?name=&folder=&tag=&tag=&page=   body = the file

use crate::db;
use crate::formats;
use crate::import::{self, ImportSummary, Source};
use crate::library::Library;
use serde::Serialize;
use serde_json::{json, Value};
use std::io::Read;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

pub const PORT: u16 = 41620;
const MAX_BODY: u64 = 300 * 1024 * 1024;

/// What the server needs from the app (a trait so tests can run without Tauri).
pub trait Host: Send + Sync + 'static {
    fn library(&self) -> &Mutex<Option<Library>>;
    /// Called after every import that went through, to refresh the UI.
    fn imported(&self, summary: &ImportSummary);
}

pub struct Server {
    http: Arc<tiny_http::Server>,
    thread: Option<JoinHandle<()>>,
    port: u16,
}

impl Server {
    /// Starts listening on `127.0.0.1:port` (0 = any free port, for tests).
    pub fn start(port: u16, token: String, host: Arc<dyn Host>) -> Result<Self, String> {
        let http = tiny_http::Server::http(("127.0.0.1", port)).map_err(|e| {
            format!("127.0.0.1:{port} で待ち受けできませんでした（ほかのアプリが使用中の可能性があります）: {e}")
        })?;
        let http = Arc::new(http);
        let port = http.server_addr().to_ip().map(|a| a.port()).unwrap_or(port);
        let token = Arc::new(token);
        let server = http.clone();
        let thread = std::thread::spawn(move || {
            for req in server.incoming_requests() {
                let (token, host) = (token.clone(), host.clone());
                // Imports can take a while; don't hold up other requests.
                std::thread::spawn(move || serve(req, port, &token, &*host));
            }
        });
        Ok(Self { http, thread: Some(thread), port })
    }

    pub fn port(&self) -> u16 {
        self.port
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.http.unblock();
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn serve(mut req: tiny_http::Request, port: u16, token: &str, host: &dyn Host) {
    let header = |name: &'static str| {
        req.headers()
            .iter()
            .find(|h| h.field.equiv(name))
            .map(|h| h.value.as_str().to_string())
    };
    let head = Head {
        method: req.method().as_str().to_ascii_uppercase(),
        url: req.url().to_string(),
        host: header("Host"),
        origin: header("Origin"),
        auth: header("Authorization"),
        length: req.body_length().map(|n| n as u64),
    };
    let (status, body) = handle(&head, req.as_reader(), port, token, host);
    let response = tiny_http::Response::from_string(body.to_string())
        .with_status_code(status)
        .with_header(tiny_http::Header::from_bytes("Content-Type", "application/json; charset=utf-8").unwrap())
        .with_header(tiny_http::Header::from_bytes("Cache-Control", "no-store").unwrap());
    let _ = req.respond(response);
}

struct Head {
    method: String,
    url: String,
    host: Option<String>,
    origin: Option<String>,
    auth: Option<String>,
    length: Option<u64>,
}

fn error(status: u16, message: &str) -> (u16, Value) {
    (status, json!({ "error": message }))
}

/// Compares without stopping at the first difference.
fn same_secret(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn handle(head: &Head, body: &mut dyn Read, port: u16, token: &str, host: &dyn Host) -> (u16, Value) {
    let allowed_hosts = [format!("127.0.0.1:{port}"), format!("localhost:{port}")];
    if !head.host.as_ref().is_some_and(|h| allowed_hosts.iter().any(|a| a.eq_ignore_ascii_case(h))) {
        return error(403, "許可されていない接続です");
    }
    if head.origin.as_ref().is_some_and(|o| !o.starts_with("chrome-extension://")) {
        return error(403, "ブラウザ拡張以外からの接続は受け付けません");
    }
    let given = head.auth.as_deref().and_then(|a| a.strip_prefix("Bearer ")).unwrap_or("");
    if token.is_empty() || !same_secret(given.trim(), token) {
        return error(401, "接続キーが一致しません。アプリの「ブラウザ拡張と連携」で拡張機能を用意し直してください");
    }

    let (path, query) = head.url.split_once('?').unwrap_or((&head.url, ""));
    let params = parse_query(query);
    let param = |k: &str| params.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str()).filter(|v| !v.is_empty());

    let lib = host.library();
    let with_lib = |f: &dyn Fn(&mut Library) -> Result<Value, String>| -> (u16, Value) {
        let mut guard = lib.lock().unwrap();
        match guard.as_mut() {
            None => error(503, "アプリでライブラリが開かれていません"),
            Some(l) => match f(l) {
                Ok(v) => (200, v),
                Err(e) => error(500, &e),
            },
        }
    };

    match (head.method.as_str(), path) {
        ("GET", "/info") => {
            let name = lib.lock().unwrap().as_ref().map(|l| {
                l.root.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
            });
            (200, json!({ "app": "image-library", "version": env!("CARGO_PKG_VERSION"), "library": name }))
        }
        ("GET", "/folders") => with_lib(&|l| {
            #[derive(Serialize)]
            #[serde(rename_all = "camelCase")]
            struct F {
                id: String,
                name: String,
                parent_id: Option<String>,
            }
            let folders = db::list_folders(&l.conn).map_err(|e| e.to_string())?;
            let out: Vec<F> = folders
                .into_iter()
                .map(|f| F { id: f.id, name: f.name, parent_id: f.parent_id })
                .collect();
            Ok(json!(out))
        }),
        ("GET", "/tags") => with_lib(&|l| {
            let tags = db::list_tags(&l.conn).map_err(|e| e.to_string())?;
            Ok(json!(tags.into_iter().map(|t| t.name).collect::<Vec<_>>()))
        }),
        ("POST", "/import") => {
            if head.length.is_some_and(|n| n > MAX_BODY) {
                return error(413, "ファイルが大きすぎます");
            }
            let mut data = Vec::new();
            if let Err(e) = body.take(MAX_BODY + 1).read_to_end(&mut data) {
                return error(400, &e.to_string());
            }
            if data.len() as u64 > MAX_BODY {
                return error(413, "ファイルが大きすぎます");
            }
            if data.is_empty() {
                return error(400, "データが空です");
            }
            let tags: Vec<String> = params
                .iter()
                .filter(|(k, v)| k == "tag" && !v.trim().is_empty())
                .map(|(_, v)| v.trim().to_string())
                .collect();
            import_one(
                host,
                param("name").unwrap_or("image"),
                data,
                param("folder"),
                &tags,
                param("page").filter(|p| p.starts_with("http://") || p.starts_with("https://")),
            )
        }
        (_, "/info" | "/folders" | "/tags" | "/import") => error(405, "このメソッドは使えません"),
        _ => error(404, "見つかりません"),
    }
}

fn import_one(
    host: &dyn Host,
    name: &str,
    data: Vec<u8>,
    folder: Option<&str>,
    tags: &[String],
    page: Option<&str>,
) -> (u16, Value) {
    let lib = host.library();
    if let Some(f) = folder {
        let guard = lib.lock().unwrap();
        let Some(l) = guard.as_ref() else { return error(503, "アプリでライブラリが開かれていません") };
        match db::list_folders(&l.conn) {
            Ok(all) if all.iter().any(|x| x.id == f) => {}
            Ok(_) => return error(400, "保存先のフォルダが見つかりません。拡張機能で選び直してください"),
            Err(e) => return error(500, &e.to_string()),
        }
    }
    let name = formats::name_for_content(name, &data);
    let summary = match import::run(lib, vec![Source::Bytes { name, data }], folder.map(str::to_owned), |_, _| {}) {
        Ok(s) => s,
        Err(e) => return error(503, &e),
    };
    if summary.ids.is_empty() {
        let reason = summary.failed.first().map(String::as_str).unwrap_or("読み込めませんでした");
        return error(422, reason);
    }
    {
        let mut guard = lib.lock().unwrap();
        if let Some(l) = guard.as_mut() {
            let result = db::add_tags(&mut l.conn, &summary.ids, tags)
                .and_then(|_| page.map_or(Ok(()), |p| db::set_source_url(&l.conn, &summary.ids, p)));
            if let Err(e) = result {
                host.imported(&summary);
                return error(500, &e.to_string());
            }
        }
    }
    host.imported(&summary);
    (200, json!({ "imported": summary.imported, "duplicates": summary.duplicates, "id": summary.ids[0] }))
}

/// `a=1&b=x%20y` -> [("a", "1"), ("b", "x y")]. `+` is a space (URLSearchParams).
fn parse_query(q: &str) -> Vec<(String, String)> {
    q.split('&')
        .filter(|s| !s.is_empty())
        .map(|pair| {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            let dec = |s: &str| crate::commands::percent_decode(&s.replace('+', " "));
            (dec(k), dec(v))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, RgbImage};
    use std::io::{Cursor, Write};
    use std::net::TcpStream;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct TestHost {
        lib: Mutex<Option<Library>>,
        imports: AtomicUsize,
    }

    impl Host for TestHost {
        fn library(&self) -> &Mutex<Option<Library>> {
            &self.lib
        }
        fn imported(&self, _: &ImportSummary) {
            self.imports.fetch_add(1, Ordering::Relaxed);
        }
    }

    const TOKEN: &str = "secret-token";

    fn setup() -> (tempfile::TempDir, Arc<TestHost>, Server) {
        let dir = tempfile::tempdir().unwrap();
        let lib = Library::create(&dir.path().join("Web.library")).unwrap();
        let host = Arc::new(TestHost { lib: Mutex::new(Some(lib)), imports: AtomicUsize::new(0) });
        let server = Server::start(0, TOKEN.into(), host.clone()).unwrap();
        (dir, host, server)
    }

    /// Sends a raw HTTP/1.1 request; returns the status and the JSON body.
    fn call(port: u16, method: &str, path: &str, headers: &[(&str, &str)], body: &[u8]) -> (u16, Value) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let mut req = format!("{method} {path} HTTP/1.1\r\nConnection: close\r\nContent-Length: {}\r\n", body.len());
        for (k, v) in headers {
            req.push_str(&format!("{k}: {v}\r\n"));
        }
        req.push_str("\r\n");
        s.write_all(req.as_bytes()).unwrap();
        s.write_all(body).unwrap();
        let mut out = Vec::new();
        s.read_to_end(&mut out).unwrap();
        let text = String::from_utf8_lossy(&out);
        let status = text.split(' ').nth(1).unwrap().parse().unwrap();
        let json = text.split_once("\r\n\r\n").map(|(_, b)| serde_json::from_str(b).unwrap_or(Value::Null)).unwrap();
        (status, json)
    }

    fn png() -> Vec<u8> {
        let mut buf = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(RgbImage::from_pixel(40, 20, image::Rgb([9, 99, 199]))).write_to(&mut buf, image::ImageFormat::Png).unwrap();
        buf.into_inner()
    }

    #[test]
    fn refuses_web_pages_and_wrong_tokens() {
        let (_tmp, _host, server) = setup();
        let p = server.port();
        let host = format!("127.0.0.1:{p}");
        let auth = format!("Bearer {TOKEN}");
        let ok = [("Host", host.as_str()), ("Authorization", auth.as_str())];
        assert_eq!(call(p, "GET", "/info", &ok, b"").0, 200);
        assert_eq!(call(p, "GET", "/info", &[ok[0]], b"").0, 401, "no token");
        assert_eq!(call(p, "GET", "/info", &[ok[0], ("Authorization", "Bearer secret-tokeX")], b"").0, 401);
        // A page on another site (or a rebinding DNS name) can't reach it even with the token.
        assert_eq!(call(p, "GET", "/info", &[ok[0], ok[1], ("Origin", "https://evil.example")], b"").0, 403);
        assert_eq!(call(p, "GET", "/info", &[("Host", "evil.example"), ok[1]], b"").0, 403);
        let ext = [ok[0], ok[1], ("Origin", "chrome-extension://abcdefghijklmnop")];
        let (status, info) = call(p, "GET", "/info", &ext, b"");
        assert_eq!((status, info["library"].as_str()), (200, Some("Web")));
        let localhost = format!("localhost:{p}");
        assert_eq!(call(p, "GET", "/nope", &[("Host", &localhost), ok[1]], b"").0, 404);
        assert_eq!(call(p, "GET", "/import", &ok, b"").0, 405);
    }

    #[test]
    fn imports_with_folder_tags_and_page() {
        let (_tmp, host, server) = setup();
        let p = server.port();
        let h = format!("127.0.0.1:{p}");
        let auth = format!("Bearer {TOKEN}");
        let hd = [("Host", h.as_str()), ("Authorization", auth.as_str())];
        let folder = {
            let g = host.lib.lock().unwrap();
            db::create_folder(&g.as_ref().unwrap().conn, "Web 保存", None).unwrap()
        };
        let (status, folders) = call(p, "GET", "/folders", &hd, b"");
        assert_eq!((status, folders[0]["name"].as_str()), (200, Some("Web 保存")));

        // No extension in the name: it comes from the content.
        let path = format!(
            "/import?name=%E5%86%99%E7%9C%9F&folder={folder}&tag=%E5%8F%82%E8%80%83&tag=web+design&page=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1"
        );
        let (status, res) = call(p, "POST", &path, &hd, &png());
        assert_eq!(status, 200, "{res}");
        assert_eq!(res["imported"], 1);
        assert_eq!(host.imports.load(Ordering::Relaxed), 1);

        let (_, tags) = call(p, "GET", "/tags", &hd, b"");
        let mut tags: Vec<&str> = tags.as_array().unwrap().iter().filter_map(Value::as_str).collect();
        tags.sort();
        assert_eq!(tags, ["web design", "参考"]);
        {
            let g = host.lib.lock().unwrap();
            let conn = &g.as_ref().unwrap().conn;
            let it = db::get_items(conn, &[res["id"].as_str().unwrap().to_string()]).unwrap().remove(0);
            assert_eq!((it.name.as_str(), it.ext.as_str(), it.width), ("写真.png", "png", 40));
            assert_eq!(it.folder_id.as_deref(), Some(folder.as_str()));
            assert_eq!(it.tag_ids.len(), 2);
            assert_eq!(it.source_url.as_deref(), Some("https://example.com/a?b=1"));
        }

        // Saving it again from another page: a duplicate, the first page stays,
        // new tags are still added.
        let (status, res2) = call(p, "POST", "/import?name=x.png&tag=again&page=https%3A%2F%2Fother.example%2F", &hd, &png());
        assert_eq!((status, res2["duplicates"].as_u64(), res2["id"].clone()), (200, Some(1), res["id"].clone()));
        let g = host.lib.lock().unwrap();
        let conn = &g.as_ref().unwrap().conn;
        let it = db::get_items(conn, &[res["id"].as_str().unwrap().to_string()]).unwrap().remove(0);
        assert_eq!(it.source_url.as_deref(), Some("https://example.com/a?b=1"));
        assert_eq!(it.tag_ids.len(), 3);
    }

    #[test]
    fn reports_bad_input() {
        let (_tmp, host, server) = setup();
        let p = server.port();
        let h = format!("127.0.0.1:{p}");
        let auth = format!("Bearer {TOKEN}");
        let hd = [("Host", h.as_str()), ("Authorization", auth.as_str())];
        assert_eq!(call(p, "POST", "/import?name=a.png", &hd, b"").0, 400, "empty body");
        let (status, res) = call(p, "POST", "/import?name=page.html", &hd, b"<html></html>");
        assert_eq!(status, 422);
        assert!(res["error"].as_str().unwrap().contains("page.html"), "{res}");
        assert_eq!(call(p, "POST", "/import?name=a.png&folder=gone", &hd, &png()).0, 400);
        // A javascript: or file: "page" is not stored.
        let (status, res) = call(p, "POST", "/import?name=a.png&page=javascript%3Aalert(1)", &hd, &png());
        assert_eq!(status, 200);
        {
            let g = host.lib.lock().unwrap();
            let it = db::get_items(&g.as_ref().unwrap().conn, &[res["id"].as_str().unwrap().into()]).unwrap().remove(0);
            assert_eq!(it.source_url, None);
        }
        *host.lib.lock().unwrap() = None;
        assert_eq!(call(p, "GET", "/folders", &hd, b"").0, 503);
        assert_eq!(call(p, "POST", "/import?name=a.png", &hd, &png()).0, 503);
    }

    #[test]
    fn stops_listening_when_dropped() {
        let (_tmp, _host, server) = setup();
        let p = server.port();
        drop(server);
        assert!(TcpStream::connect(("127.0.0.1", p)).is_err());
    }

    #[test]
    fn query_decoding() {
        assert_eq!(
            parse_query("a=1&b=x+y%2Bz&c&tag=%E7%94%BB"),
            [("a", "1"), ("b", "x y+z"), ("c", ""), ("tag", "画")]
                .map(|(k, v)| (k.to_string(), v.to_string()))
        );
    }
}
