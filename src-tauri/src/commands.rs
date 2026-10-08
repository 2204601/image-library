//! Commands invoked from the frontend. All return `Result<_, String>` so
//! errors surface as rejected promises in JS.

use crate::db::{self, Counts, Folder, Item, ItemQuery, SelectionInfo, Tag};
use crate::import::{self, ImportSummary, Source};
use crate::library::Library;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub type CmdResult<T> = Result<T, String>;

#[derive(Default)]
pub struct AppState {
    pub lib: Mutex<Option<Library>>,
}

fn err(e: impl ToString) -> String {
    e.to_string()
}

fn with_lib<T>(state: &AppState, f: impl FnOnce(&mut Library) -> CmdResult<T>) -> CmdResult<T> {
    let mut guard = state.lib.lock().unwrap();
    let lib = guard.as_mut().ok_or("ライブラリが開かれていません")?;
    f(lib)
}

// ------------------------------------------------------------- settings

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    last_library: Option<PathBuf>,
}

fn settings_path(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(app.path().app_config_dir().map_err(err)?.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, s: &Settings) -> CmdResult<()> {
    let path = settings_path(app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    fs::write(path, serde_json::to_vec_pretty(s).map_err(err)?).map_err(err)
}

// -------------------------------------------------------------- library

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    root: String,
    name: String,
}

fn activate(app: &AppHandle, state: &AppState, lib: Library) -> CmdResult<LibraryInfo> {
    app.asset_protocol_scope()
        .allow_directory(&lib.root, true)
        .map_err(err)?;
    let info = LibraryInfo {
        root: lib.root.display().to_string(),
        name: lib
            .root
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default(),
    };
    save_settings(app, &Settings { last_library: Some(lib.root.clone()) })?;
    *state.lib.lock().unwrap() = Some(lib);
    Ok(info)
}

/// Re-opens the library used last time, if it still exists.
#[tauri::command]
pub fn open_last_library(app: AppHandle, state: State<AppState>) -> CmdResult<Option<LibraryInfo>> {
    match load_settings(&app).last_library {
        Some(p) => match Library::open(&p) {
            Ok(lib) => activate(&app, &state, lib).map(Some),
            Err(_) => Ok(None),
        },
        None => Ok(None),
    }
}

#[tauri::command]
pub fn create_library(app: AppHandle, state: State<AppState>, path: PathBuf) -> CmdResult<LibraryInfo> {
    let path = if path.extension().is_some_and(|e| e == "library") {
        path
    } else {
        path.with_extension("library")
    };
    activate(&app, &state, Library::create(&path)?)
}

#[tauri::command]
pub fn open_library(app: AppHandle, state: State<AppState>, path: PathBuf) -> CmdResult<LibraryInfo> {
    activate(&app, &state, Library::open(&path)?)
}

// ---------------------------------------------------------------- items

/// Item plus absolute paths for display (built in Rust so separators are
/// correct on Windows).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemView {
    #[serde(flatten)]
    item: Item,
    file_path: String,
    thumb_path: String,
    /// What the viewer shows (a JPEG copy for HEIC / TIFF).
    display_path: String,
}

#[tauri::command]
pub fn query_items(state: State<AppState>, query: ItemQuery) -> CmdResult<Vec<ItemView>> {
    with_lib(&state, |lib| {
        let items = db::query_items(&lib.conn, &query).map_err(err)?;
        Ok(items
            .into_iter()
            .map(|item| ItemView {
                file_path: lib.file_path(&item).display().to_string(),
                thumb_path: lib.thumb_path(&item).display().to_string(),
                display_path: lib.display_path(&item).display().to_string(),
                item,
            })
            .collect())
    })
}

#[tauri::command]
pub fn get_counts(state: State<AppState>) -> CmdResult<Counts> {
    with_lib(&state, |lib| db::counts(&lib.conn).map_err(err))
}

#[tauri::command]
pub fn selection_info(state: State<AppState>, ids: Vec<String>) -> CmdResult<SelectionInfo> {
    with_lib(&state, |lib| db::selection_info(&lib.conn, &ids).map_err(err))
}

#[tauri::command]
pub fn set_note(state: State<AppState>, id: String, note: String) -> CmdResult<()> {
    with_lib(&state, |lib| db::set_note(&lib.conn, &id, &note).map_err(err))
}

#[tauri::command]
pub fn rename_item(state: State<AppState>, id: String, name: String) -> CmdResult<()> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(());
    }
    with_lib(&state, |lib| db::rename_item(&lib.conn, &id, name).map_err(err))
}

#[tauri::command]
pub fn trash_items(state: State<AppState>, ids: Vec<String>) -> CmdResult<()> {
    with_lib(&state, |lib| db::trash_items(&lib.conn, &ids).map_err(err))
}

/// Marks the images as "not duplicates" so they aren't proposed together again.
#[tauri::command]
pub fn dismiss_duplicates(state: State<AppState>, ids: Vec<String>) -> CmdResult<()> {
    with_lib(&state, |lib| db::dismiss_duplicates(&mut lib.conn, &ids).map_err(err))
}

#[tauri::command]
pub fn undismiss_duplicates(state: State<AppState>, ids: Vec<String>) -> CmdResult<()> {
    with_lib(&state, |lib| db::undismiss_duplicates(&lib.conn, &ids).map_err(err))
}

#[tauri::command]
pub fn clear_dismissed_duplicates(state: State<AppState>) -> CmdResult<()> {
    with_lib(&state, |lib| db::clear_dismissed_duplicates(&lib.conn).map_err(err))
}

/// How many dismissed groups are in effect.
#[tauri::command]
pub fn count_dismissed_duplicates(state: State<AppState>) -> CmdResult<usize> {
    with_lib(&state, |lib| db::dismissed_duplicate_groups(&lib.conn).map_err(err))
}

/// What tidying these groups would carry over to the copies kept.
#[tauri::command]
pub fn preview_duplicates(
    state: State<AppState>,
    groups: Vec<db::DuplicateGroup>,
) -> CmdResult<Vec<db::DuplicateEffect>> {
    with_lib(&state, |lib| db::plan_duplicates(&lib.conn, &groups).map_err(err))
}

#[tauri::command]
pub fn resolve_duplicates(
    state: State<AppState>,
    groups: Vec<db::DuplicateGroup>,
) -> CmdResult<Vec<db::DuplicateEffect>> {
    with_lib(&state, |lib| db::resolve_duplicates(&mut lib.conn, &groups).map_err(err))
}

#[tauri::command]
pub fn restore_items(state: State<AppState>, ids: Vec<String>) -> CmdResult<()> {
    with_lib(&state, |lib| db::restore_items(&lib.conn, &ids).map_err(err))
}

#[tauri::command]
pub fn delete_items(state: State<AppState>, ids: Vec<String>) -> CmdResult<()> {
    with_lib(&state, |lib| lib.delete_items(&ids))
}

#[tauri::command]
pub fn empty_trash(state: State<AppState>) -> CmdResult<()> {
    with_lib(&state, |lib| {
        let ids = db::trashed_ids(&lib.conn).map_err(err)?;
        lib.delete_items(&ids)
    })
}

fn item_paths(state: &AppState, ids: &[String]) -> CmdResult<Vec<(Item, PathBuf)>> {
    with_lib(state, |lib| {
        let mut items = db::get_items(&lib.conn, ids).map_err(err)?;
        // Keep the caller's order (e.g. grid order).
        items.sort_by_key(|it| ids.iter().position(|x| *x == it.id));
        Ok(items
            .into_iter()
            .map(|it| {
                let p = lib.file_path(&it);
                (it, p)
            })
            .collect())
    })
}

#[tauri::command]
pub fn reveal_item(state: State<AppState>, id: String) -> CmdResult<()> {
    let (_, path) = item_paths(&state, &[id])?.pop().ok_or("画像が見つかりません")?;
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(err)
}

/// Opens items in the OS default app.
#[tauri::command]
pub fn open_items(state: State<AppState>, ids: Vec<String>) -> CmdResult<()> {
    for (_, path) in item_paths(&state, &ids)? {
        tauri_plugin_opener::open_path(path, None::<&str>).map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_rating(state: State<AppState>, ids: Vec<String>, rating: u8) -> CmdResult<()> {
    with_lib(&state, |lib| db::set_rating(&lib.conn, &ids, rating).map_err(err))
}

#[tauri::command]
pub fn set_favorite(state: State<AppState>, ids: Vec<String>, on: bool) -> CmdResult<()> {
    with_lib(&state, |lib| db::set_favorite(&lib.conn, &ids, on).map_err(err))
}

/// Pins the items to the top of every list, or unpins them.
#[tauri::command]
pub fn set_pinned(state: State<AppState>, ids: Vec<String>, on: bool) -> CmdResult<()> {
    with_lib(&state, |lib| db::set_pinned(&lib.conn, &ids, on).map_err(err))
}

/// Rotates / flips without touching the files (see orient.rs). Runs off the
/// main thread because thumbnails are re-rendered. Returns how many changed.
#[tauri::command]
pub async fn orient_items(app: AppHandle, ids: Vec<String>, op: crate::orient::OrientOp) -> CmdResult<usize> {
    tauri::async_runtime::spawn_blocking(move || {
        with_lib(&app.state::<AppState>(), |lib| import::orient(lib, &ids, op))
    })
    .await
    .map_err(err)?
}

/// The font file of a font item, unpacked (WOFF / WOFF2) and, for a
/// collection, cut down to one font.
fn font_sfnt(state: &AppState, id: &str) -> CmdResult<Vec<u8>> {
    let (item, path) = item_paths(state, &[id.to_string()])?.pop().ok_or("フォントが見つかりません")?;
    if item.kind != db::Kind::Font {
        return Err("フォントではありません".into());
    }
    crate::fonts::to_sfnt(&fs::read(path).map_err(err)?, &item.ext)
}

/// Names of every font in the file and the characters of font `face`.
#[tauri::command]
pub async fn font_info(app: AppHandle, id: String, face: u32) -> CmdResult<crate::fonts::FontInfo> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::fonts::info(&font_sfnt(&app.state::<AppState>(), &id)?, face)
    })
    .await
    .map_err(err)?
}

/// Font `face` as plain OpenType data, for `new FontFace()` in the viewer
/// (web views can't load one font out of a collection).
#[tauri::command]
pub async fn font_data(app: AppHandle, id: String, face: u32) -> CmdResult<tauri::ipc::Response> {
    tauri::async_runtime::spawn_blocking(move || {
        let sfnt = font_sfnt(&app.state::<AppState>(), &id)?;
        Ok(tauri::ipc::Response::new(crate::fonts::extract_face(&sfnt, face)?))
    })
    .await
    .map_err(err)?
}

/// Puts the files on the clipboard (paste into Finder / Explorer / chat apps).
/// A single image is also put on as bitmap data for design tools.
#[tauri::command]
pub fn copy_items(state: State<AppState>, ids: Vec<String>) -> CmdResult<usize> {
    use clipboard_rs::{common::RustImage, Clipboard, ClipboardContent, ClipboardContext, RustImageData};
    let paths: Vec<String> = item_paths(&state, &ids)?
        .into_iter()
        .map(|(_, p)| p.display().to_string())
        .collect();
    if paths.is_empty() {
        return Ok(0);
    }
    let ctx = ClipboardContext::new().map_err(err)?;
    let mut contents = vec![ClipboardContent::Files(paths.clone())];
    if paths.len() == 1 {
        if let Ok(img) = RustImageData::from_path(&paths[0]) {
            contents.push(ClipboardContent::Image(img));
        }
    }
    ctx.set(contents).map_err(err)?;
    Ok(paths.len())
}

/// Copies the original files into `dest`, never overwriting existing files.
#[tauri::command]
pub fn export_items(state: State<AppState>, ids: Vec<String>, dest: PathBuf) -> CmdResult<usize> {
    let items = item_paths(&state, &ids)?;
    for (item, src) in &items {
        let target = export_target(&dest, &item.name, &item.ext);
        fs::copy(src, target).map_err(err)?;
    }
    Ok(items.len())
}

/// `dest/name.ext`, or `name (2).ext`… when taken. Keeps a renamed item's
/// display name but makes sure the extension is there.
fn export_target(dest: &std::path::Path, name: &str, ext: &str) -> PathBuf {
    let has_ext = std::path::Path::new(name)
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case(ext));
    let stem = if has_ext { &name[..name.len() - ext.len() - 1] } else { name };
    let clean: String = stem
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
    let mut candidate = dest.join(format!("{clean}.{ext}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dest.join(format!("{clean} ({n}).{ext}"));
        n += 1;
    }
    candidate
}

// --------------------------------------------------------------- import

#[derive(Clone, Serialize)]
struct Progress {
    done: usize,
    total: usize,
}

fn emit_progress(app: &AppHandle) -> impl Fn(usize, usize) + Sync + '_ {
    move |done, total| {
        let _ = app.emit("import-progress", Progress { done, total });
    }
}

#[tauri::command]
pub async fn import_paths(
    app: AppHandle,
    paths: Vec<PathBuf>,
    folder_id: Option<String>,
) -> CmdResult<ImportSummary> {
    tauri::async_runtime::spawn_blocking(move || {
        let files = import::collect_files(&paths);
        let state = app.state::<AppState>();
        import::run(
            &state.lib,
            files,
            folder_id,
            emit_progress(&app),
        )
    })
    .await
    .map_err(err)?
}

/// Prepares the similar-images view: hashes items that predate the feature.
/// Returns how many were hashed.
#[tauri::command]
pub async fn index_similar(app: AppHandle) -> CmdResult<usize> {
    tauri::async_runtime::spawn_blocking(move || {
        import::compute_missing_phashes(&app.state::<AppState>().lib)
    })
    .await
    .map_err(err)?
}

/// Imports raw image bytes (clipboard paste). The file name and target
/// folder are passed as headers so the body can stay binary.
#[tauri::command]
pub async fn import_bytes(app: AppHandle, request: tauri::ipc::Request<'_>) -> CmdResult<ImportSummary> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("バイナリデータが必要です".into());
    };
    let header = |k: &str| {
        request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .map(percent_decode)
    };
    let name = header("x-name").unwrap_or_else(|| "pasted.png".into());
    let folder_id = header("x-folder").filter(|s| !s.is_empty());
    let data = data.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        import::run(&state.lib, vec![Source::Bytes { name, data }], folder_id, emit_progress(&app))
    })
    .await
    .map_err(err)?
}

/// Headers are ASCII-only, so the frontend sends `encodeURIComponent` values.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The proxy the OS uses for `url` (PAC included), for the updater: its
/// HTTP client can't run PAC scripts. None = connect directly.
#[tauri::command]
pub async fn system_proxy(url: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || crate::proxy::for_url(&url)).await.ok().flatten()
}

#[tauri::command]
pub fn supported_exts() -> Vec<&'static str> {
    import::SUPPORTED_EXTS.to_vec()
}

// -------------------------------------------------------------- folders

#[tauri::command]
pub fn list_folders(state: State<AppState>) -> CmdResult<Vec<Folder>> {
    with_lib(&state, |lib| db::list_folders(&lib.conn).map_err(err))
}

#[tauri::command]
pub fn create_folder(state: State<AppState>, name: String, parent_id: Option<String>) -> CmdResult<String> {
    with_lib(&state, |lib| {
        db::create_folder(&lib.conn, name.trim(), parent_id.as_deref()).map_err(err)
    })
}

#[tauri::command]
pub fn rename_folder(state: State<AppState>, id: String, name: String) -> CmdResult<()> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(());
    }
    with_lib(&state, |lib| db::rename_folder(&lib.conn, &id, name).map_err(err))
}

#[tauri::command]
pub fn delete_folder(state: State<AppState>, id: String) -> CmdResult<()> {
    with_lib(&state, |lib| db::delete_folder(&lib.conn, &id).map_err(err))
}

#[tauri::command]
pub fn move_folder(state: State<AppState>, id: String, parent_id: Option<String>) -> CmdResult<bool> {
    with_lib(&state, |lib| db::move_folder(&mut lib.conn, &id, parent_id.as_deref()).map_err(err))
}

#[tauri::command]
pub fn move_to_folder(state: State<AppState>, ids: Vec<String>, folder_id: String) -> CmdResult<()> {
    with_lib(&state, |lib| db::move_to_folder(&lib.conn, &ids, &folder_id).map_err(err))
}

/// Drops a folder under `parent_id`, in front of sibling `before` (None = last).
#[tauri::command]
pub fn place_folder(
    state: State<AppState>,
    id: String,
    parent_id: Option<String>,
    before: Option<String>,
) -> CmdResult<bool> {
    with_lib(&state, |lib| {
        db::place_folder(&mut lib.conn, &id, parent_id.as_deref(), before.as_deref()).map_err(err)
    })
}

/// -1 / +1 = up / down one, i32::MIN / i32::MAX = to the top / bottom.
#[tauri::command]
pub fn shift_folder(state: State<AppState>, id: String, by: i32) -> CmdResult<()> {
    with_lib(&state, |lib| db::shift_folder(&mut lib.conn, &id, by).map_err(err))
}

#[tauri::command]
pub fn sort_folders_by_name(state: State<AppState>, parent_id: Option<String>) -> CmdResult<()> {
    with_lib(&state, |lib| db::sort_folders_by_name(&mut lib.conn, parent_id.as_deref()).map_err(err))
}

// -------------------------------------------------------- smart folders

#[tauri::command]
pub fn list_smart_folders(state: State<AppState>) -> CmdResult<Vec<db::SmartFolder>> {
    with_lib(&state, |lib| db::list_smart_folders(&lib.conn).map_err(err))
}

#[tauri::command]
pub fn create_smart_folder(state: State<AppState>, name: String, rule: db::Rule) -> CmdResult<String> {
    with_lib(&state, |lib| db::create_smart_folder(&lib.conn, name.trim(), &rule).map_err(err))
}

#[tauri::command]
pub fn update_smart_folder(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    rule: Option<db::Rule>,
) -> CmdResult<()> {
    let name = name.map(|n| n.trim().to_owned()).filter(|n| !n.is_empty());
    with_lib(&state, |lib| {
        db::update_smart_folder(&lib.conn, &id, name.as_deref(), rule.as_ref()).map_err(err)
    })
}

#[tauri::command]
pub fn delete_smart_folder(state: State<AppState>, id: String) -> CmdResult<()> {
    with_lib(&state, |lib| db::delete_smart_folder(&lib.conn, &id).map_err(err))
}

#[tauri::command]
pub fn list_exts(state: State<AppState>) -> CmdResult<Vec<(String, i64)>> {
    with_lib(&state, |lib| db::list_exts(&lib.conn).map_err(err))
}

#[tauri::command]
pub fn reorder_in_folder(
    state: State<AppState>,
    folder_id: String,
    ids: Vec<String>,
    before: Option<String>,
) -> CmdResult<()> {
    with_lib(&state, |lib| {
        db::reorder_in_folder(&mut lib.conn, &folder_id, &ids, before.as_deref()).map_err(err)
    })
}

#[tauri::command]
pub fn remove_from_folder(state: State<AppState>, ids: Vec<String>, folder_id: String) -> CmdResult<()> {
    with_lib(&state, |lib| db::remove_from_folder(&lib.conn, &ids, &folder_id).map_err(err))
}

// ----------------------------------------------------------------- tags

#[tauri::command]
pub fn list_tags(state: State<AppState>) -> CmdResult<Vec<Tag>> {
    with_lib(&state, |lib| db::list_tags(&lib.conn).map_err(err))
}

#[tauri::command]
pub fn add_tags(state: State<AppState>, ids: Vec<String>, names: Vec<String>) -> CmdResult<()> {
    with_lib(&state, |lib| db::add_tags(&mut lib.conn, &ids, &names).map_err(err))
}

#[tauri::command]
pub fn remove_tag(state: State<AppState>, ids: Vec<String>, tag_id: i64) -> CmdResult<()> {
    with_lib(&state, |lib| db::remove_tag(&lib.conn, &ids, tag_id).map_err(err))
}

#[tauri::command]
pub fn rename_tag(state: State<AppState>, id: i64, name: String) -> CmdResult<()> {
    with_lib(&state, |lib| db::rename_tag(&mut lib.conn, id, &name).map_err(err))
}

#[tauri::command]
pub fn set_folder_color(state: State<AppState>, id: String, color: Option<String>) -> CmdResult<()> {
    with_lib(&state, |lib| {
        db::set_color(&lib.conn, db::ColorTarget::Folder, &id, color.as_deref()).map_err(err)
    })
}

#[tauri::command]
pub fn set_smart_folder_color(state: State<AppState>, id: String, color: Option<String>) -> CmdResult<()> {
    with_lib(&state, |lib| {
        db::set_color(&lib.conn, db::ColorTarget::SmartFolder, &id, color.as_deref()).map_err(err)
    })
}

#[tauri::command]
pub fn set_tag_color(state: State<AppState>, id: i64, color: Option<String>) -> CmdResult<()> {
    with_lib(&state, |lib| {
        db::set_color(&lib.conn, db::ColorTarget::Tag, &id, color.as_deref()).map_err(err)
    })
}

#[tauri::command]
pub fn delete_tag(state: State<AppState>, id: i64) -> CmdResult<()> {
    with_lib(&state, |lib| db::delete_tag(&lib.conn, id).map_err(err))
}

#[cfg(test)]
mod tests {
    #[test]
    fn export_names() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        assert_eq!(super::export_target(d, "cat.PNG", "png"), d.join("cat.png"));
        assert_eq!(super::export_target(d, "renamed", "jpg"), d.join("renamed.jpg"));
        assert_eq!(super::export_target(d, "a/b:c", "jpg"), d.join("a_b_c.jpg"));
        std::fs::write(d.join("cat.png"), "x").unwrap();
        std::fs::write(d.join("cat (2).png"), "x").unwrap();
        assert_eq!(super::export_target(d, "cat.png", "png"), d.join("cat (3).png"));
    }

    #[test]
    fn percent_decode_utf8() {
        assert_eq!(super::percent_decode("%E7%94%BB%E5%83%8F.png"), "画像.png");
        assert_eq!(super::percent_decode("a%2"), "a%2");
    }
}
