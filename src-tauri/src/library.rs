//! A library is a self-contained folder:
//!   <name>.library/library.db
//!   <name>.library/images/<item id>/<file name>
//!   <name>.library/thumbs/<item id>.jpg|png

use crate::db::{self, Item};
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

pub const DB_FILE: &str = "library.db";

pub struct Library {
    pub root: PathBuf,
    pub conn: Connection,
}

impl Library {
    pub fn create(root: &Path) -> Result<Self, String> {
        if root.join(DB_FILE).exists() {
            return Self::open(root);
        }
        if root.exists() && fs::read_dir(root).map_err(|e| e.to_string())?.next().is_some() {
            return Err("空でないフォルダにはライブラリを作成できません".into());
        }
        Self::load(root)
    }

    pub fn open(root: &Path) -> Result<Self, String> {
        if !root.join(DB_FILE).is_file() {
            return Err(format!("ライブラリではありません: {}", root.display()));
        }
        Self::load(root)
    }

    fn load(root: &Path) -> Result<Self, String> {
        fs::create_dir_all(root.join("images")).map_err(|e| e.to_string())?;
        fs::create_dir_all(root.join("thumbs")).map_err(|e| e.to_string())?;
        fs::create_dir_all(root.join("previews")).map_err(|e| e.to_string())?;
        let conn = db::open(&root.join(DB_FILE)).map_err(|e| e.to_string())?;
        Ok(Self { root: root.to_path_buf(), conn })
    }

    pub fn file_path(&self, item: &Item) -> PathBuf {
        self.root.join("images").join(&item.id).join(&item.file_name)
    }

    pub fn thumb_path(&self, item: &Item) -> PathBuf {
        self.root.join("thumbs").join(&item.thumb)
    }

    /// What the viewer shows: the JPEG display copy if there is one.
    pub fn display_path(&self, item: &Item) -> PathBuf {
        match &item.preview {
            Some(p) => self.root.join("previews").join(p),
            None => self.file_path(item),
        }
    }

    /// Permanently deletes items (rows and files).
    pub fn delete_items(&self, ids: &[String]) -> Result<(), String> {
        if ids.is_empty() {
            return Ok(());
        }
        let removed = db::delete_items(&self.conn, ids).map_err(|e| e.to_string())?;
        for item in removed {
            let _ = fs::remove_dir_all(self.root.join("images").join(&item.id));
            let _ = fs::remove_file(self.thumb_path(&item));
            if let Some(p) = &item.preview {
                let _ = fs::remove_file(self.root.join("previews").join(p));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_open_and_reject() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("A.library");
        Library::create(&root).unwrap();
        assert!(root.join("images").is_dir() && root.join(DB_FILE).is_file());
        Library::open(&root).unwrap();
        Library::create(&root).unwrap(); // existing library just opens

        let other = tmp.path().join("other");
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("x.txt"), "x").unwrap();
        assert!(Library::create(&other).is_err());
        assert!(Library::open(&other).is_err());
    }
}
