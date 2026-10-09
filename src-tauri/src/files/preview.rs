//! The viewer's full preview of a document that isn't a PDF (office, iWork),
//! made once and kept in the library's previews/ folder:
//!
//! - `previews/<id>.pdf`: the document as PDF. Windows: made by Office, when
//!   it is installed (win_office.rs)
//! - `previews/<id>.qlpreview/`: Quick Look's preview (macOS), an HTML page
//!   with its styles and pictures next to it (`Preview.html`), or a PDF
//!   (`Preview.pdf`)
//!
//! Whichever was made is shown on both systems: a library carried from
//! Windows to a Mac keeps its PDFs, and the other way round.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Preview {
    Pdf { path: PathBuf },
    /// `file` inside `dir`; the page loads the other files of `dir`.
    Html { dir: PathBuf, file: String },
}

/// One preview made at a time: Office is driven one document at a time, and
/// the viewer and the Windows thumbnail pass may ask for the same one.
static MAKING: Mutex<()> = Mutex::new(());

/// The kept preview of item `id`, if one was made.
pub fn stored(previews: &Path, id: &str) -> Option<Preview> {
    let pdf = previews.join(format!("{id}.pdf"));
    if pdf.is_file() {
        return Some(Preview::Pdf { path: pdf });
    }
    let dir = previews.join(format!("{id}.qlpreview"));
    if dir.join("Preview.html").is_file() {
        return Some(Preview::Html { dir, file: "Preview.html".into() });
    }
    let pdf = dir.join("Preview.pdf");
    pdf.is_file().then_some(Preview::Pdf { path: pdf })
}

/// The preview of item `id` (stored at `path`), made now if there is none
/// yet. None when this system can't make one.
pub fn get(previews: &Path, id: &str, path: &Path, ext: &str) -> Option<Preview> {
    if let Some(p) = stored(previews, id) {
        return Some(p);
    }
    let _making = MAKING.lock().unwrap_or_else(|e| e.into_inner());
    // Made by the other caller while this one waited.
    if let Some(p) = stored(previews, id) {
        return Some(p);
    }
    make(previews, id, path, ext)
}

/// Windows: the PDF of item `id`, made by Office now if there is none yet.
#[cfg(windows)]
pub fn pdf(previews: &Path, id: &str, path: &Path, ext: &str) -> Option<PathBuf> {
    let pdf = previews.join(format!("{id}.pdf"));
    if !pdf.is_file() {
        let _making = MAKING.lock().unwrap_or_else(|e| e.into_inner());
        if !pdf.is_file() {
            convert(path, ext, &pdf)?;
        }
    }
    Some(pdf)
}

#[cfg(target_os = "macos")]
fn make(previews: &Path, id: &str, path: &Path, _ext: &str) -> Option<Preview> {
    // qlmanage writes <file name>.qlpreview/ into the output folder. A
    // temporary folder next to the result, so the move is a rename.
    let tmp = tempfile::Builder::new().prefix(".ql-").tempdir_in(previews).ok()?;
    let ok = super::run_quicklook(&["-p", "-o"], tmp.path(), path);
    let made = tmp.path().join(format!("{}.qlpreview", path.file_name()?.to_string_lossy()));
    if !ok || !(made.join("Preview.html").is_file() || made.join("Preview.pdf").is_file()) {
        return None;
    }
    let dest = previews.join(format!("{id}.qlpreview"));
    let _ = fs::remove_dir_all(&dest);
    fs::rename(&made, &dest).ok()?;
    stored(previews, id)
}

#[cfg(windows)]
fn make(previews: &Path, id: &str, path: &Path, ext: &str) -> Option<Preview> {
    convert(path, ext, &previews.join(format!("{id}.pdf")))?;
    stored(previews, id)
}

/// Office to PDF (win_office.rs); why it failed goes to the log.
#[cfg(windows)]
fn convert(path: &Path, ext: &str, pdf: &Path) -> Option<()> {
    match super::win_office::to_pdf(path, ext, pdf) {
        Ok(()) => Some(()),
        Err(super::win_office::Error::Unavailable) => None,
        Err(super::win_office::Error::Failed(why)) => {
            log::warn!("{}: PDF にできませんでした: {why}", path.display());
            None
        }
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn make(_previews: &Path, _id: &str, _path: &Path, _ext: &str) -> Option<Preview> {
    None
}

/// Removes the kept previews of a deleted item.
pub fn remove(previews: &Path, id: &str) {
    let _ = fs::remove_file(previews.join(format!("{id}.pdf")));
    let _ = fs::remove_dir_all(previews.join(format!("{id}.qlpreview")));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_what_was_kept() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        assert_eq!(stored(p, "a"), None);

        fs::create_dir(p.join("a.qlpreview")).unwrap();
        fs::write(p.join("a.qlpreview/Preview.html"), "<p>x</p>").unwrap();
        assert_eq!(stored(p, "a"), Some(Preview::Html { dir: p.join("a.qlpreview"), file: "Preview.html".into() }));
        // A PDF (made on Windows) is preferred.
        fs::write(p.join("a.pdf"), b"%PDF").unwrap();
        assert_eq!(stored(p, "a"), Some(Preview::Pdf { path: p.join("a.pdf") }));

        remove(p, "a");
        assert_eq!(stored(p, "a"), None);
        assert!(!p.join("a.qlpreview").exists());
    }

    #[test]
    fn quick_look_pdf_preview() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        fs::create_dir(p.join("b.qlpreview")).unwrap();
        fs::write(p.join("b.qlpreview/Preview.pdf"), b"%PDF").unwrap();
        assert_eq!(stored(p, "b"), Some(Preview::Pdf { path: p.join("b.qlpreview/Preview.pdf") }));
    }

    /// Quick Look's preview of a Word document is an HTML page.
    #[cfg(target_os = "macos")]
    #[test]
    fn makes_a_quick_look_preview() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("doc.txt");
        fs::write(&src, "見出し\n\n本文").unwrap();
        let docx = dir.path().join("doc.docx");
        let ok = std::process::Command::new("/usr/bin/textutil")
            .args(["-convert", "docx", "-output"])
            .arg(&docx)
            .arg(&src)
            .status()
            .is_ok_and(|s| s.success());
        if !ok {
            eprintln!("skipping: textutil made no document");
            return;
        }
        let previews = dir.path().join("previews");
        fs::create_dir(&previews).unwrap();
        match get(&previews, "c", &docx, "docx") {
            Some(Preview::Html { dir, file }) => {
                let html = fs::read_to_string(dir.join(file)).unwrap();
                assert!(html.contains("本文"));
            }
            None => eprintln!("skipping: Quick Look made no preview"),
            other => panic!("unexpected preview {other:?}"),
        }
        // Nothing left behind but the preview.
        let left: Vec<_> = fs::read_dir(&previews).unwrap().flatten().map(|e| e.file_name()).collect();
        assert!(left.len() <= 1, "{left:?}");
    }
}
