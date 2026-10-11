//! The app's own folders, named after `identifier` in tauri.conf.json.
//!
//! The app was called "Image Library" (`com.local.imagelibrary`) before it
//! became Stockroom. The settings (library list, connection keys), the window's
//! place, the logs and the webview's storage were in folders named after the
//! old identifier: they're moved to the new names once, before anything opens
//! them.

use std::path::{Path, PathBuf};

/// `identifier` in tauri.conf.json.
pub const APP_ID: &str = "com.local.stockroom";
const OLD_APP_ID: &str = "com.local.imagelibrary";

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn env_dir(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(PathBuf::from)
}

/// Where Tauri's `app_config_dir` is, without the identifier.
pub fn config_base() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        Some(home()?.join("Library/Application Support"))
    } else if cfg!(windows) {
        env_dir("APPDATA")
    } else {
        env_dir("XDG_CONFIG_HOME").or_else(|| home().map(|h| h.join(".config")))
    }
}

/// Every folder that holds one named after the identifier: Tauri's
/// `app_*_dir`s, and on macOS the webview's storage (on Windows it's inside
/// the local app data one).
fn bases() -> Vec<PathBuf> {
    let mut v = vec![config_base()];
    if cfg!(target_os = "macos") {
        let lib = home().map(|h| h.join("Library"));
        v.extend(["Logs", "Caches", "WebKit"].map(|d| lib.as_ref().map(|l| l.join(d))));
    } else if cfg!(windows) {
        v.push(env_dir("LOCALAPPDATA"));
    } else {
        v.push(env_dir("XDG_DATA_HOME").or_else(|| home().map(|h| h.join(".local/share"))));
        v.push(env_dir("XDG_CACHE_HOME").or_else(|| home().map(|h| h.join(".cache"))));
    }
    v.into_iter().flatten().collect()
}

/// `base/old` becomes `base/new`, unless the new one is already there. Says
/// what it did, for the log.
fn move_dir(base: &Path, old: &str, new: &str) -> Option<String> {
    let (from, to) = (base.join(old), base.join(new));
    if !from.is_dir() || to.exists() {
        return None;
    }
    Some(match std::fs::rename(&from, &to) {
        Ok(()) => format!("moved {} -> {}", from.display(), to.display()),
        Err(e) => format!("could not move {} -> {}: {e}", from.display(), to.display()),
    })
}

/// Moves the old name's folders over; returns what was done, for the log
/// (which can't be written yet: it goes into one of these folders).
pub fn move_from_old_name() -> Vec<String> {
    bases().iter().filter_map(|b| move_dir(b, OLD_APP_ID, APP_ID)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moves_the_old_folder_once() {
        let base = tempfile::tempdir().unwrap();
        let old = base.path().join(OLD_APP_ID);
        std::fs::create_dir(&old).unwrap();
        std::fs::write(old.join("settings.json"), "{}").unwrap();
        assert!(move_dir(base.path(), OLD_APP_ID, APP_ID).unwrap().starts_with("moved"));
        assert!(base.path().join(APP_ID).join("settings.json").is_file());
        assert!(!old.exists());
        assert!(move_dir(base.path(), OLD_APP_ID, APP_ID).is_none());
    }

    #[test]
    fn keeps_a_new_folder_that_is_already_there() {
        let base = tempfile::tempdir().unwrap();
        std::fs::create_dir(base.path().join(OLD_APP_ID)).unwrap();
        std::fs::create_dir(base.path().join(APP_ID)).unwrap();
        assert!(move_dir(base.path(), OLD_APP_ID, APP_ID).is_none());
        assert!(base.path().join(OLD_APP_ID).is_dir());
    }
}
