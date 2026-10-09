//! File-only commands (the frontend's features/files/api.ts). The shared
//! item commands stay in crate::commands.

use super::preview::{self, Preview};
use crate::commands::{err, item_paths, with_lib, AppState, CmdResult};
use crate::db;
use tauri::{AppHandle, Manager};

/// The viewer's preview of a document other than a PDF (preview.rs), made
/// now if needed; None when this system can't make one.
#[tauri::command]
pub async fn file_preview(app: AppHandle, id: String) -> CmdResult<Option<Preview>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let (item, path) = item_paths(&state, &[id])?.pop().ok_or("ファイルが見つかりません")?;
        if item.kind != db::Kind::File || item.ext == "pdf" {
            return Ok(None);
        }
        let previews = with_lib(&state, |lib| Ok(lib.root.join("previews")))?;
        Ok(preview::get(&previews, &item.id, &path, &item.ext))
    })
    .await
    .map_err(err)?
}

/// Windows: starts making thumbnails of office documents with Office, in the
/// background (thumbs.rs). Does nothing elsewhere.
#[tauri::command]
pub fn prepare_file_thumbs(app: AppHandle) {
    #[cfg(windows)]
    super::thumbs::start(app);
    #[cfg(not(windows))]
    let _ = app;
}
