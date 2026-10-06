//! Importing: copy into the library, hash for de-duplication, make thumbnails.
//! File work runs in parallel without touching the DB; rows are written
//! afterwards in a single transaction.

use crate::db::{self, NewItem};
use crate::library::Library;
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader};
use rayon::prelude::*;
use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use walkdir::WalkDir;

pub const SUPPORTED_EXTS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp"];
const THUMB_MAX: u32 = 512;

pub enum Source {
    Path(PathBuf),
    Bytes { name: String, data: Vec<u8> },
}

impl Source {
    fn label(&self) -> String {
        match self {
            Source::Path(p) => p.display().to_string(),
            Source::Bytes { name, .. } => name.clone(),
        }
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub imported: usize,
    pub duplicates: usize,
    pub failed: Vec<String>,
}

fn ext_of(name: &str) -> Option<String> {
    let ext = Path::new(name).extension()?.to_str()?.to_ascii_lowercase();
    SUPPORTED_EXTS.contains(&ext.as_str()).then_some(ext)
}

/// Expands dropped paths: directories are walked recursively, hidden and
/// unsupported files are skipped.
pub fn collect_files(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for p in paths {
        if p.is_dir() {
            for e in WalkDir::new(p)
                .into_iter()
                .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'))
                .filter_map(Result::ok)
            {
                if e.file_type().is_file() && ext_of(&e.file_name().to_string_lossy()).is_some() {
                    out.push(e.into_path());
                }
            }
        } else if p.is_file() {
            if let Some(name) = p.file_name() {
                if ext_of(&name.to_string_lossy()).is_some() {
                    out.push(p.clone());
                }
            }
        }
    }
    out
}

enum Outcome {
    New(NewItem),
    Duplicate(String), // existing item id
    Failed(String),
}

/// Keeps file names portable across macOS and Windows.
fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.');
    if trimmed.is_empty() { "image".into() } else { trimmed.into() }
}

fn decode(bytes: &[u8]) -> image::ImageResult<DynamicImage> {
    let mut decoder = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()?
        .into_decoder()?;
    let orientation = decoder.orientation()?;
    let mut img = DynamicImage::from_decoder(decoder)?;
    img.apply_orientation(orientation);
    Ok(img)
}

/// Writes a JPEG thumbnail, or PNG when the image has real transparency.
/// Returns the thumbnail's file name.
fn write_thumb(img: &DynamicImage, dir: &Path, id: &str) -> Result<String, String> {
    let thumb = img.thumbnail(THUMB_MAX, THUMB_MAX);
    let transparent = thumb.color().has_alpha() && thumb.to_rgba8().pixels().any(|p| p[3] < 255);
    if transparent {
        let name = format!("{id}.png");
        thumb
            .save_with_format(dir.join(&name), ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        Ok(name)
    } else {
        let name = format!("{id}.jpg");
        let file = fs::File::create(dir.join(&name)).map_err(|e| e.to_string())?;
        JpegEncoder::new_with_quality(std::io::BufWriter::new(file), 85)
            .encode_image(&thumb.to_rgb8())
            .map_err(|e| e.to_string())?;
        Ok(name)
    }
}

fn process(
    src: &Source,
    root: &Path,
    known: &HashMap<String, String>,
    seen: &Mutex<HashSet<String>>,
) -> Result<Outcome, String> {
    let (name, data) = match src {
        Source::Path(p) => {
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            (name, fs::read(p).map_err(|e| e.to_string())?)
        }
        Source::Bytes { name, data } => (name.clone(), data.clone()),
    };
    let ext = ext_of(&name).ok_or("unsupported file type")?;
    let hash = hex::encode(Sha256::digest(&data));
    if let Some(existing) = known.get(&hash) {
        return Ok(Outcome::Duplicate(existing.clone()));
    }
    if !seen.lock().unwrap().insert(hash.clone()) {
        return Ok(Outcome::Duplicate(String::new())); // same file twice in this batch
    }

    let img = decode(&data).map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().simple().to_string();
    let file_name = sanitize(&name);
    let item_dir = root.join("images").join(&id);
    fs::create_dir_all(&item_dir).map_err(|e| e.to_string())?;
    fs::write(item_dir.join(&file_name), &data).map_err(|e| e.to_string())?;
    let thumb = match write_thumb(&img, &root.join("thumbs"), &id) {
        Ok(t) => t,
        Err(e) => {
            let _ = fs::remove_dir_all(&item_dir);
            return Err(e);
        }
    };

    Ok(Outcome::New(NewItem {
        id,
        name,
        file_name,
        ext,
        width: img.width(),
        height: img.height(),
        size: data.len() as i64,
        hash,
        thumb,
    }))
}

/// Runs the import. `lib` is locked only briefly at the start and end so the
/// UI stays responsive while files are processed.
pub fn run(
    lib: &Mutex<Option<Library>>,
    sources: Vec<Source>,
    folder_id: Option<String>,
    on_progress: impl Fn(usize, usize) + Sync,
) -> Result<ImportSummary, String> {
    let (root, known) = {
        let guard = lib.lock().unwrap();
        let l = guard.as_ref().ok_or("ライブラリが開かれていません")?;
        (l.root.clone(), db::hash_index(&l.conn).map_err(|e| e.to_string())?)
    };

    let total = sources.len();
    let done = AtomicUsize::new(0);
    let seen = Mutex::new(HashSet::new());
    on_progress(0, total);
    let outcomes: Vec<Outcome> = sources
        .par_iter()
        .map(|src| {
            let o = process(src, &root, &known, &seen)
                .unwrap_or_else(|e| Outcome::Failed(format!("{}: {e}", src.label())));
            on_progress(done.fetch_add(1, Ordering::Relaxed) + 1, total);
            o
        })
        .collect();

    let mut guard = lib.lock().unwrap();
    let l = guard.as_mut().ok_or("ライブラリが開かれていません")?;
    if l.root != root {
        return Err("インポート中にライブラリが切り替わりました".into());
    }
    commit(&mut l.conn, outcomes, folder_id.as_deref()).map_err(|e| e.to_string())
}

fn commit(
    conn: &mut Connection,
    outcomes: Vec<Outcome>,
    folder_id: Option<&str>,
) -> rusqlite::Result<ImportSummary> {
    let mut summary = ImportSummary::default();
    let mut touched: Vec<String> = Vec::new();
    let tx = conn.transaction()?;
    let base = db::now_ms();
    for (i, o) in outcomes.into_iter().enumerate() {
        match o {
            Outcome::New(item) => {
                // Offset by index so the import order is preserved when sorting.
                db::insert_item(&tx, &item, base + i as i64)?;
                touched.push(item.id);
                summary.imported += 1;
            }
            Outcome::Duplicate(id) => {
                if !id.is_empty() {
                    // Re-importing something from the trash brings it back.
                    db::restore_items(&tx, std::slice::from_ref(&id))?;
                    touched.push(id);
                }
                summary.duplicates += 1;
            }
            Outcome::Failed(msg) => summary.failed.push(msg),
        }
    }
    if let Some(f) = folder_id {
        db::add_to_folder(&tx, &touched, f)?;
    }
    tx.commit()?;
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage, Rgba, RgbaImage};

    fn setup() -> (tempfile::TempDir, Mutex<Option<Library>>) {
        let dir = tempfile::tempdir().unwrap();
        let lib = Library::create(&dir.path().join("Test.library")).unwrap();
        (dir, Mutex::new(Some(lib)))
    }

    fn png_bytes(img: DynamicImage) -> Vec<u8> {
        let mut buf = Cursor::new(Vec::new());
        img.write_to(&mut buf, ImageFormat::Png).unwrap();
        buf.into_inner()
    }

    #[test]
    fn imports_dedupes_and_thumbnails() {
        let (tmp, lib) = setup();
        let src_dir = tmp.path().join("src");
        fs::create_dir_all(src_dir.join("sub")).unwrap();
        fs::create_dir_all(src_dir.join(".hidden")).unwrap();
        RgbImage::from_pixel(1200, 600, Rgb([200, 10, 10])).save(src_dir.join("red.jpg")).unwrap();
        RgbaImage::from_pixel(64, 64, Rgba([0, 0, 255, 100])).save(src_dir.join("sub/clear.png")).unwrap();
        fs::copy(src_dir.join("red.jpg"), src_dir.join("sub/red-copy.jpg")).unwrap();
        fs::write(src_dir.join("notes.txt"), "x").unwrap();
        fs::write(src_dir.join("broken.png"), "not an image").unwrap();
        fs::copy(src_dir.join("red.jpg"), src_dir.join(".hidden/x.jpg")).unwrap();

        let files = collect_files(std::slice::from_ref(&src_dir));
        assert_eq!(files.len(), 4, "{files:?}"); // txt and hidden dir skipped

        let folder = {
            let g = lib.lock().unwrap();
            db::create_folder(&g.as_ref().unwrap().conn, "F", None).unwrap()
        };
        let calls = AtomicUsize::new(0);
        let sum = run(
            &lib,
            files.into_iter().map(Source::Path).collect(),
            Some(folder.clone()),
            |_, _| {
                calls.fetch_add(1, Ordering::Relaxed);
            },
        )
        .unwrap();
        assert_eq!(sum.imported, 2);
        assert_eq!(sum.duplicates, 1);
        assert_eq!(sum.failed.len(), 1);
        assert_eq!(calls.load(Ordering::Relaxed), 5);

        let g = lib.lock().unwrap();
        let l = g.as_ref().unwrap();
        let items = db::query_items(
            &l.conn,
            &db::ItemQuery {
                view: db::View::Folder { id: folder },
                search: String::new(),
                tag_ids: vec![],
                sort: db::SortKey::Name,
                desc: false,
            },
        )
        .unwrap();
        assert_eq!(items.len(), 2);
        let clear = &items[0];
        assert_eq!((clear.name.as_str(), clear.width), ("clear.png", 64));
        assert!(clear.thumb.ends_with(".png"), "transparent -> png thumb");
        let red = &items[1];
        assert_eq!((red.width, red.height), (1200, 600));
        assert!(red.thumb.ends_with(".jpg"));
        assert!(l.root.join("images").join(&red.id).join(&red.file_name).is_file());
        let t = image::open(l.root.join("thumbs").join(&red.thumb)).unwrap();
        assert_eq!((t.width(), t.height()), (512, 256));
    }

    #[test]
    fn reimport_restores_from_trash_and_bytes_source() {
        let (_tmp, lib) = setup();
        let data = png_bytes(DynamicImage::ImageRgb8(RgbImage::new(8, 8)));
        let src = || vec![Source::Bytes { name: "paste.png".into(), data: data.clone() }];
        assert_eq!(run(&lib, src(), None, |_, _| {}).unwrap().imported, 1);

        let id = {
            let g = lib.lock().unwrap();
            let conn = &g.as_ref().unwrap().conn;
            let id = db::hash_index(conn).unwrap().into_values().next().unwrap();
            db::trash_items(conn, std::slice::from_ref(&id)).unwrap();
            id
        };
        let sum = run(&lib, src(), None, |_, _| {}).unwrap();
        assert_eq!((sum.imported, sum.duplicates), (0, 1));
        let g = lib.lock().unwrap();
        let conn = &g.as_ref().unwrap().conn;
        assert!(db::trashed_ids(conn).unwrap().is_empty());
        assert_eq!(db::get_items(conn, &[id]).unwrap().len(), 1);
    }

    #[test]
    fn sanitize_names() {
        assert_eq!(sanitize("a/b:c?.png"), "a_b_c_.png");
        assert_eq!(sanitize(" ..."), "image");
    }
}
