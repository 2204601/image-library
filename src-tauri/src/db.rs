//! SQLite schema and queries. Everything here takes a plain `Connection`
//! so it can be unit-tested without Tauri.

use rusqlite::{params, params_from_iter, Connection, OptionalExtension, ToSql, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{search, similar};

pub type DbResult<T> = rusqlite::Result<T>;

const SCHEMA_VERSION: i32 = 4;

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

fn has_column(conn: &Connection, table: &str, column: &str) -> DbResult<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = stmt.query_map([], |r| r.get::<_, String>(1))?;
    for name in names {
        if name? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Adds a column unless it already exists. Returns whether it was added, so
/// one-time seeding can be skipped when a step runs again.
fn add_column(conn: &Connection, table: &str, column: &str, decl: &str) -> DbResult<bool> {
    if has_column(conn, table, column)? {
        return Ok(false);
    }
    conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"))?;
    Ok(true)
}

/// Brings the schema up to `SCHEMA_VERSION`.
///
/// Every step is safe to run again: an older build of the app that opens a
/// newer library leaves the extra columns in place but may lower
/// `user_version`, so the steps check what exists instead of trusting the
/// number. Each step runs in its own transaction and records its version, and
/// the version is never lowered here.
pub fn migrate(conn: &Connection) -> DbResult<()> {
    let version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let step = |target: i32, f: &dyn Fn(&Connection) -> DbResult<()>| -> DbResult<()> {
        if version >= target {
            return Ok(());
        }
        let tx = conn.unchecked_transaction()?; // rolled back on error (drop)
        f(&tx)?;
        tx.pragma_update(None, "user_version", target)?;
        tx.commit()
    };

    step(1, &|c| {
        c.execute_batch(
            "CREATE TABLE IF NOT EXISTS items (
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
             CREATE INDEX IF NOT EXISTS idx_items_hash ON items(hash);
             CREATE INDEX IF NOT EXISTS idx_items_deleted ON items(deleted_at, imported_at);

             CREATE TABLE IF NOT EXISTS folders (
               id        TEXT PRIMARY KEY,
               parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
               name      TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);

             CREATE TABLE IF NOT EXISTS item_folders (
               item_id   TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
               folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
               PRIMARY KEY (item_id, folder_id)
             );
             CREATE INDEX IF NOT EXISTS idx_item_folders_folder ON item_folders(folder_id);

             CREATE TABLE IF NOT EXISTS tags (
               id   INTEGER PRIMARY KEY,
               name TEXT NOT NULL UNIQUE COLLATE NOCASE
             );

             CREATE TABLE IF NOT EXISTS item_tags (
               item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
               tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
               PRIMARY KEY (item_id, tag_id)
             );
             CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id);",
        )
    })?;

    // Star ratings, and a per-folder position for manual ordering.
    step(2, &|c| {
        add_column(c, "items", "rating", "INTEGER NOT NULL DEFAULT 0")?;
        if add_column(c, "item_folders", "position", "REAL")? {
            c.execute_batch("UPDATE item_folders SET position = rowid")?;
        }
        Ok(())
    })?;

    // Perceptual hash for near-duplicate detection; NULL = not computed yet.
    // pcolor = average colour 0xRRGGBB (see similar.rs).
    step(3, &|c| {
        add_column(c, "items", "phash", "INTEGER")?;
        add_column(c, "items", "pcolor", "INTEGER")?;
        Ok(())
    })?;

    // - items.preview: JPEG display copy for formats the web view can't show.
    // - folders.sort_order: user-defined order among siblings (seeded A→Z).
    // - smart_folders: saved conditions (`rule` is a JSON-encoded `Rule`).
    step(4, &|c| {
        add_column(c, "items", "preview", "TEXT")?;
        if add_column(c, "folders", "sort_order", "REAL")? {
            c.execute_batch(
                "UPDATE folders SET sort_order = (
                   SELECT COUNT(*) FROM folders o
                   WHERE o.parent_id IS folders.parent_id
                     AND (o.name < folders.name COLLATE NOCASE
                          OR (o.name = folders.name COLLATE NOCASE AND o.id < folders.id)))",
            )?;
        }
        c.execute_batch(
            "CREATE TABLE IF NOT EXISTS smart_folders (
               id         TEXT PRIMARY KEY,
               name       TEXT NOT NULL,
               rule       TEXT NOT NULL,
               sort_order REAL NOT NULL
             )",
        )
    })?;
    // New steps go above; the last one must be SCHEMA_VERSION.
    debug_assert!(
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i32>(0))? >= SCHEMA_VERSION,
        "add a migrate() step for SCHEMA_VERSION"
    );
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
    /// File name in `previews/` of a JPEG display copy, if the original
    /// format can't be shown by the web view.
    pub preview: Option<String>,
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
    pub preview: Option<String>,
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
    /// Items matching a smart folder's saved rule.
    Smart { id: String },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Shape {
    Landscape,
    Portrait,
    Square,
}

/// Attribute filters (the filter bar). Empty / None = no restriction.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Filter {
    /// File types, e.g. "jpg" (also matches .jpeg), "png".
    pub exts: Vec<String>,
    /// Any of these shapes. Square = sides within 5% of each other.
    pub shapes: Vec<Shape>,
    pub min_width: Option<u32>,
    pub max_width: Option<u32>,
    pub min_height: Option<u32>,
    pub max_height: Option<u32>,
    /// Import time range in ms; `after` inclusive, `before` exclusive.
    pub imported_after: Option<i64>,
    pub imported_before: Option<i64>,
    /// File size range in bytes (inclusive).
    pub min_size: Option<i64>,
    pub max_size: Option<i64>,
}

/// A set of conditions. Ad-hoc queries are built from the toolbar state;
/// smart folders store one as JSON.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Rule {
    pub search: String,
    pub tag_ids: Vec<i64>,
    pub tag_match_all: bool,
    pub min_rating: u8,
    pub filter: Filter,
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
    #[serde(default)]
    pub filter: Filter,
    pub sort: SortKey,
    pub desc: bool,
}

impl ItemQuery {
    fn rule(&self) -> Rule {
        Rule {
            search: self.search.clone(),
            tag_ids: self.tag_ids.clone(),
            tag_match_all: self.tag_match_all,
            min_rating: self.min_rating,
            filter: self.filter.clone(),
        }
    }
}

const ITEM_COLS: &str = "items.id, items.name, items.file_name, items.ext, items.width, items.height, \
     items.size, items.thumb, items.note, items.rating, items.imported_at, items.deleted_at, items.preview";

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
        preview: r.get(12)?,
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

/// Spellings that count as the same file type.
fn ext_aliases(ext: &str) -> Vec<String> {
    let e = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    match e.as_str() {
        "jpg" | "jpeg" => vec!["jpg".into(), "jpeg".into()],
        "tif" | "tiff" => vec!["tif".into(), "tiff".into()],
        "heic" | "heif" => vec!["heic".into(), "heif".into()],
        _ => vec![e],
    }
}

/// Canonical name of a file type for display / filters ("jpeg" -> "jpg").
pub fn canonical_ext(ext: &str) -> String {
    ext_aliases(ext).swap_remove(0)
}

/// Adds the WHERE clauses for `rule`.
fn push_rule(rule: &Rule, wheres: &mut Vec<String>, args: &mut Vec<Box<dyn ToSql>>) {
    if let Some(expr) = search::parse(&rule.search) {
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

    if rule.min_rating > 0 {
        wheres.push("items.rating >= ?".into());
        args.push(Box::new(rule.min_rating));
    }

    if !rule.tag_ids.is_empty() {
        let marks = placeholders(rule.tag_ids.len());
        // AND: the item carries every selected tag; OR: at least one of them.
        let need = if rule.tag_match_all { rule.tag_ids.len() } else { 1 };
        wheres.push(format!(
            "(SELECT COUNT(*) FROM item_tags t WHERE t.item_id = items.id AND t.tag_id IN ({marks})) >= {need}"
        ));
        for tag_id in &rule.tag_ids {
            args.push(Box::new(*tag_id));
        }
    }

    let f = &rule.filter;
    if !f.exts.is_empty() {
        let exts: Vec<String> = f.exts.iter().flat_map(|e| ext_aliases(e)).collect();
        wheres.push(format!("lower(items.ext) IN ({})", placeholders(exts.len())));
        args.extend(exts.into_iter().map(|e| Box::new(e) as Box<dyn ToSql>));
    }
    if !f.shapes.is_empty() {
        let parts: Vec<&str> = f
            .shapes
            .iter()
            .map(|s| match s {
                Shape::Landscape => "items.width > items.height * 1.05",
                Shape::Portrait => "items.height > items.width * 1.05",
                Shape::Square => {
                    "(items.width <= items.height * 1.05 AND items.height <= items.width * 1.05)"
                }
            })
            .collect();
        wheres.push(format!("({})", parts.join(" OR ")));
    }
    let mut range = |col: &str, op: &str, v: Option<i64>| {
        if let Some(v) = v {
            wheres.push(format!("{col} {op} ?"));
            args.push(Box::new(v));
        }
    };
    range("items.width", ">=", f.min_width.map(i64::from));
    range("items.width", "<=", f.max_width.map(i64::from));
    range("items.height", ">=", f.min_height.map(i64::from));
    range("items.height", "<=", f.max_height.map(i64::from));
    range("items.imported_at", ">=", f.imported_after);
    range("items.imported_at", "<", f.imported_before);
    range("items.size", ">=", f.min_size);
    range("items.size", "<=", f.max_size);
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
        View::All | View::Trash | View::Similar | View::Smart { .. } => {}
    }

    push_rule(&q.rule(), &mut wheres, &mut args);
    if let View::Smart { id } = &q.view {
        match load_rule(conn, id)? {
            Some(rule) => push_rule(&rule, &mut wheres, &mut args),
            None => wheres.push("0".into()), // folder was deleted
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
        "INSERT INTO items (id, name, file_name, ext, width, height, size, hash, thumb, imported_at, phash, pcolor, preview)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
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
            it.phash.map(|(_, c)| c),
            it.preview
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
         FROM folders f ORDER BY f.sort_order IS NULL, f.sort_order, f.name COLLATE NOCASE",
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

/// Creates a folder at the end of its siblings.
pub fn create_folder(conn: &Connection, name: &str, parent_id: Option<&str>) -> DbResult<String> {
    let id = uuid::Uuid::new_v4().simple().to_string();
    conn.execute(
        "INSERT INTO folders (id, parent_id, name, sort_order) VALUES (?1, ?2, ?3,
           (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM folders WHERE parent_id IS ?2))",
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

/// Re-parents a folder (to the end of its new siblings). Returns false (and
/// does nothing) if that would create a cycle.
pub fn move_folder(conn: &mut Connection, id: &str, new_parent: Option<&str>) -> DbResult<bool> {
    place_folder(conn, id, new_parent, None)
}

fn would_cycle(conn: &Connection, id: &str, new_parent: Option<&str>) -> DbResult<bool> {
    let mut cur = new_parent.map(str::to_owned);
    while let Some(c) = cur {
        if c == id {
            return Ok(true);
        }
        cur = conn
            .query_row("SELECT parent_id FROM folders WHERE id = ?1", [&c], |r| {
                r.get::<_, Option<String>>(0)
            })
            .optional()?
            .flatten();
    }
    Ok(false)
}

fn sibling_ids(conn: &Connection, parent: Option<&str>) -> DbResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT id FROM folders WHERE parent_id IS ?1
         ORDER BY sort_order IS NULL, sort_order, name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([parent], |r| r.get(0))?;
    rows.collect()
}

fn renumber(conn: &Connection, ids: &[String]) -> DbResult<()> {
    let mut stmt = conn.prepare("UPDATE folders SET sort_order = ?2 WHERE id = ?1")?;
    for (i, id) in ids.iter().enumerate() {
        stmt.execute(params![id, (i + 1) as f64])?;
    }
    Ok(())
}

/// Puts a folder under `parent`, in front of sibling `before` (None = last).
/// Returns false (and does nothing) if that would create a cycle.
pub fn place_folder(
    conn: &mut Connection,
    id: &str,
    parent: Option<&str>,
    before: Option<&str>,
) -> DbResult<bool> {
    if would_cycle(conn, id, parent)? {
        return Ok(false);
    }
    let tx = conn.transaction()?;
    tx.execute("UPDATE folders SET parent_id = ?2 WHERE id = ?1", params![id, parent])?;
    let mut order = sibling_ids(&tx, parent)?;
    order.retain(|x| x != id);
    let at = before
        .and_then(|b| order.iter().position(|x| x == b))
        .unwrap_or(order.len());
    order.insert(at, id.to_owned());
    renumber(&tx, &order)?;
    tx.commit()?;
    Ok(true)
}

/// Moves a folder up (-1) / down (+1) among its siblings, or to the
/// top (`i32::MIN`) / bottom (`i32::MAX`).
pub fn shift_folder(conn: &mut Connection, id: &str, by: i32) -> DbResult<()> {
    let tx = conn.transaction()?;
    let parent: Option<String> =
        tx.query_row("SELECT parent_id FROM folders WHERE id = ?1", [id], |r| r.get(0))?;
    let mut order = sibling_ids(&tx, parent.as_deref())?;
    if let Some(from) = order.iter().position(|x| x == id) {
        let item = order.remove(from);
        let to = (from as i64 + by as i64).clamp(0, order.len() as i64) as usize;
        order.insert(to, item);
        renumber(&tx, &order)?;
    }
    tx.commit()
}

/// Resets the children of `parent` to A→Z order.
pub fn sort_folders_by_name(conn: &mut Connection, parent: Option<&str>) -> DbResult<()> {
    let tx = conn.transaction()?;
    let ids: Vec<String> = {
        let mut stmt = tx.prepare(
            "SELECT id FROM folders WHERE parent_id IS ?1 ORDER BY name COLLATE NOCASE, id",
        )?;
        let rows = stmt.query_map([parent], |r| r.get(0))?;
        rows.collect::<DbResult<_>>()?
    };
    renumber(&tx, &ids)?;
    tx.commit()
}

// -------------------------------------------------------- smart folders

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartFolder {
    pub id: String,
    pub name: String,
    pub rule: Rule,
    pub count: i64,
}

fn load_rule(conn: &Connection, id: &str) -> DbResult<Option<Rule>> {
    let json: Option<String> = conn
        .query_row("SELECT rule FROM smart_folders WHERE id = ?1", [id], |r| r.get(0))
        .optional()?;
    Ok(json.map(|j| clean_rule(conn, serde_json::from_str(&j).unwrap_or_default())))
}

/// Drops references to tags that have since been deleted.
fn clean_rule(conn: &Connection, mut rule: Rule) -> Rule {
    rule.tag_ids.retain(|t| {
        conn.query_row("SELECT 1 FROM tags WHERE id = ?1", [t], |_| Ok(()))
            .optional()
            .ok()
            .flatten()
            .is_some()
    });
    rule
}

fn count_rule(conn: &Connection, rule: &Rule) -> DbResult<i64> {
    let mut wheres = vec!["items.deleted_at IS NULL".to_string()];
    let mut args: Vec<Box<dyn ToSql>> = Vec::new();
    push_rule(rule, &mut wheres, &mut args);
    conn.query_row(
        &format!("SELECT COUNT(*) FROM items WHERE {}", wheres.join(" AND ")),
        params_from_iter(args.iter().map(|b| b.as_ref())),
        |r| r.get(0),
    )
}

pub fn list_smart_folders(conn: &Connection) -> DbResult<Vec<SmartFolder>> {
    let rows: Vec<(String, String, String)> = {
        let mut stmt =
            conn.prepare("SELECT id, name, rule FROM smart_folders ORDER BY sort_order, name")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        rows.collect::<DbResult<_>>()?
    };
    rows.into_iter()
        .map(|(id, name, json)| {
            let rule = clean_rule(conn, serde_json::from_str(&json).unwrap_or_default());
            let count = count_rule(conn, &rule)?;
            Ok(SmartFolder { id, name, rule, count })
        })
        .collect()
}

pub fn create_smart_folder(conn: &Connection, name: &str, rule: &Rule) -> DbResult<String> {
    let id = uuid::Uuid::new_v4().simple().to_string();
    conn.execute(
        "INSERT INTO smart_folders (id, name, rule, sort_order)
         VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM smart_folders))",
        params![id, name, serde_json::to_string(rule).unwrap_or_default()],
    )?;
    Ok(id)
}

pub fn update_smart_folder(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    rule: Option<&Rule>,
) -> DbResult<()> {
    if let Some(n) = name {
        conn.execute("UPDATE smart_folders SET name = ?2 WHERE id = ?1", params![id, n])?;
    }
    if let Some(r) = rule {
        conn.execute(
            "UPDATE smart_folders SET rule = ?2 WHERE id = ?1",
            params![id, serde_json::to_string(r).unwrap_or_default()],
        )?;
    }
    Ok(())
}

pub fn delete_smart_folder(conn: &Connection, id: &str) -> DbResult<()> {
    conn.execute("DELETE FROM smart_folders WHERE id = ?1", [id])?;
    Ok(())
}

/// File types in the library with counts (live items), for the filter bar.
pub fn list_exts(conn: &Connection) -> DbResult<Vec<(String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT lower(ext), COUNT(*) FROM items WHERE deleted_at IS NULL GROUP BY lower(ext)",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    let mut merged: Vec<(String, i64)> = Vec::new();
    for row in rows {
        let (ext, n) = row?;
        let ext = canonical_ext(&ext);
        match merged.iter_mut().find(|(e, _)| *e == ext) {
            Some((_, c)) => *c += n,
            None => merged.push((ext, n)),
        }
    }
    merged.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    Ok(merged)
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
                preview: None,
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
            filter: Filter::default(),
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

        assert!(!move_folder(&mut conn, &p, Some(&c)).unwrap(), "cycle must be rejected");
        assert!(!move_folder(&mut conn, &p, Some(&p)).unwrap());
        assert!(move_folder(&mut conn, &c, None).unwrap());
        assert!(move_folder(&mut conn, &c, Some(&p)).unwrap());

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

    #[test]
    fn attribute_filters() {
        let mut conn = mem();
        // add() makes 10x10 png items; adjust per item.
        for (id, ext, w, h, size, at) in [
            ("a", "JPEG", 1200, 800, 500_000, 1_000),
            ("b", "png", 600, 900, 50_000, 2_000),
            ("c", "png", 500, 510, 5_000_000, 3_000),
            ("d", "tif", 100, 100, 10, 4_000),
        ] {
            add(&mut conn, id, &format!("{id}.{ext}"), at);
            conn.execute(
                "UPDATE items SET ext = ?2, width = ?3, height = ?4, size = ?5 WHERE id = ?1",
                params![id, ext, w, h, size],
            )
            .unwrap();
        }
        let find = |conn: &Connection, f: Filter| {
            let mut query = q(View::All);
            query.filter = f;
            ids(query_items(conn, &query).unwrap())
        };
        let f = |set: fn(&mut Filter)| {
            let mut f = Filter::default();
            set(&mut f);
            f
        };
        assert_eq!(find(&conn, f(|f| f.exts = vec!["jpg".into()])), s(&["a"]), "jpg matches .JPEG");
        assert_eq!(find(&conn, f(|f| f.exts = vec!["tiff".into(), "png".into()])), s(&["b", "c", "d"]));
        assert_eq!(find(&conn, f(|f| f.shapes = vec![Shape::Landscape])), s(&["a"]));
        assert_eq!(find(&conn, f(|f| f.shapes = vec![Shape::Portrait])), s(&["b"]));
        assert_eq!(find(&conn, f(|f| f.shapes = vec![Shape::Square])), s(&["c", "d"]), "within 5%");
        assert_eq!(find(&conn, f(|f| f.min_width = Some(600))), s(&["a", "b"]));
        assert_eq!(find(&conn, f(|f| { f.min_height = Some(500); f.max_height = Some(850) })), s(&["a", "c"]));
        assert_eq!(find(&conn, f(|f| { f.imported_after = Some(2_000); f.imported_before = Some(4_000) })), s(&["b", "c"]));
        assert_eq!(find(&conn, f(|f| f.max_size = Some(50_000))), s(&["b", "d"]));
        assert_eq!(find(&conn, f(|f| f.min_size = Some(1_000_000))), s(&["c"]));
        assert_eq!(
            list_exts(&conn).unwrap(),
            vec![("png".to_string(), 2), ("jpg".to_string(), 1), ("tif".to_string(), 1)]
        );
    }

    #[test]
    fn smart_folders() {
        let mut conn = mem();
        add(&mut conn, "a", "cat.png", 1);
        add(&mut conn, "b", "dog.png", 2);
        add(&mut conn, "c", "cat2.png", 3);
        set_rating(&conn, &s(&["a", "b"]), 4).unwrap();
        add_tags(&mut conn, &s(&["a", "c"]), &s(&["pet"])).unwrap();
        let pet = list_tags(&conn).unwrap()[0].id;

        let rule = Rule { min_rating: 3, ..Default::default() };
        let id = create_smart_folder(&conn, "Good", &rule).unwrap();
        let list = list_smart_folders(&conn).unwrap();
        assert_eq!((list[0].name.as_str(), list[0].count), ("Good", 2));
        assert_eq!(list[0].rule, rule);

        // The smart rule is combined with the ad-hoc search.
        let mut query = q(View::Smart { id: id.clone() });
        assert_eq!(ids(query_items(&conn, &query).unwrap()), s(&["a", "b"]));
        query.search = "cat".into();
        assert_eq!(ids(query_items(&conn, &query).unwrap()), s(&["a"]));

        let rule = Rule { tag_ids: vec![pet], search: "cat".into(), ..Default::default() };
        update_smart_folder(&conn, &id, Some("Cats"), Some(&rule)).unwrap();
        assert_eq!(list_smart_folders(&conn).unwrap()[0].count, 2);
        // Trashed items don't count.
        trash_items(&conn, &s(&["c"])).unwrap();
        assert_eq!(list_smart_folders(&conn).unwrap()[0].count, 1);
        // A deleted tag drops out of the rule instead of matching nothing.
        delete_tag(&conn, pet).unwrap();
        let sf = &list_smart_folders(&conn).unwrap()[0];
        assert!(sf.rule.tag_ids.is_empty());
        assert_eq!(sf.count, 1); // just "cat" now (c is trashed)

        delete_smart_folder(&conn, &id).unwrap();
        assert!(list_smart_folders(&conn).unwrap().is_empty());
        let query = q(View::Smart { id });
        assert!(query_items(&conn, &query).unwrap().is_empty(), "deleted smart folder shows nothing");
    }

    #[test]
    fn folder_order() {
        let mut conn = mem();
        let names = |conn: &Connection, parent: Option<&str>| -> Vec<String> {
            list_folders(conn)
                .unwrap()
                .into_iter()
                .filter(|f| f.parent_id.as_deref() == parent)
                .map(|f| f.name)
                .collect()
        };
        let b = create_folder(&conn, "B", None).unwrap();
        let a = create_folder(&conn, "A", None).unwrap();
        let c = create_folder(&conn, "C", None).unwrap();
        assert_eq!(names(&conn, None), ["B", "A", "C"], "new folders go last");

        shift_folder(&mut conn, &c, -1).unwrap();
        assert_eq!(names(&conn, None), ["B", "C", "A"]);
        shift_folder(&mut conn, &a, i32::MIN).unwrap();
        assert_eq!(names(&conn, None), ["A", "B", "C"]);
        shift_folder(&mut conn, &a, i32::MAX).unwrap();
        assert_eq!(names(&conn, None), ["B", "C", "A"]);

        assert!(place_folder(&mut conn, &a, None, Some(&b)).unwrap());
        assert_eq!(names(&conn, None), ["A", "B", "C"]);
        // Into another folder, in front of an existing child.
        let x = create_folder(&conn, "X", Some(&b)).unwrap();
        assert!(place_folder(&mut conn, &c, Some(&b), Some(&x)).unwrap());
        assert_eq!(names(&conn, Some(&b)), ["C", "X"]);
        assert!(!place_folder(&mut conn, &b, Some(&x), None).unwrap(), "no cycles");

        place_folder(&mut conn, &x, Some(&b), Some(&c)).unwrap();
        assert_eq!(names(&conn, Some(&b)), ["X", "C"]);
        sort_folders_by_name(&mut conn, Some(&b)).unwrap();
        assert_eq!(names(&conn, Some(&b)), ["C", "X"]);
    }

    #[test]
    fn v4_seeds_folder_order_alphabetically() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT NOT NULL, file_name TEXT NOT NULL,
               ext TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, size INTEGER NOT NULL,
               hash TEXT NOT NULL, thumb TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
               imported_at INTEGER NOT NULL, deleted_at INTEGER,
               rating INTEGER NOT NULL DEFAULT 0, phash INTEGER, pcolor INTEGER);
             CREATE TABLE folders (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL);
             CREATE TABLE item_folders (item_id TEXT NOT NULL, folder_id TEXT NOT NULL,
               position REAL, PRIMARY KEY (item_id, folder_id));
             CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
             CREATE TABLE item_tags (item_id TEXT NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (item_id, tag_id));
             INSERT INTO folders VALUES ('1', NULL, 'zebra'), ('2', NULL, 'Apple'), ('3', '1', 'b'), ('4', '1', 'a');
             PRAGMA user_version = 3;",
        )
        .unwrap();
        migrate(&conn).unwrap();
        let folders = list_folders(&conn).unwrap();
        let under = |p: Option<&str>| -> Vec<&str> {
            folders.iter().filter(|f| f.parent_id.as_deref() == p).map(|f| f.name.as_str()).collect()
        };
        assert_eq!(under(None), ["Apple", "zebra"]); // A→Z within each parent
        assert_eq!(under(Some("1")), ["a", "b"]);
    }

    /// An older build that opens a newer library lowers `user_version` but
    /// keeps the new columns. Opening it with this build again must work and
    /// must not reset anything the user arranged in the meantime.
    #[test]
    fn reopening_after_older_build_lowered_the_version() {
        let mut conn = mem();
        add(&mut conn, "a", "a.png", 1);
        add(&mut conn, "b", "b.png", 2);
        let f = create_folder(&conn, "Zeta", None).unwrap();
        let g = create_folder(&conn, "Alpha", None).unwrap();
        add_to_folder(&conn, &s(&["a", "b"]), &f).unwrap();
        reorder_in_folder(&mut conn, &f, &s(&["b"]), Some("a")).unwrap(); // b before a
        create_smart_folder(&conn, "Saved", &Rule { min_rating: 2, ..Default::default() }).unwrap();
        set_rating(&conn, &s(&["a"]), 5).unwrap();

        for older in [0, 1, 2, 3] {
            conn.pragma_update(None, "user_version", older).unwrap();
            migrate(&conn).unwrap_or_else(|e| panic!("from user_version {older}: {e}"));
            let v: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
            assert_eq!(v, SCHEMA_VERSION);
        }

        // Folder order (Zeta before Alpha, not re-seeded A→Z), manual item
        // order, smart folders and ratings all survive.
        let names: Vec<String> = list_folders(&conn).unwrap().into_iter().map(|x| x.name).collect();
        assert_eq!(names, ["Zeta", "Alpha"]);
        let _ = g;
        let mut query = q(View::Folder { id: f });
        query.sort = SortKey::Manual;
        assert_eq!(ids(query_items(&conn, &query).unwrap()), s(&["b", "a"]));
        assert_eq!(list_smart_folders(&conn).unwrap().len(), 1);
        assert_eq!(get_items(&conn, &s(&["a"])).unwrap()[0].rating, 5);
    }

    #[test]
    fn never_lowers_a_newer_version() {
        let conn = mem();
        conn.pragma_update(None, "user_version", SCHEMA_VERSION + 5).unwrap();
        migrate(&conn).unwrap();
        let v: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, SCHEMA_VERSION + 5);
    }

    #[test]
    fn failed_step_leaves_no_open_transaction() {
        // A broken library (items missing) makes step 2 fail; the connection
        // must not be left inside the half-done transaction.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE item_folders (item_id TEXT, folder_id TEXT);
             CREATE TABLE items_x (id TEXT);
             PRAGMA user_version = 1;",
        )
        .unwrap();
        assert!(migrate(&conn).is_err());
        assert!(conn.is_autocommit(), "transaction was rolled back");
        let v: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 1, "version not bumped past the failed step");
        assert!(!has_column(&conn, "item_folders", "position").unwrap(), "partial step undone");
    }

    /// The reported case: a library made by v0.3.0 (schema 3), then opened by
    /// an older build that wrote user_version back to 2.
    #[test]
    fn v3_library_with_version_written_back_to_2() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT NOT NULL, file_name TEXT NOT NULL,
               ext TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, size INTEGER NOT NULL,
               hash TEXT NOT NULL, thumb TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
               imported_at INTEGER NOT NULL, deleted_at INTEGER,
               rating INTEGER NOT NULL DEFAULT 0, phash INTEGER, pcolor INTEGER);
             CREATE TABLE folders (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL);
             CREATE TABLE item_folders (item_id TEXT NOT NULL, folder_id TEXT NOT NULL,
               position REAL, PRIMARY KEY (item_id, folder_id));
             CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
             CREATE TABLE item_tags (item_id TEXT NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (item_id, tag_id));
             INSERT INTO items (id, name, file_name, ext, width, height, size, hash, thumb, imported_at, phash, pcolor)
               VALUES ('a', 'a.png', 'a.png', 'png', 1, 1, 1, 'h', 'a.jpg', 1, 42, 7);
             INSERT INTO folders VALUES ('f', NULL, 'F');
             INSERT INTO item_folders VALUES ('a', 'f', 9);
             PRAGMA user_version = 2;",
        )
        .unwrap();
        migrate(&conn).unwrap();
        let v: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, SCHEMA_VERSION);
        assert!(has_column(&conn, "items", "preview").unwrap());
        assert!(list_smart_folders(&conn).unwrap().is_empty());
        let (phash, pos): (i64, f64) = conn
            .query_row(
                "SELECT phash, position FROM items JOIN item_folders ON item_id = id",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((phash, pos), (42, 9.0), "existing hashes / positions untouched");
    }
}
