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
    /// `dirs` is the folder path to file it under, relative to the import
    /// target (e.g. `["Trip", "Day1"]` for `Trip/Day1/x.jpg` from a dropped `Trip`).
    Path { path: PathBuf, dirs: Vec<String> },
    Bytes { name: String, data: Vec<u8> },
}

impl Source {
    pub fn file(path: impl Into<PathBuf>) -> Self {
        Source::Path { path: path.into(), dirs: vec![] }
    }

    fn label(&self) -> String {
        match self {
            Source::Path { path, .. } => path.display().to_string(),
            Source::Bytes { name, .. } => name.clone(),
        }
    }

    fn dirs(&self) -> &[String] {
        match self {
            Source::Path { dirs, .. } => dirs,
            Source::Bytes { .. } => &[],
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

/// Expands dropped paths. Directories are walked recursively and keep their
/// structure as folders (the dropped directory itself becomes a folder);
/// hidden and unsupported files are skipped.
pub fn collect_files(paths: &[PathBuf]) -> Vec<Source> {
    let mut out = Vec::new();
    for p in paths {
        if p.is_dir() {
            let base = p.parent().unwrap_or(p);
            for e in WalkDir::new(p)
                .into_iter()
                .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'))
                .filter_map(Result::ok)
            {
                if e.file_type().is_file() && ext_of(&e.file_name().to_string_lossy()).is_some() {
                    let dirs = e
                        .path()
                        .parent()
                        .and_then(|d| d.strip_prefix(base).ok())
                        .map(|rel| {
                            rel.components()
                                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                                .collect()
                        })
                        .unwrap_or_default();
                    out.push(Source::Path { path: e.into_path(), dirs });
                }
            }
        } else if p.is_file() {
            if let Some(name) = p.file_name() {
                if ext_of(&name.to_string_lossy()).is_some() {
                    out.push(Source::file(p.clone()));
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
        Source::Path { path, .. } => {
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            (name, fs::read(path).map_err(|e| e.to_string())?)
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
    let outcomes: Vec<(Outcome, Vec<String>)> = sources
        .par_iter()
        .map(|src| {
            let o = process(src, &root, &known, &seen)
                .unwrap_or_else(|e| Outcome::Failed(format!("{}: {e}", src.label())));
            on_progress(done.fetch_add(1, Ordering::Relaxed) + 1, total);
            (o, src.dirs().to_vec())
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
    outcomes: Vec<(Outcome, Vec<String>)>,
    folder_id: Option<&str>,
) -> rusqlite::Result<ImportSummary> {
    let mut summary = ImportSummary::default();
    // Target folder (None = unfiled) -> item ids, in import order.
    let mut placed: Vec<(Option<String>, Vec<String>)> = Vec::new();
    let mut folder_cache: HashMap<Vec<String>, String> = HashMap::new();
    let tx = conn.transaction()?;
    let base = db::now_ms();
    for (i, (o, dirs)) in outcomes.into_iter().enumerate() {
        let id = match o {
            Outcome::New(item) => {
                // Offset by index so the import order is preserved when sorting.
                db::insert_item(&tx, &item, base + i as i64)?;
                summary.imported += 1;
                item.id
            }
            Outcome::Duplicate(id) => {
                summary.duplicates += 1;
                if id.is_empty() {
                    continue;
                }
                // Re-importing something from the trash brings it back.
                db::restore_items(&tx, std::slice::from_ref(&id))?;
                id
            }
            Outcome::Failed(msg) => {
                summary.failed.push(msg);
                continue;
            }
        };
        // Recreate the source directory structure under the target folder.
        let mut folder = folder_id.map(str::to_owned);
        for depth in 1..=dirs.len() {
            let key = dirs[..depth].to_vec();
            let next = match folder_cache.get(&key) {
                Some(f) => f.clone(),
                None => {
                    let f = db::find_or_create_folder(&tx, folder.as_deref(), &dirs[depth - 1])?;
                    folder_cache.insert(key, f.clone());
                    f
                }
            };
            folder = Some(next);
        }
        match placed.iter_mut().find(|(f, _)| *f == folder) {
            Some((_, ids)) => ids.push(id),
            None => placed.push((folder, vec![id])),
        }
    }
    for (folder, ids) in &placed {
        if let Some(f) = folder {
            db::add_to_folder(&tx, ids, f)?;
        }
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
        fs::copy(src_dir.join("red.jpg"), src_dir.join("red-copy.jpg")).unwrap(); // same dir, so placement is deterministic
        fs::write(src_dir.join("notes.txt"), "x").unwrap();
        fs::write(src_dir.join("broken.png"), "not an image").unwrap();
        fs::copy(src_dir.join("red.jpg"), src_dir.join(".hidden/x.jpg")).unwrap();

        let files = collect_files(std::slice::from_ref(&src_dir));
        assert_eq!(files.len(), 4); // txt and hidden dir skipped
        let mut dirs: Vec<Vec<String>> = files.iter().map(|f| f.dirs().to_vec()).collect();
        dirs.sort();
        assert_eq!(dirs[0], ["src"]);
        assert_eq!(dirs[3], ["src", "sub"]);

        let target = {
            let g = lib.lock().unwrap();
            db::create_folder(&g.as_ref().unwrap().conn, "F", None).unwrap()
        };
        let calls = AtomicUsize::new(0);
        let sum = run(&lib, files, Some(target.clone()), |_, _| {
            calls.fetch_add(1, Ordering::Relaxed);
        })
        .unwrap();
        assert_eq!(sum.imported, 2);
        assert_eq!(sum.duplicates, 1);
        assert_eq!(sum.failed.len(), 1);
        assert_eq!(calls.load(Ordering::Relaxed), 5);

        let g = lib.lock().unwrap();
        let l = g.as_ref().unwrap();
        // The dropped directory is recreated as F/src/sub.
        let folders = db::list_folders(&l.conn).unwrap();
        let src = folders.iter().find(|f| f.name == "src").unwrap();
        let sub = folders.iter().find(|f| f.name == "sub").unwrap();
        assert_eq!(src.parent_id.as_deref(), Some(target.as_str()));
        assert_eq!(sub.parent_id.as_deref(), Some(src.id.as_str()));
        assert_eq!((src.count, sub.count), (1, 1));

        let items = db::query_items(
            &l.conn,
            &db::ItemQuery {
                view: db::View::Folder { id: target },
                include_subfolders: true,
                sort: db::SortKey::Name,
                ..Default::default()
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
    fn reimporting_a_folder_reuses_its_folders() {
        let (tmp, lib) = setup();
        let dir = tmp.path().join("Trip");
        fs::create_dir_all(&dir).unwrap();
        RgbImage::from_pixel(4, 4, Rgb([1, 2, 3])).save(dir.join("a.png")).unwrap();
        run(&lib, collect_files(std::slice::from_ref(&dir)), None, |_, _| {}).unwrap();
        RgbImage::from_pixel(4, 4, Rgb([9, 9, 9])).save(dir.join("b.png")).unwrap();
        let sum = run(&lib, collect_files(std::slice::from_ref(&dir)), None, |_, _| {}).unwrap();
        assert_eq!((sum.imported, sum.duplicates), (1, 1));
        let g = lib.lock().unwrap();
        let folders = db::list_folders(&g.as_ref().unwrap().conn).unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].count, 2);
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
