//! SQLite schema and queries. Everything here takes a plain `Connection`
//! so it can be unit-tested without Tauri.

use rusqlite::{params, params_from_iter, Connection, OptionalExtension, ToSql, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{search, similar};

pub type DbResult<T> = rusqlite::Result<T>;

const SCHEMA_VERSION: i32 = 3;

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn open(path: &std::path::Path) -> DbResult<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;",
    )?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> DbResult<()> {
    let version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 {
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE items (
               id          TEXT PRIMARY KEY,
               name        TEXT NOT NULL,
               file_name   TEXT NOT NULL,
               ext         TEXT NOT NULL,
               width       INTEGER NOT NULL,
               height      INTEGER NOT NULL,
               size        INTEGER NOT NULL,
               hash        TEXT NOT NULL,
               thumb       TEXT NOT NULL,
               note        TEXT NOT NULL DEFAULT '',
               imported_at INTEGER NOT NULL,
               deleted_at  INTEGER
             );
             CREATE INDEX idx_items_hash ON items(hash);
             CREATE INDEX idx_items_deleted ON items(deleted_at, imported_at);

             CREATE TABLE folders (
               id        TEXT PRIMARY KEY,
               parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
               name      TEXT NOT NULL
             );
             CREATE INDEX idx_folders_parent ON folders(parent_id);

             CREATE TABLE item_folders (
               item_id   TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
               folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
               PRIMARY KEY (item_id, folder_id)
             );
             CREATE INDEX idx_item_folders_folder ON item_folders(folder_id);

             CREATE TABLE tags (
               id   INTEGER PRIMARY KEY,
               name TEXT NOT NULL UNIQUE COLLATE NOCASE
             );

             CREATE TABLE item_tags (
               item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
               tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
               PRIMARY KEY (item_id, tag_id)
             );
             CREATE INDEX idx_item_tags_tag ON item_tags(tag_id);
             COMMIT;",
        )?;
    }
    if version < 2 {
        // Star ratings, and a per-folder position for manual ordering.
        conn.execute_batch(
            "BEGIN;
             ALTER TABLE items ADD COLUMN rating INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE item_folders ADD COLUMN position REAL;
             UPDATE item_folders SET position = rowid;
             COMMIT;",
        )?;
    }
    if version < 3 {
        // Perceptual hash for near-duplicate detection; NULL = not computed yet.
        // pcolor = average colour 0xRRGGBB (see similar.rs).
        conn.execute_batch(
            "BEGIN;
             ALTER TABLE items ADD COLUMN phash INTEGER;
             ALTER TABLE items ADD COLUMN pcolor INTEGER;
             COMMIT;",
        )?;
    }
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

// ---------------------------------------------------------------- items

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub name: String,
    pub file_name: String,
    pub ext: String,
    pub width: u32,
    pub height: u32,
    pub size: i64,
    pub thumb: String,
    pub note: String,
    pub rating: u8,
    pub imported_at: i64,
    pub deleted_at: Option<i64>,
    /// Similar view only: which group of look-alikes the item belongs to.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct NewItem {
    pub id: String,
    pub name: String,
    pub file_name: String,
    pub ext: String,
    pub width: u32,
    pub height: u32,
    pub size: i64,
    pub hash: String,
    pub thumb: String,
    /// Perceptual hash and average colour (see similar.rs).
    pub phash: Option<(u64, u32)>,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum View {
    #[default]
    All,
    Unfiled,
    Untagged,
    Trash,
    Folder { id: String },
    /// Groups of images that look alike (likely duplicates).
    Similar,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortKey {
    #[default]
    ImportedAt,
    Name,
    Size,
    /// Pixel count (width × height).
    Dimensions,
    Rating,
    /// User-defined order inside a folder; other views fall back to import order.
    Manual,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemQuery {
    pub view: View,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub tag_ids: Vec<i64>,
    /// `tag_ids` must all be present (AND); otherwise any one of them (OR).
    #[serde(default)]
    pub tag_match_all: bool,
    /// Folder view also shows items of all subfolders.
    #[serde(default)]
    pub include_subfolders: bool,
    #[serde(default)]
    pub min_rating: u8,
    pub sort: SortKey,
    pub desc: bool,
}

const ITEM_COLS: &str = "items.id, items.name, items.file_name, items.ext, items.width, items.height, \
     items.size, items.thumb, items.note, items.rating, items.imported_at, items.deleted_at";

fn row_to_item(r: &rusqlite::Row) -> DbResult<Item> {
    Ok(Item {
        id: r.get(0)?,
        name: r.get(1)?,
        file_name: r.get(2)?,
        ext: r.get(3)?,
        width: r.get(4)?,
        height: r.get(5)?,
        size: r.get(6)?,
        thumb: r.get(7)?,
        note: r.get(8)?,
        rating: r.get(9)?,
        imported_at: r.get(10)?,
        deleted_at: r.get(11)?,
        group: None,
    })
}

fn escape_like(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('%');
    for c in s.chars() {
        if matches!(c, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('%');
    out
}

fn placeholders(n: usize) -> String {
    vec!["?"; n].join(",")
}

const SUBFOLDERS_CTE: &str = "WITH RECURSIVE sub(id) AS (
       SELECT ? UNION ALL SELECT c.id FROM folders c JOIN sub ON c.parent_id = sub.id)
     SELECT id FROM sub";

pub fn query_items(conn: &Connection, q: &ItemQuery) -> DbResult<Vec<Item>> {
    let mut wheres: Vec<String> = Vec::new();
    let mut args: Vec<Box<dyn ToSql>> = Vec::new();

    // Manual order joins the folder's positions; its bind value comes first.
    let manual_folder = match (&q.view, q.sort) {
        (View::Folder { id }, SortKey::Manual) => Some(id.clone()),
        _ => None,
    };
    let join = if let Some(f) = &manual_folder {
        args.push(Box::new(f.clone()));
        "LEFT JOIN item_folders pos ON pos.item_id = items.id AND pos.folder_id = ?"
    } else {
        ""
    };

    if q.view == View::Trash {
        wheres.push("items.deleted_at IS NOT NULL".into());
    } else {
        wheres.push("items.deleted_at IS NULL".into());
    }
    match &q.view {
        View::Unfiled => wheres
            .push("NOT EXISTS (SELECT 1 FROM item_folders f WHERE f.item_id = items.id)".into()),
        View::Untagged => {
            wheres.push("NOT EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = items.id)".into())
        }
        View::Folder { id } if q.include_subfolders => {
            wheres.push(format!(
                "EXISTS (SELECT 1 FROM item_folders f WHERE f.item_id = items.id
                   AND f.folder_id IN ({SUBFOLDERS_CTE}))"
            ));
            args.push(Box::new(id.clone()));
        }
        View::Folder { id } => {
            wheres.push(
                "EXISTS (SELECT 1 FROM item_folders f WHERE f.item_id = items.id AND f.folder_id = ?)"
                    .into(),
            );
            args.push(Box::new(id.clone()));
        }
        View::All | View::Trash | View::Similar => {}
    }

    if let Some(expr) = search::parse(&q.search) {
        let sql = search::to_sql(&expr, &mut |word| {
            let pat = escape_like(word);
            args.push(Box::new(pat.clone()));
            args.push(Box::new(pat.clone()));
            args.push(Box::new(pat));
            "(items.name LIKE ? ESCAPE '\\' OR items.note LIKE ? ESCAPE '\\' OR EXISTS (
               SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id
               WHERE it.item_id = items.id AND t.name LIKE ? ESCAPE '\\'))"
                .into()
        });
        wheres.push(sql);
    }

    if q.min_rating > 0 {
        wheres.push("items.rating >= ?".into());
        args.push(Box::new(q.min_rating));
    }

    if !q.tag_ids.is_empty() {
        let marks = vec!["?"; q.tag_ids.len()].join(", ");
        // AND: the item carries every selected tag; OR: at least one of them.
        let need = if q.tag_match_all { q.tag_ids.len() } else { 1 };
        wheres.push(format!(
            "(SELECT COUNT(*) FROM item_tags t WHERE t.item_id = items.id AND t.tag_id IN ({marks})) >= {need}"
        ));
        for tag_id in &q.tag_ids {
            args.push(Box::new(*tag_id));
        }
    }

    let dir = if q.desc { "DESC" } else { "ASC" };
    let order = match q.sort {
        SortKey::ImportedAt => format!("items.imported_at {dir}"),
        SortKey::Name => format!("items.name COLLATE NOCASE {dir}"),
        SortKey::Size => format!("items.size {dir}"),
        SortKey::Dimensions => format!("items.width * items.height {dir}"),
        SortKey::Rating => format!("items.rating {dir}, items.imported_at DESC"),
        // Manual is always top-to-bottom; items without a position go last.
        SortKey::Manual if manual_folder.is_some() => {
            "pos.position IS NULL, pos.position ASC, items.imported_at ASC".into()
        }
        SortKey::Manual => format!("items.imported_at {dir}"),
    };
    let sql = format!(
        "SELECT {ITEM_COLS} FROM items {join} WHERE {} ORDER BY {order}, items.rowid {dir}",
        wheres.join(" AND ")
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(args.iter().map(|b| b.as_ref())), row_to_item)?;
    let items = rows.collect::<DbResult<Vec<_>>>()?;
    if q.view == View::Similar {
        return similar_groups(conn, items);
    }
    Ok(items)
}

/// Keeps only items that have look-alikes among `items`, grouped together.
/// Groups follow the query's sort order; inside a group the best copy
/// (most pixels, then largest file, then oldest) comes first.
fn similar_groups(conn: &Connection, items: Vec<Item>) -> DbResult<Vec<Item>> {
    let mut stmt = conn.prepare(
        "SELECT id, phash, pcolor FROM items WHERE deleted_at IS NULL AND phash IS NOT NULL",
    )?;
    let hashes: HashMap<String, (i64, u32)> = stmt
        .query_map([], |r| Ok((r.get(0)?, (r.get(1)?, r.get::<_, Option<u32>>(2)?.unwrap_or(0)))))?
        .collect::<DbResult<_>>()?;
    let mut items: Vec<Option<Item>> = items
        .into_iter()
        .filter(|i| hashes.contains_key(&i.id))
        .map(Some)
        .collect();
    let entries: Vec<similar::Entry> = items
        .iter()
        .flatten()
        .map(|i| {
            let (hash, color) = hashes[&i.id];
            similar::Entry { hash: hash as u64, color, width: i.width, height: i.height }
        })
        .collect();
    let mut out = Vec::new();
    for (n, group) in similar::groups(&entries).into_iter().enumerate() {
        let mut members: Vec<Item> = group.into_iter().filter_map(|k| items[k].take()).collect();
        members.sort_by_key(|i| {
            (std::cmp::Reverse(i.width as u64 * i.height as u64), std::cmp::Reverse(i.size), i.imported_at)
        });
        for mut m in members {
            m.group = Some(n as u32);
            out.push(m);
        }
    }
    Ok(out)
}

/// Live items whose perceptual hash hasn't been computed: (id, thumbnail file).
pub fn missing_phashes(conn: &Connection) -> DbResult<Vec<(String, String)>> {
    let mut stmt = conn.prepare("SELECT id, thumb FROM items WHERE phash IS NULL AND deleted_at IS NULL")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

pub fn set_phashes(conn: &mut Connection, hashes: &[(String, (u64, u32))]) -> DbResult<()> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare("UPDATE items SET phash = ?2, pcolor = ?3 WHERE id = ?1")?;
        for (id, (h, c)) in hashes {
            stmt.execute(params![id, *h as i64, c])?;
        }
    }
    tx.commit()
}

pub fn get_items(conn: &Connection, ids: &[String]) -> DbResult<Vec<Item>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let sql = format!(
        "SELECT {ITEM_COLS} FROM items WHERE id IN ({})",
        placeholders(ids.len())
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(ids), row_to_item)?;
    rows.collect()
}

/// hash -> item id, including trashed items.
pub fn hash_index(conn: &Connection) -> DbResult<HashMap<String, String>> {
    let mut stmt = conn.prepare("SELECT hash, id FROM items")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

pub fn insert_item(tx: &Transaction, it: &NewItem, imported_at: i64) -> DbResult<()> {
    tx.execute(
        "INSERT INTO items (id, name, file_name, ext, width, height, size, hash, thumb, imported_at, phash, pcolor)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            it.id,
            it.name,
            it.file_name,
            it.ext,
            it.width,
            it.height,
            it.size,
            it.hash,
            it.thumb,
            imported_at,
            it.phash.map(|(h, _)| h as i64),
            it.phash.map(|(_, c)| c)
        ],
    )?;
    Ok(())
}

pub fn set_note(conn: &Connection, id: &str, note: &str) -> DbResult<()> {
    conn.execute("UPDATE items SET note = ?2 WHERE id = ?1", params![id, note])?;
    Ok(())
}

pub fn set_rating(conn: &Connection, ids: &[String], rating: u8) -> DbResult<()> {
    let mut stmt = conn.prepare("UPDATE items SET rating = ?2 WHERE id = ?1")?;
    for id in ids {
        stmt.execute(params![id, rating.min(5)])?;
    }
    Ok(())
}

pub fn rename_item(conn: &Connection, id: &str, name: &str) -> DbResult<()> {
    conn.execute("UPDATE items SET name = ?2 WHERE id = ?1", params![id, name])?;
    Ok(())
}

pub fn trash_items(conn: &Connection, ids: &[String]) -> DbResult<()> {
    let mut args: Vec<Box<dyn ToSql>> = vec![Box::new(now_ms())];
    args.extend(ids.iter().map(|s| Box::new(s.clone()) as Box<dyn ToSql>));
    let sql = format!(
        "UPDATE items SET deleted_at = ? WHERE deleted_at IS NULL AND id IN ({})",
        placeholders(ids.len())
    );
    conn.execute(&sql, params_from_iter(args.iter().map(|b| b.as_ref())))?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct DuplicateGroup {
    pub keep: String,
    pub remove: Vec<String>,
}

/// Trashes duplicates after copying their tags, folders and best rating onto
/// the copy that is kept, so no organizing work is lost.
pub fn resolve_duplicates(conn: &mut Connection, groups: &[DuplicateGroup]) -> DbResult<()> {
    let tx = conn.transaction()?;
    for g in groups.iter().filter(|g| !g.remove.is_empty()) {
        let marks = placeholders(g.remove.len());
        let mut args: Vec<&dyn ToSql> = vec![&g.keep];
        args.extend(g.remove.iter().map(|s| s as &dyn ToSql));
        tx.execute(
            &format!(
                "INSERT OR IGNORE INTO item_tags (item_id, tag_id)
                 SELECT ?, tag_id FROM item_tags WHERE item_id IN ({marks})"
            ),
            params_from_iter(&args),
        )?;
        let mut stmt = tx.prepare(&format!(
            "SELECT DISTINCT folder_id FROM item_folders WHERE item_id IN ({marks})"
        ))?;
        let folders: Vec<String> =
            stmt.query_map(params_from_iter(&g.remove), |r| r.get(0))?.collect::<DbResult<_>>()?;
        for f in &folders {
            add_to_folder(&tx, std::slice::from_ref(&g.keep), f)?;
        }
        tx.execute(
            &format!(
                "UPDATE items SET rating = MAX(rating, (SELECT MAX(rating) FROM items WHERE id IN ({marks})))
                 WHERE id = ?"
            ),
            params_from_iter(g.remove.iter().map(|s| s as &dyn ToSql).chain([&g.keep as &dyn ToSql])),
        )?;
        trash_items(&tx, &g.remove)?;
    }
    tx.commit()
}

pub fn restore_items(conn: &Connection, ids: &[String]) -> DbResult<()> {
    let sql = format!(
        "UPDATE items SET deleted_at = NULL WHERE id IN ({})",
        placeholders(ids.len())
    );
    conn.execute(&sql, params_from_iter(ids))?;
    Ok(())
}

/// Deletes rows and returns them so the caller can remove the files.
pub fn delete_items(conn: &Connection, ids: &[String]) -> DbResult<Vec<Item>> {
    let items = get_items(conn, ids)?;
    let sql = format!("DELETE FROM items WHERE id IN ({})", placeholders(ids.len()));
    conn.execute(&sql, params_from_iter(ids))?;
    Ok(items)
}

pub fn trashed_ids(conn: &Connection) -> DbResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM items WHERE deleted_at IS NOT NULL")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub all: i64,
    pub unfiled: i64,
    pub untagged: i64,
    pub trash: i64,
}

pub fn counts(conn: &Connection) -> DbResult<Counts> {
    conn.query_row(
        "SELECT
           SUM(deleted_at IS NULL),
           SUM(deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM item_folders f WHERE f.item_id = items.id)),
           SUM(deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = items.id)),
           SUM(deleted_at IS NOT NULL)
         FROM items",
        [],
        |r| {
            Ok(Counts {
                all: r.get::<_, Option<i64>>(0)?.unwrap_or(0),
                unfiled: r.get::<_, Option<i64>>(1)?.unwrap_or(0),
                untagged: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                trash: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
            })
        },
    )
}

// -------------------------------------------------------------- folders

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub count: i64,
}

pub fn list_folders(conn: &Connection) -> DbResult<Vec<Folder>> {
    let mut stmt = conn.prepare(
        "SELECT f.id, f.parent_id, f.name,
           (SELECT COUNT(*) FROM item_folders x JOIN items i ON i.id = x.item_id
            WHERE x.folder_id = f.id AND i.deleted_at IS NULL)
         FROM folders f ORDER BY f.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Folder {
            id: r.get(0)?,
            parent_id: r.get(1)?,
            name: r.get(2)?,
            count: r.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn create_folder(conn: &Connection, name: &str, parent_id: Option<&str>) -> DbResult<String> {
    let id = uuid::Uuid::new_v4().simple().to_string();
    conn.execute(
        "INSERT INTO folders (id, parent_id, name) VALUES (?1, ?2, ?3)",
        params![id, parent_id, name],
    )?;
    Ok(id)
}

pub fn rename_folder(conn: &Connection, id: &str, name: &str) -> DbResult<()> {
    conn.execute("UPDATE folders SET name = ?2 WHERE id = ?1", params![id, name])?;
    Ok(())
}

/// Deletes the folder and its subfolders. Items themselves are kept.
pub fn delete_folder(conn: &Connection, id: &str) -> DbResult<()> {
    conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    Ok(())
}

/// Re-parents a folder. Returns false (and does nothing) if that would create a cycle.
pub fn move_folder(conn: &Connection, id: &str, new_parent: Option<&str>) -> DbResult<bool> {
    let mut cur = new_parent.map(str::to_owned);
    while let Some(c) = cur {
        if c == id {
            return Ok(false);
        }
        cur = conn
            .query_row("SELECT parent_id FROM folders WHERE id = ?1", [&c], |r| {
                r.get::<_, Option<String>>(0)
            })
            .optional()?
            .flatten();
    }
    conn.execute(
        "UPDATE folders SET parent_id = ?2 WHERE id = ?1",
        params![id, new_parent],
    )?;
    Ok(true)
}

/// Adds items to a folder; new members go to the end of its manual order.
pub fn add_to_folder(conn: &Connection, item_ids: &[String], folder_id: &str) -> DbResult<()> {
    let mut stmt = conn.prepare(
        "INSERT OR IGNORE INTO item_folders (item_id, folder_id, position)
         VALUES (?1, ?2, (SELECT COALESCE(MAX(position), 0) + 1 FROM item_folders WHERE folder_id = ?2))",
    )?;
    for id in item_ids {
        stmt.execute(params![id, folder_id])?;
    }
    Ok(())
}

/// Moves `ids` (in the given order) in front of `before`, or to the end.
pub fn reorder_in_folder(
    conn: &mut Connection,
    folder_id: &str,
    ids: &[String],
    before: Option<&str>,
) -> DbResult<()> {
    let tx = conn.transaction()?;
    let mut order: Vec<String> = {
        let mut stmt = tx.prepare(
            "SELECT item_id FROM item_folders WHERE folder_id = ?1
             ORDER BY position IS NULL, position, rowid",
        )?;
        let rows = stmt.query_map([folder_id], |r| r.get(0))?;
        rows.collect::<DbResult<_>>()?
    };
    let moving: Vec<String> = ids.iter().filter(|id| order.contains(id)).cloned().collect();
    order.retain(|id| !moving.contains(id));
    let at = before
        .and_then(|b| order.iter().position(|id| id == b))
        .unwrap_or(order.len());
    order.splice(at..at, moving);
    {
        let mut stmt =
            tx.prepare("UPDATE item_folders SET position = ?3 WHERE item_id = ?1 AND folder_id = ?2")?;
        for (i, id) in order.iter().enumerate() {
            stmt.execute(params![id, folder_id, (i + 1) as f64])?;
        }
    }
    tx.commit()
}

/// Returns the child folder called `name` under `parent`, creating it if needed.
pub fn find_or_create_folder(conn: &Connection, parent: Option<&str>, name: &str) -> DbResult<String> {
    let existing = conn
        .query_row(
            "SELECT id FROM folders WHERE name = ?1 AND parent_id IS ?2",
            params![name, parent],
            |r| r.get(0),
        )
        .optional()?;
    match existing {
        Some(id) => Ok(id),
        None => create_folder(conn, name, parent),
    }
}

pub fn remove_from_folder(conn: &Connection, item_ids: &[String], folder_id: &str) -> DbResult<()> {
    let mut stmt = conn.prepare("DELETE FROM item_folders WHERE item_id = ?1 AND folder_id = ?2")?;
    for id in item_ids {
        stmt.execute(params![id, folder_id])?;
    }
    Ok(())
}

// ----------------------------------------------------------------- tags

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub count: i64,
}

pub fn list_tags(conn: &Connection) -> DbResult<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name,
           (SELECT COUNT(*) FROM item_tags x JOIN items i ON i.id = x.item_id
            WHERE x.tag_id = t.id AND i.deleted_at IS NULL)
         FROM tags t ORDER BY t.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Tag {
            id: r.get(0)?,
            name: r.get(1)?,
            count: r.get(2)?,
        })
    })?;
    rows.collect()
}

fn ensure_tag(conn: &Connection, name: &str) -> DbResult<i64> {
    conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [name])?;
    conn.query_row("SELECT id FROM tags WHERE name = ?1", [name], |r| r.get(0))
}

pub fn add_tags(conn: &mut Connection, item_ids: &[String], names: &[String]) -> DbResult<()> {
    let tx = conn.transaction()?;
    for name in names.iter().map(|n| n.trim()).filter(|n| !n.is_empty()) {
        let tag_id = ensure_tag(&tx, name)?;
        let mut stmt =
            tx.prepare_cached("INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?1, ?2)")?;
        for id in item_ids {
            stmt.execute(params![id, tag_id])?;
        }
    }
    tx.commit()
}

pub fn remove_tag(conn: &Connection, item_ids: &[String], tag_id: i64) -> DbResult<()> {
    let mut stmt = conn.prepare("DELETE FROM item_tags WHERE item_id = ?1 AND tag_id = ?2")?;
    for id in item_ids {
        stmt.execute(params![id, tag_id])?;
    }
    Ok(())
}

/// Renames a tag. If another tag already has that name, the two are merged.
pub fn rename_tag(conn: &mut Connection, id: i64, name: &str) -> DbResult<()> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(());
    }
    let tx = conn.transaction()?;
    let existing: Option<i64> = tx
        .query_row(
            "SELECT id FROM tags WHERE name = ?1 AND id != ?2",
            params![name, id],
            |r| r.get(0),
        )
        .optional()?;
    match existing {
        Some(target) => {
            tx.execute(
                "INSERT OR IGNORE INTO item_tags (item_id, tag_id)
                 SELECT item_id, ?2 FROM item_tags WHERE tag_id = ?1",
                params![id, target],
            )?;
            tx.execute("DELETE FROM tags WHERE id = ?1", [id])?;
        }
        None => {
            tx.execute("UPDATE tags SET name = ?2 WHERE id = ?1", params![id, name])?;
        }
    }
    tx.commit()
}

pub fn delete_tag(conn: &Connection, id: i64) -> DbResult<()> {
    conn.execute("DELETE FROM tags WHERE id = ?1", [id])?;
    Ok(())
}

// ------------------------------------------------------------ selection

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FolderRef {
    pub id: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionInfo {
    /// Tags present on at least one selected item; `count` = how many of them.
    pub tags: Vec<Tag>,
    pub folders: Vec<FolderRef>,
}

pub fn selection_info(conn: &Connection, ids: &[String]) -> DbResult<SelectionInfo> {
    if ids.is_empty() {
        return Ok(SelectionInfo { tags: vec![], folders: vec![] });
    }
    let ph = placeholders(ids.len());
    let mut stmt = conn.prepare(&format!(
        "SELECT t.id, t.name, COUNT(*) FROM item_tags x JOIN tags t ON t.id = x.tag_id
         WHERE x.item_id IN ({ph}) GROUP BY t.id ORDER BY t.name COLLATE NOCASE"
    ))?;
    let tags = stmt
        .query_map(params_from_iter(ids), |r| {
            Ok(Tag {
                id: r.get(0)?,
                name: r.get(1)?,
                count: r.get(2)?,
            })
        })?
        .collect::<DbResult<Vec<_>>>()?;
    let mut stmt = conn.prepare(&format!(
        "SELECT folder_id, COUNT(*) FROM item_folders WHERE item_id IN ({ph}) GROUP BY folder_id"
    ))?;
    let folders = stmt
        .query_map(params_from_iter(ids), |r| {
            Ok(FolderRef {
                id: r.get(0)?,
                count: r.get(1)?,
            })
        })?
        .collect::<DbResult<Vec<_>>>()?;
    Ok(SelectionInfo { tags, folders })
}

// ---------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn add(conn: &mut Connection, id: &str, name: &str, at: i64) {
        let tx = conn.transaction().unwrap();
        insert_item(
            &tx,
            &NewItem {
                id: id.into(),
                name: name.into(),
                file_name: name.into(),
                ext: "png".into(),
                width: 10,
                height: 10,
                size: at,
                hash: format!("h-{id}"),
                thumb: format!("{id}.jpg"),
                phash: None,
            },
            at,
        )
        .unwrap();
        tx.commit().unwrap();
    }

    fn q(view: View) -> ItemQuery {
        ItemQuery {
            view,
            search: String::new(),
            tag_ids: vec![],
            tag_match_all: false,
            include_subfolders: false,
            min_rating: 0,
            sort: SortKey::ImportedAt,
            desc: false,
        }
    }

    fn ids(items: Vec<Item>) -> Vec<String> {
        items.into_iter().map(|i| i.id).collect()
    }

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn migrate_is_idempotent() {
        let conn = mem();
        migrate(&conn).unwrap();
        let v: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, SCHEMA_VERSION);
    }

    #[test]
    fn views_and_counts() {
        let mut conn = mem();
        add(&mut conn, "a", "cat.png", 1);
        add(&mut conn, "b", "dog.png", 2);
        add(&mut conn, "c", "bird.png", 3);
        let f = create_folder(&conn, "Animals", None).unwrap();
        add_to_folder(&conn, &s(&["a"]), &f).unwrap();
        add_tags(&mut conn, &s(&["b"]), &s(&["cute"])).unwrap();
        trash_items(&conn, &s(&["c"])).unwrap();

        assert_eq!(ids(query_items(&conn, &q(View::All)).unwrap()), s(&["a", "b"]));
        assert_eq!(ids(query_items(&conn, &q(View::Unfiled)).unwrap()), s(&["b"]));
        assert_eq!(ids(query_items(&conn, &q(View::Untagged)).unwrap()), s(&["a"]));
        assert_eq!(ids(query_items(&conn, &q(View::Trash)).unwrap()), s(&["c"]));
        assert_eq!(
            ids(query_items(&conn, &q(View::Folder { id: f.clone() })).unwrap()),
            s(&["a"])
        );
        assert_eq!(
            counts(&conn).unwrap(),
            Counts { all: 2, unfiled: 1, untagged: 1, trash: 1 }
        );

        restore_items(&conn, &s(&["c"])).unwrap();
        assert_eq!(counts(&conn).unwrap().trash, 0);
        assert_eq!(counts(&conn).unwrap().all, 3);
    }

    #[test]
    fn resolve_duplicates_merges_into_keeper() {
        let mut conn = mem();
        add(&mut conn, "a", "a.png", 1);
        add(&mut conn, "b", "b.png", 2);
        add(&mut conn, "c", "c.png", 3);
        let f = create_folder(&conn, "F", None).unwrap();
        add_to_folder(&conn, &s(&["b"]), &f).unwrap();
        add_tags(&mut conn, &s(&["b"]), &s(&["x"])).unwrap();
        add_tags(&mut conn, &s(&["c"]), &s(&["y"])).unwrap();
        set_rating(&conn, &s(&["c"]), 4).unwrap();

        resolve_duplicates(&mut conn, &[DuplicateGroup { keep: "a".into(), remove: s(&["b", "c"]) }]).unwrap();
        assert_eq!(ids(query_items(&conn, &q(View::All)).unwrap()), s(&["a"]));
        assert_eq!(ids(query_items(&conn, &q(View::Folder { id: f })).unwrap()), s(&["a"]));
        let info = selection_info(&conn, &s(&["a"])).unwrap();
        let mut names: Vec<_> = info.tags.iter().map(|t| t.name.as_str()).collect();
        names.sort();
        assert_eq!(names, ["x", "y"]);
        assert_eq!(get_items(&conn, &s(&["a"])).unwrap()[0].rating, 4);
        assert_eq!(counts(&conn).unwrap().trash, 2);
    }

    #[test]
    fn tag_filter_any_or_all() {
        let mut conn = mem();
        add(&mut conn, "a", "a.png", 1);
        add(&mut conn, "b", "b.png", 2);
        add(&mut conn, "c", "c.png", 3);
        add_tags(&mut conn, &s(&["a", "b"]), &s(&["red"])).unwrap();
        add_tags(&mut conn, &s(&["b", "c"]), &s(&["blue"])).unwrap();
        let tags = list_tags(&conn).unwrap();
        let id = |n: &str| tags.iter().find(|t| t.name == n).unwrap().id;

        let mut query = q(View::All);
        query.tag_ids = vec![id("red"), id("blue")];
        assert_eq!(ids(query_items(&conn, &query).unwrap()), s(&["a", "b", "c"]));
        query.tag_match_all = true;
        assert_eq!(ids(query_items(&conn, &query).unwrap()), s(&["b"]));
    }

    #[test]
    fn search_tags_and_sort() {
        let mut conn = mem();
        add(&mut conn, "a", "Cat_1.png", 1);
        add(&mut conn, "b", "dog.png", 2);
        add(&mut conn, "c", "cat%2.png", 3);
        add_tags(&mut conn, &s(&["b", "c"]), &s(&["pet", "Animal"])).unwrap();
        set_note(&conn, "b", "fluffy friend").unwrap();

        let mut query = q(View::All);
        query.search = "cat".into();
        assert_eq!(ids(query_items(&conn, &query).unwrap()), s(&["a", "c"]));
        query.search = "%".into(); // LIKE wildcard must be escaped
        assert_eq!(ids(query_items(&conn, &query).unwrap()), s(&["c"]));
        query.search = "fluffy".into(); // note
        assert_eq!(ids(query_items(&conn, &query).unwrap()), s(&["b"]));
        query.search = "anim".into(); // tag name
        assert_eq!(ids(query_items(&conn, &query).unwrap()), s(&["b", "c"]));

        let tags = list_tags(&conn).unwrap();
        assert_eq!(tags.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), ["Animal", "pet"]);
        let pet = tags.iter().find(|t| t.name == "pet").unwrap().id;
        remove_tag(&conn, &s(&["c"]), pet).unwrap();
        let mut query = q(View::All);
        query.tag_ids = vec![pet];
        assert_eq!(ids(query_items(&conn, &query).unwrap()), s(&["b"]));

        let mut query = q(View::All);
        query.sort = SortKey::Name;
        query.desc = true;
        assert_eq!(ids(query_items(&conn, &query).unwrap()), s(&["b", "a", "c"])); // "_" > "%"
    }

    #[test]
    fn tag_rename_merges() {
        let mut conn = mem();
        add(&mut conn, "a", "a.png", 1);
        add(&mut conn, "b", "b.png", 2);
        add_tags(&mut conn, &s(&["a"]), &s(&["red"])).unwrap();
        add_tags(&mut conn, &s(&["a", "b"]), &s(&["Rouge"])).unwrap();
        let red = list_tags(&conn).unwrap().into_iter().find(|t| t.name == "red").unwrap();
        rename_tag(&mut conn, red.id, "rouge").unwrap(); // case-insensitive clash
        let tags = list_tags(&conn).unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].count, 2);
    }

    #[test]
    fn folder_tree_ops() {
        let mut conn = mem();
        add(&mut conn, "a", "a.png", 1);
        let p = create_folder(&conn, "Parent", None).unwrap();
        let c = create_folder(&conn, "Child", Some(&p)).unwrap();
        add_to_folder(&conn, &s(&["a"]), &c).unwrap();

        assert!(!move_folder(&conn, &p, Some(&c)).unwrap(), "cycle must be rejected");
        assert!(!move_folder(&conn, &p, Some(&p)).unwrap());
        assert!(move_folder(&conn, &c, None).unwrap());
        assert!(move_folder(&conn, &c, Some(&p)).unwrap());

        let info = selection_info(&conn, &s(&["a"])).unwrap();
        assert_eq!(info.folders, vec![FolderRef { id: c.clone(), count: 1 }]);

        delete_folder(&conn, &p).unwrap(); // cascades to child
        assert!(list_folders(&conn).unwrap().is_empty());
        assert_eq!(counts(&conn).unwrap().unfiled, 1);
        assert_eq!(counts(&conn).unwrap().all, 1);
    }

    #[test]
    fn delete_cascades_links() {
        let mut conn = mem();
        add(&mut conn, "a", "a.png", 1);
        add_tags(&mut conn, &s(&["a"]), &s(&["x"])).unwrap();
        trash_items(&conn, &s(&["a"])).unwrap();
        assert_eq!(trashed_ids(&conn).unwrap(), s(&["a"]));
        let removed = delete_items(&conn, &s(&["a"])).unwrap();
        assert_eq!(removed.len(), 1);
        let links: i64 = conn.query_row("SELECT COUNT(*) FROM item_tags", [], |r| r.get(0)).unwrap();
        assert_eq!(links, 0);
        assert!(hash_index(&conn).unwrap().is_empty());
    }

    #[test]
    fn migrates_v1_library() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        // A library created by v0.1.0 (schema 1) with one filed item.
        conn.execute_batch(
            "CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT NOT NULL, file_name TEXT NOT NULL,
               ext TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, size INTEGER NOT NULL,
               hash TEXT NOT NULL, thumb TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
               imported_at INTEGER NOT NULL, deleted_at INTEGER);
             CREATE TABLE folders (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE, name TEXT NOT NULL);
             CREATE TABLE item_folders (item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
               folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE, PRIMARY KEY (item_id, folder_id));
             CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
             CREATE TABLE item_tags (item_id TEXT NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (item_id, tag_id));
             INSERT INTO items VALUES ('a','a.png','a.png','png',1,1,1,'h','a.jpg','',1,NULL);
             INSERT INTO folders VALUES ('f',NULL,'F');
             INSERT INTO item_folders VALUES ('a','f');
             PRAGMA user_version = 1;",
        )
        .unwrap();
        migrate(&conn).unwrap();
        let mut query = q(View::Folder { id: "f".into() });
        query.sort = SortKey::Manual;
        let items = query_items(&conn, &query).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].rating, 0);
    }

    #[test]
    fn ratings_sort_and_filter() {
        let mut conn = mem();
        add(&mut conn, "a", "a.png", 1);
        add(&mut conn, "b", "b.png", 2);
        add(&mut conn, "c", "c.png", 3);
        set_rating(&conn, &s(&["a"]), 3).unwrap();
        set_rating(&conn, &s(&["c"]), 9).unwrap(); // clamped to 5
        let mut query = q(View::All);
        query.sort = SortKey::Rating;
        query.desc = true;
        assert_eq!(ids(query_items(&conn, &query).unwrap()), s(&["c", "a", "b"]));
        assert_eq!(query_items(&conn, &query).unwrap()[0].rating, 5);
        query.min_rating = 3;
        assert_eq!(ids(query_items(&conn, &query).unwrap()), s(&["c", "a"]));
    }

    #[test]
    fn search_syntax_end_to_end() {
        let mut conn = mem();
        add(&mut conn, "a", "black cat.png", 1);
        add(&mut conn, "b", "black dog.png", 2);
        add(&mut conn, "c", "white cat.png", 3);
        add_tags(&mut conn, &s(&["c"]), &s(&["pet store"])).unwrap();
        let find = |conn: &Connection, text: &str| {
            let mut query = q(View::All);
            query.search = text.into();
            ids(query_items(conn, &query).unwrap())
        };
        assert_eq!(find(&conn, "(cat OR dog) black"), s(&["a", "b"]));
        assert_eq!(find(&conn, "cat -black"), s(&["c"]));
        assert_eq!(find(&conn, "dog || white"), s(&["b", "c"]));
        assert_eq!(find(&conn, r#""pet store""#), s(&["c"]));
        assert_eq!(find(&conn, "-cat -dog"), Vec::<String>::new());
    }

    #[test]
    fn subfolders_and_manual_order() {
        let mut conn = mem();
        for (i, id) in ["a", "b", "c", "d"].iter().enumerate() {
            add(&mut conn, id, &format!("{id}.png"), i as i64);
        }
        let p = create_folder(&conn, "P", None).unwrap();
        let c = create_folder(&conn, "C", Some(&p)).unwrap();
        let g = create_folder(&conn, "G", Some(&c)).unwrap();
        add_to_folder(&conn, &s(&["a", "b", "c"]), &p).unwrap();
        add_to_folder(&conn, &s(&["d"]), &g).unwrap();

        let mut query = q(View::Folder { id: p.clone() });
        query.sort = SortKey::Manual;
        assert_eq!(ids(query_items(&conn, &query).unwrap()), s(&["a", "b", "c"]));
        query.include_subfolders = true;
        assert_eq!(ids(query_items(&conn, &query).unwrap()), s(&["a", "b", "c", "d"]));

        query.include_subfolders = false;
        reorder_in_folder(&mut conn, &p, &s(&["c"]), Some("a")).unwrap();
        assert_eq!(ids(query_items(&conn, &query).unwrap()), s(&["c", "a", "b"]));
        reorder_in_folder(&mut conn, &p, &s(&["c", "a"]), None).unwrap();
        assert_eq!(ids(query_items(&conn, &query).unwrap()), s(&["b", "c", "a"]));
        // Newly added items go to the end.
        add_to_folder(&conn, &s(&["d"]), &p).unwrap();
        assert_eq!(ids(query_items(&conn, &query).unwrap()), s(&["b", "c", "a", "d"]));
    }

    #[test]
    fn find_or_create_reuses() {
        let conn = mem();
        let a = find_or_create_folder(&conn, None, "Photos").unwrap();
        assert_eq!(find_or_create_folder(&conn, None, "Photos").unwrap(), a);
        let child = find_or_create_folder(&conn, Some(&a), "Photos").unwrap();
        assert_ne!(child, a, "same name under a different parent is a different folder");
        assert_eq!(find_or_create_folder(&conn, Some(&a), "Photos").unwrap(), child);
    }
}
