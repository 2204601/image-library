//! Importing: copy into the library, hash for de-duplication, make thumbnails.
//! File work runs in parallel without touching the DB; rows are written
//! afterwards in a single transaction.

use crate::db::{self, NewItem};
use crate::formats;
use crate::library::Library;
use crate::orient::{self, OrientOp, Orientation};
use crate::similar;
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageFormat};
use rayon::prelude::*;
use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use walkdir::WalkDir;

pub use formats::SUPPORTED_EXTS;
const THUMB_MAX: u32 = 512;
/// Longest side of display copies (see `formats::needs_preview`).
const PREVIEW_MAX: u32 = 4096;

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

fn write_jpeg(img: &DynamicImage, path: &Path, quality: u8) -> Result<(), String> {
    let file = fs::File::create(path).map_err(|e| e.to_string())?;
    JpegEncoder::new_with_quality(std::io::BufWriter::new(file), quality)
        .encode_image(&img.to_rgb8())
        .map_err(|e| e.to_string())
}

/// Writes a JPEG thumbnail, or PNG when the image has real transparency.
/// Returns the thumbnail's file name.
fn write_thumb(thumb: &DynamicImage, dir: &Path, id: &str) -> Result<String, String> {
    let transparent = thumb.color().has_alpha() && thumb.to_rgba8().pixels().any(|p| p[3] < 255);
    if transparent {
        let name = format!("{id}.png");
        thumb
            .save_with_format(dir.join(&name), ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        Ok(name)
    } else {
        let name = format!("{id}.jpg");
        write_jpeg(thumb, &dir.join(&name), 85)?;
        Ok(name)
    }
}

/// Rotates / flips items (see orient.rs): writes the thumbnail for the new
/// orientation from the unrotated one, then stores it. The unrotated
/// thumbnail is kept; the previous rotated one is removed. Returns how many
/// items changed.
pub fn orient(lib: &mut Library, ids: &[String], op: OrientOp) -> Result<usize, String> {
    let items = db::get_items(&lib.conn, ids).map_err(|e| e.to_string())?;
    let thumbs = lib.root.join("thumbs");
    let rendered: Vec<Result<(&db::Item, Orientation, String, (u32, u32)), String>> = items
        .par_iter()
        .filter_map(|it| {
            let from = Orientation::new(it.rotation, it.flipped);
            let to = from.then(op);
            (to != from).then_some((it, from, to))
        })
        .map(|(it, from, to)| {
            let base = orient::base_thumb(&it.thumb);
            let name = to.thumb_name(&base);
            if !to.is_identity() {
                let img = image::open(thumbs.join(&base)).map_err(|e| format!("{}: {e}", it.name))?;
                let out = to.apply(&img);
                let path = thumbs.join(&name);
                if name.ends_with(".png") {
                    out.save_with_format(&path, ImageFormat::Png).map_err(|e| e.to_string())?;
                } else {
                    write_jpeg(&out, &path, 85)?;
                }
            }
            // width / height are the displayed size: swap when going between upright and sideways.
            let size = if from.swaps_axes() != to.swaps_axes() { (it.height, it.width) } else { (it.width, it.height) };
            Ok((it, to, name, size))
        })
        .collect();

    let mut first_err = None;
    let mut stale = Vec::new();
    let tx = lib.conn.transaction().map_err(|e| e.to_string())?;
    let mut changed = 0;
    for r in rendered {
        match r {
            Ok((it, to, name, (w, h))) => {
                db::set_orientation(&tx, &it.id, to, w, h, &name).map_err(|e| e.to_string())?;
                if it.thumb != name && it.thumb != orient::base_thumb(&it.thumb) {
                    stale.push(thumbs.join(&it.thumb));
                }
                changed += 1;
            }
            Err(e) => {
                first_err.get_or_insert(e);
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    for p in stale {
        let _ = fs::remove_file(p);
    }
    match first_err {
        Some(e) if changed == 0 => Err(e),
        _ => Ok(changed),
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

    let decoded = formats::decode(&data, &ext)?;
    let img = decoded.image;
    let id = uuid::Uuid::new_v4().simple().to_string();
    let file_name = sanitize(&name);
    let item_dir = root.join("images").join(&id);
    fs::create_dir_all(&item_dir).map_err(|e| e.to_string())?;
    fs::write(item_dir.join(&file_name), &data).map_err(|e| e.to_string())?;
    // The perceptual hash comes from the thumbnail, like the backfill in
    // `compute_missing_phashes`, so old and new items hash the same way.
    let small = img.thumbnail(THUMB_MAX, THUMB_MAX);
    let phash = (similar::dhash(&small), similar::mean_color(&small));
    let thumb = match write_thumb(&small, &root.join("thumbs"), &id) {
        Ok(t) => t,
        Err(e) => {
            let _ = fs::remove_dir_all(&item_dir);
            return Err(e);
        }
    };
    // HEIC / TIFF: keep a JPEG the web view can always display.
    let preview = if formats::needs_preview(&ext) {
        let name = format!("{id}.jpg");
        let big = if img.width().max(img.height()) > PREVIEW_MAX {
            img.resize(PREVIEW_MAX, PREVIEW_MAX, image::imageops::FilterType::Lanczos3)
        } else {
            img.clone()
        };
        if let Err(e) = write_jpeg(&big, &root.join("previews").join(&name), 90) {
            let _ = fs::remove_dir_all(&item_dir);
            let _ = fs::remove_file(root.join("thumbs").join(&thumb));
            return Err(e);
        }
        Some(name)
    } else {
        None
    };

    Ok(Outcome::New(NewItem {
        id,
        name,
        file_name,
        ext,
        width: decoded.width,
        height: decoded.height,
        size: data.len() as i64,
        hash,
        thumb,
        phash: Some(phash),
        preview,
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

/// Computes perceptual hashes for items imported before they existed, from
/// their thumbnails. Like `run`, the library is locked only at the ends.
/// Returns how many were computed.
pub fn compute_missing_phashes(lib: &Mutex<Option<Library>>) -> Result<usize, String> {
    let (root, missing) = {
        let guard = lib.lock().unwrap();
        let l = guard.as_ref().ok_or("ライブラリが開かれていません")?;
        (l.root.clone(), db::missing_phashes(&l.conn).map_err(|e| e.to_string())?)
    };
    if missing.is_empty() {
        return Ok(0);
    }
    let hashes: Vec<(String, (u64, u32))> = missing
        .par_iter()
        .filter_map(|(id, thumb)| {
            let img = image::open(root.join("thumbs").join(thumb)).ok()?;
            Some((id.clone(), (similar::dhash(&img), similar::mean_color(&img))))
        })
        .collect();
    let mut guard = lib.lock().unwrap();
    let l = guard.as_mut().ok_or("ライブラリが開かれていません")?;
    if l.root != root {
        return Err("解析中にライブラリが切り替わりました".into());
    }
    db::set_phashes(&mut l.conn, &hashes).map_err(|e| e.to_string())?;
    Ok(hashes.len())
}

fn commit(
    conn: &mut Connection,
    outcomes: Vec<(Outcome, Vec<String>)>,
    folder_id: Option<&str>,
) -> rusqlite::Result<ImportSummary> {
    let mut summary = ImportSummary::default();
    // Target folder (None = unfiled) -> item ids, in import order.
    // The flag marks already-known items, which only fill an empty spot.
    let mut placed: Vec<(Option<String>, bool, Vec<String>)> = Vec::new();
    let mut folder_cache: HashMap<Vec<String>, String> = HashMap::new();
    let tx = conn.transaction()?;
    let base = db::now_ms();
    for (i, (o, dirs)) in outcomes.into_iter().enumerate() {
        let known = matches!(o, Outcome::Duplicate(_));
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
        match placed.iter_mut().find(|(f, k, _)| *f == folder && *k == known) {
            Some((_, _, ids)) => ids.push(id),
            None => placed.push((folder, known, vec![id])),
        }
    }
    for (folder, known, ids) in &placed {
        if let Some(f) = folder {
            // Re-importing something already filed elsewhere doesn't move it.
            if *known {
                db::file_unfiled(&tx, ids, f)?;
            } else {
                db::move_to_folder(&tx, ids, f)?;
            }
        }
    }
    tx.commit()?;
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
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

    /// Smooth pattern with `fx` / `fy` waves across the image.
    fn textured(w: u32, h: u32, fx: f32, fy: f32) -> DynamicImage {
        DynamicImage::ImageRgb8(RgbImage::from_fn(w, h, |x, y| {
            let v = ((x as f32 / w as f32 * fx).sin() * (y as f32 / h as f32 * fy).cos() * 120.0 + 128.0) as u8;
            Rgb([v, 255 - v, v / 2])
        }))
    }

    fn jpeg_bytes(img: &DynamicImage) -> Vec<u8> {
        let mut buf = Cursor::new(Vec::new());
        img.to_rgb8().write_to(&mut buf, ImageFormat::Jpeg).unwrap();
        buf.into_inner()
    }

    #[test]
    fn finds_resized_copies_and_backfills_hashes() {
        let (_tmp, lib) = setup();
        let big = textured(1600, 1200, 9.0, 6.0);
        let small = big.resize(400, 300, image::imageops::FilterType::Lanczos3);
        let sources = vec![
            Source::Bytes { name: "small.jpg".into(), data: jpeg_bytes(&small) },
            Source::Bytes { name: "other.png".into(), data: png_bytes(textured(1600, 1200, 3.0, 13.0)) },
            Source::Bytes { name: "big.png".into(), data: png_bytes(big) },
        ];
        assert_eq!(run(&lib, sources, None, |_, _| {}).unwrap().imported, 3);

        let similar = |lib: &Mutex<Option<Library>>| {
            let g = lib.lock().unwrap();
            let q = db::ItemQuery { view: db::View::Similar, ..Default::default() };
            db::query_items(&g.as_ref().unwrap().conn, &q)
                .unwrap()
                .into_iter()
                .map(|i| (i.name, i.group))
                .collect::<Vec<_>>()
        };
        // The larger copy comes first.
        let expected = vec![("big.png".to_string(), Some(0)), ("small.jpg".to_string(), Some(0))];
        assert_eq!(similar(&lib), expected);

        // Items from before the hash existed get it from their thumbnails.
        lib.lock().unwrap().as_ref().unwrap().conn.execute("UPDATE items SET phash = NULL", []).unwrap();
        assert!(similar(&lib).is_empty());
        assert_eq!(compute_missing_phashes(&lib).unwrap(), 3);
        assert_eq!(compute_missing_phashes(&lib).unwrap(), 0);
        assert_eq!(similar(&lib), expected);
    }

    #[test]
    fn imports_new_formats_with_display_copies() {
        let (tmp, lib) = setup();
        let dir = tmp.path().join("fmt");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("logo.svg"),
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><circle cx="75" cy="75" r="60" fill="#09f"/></svg>"##,
        )
        .unwrap();
        image::RgbImage::from_fn(80, 60, |x, y| image::Rgb([x as u8 * 3, y as u8 * 4, 90]))
            .save(dir.join("scan.tiff"))
            .unwrap();
        #[cfg(target_os = "macos")]
        let heic = std::process::Command::new("/usr/bin/sips")
            .args(["-s", "format", "heic"])
            .arg(dir.join("scan.tiff"))
            .arg("--out")
            .arg(dir.join("photo.heic"))
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        #[cfg(not(target_os = "macos"))]
        let heic = false;

        let sum = run(&lib, collect_files(std::slice::from_ref(&dir)), None, |_, _| {}).unwrap();
        assert!(sum.failed.is_empty(), "{:?}", sum.failed);
        assert_eq!(sum.imported, if heic { 3 } else { 2 });

        let g = lib.lock().unwrap();
        let l = g.as_ref().unwrap();
        let items = db::query_items(&l.conn, &db::ItemQuery { sort: db::SortKey::Name, ..Default::default() }).unwrap();
        let by = |n: &str| items.iter().find(|i| i.name == n).unwrap();

        let svg = by("logo.svg");
        assert_eq!((svg.width, svg.height), (300, 150), "SVG keeps its document size");
        assert!(svg.preview.is_none(), "web views render SVG directly");
        assert!(l.thumb_path(svg).is_file());

        let tif = by("scan.tiff");
        assert_eq!((tif.width, tif.height), (80, 60));
        let p = l.display_path(tif);
        assert!(p.starts_with(l.root.join("previews")) && p.is_file(), "TIFF gets a JPEG display copy");
        assert_eq!(image::open(&p).unwrap().width(), 80);

        if heic {
            let h = by("photo.heic");
            assert_eq!((h.width, h.height), (80, 60));
            assert!(l.display_path(h).is_file());
        }

        // Deleting removes the display copy too.
        let preview = l.display_path(tif);
        l.delete_items(std::slice::from_ref(&tif.id)).unwrap();
        assert!(!preview.exists());
    }

    #[test]
    fn orient_rewrites_thumbnail_and_size_only() {
        let (_tmp, lib) = setup();
        let data = png_bytes(DynamicImage::ImageRgb8(RgbImage::from_pixel(1200, 600, Rgb([10, 200, 10]))));
        run(&lib, vec![Source::Bytes { name: "wide.png".into(), data: data.clone() }], None, |_, _| {}).unwrap();
        let mut g = lib.lock().unwrap();
        let l = g.as_mut().unwrap();
        let get = |l: &Library| db::query_items(&l.conn, &db::ItemQuery::default()).unwrap().remove(0);
        let it = get(l);
        let ids = vec![it.id.clone()];
        let base = it.thumb.clone();

        assert_eq!(orient(l, &ids, OrientOp::RotateCw).unwrap(), 1);
        let r = get(l);
        assert_eq!((r.width, r.height, r.rotation, r.flipped), (600, 1200, 1, false));
        assert_ne!(r.thumb, base);
        let t = image::open(l.thumb_path(&r)).unwrap();
        assert_eq!((t.width(), t.height()), (256, 512));
        assert_eq!(fs::read(l.file_path(&r)).unwrap(), data, "the original file is untouched");

        // Flipping a sideways image keeps it sideways; the old rotated thumbnail goes away.
        orient(l, &ids, OrientOp::FlipH).unwrap();
        let f = get(l);
        assert_eq!((f.width, f.height, f.rotation, f.flipped), (600, 1200, 3, true));
        assert!(!l.thumb_path(&r).exists());

        // Reset returns to the unrotated thumbnail, which was kept.
        orient(l, &ids, OrientOp::Reset).unwrap();
        let z = get(l);
        assert_eq!((z.width, z.height, z.thumb.as_str()), (1200, 600, base.as_str()));
        assert!(!l.thumb_path(&f).exists());
        assert_eq!(orient(l, &ids, OrientOp::Reset).unwrap(), 0, "no-op");

        // Deleting removes both thumbnails.
        orient(l, &ids, OrientOp::RotateCcw).unwrap();
        let c = get(l);
        l.delete_items(&ids).unwrap();
        assert!(!l.thumb_path(&c).exists() && !l.thumb_path(&z).exists());
    }

    #[test]
    fn sanitize_names() {
        assert_eq!(sanitize("a/b:c?.png"), "a_b_c_.png");
        assert_eq!(sanitize(" ..."), "image");
    }
}
