//! Windows: better thumbnails for office documents, made in the background.
//! At import they get the picture kept inside the file or the type card
//! (making a PDF takes Office a few seconds per document); afterwards each
//! document without a PDF preview is converted by Office (win_office.rs),
//! the PDF is kept for the viewer (preview.rs) and its first page becomes the
//! thumbnail. The list is told with the `file-thumbs` event.
//!
//! Started when a library opens and after imports (`prepare_file_thumbs`);
//! one pass at a time, documents that failed aren't tried again this session.
//! A thumbnail made from the PDF is named `<id>_p.*`, which marks the
//! document as done (its PDF may also have been made earlier by the viewer).

use super::{preview, win_office, win_pdf};
use crate::commands::AppState;
use crate::db;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

static RUNNING: AtomicBool = AtomicBool::new(false);
/// Asked again while running: look for new documents once more at the end.
static AGAIN: AtomicBool = AtomicBool::new(false);
static FAILED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

pub fn start(app: AppHandle) {
    if RUNNING.swap(true, Ordering::SeqCst) {
        AGAIN.store(true, Ordering::SeqCst);
        return;
    }
    std::thread::spawn(move || {
        loop {
            AGAIN.store(false, Ordering::SeqCst);
            pass(&app);
            if !AGAIN.load(Ordering::SeqCst) {
                break;
            }
        }
        RUNNING.store(false, Ordering::SeqCst);
    });
}

fn failed(id: &str) -> bool {
    FAILED.lock().unwrap().as_ref().is_some_and(|f| f.contains(id))
}

/// Converts the documents of the open library whose thumbnail isn't from their PDF yet.
fn pass(app: &AppHandle) {
    let state = app.state::<AppState>();
    let todo = {
        let guard = state.lib.lock().unwrap();
        let Some(lib) = guard.as_ref() else { return };
        let Ok(files) = db::files_of_types(&lib.conn, win_office::EXTS) else { return };
        files
            .into_iter()
            .filter(|(id, _, _, thumb)| !from_pdf(thumb) && !failed(id))
            .map(|(id, ext, file_name, thumb)| {
                let path = lib.root.join("images").join(&id).join(&file_name);
                (lib.root.clone(), id, ext, path, thumb)
            })
            .collect::<Vec<_>>()
    };
    for (root, id, ext, path, old_thumb) in todo {
        if !win_office::may_convert(&ext) {
            continue;
        }
        // Without holding the library: converting takes seconds.
        let thumb = preview::pdf(&root.join("previews"), &id, &path, &ext).and_then(|pdf| first_page(&root, &id, &pdf));
        let Some(thumb) = thumb else {
            FAILED.lock().unwrap().get_or_insert_with(HashSet::new).insert(id);
            continue;
        };
        let guard = state.lib.lock().unwrap();
        // Another library was opened meanwhile: its documents get their own pass.
        let Some(lib) = guard.as_ref().filter(|l| l.root == root) else {
            let _ = std::fs::remove_file(root.join("thumbs").join(&thumb));
            return;
        };
        if db::set_thumb(&lib.conn, &id, &thumb).is_ok() && old_thumb != thumb {
            let _ = std::fs::remove_file(root.join("thumbs").join(&old_thumb));
        }
        drop(guard);
        let _ = app.emit("file-thumbs", &id);
    }
}

fn from_pdf(thumb: &str) -> bool {
    thumb.rsplit_once('.').is_some_and(|(stem, _)| stem.ends_with("_p"))
}

/// Writes the first page of `pdf` as item `id`'s thumbnail; returns its file
/// name. A new name, so the list doesn't show the old one from its cache.
fn first_page(root: &PathBuf, id: &str, pdf: &std::path::Path) -> Option<String> {
    let png = win_pdf::render_pdf_page(pdf, crate::import::THUMB_MAX).ok()?;
    let img = image::load_from_memory(&png).ok()?;
    crate::import::write_thumb(&img, &root.join("thumbs"), &format!("{id}_p")).ok()
}
