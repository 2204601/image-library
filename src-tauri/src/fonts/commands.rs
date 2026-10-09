//! Font-only commands (the frontend's features/fonts/api.ts). The shared
//! item commands stay in crate::commands.

use crate::commands::{err, item_paths, with_lib, AppState, CmdResult};
use crate::db;
use crate::import;
use std::fs;
use tauri::{AppHandle, Manager, State};

/// The font file of a font item, unpacked (WOFF / WOFF2) and, for a
/// collection, cut down to one font.
fn font_sfnt(state: &AppState, id: &str) -> CmdResult<Vec<u8>> {
    let (item, path) = item_paths(state, &[id.to_string()])?.pop().ok_or("フォントが見つかりません")?;
    if item.kind != db::Kind::Font {
        return Err("フォントではありません".into());
    }
    super::to_sfnt(&fs::read(path).map_err(err)?, &item.ext)
}

/// Names of every font in the file and the characters of font `face`.
#[tauri::command]
pub async fn font_info(app: AppHandle, id: String, face: u32) -> CmdResult<super::FontInfo> {
    tauri::async_runtime::spawn_blocking(move || super::info(&font_sfnt(&app.state::<AppState>(), &id)?, face))
        .await
        .map_err(err)?
}

/// Names and details of every font in the file (the details panel).
#[tauri::command]
pub async fn font_faces(app: AppHandle, id: String) -> CmdResult<Vec<super::FaceInfo>> {
    tauri::async_runtime::spawn_blocking(move || super::faces(&font_sfnt(&app.state::<AppState>(), &id)?))
        .await
        .map_err(err)?
}

/// Sets the typeface style of fonts by hand (None = back to the guess).
#[tauri::command]
pub fn set_font_category(state: State<AppState>, ids: Vec<String>, category: Option<String>) -> CmdResult<usize> {
    if category.as_deref().is_some_and(|c| !super::CATEGORIES.contains(&c)) {
        return Err("書体の指定が正しくありません".into());
    }
    with_lib(&state, |lib| db::set_font_category(&lib.conn, &ids, category.as_deref()).map_err(err))
}

/// A sample line and the style of a font, for the list layout.
#[tauri::command]
pub async fn font_list_preview(app: AppHandle, id: String) -> CmdResult<super::ListPreview> {
    tauri::async_runtime::spawn_blocking(move || super::list_preview(&font_sfnt(&app.state::<AppState>(), &id)?))
        .await
        .map_err(err)?
}

/// Font `face` as plain OpenType data, for `new FontFace()` in the viewer
/// (web views can't load one font out of a collection).
#[tauri::command]
pub async fn font_data(app: AppHandle, id: String, face: u32) -> CmdResult<tauri::ipc::Response> {
    tauri::async_runtime::spawn_blocking(move || {
        let sfnt = font_sfnt(&app.state::<AppState>(), &id)?;
        Ok(tauri::ipc::Response::new(super::extract_face(&sfnt, face)?))
    })
    .await
    .map_err(err)?
}

/// Reads the family, writing system and style of fonts imported by versions
/// that didn't store them (grouping, search, filters). Returns how many were read.
#[tauri::command]
pub async fn index_fonts(app: AppHandle) -> CmdResult<usize> {
    tauri::async_runtime::spawn_blocking(move || import::compute_missing_font_meta(&app.state::<AppState>().lib))
        .await
        .map_err(err)?
}
