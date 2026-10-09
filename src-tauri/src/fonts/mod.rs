//! Font files (TTF / OTF / WOFF / WOFF2 / TTC / OTC): unpacking to plain
//! OpenType data, names and character lists, and a rendered sample used as
//! the thumbnail. The original file is stored as is, like images.

pub mod commands;

use image::{DynamicImage, RgbaImage};
use serde::Serialize;
use skrifa::raw::TableProvider;
use skrifa::string::StringId;
use skrifa::{FontRef, MetadataProvider};
use std::io::Read;

/// Thumbnail canvas (4:3).
pub const THUMB_W: u32 = 512;
pub const THUMB_H: u32 = 384;

fn be16(d: &[u8], at: usize) -> Result<u16, String> {
    d.get(at..at + 2).map(|b| u16::from_be_bytes([b[0], b[1]])).ok_or_else(|| "フォントが壊れています".into())
}

fn be32(d: &[u8], at: usize) -> Result<u32, String> {
    d.get(at..at + 4)
        .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
        .ok_or_else(|| "フォントが壊れています".into())
}

/// The file as plain OpenType / TrueType data (a collection stays a collection).
pub fn to_sfnt(data: &[u8], ext: &str) -> Result<Vec<u8>, String> {
    match ext {
        "woff" => decode_woff(data),
        "woff2" => woff2_patched::convert_woff2_to_ttf(&mut &data[..]).map_err(|e| format!("WOFF2: {e}")),
        _ => Ok(data.to_vec()),
    }
}

/// WOFF 1.0: each table is zlib-compressed unless that wouldn't make it smaller.
fn decode_woff(d: &[u8]) -> Result<Vec<u8>, String> {
    if d.get(..4) != Some(b"wOFF") {
        return Err("WOFF ではありません".into());
    }
    let flavor = be32(d, 4)?;
    let n = be16(d, 12)? as usize;
    let mut tables = Vec::with_capacity(n);
    for i in 0..n {
        let e = 44 + i * 20;
        let tag: [u8; 4] = d.get(e..e + 4).ok_or("WOFF が壊れています")?.try_into().unwrap();
        let (off, comp, orig) = (be32(d, e + 4)? as usize, be32(d, e + 8)? as usize, be32(d, e + 12)? as usize);
        let raw = d.get(off..off + comp).ok_or("WOFF が壊れています")?;
        let table = if comp < orig {
            let mut out = Vec::with_capacity(orig);
            flate2::read::ZlibDecoder::new(raw).read_to_end(&mut out).map_err(|e| format!("WOFF: {e}"))?;
            out
        } else {
            raw.to_vec()
        };
        tables.push((tag, table));
    }
    Ok(build_sfnt(flavor, tables))
}

fn checksum(data: &[u8]) -> u32 {
    data.chunks(4).fold(0u32, |sum, c| {
        let mut w = [0u8; 4];
        w[..c.len()].copy_from_slice(c);
        sum.wrapping_add(u32::from_be_bytes(w))
    })
}

/// Writes a single-font OpenType file from its tables.
fn build_sfnt(flavor: u32, mut tables: Vec<([u8; 4], Vec<u8>)>) -> Vec<u8> {
    tables.sort_by_key(|(tag, _)| *tag);
    let n = tables.len() as u16;
    let pow = if n == 0 { 0 } else { 15 - n.leading_zeros() as u16 }; // floor(log2 n)
    let search = (1u16 << pow) * 16;
    let mut out = Vec::new();
    out.extend(flavor.to_be_bytes());
    out.extend(n.to_be_bytes());
    out.extend(search.to_be_bytes());
    out.extend(pow.to_be_bytes());
    out.extend((n * 16 - search).to_be_bytes());
    let mut offset = 12 + 16 * tables.len();
    for (tag, data) in &tables {
        out.extend(tag);
        out.extend(checksum(data).to_be_bytes());
        out.extend((offset as u32).to_be_bytes());
        out.extend((data.len() as u32).to_be_bytes());
        offset += data.len().div_ceil(4) * 4;
    }
    for (_, data) in &tables {
        out.extend(data);
        out.resize(out.len().div_ceil(4) * 4, 0);
    }
    out
}

fn is_collection(sfnt: &[u8]) -> bool {
    sfnt.get(..4) == Some(b"ttcf")
}

pub fn face_count(sfnt: &[u8]) -> Result<u32, String> {
    if is_collection(sfnt) { be32(sfnt, 8) } else { Ok(1) }
}

/// One font of a collection as a standalone file (what the web view can
/// load); a single font is returned as is.
pub fn extract_face(sfnt: &[u8], index: u32) -> Result<Vec<u8>, String> {
    if !is_collection(sfnt) {
        return Ok(sfnt.to_vec());
    }
    if index >= face_count(sfnt)? {
        return Err("フォントが見つかりません".into());
    }
    let base = be32(sfnt, 12 + 4 * index as usize)? as usize;
    let flavor = be32(sfnt, base)?;
    let n = be16(sfnt, base + 4)? as usize;
    let mut tables = Vec::with_capacity(n);
    for i in 0..n {
        let r = base + 12 + i * 16;
        let tag: [u8; 4] = sfnt.get(r..r + 4).ok_or("フォントが壊れています")?.try_into().unwrap();
        let (off, len) = (be32(sfnt, r + 8)? as usize, be32(sfnt, r + 12)? as usize);
        tables.push((tag, sfnt.get(off..off + len).ok_or("フォントが壊れています")?.to_vec()));
    }
    Ok(build_sfnt(flavor, tables))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceInfo {
    pub family: String,
    /// e.g. "Regular", "Bold Italic", "W3".
    pub style: String,
    pub full_name: String,
    pub weight: f32,
    pub italic: bool,
    pub glyphs: u16,
    /// Characters (code points) the face maps, not counting spaces / controls.
    pub char_count: usize,
    /// e.g. "Version 2.004".
    pub version: String,
    /// Designer, else the foundry.
    pub designer: String,
    /// Variation axes; empty unless it is a variable font.
    pub axes: Vec<AxisInfo>,
    /// Named styles of a variable font ("Thin", "Bold", ...).
    pub instances: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisInfo {
    /// e.g. "wght", "wdth", "ital".
    pub tag: String,
    pub name: String,
    pub min: f32,
    pub default: f32,
    pub max: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontInfo {
    pub faces: Vec<FaceInfo>,
    /// Every character of the requested face (code points), in order.
    pub chars: Vec<u32>,
}

/// A name, Japanese if the font has one, else English, else whatever is
/// there. Entries that can't be decoded (old Mac encodings) come out empty
/// and are skipped.
fn name(font: &FontRef, ids: &[StringId]) -> String {
    for &id in ids {
        let all: Vec<(Option<String>, String)> = font
            .localized_strings(id)
            .map(|s| (s.language().map(str::to_string), s.to_string().trim().to_string()))
            .filter(|(_, s)| !s.is_empty())
            .collect();
        let pick = |lang: &str| all.iter().find(|(l, _)| l.as_deref().is_some_and(|l| l.starts_with(lang)));
        if let Some((_, s)) = pick("ja").or_else(|| pick("en")).or(all.first()) {
            return s.clone();
        }
    }
    String::new()
}

fn face_ref(sfnt: &[u8], index: u32) -> Result<FontRef<'_>, String> {
    FontRef::from_index(sfnt, index).map_err(|e| format!("フォントを読めません: {e}"))
}

/// The characters a face maps (code points, sorted), without spaces and controls.
fn chars(font: &FontRef) -> Vec<u32> {
    let mut chars: Vec<u32> = font
        .charmap()
        .mappings()
        .map(|(c, _)| c)
        .filter(|&c| char::from_u32(c).is_some_and(|ch| !ch.is_control() && !ch.is_whitespace()))
        .collect();
    chars.sort_unstable();
    chars.dedup();
    chars
}

fn face_info(font: &FontRef) -> FaceInfo {
    let attrs = font.attributes();
    FaceInfo {
        family: name(font, &[StringId::TYPOGRAPHIC_FAMILY_NAME, StringId::FAMILY_NAME]),
        style: name(font, &[StringId::TYPOGRAPHIC_SUBFAMILY_NAME, StringId::SUBFAMILY_NAME]),
        full_name: name(font, &[StringId::FULL_NAME, StringId::FAMILY_NAME]),
        weight: attrs.weight.value(),
        italic: attrs.style != skrifa::attribute::Style::Normal,
        glyphs: font.maxp().map(|m| m.num_glyphs()).unwrap_or(0),
        char_count: chars(font).len(),
        version: name(font, &[StringId::VERSION_STRING]),
        designer: name(font, &[StringId::DESIGNER, StringId::MANUFACTURER]),
        axes: font
            .axes()
            .iter()
            .map(|a| AxisInfo {
                tag: a.tag().to_string(),
                name: name(font, &[a.name_id()]),
                min: a.min_value(),
                default: a.default_value(),
                max: a.max_value(),
            })
            .collect(),
        instances: font
            .named_instances()
            .iter()
            .map(|i| name(font, &[i.subfamily_name_id()]))
            .filter(|n| !n.is_empty())
            .collect(),
    }
}

/// Names and details of every face in the file.
pub fn faces(sfnt: &[u8]) -> Result<Vec<FaceInfo>, String> {
    (0..face_count(sfnt)?).map(|i| face_ref(sfnt, i).map(|f| face_info(&f))).collect()
}

/// What the library stores about a font (from its first face) to group and
/// filter fonts: see `meta`.
#[derive(Debug, Clone, PartialEq)]
pub struct FontMeta {
    /// Family shared by its styles (e.g. "Noto Sans JP" for Light / Bold).
    pub family: String,
    /// 100 (thin) to 900 (black).
    pub weight: u32,
    /// Writing system: see `SCRIPTS`.
    pub script: &'static str,
    /// Typeface style (明朝 / ゴシック ...), None when it can't be told: see `CATEGORIES`.
    pub category: Option<&'static str>,
}

/// Writing systems a font is filed under: 日本語, 欧文, 中国語, 韓国語, その他.
pub const SCRIPTS: &[&str] = &["ja", "latin", "zh", "ko", "other"];
/// Typeface styles: 明朝・セリフ, ゴシック・サンセリフ, 丸ゴシック, 筆・手書き, デザイン, 等幅.
pub const CATEGORIES: &[&str] = &["mincho", "gothic", "maru", "brush", "display", "mono"];

pub fn meta(sfnt: &[u8]) -> Result<FontMeta, String> {
    let font = face_ref(sfnt, 0)?;
    Ok(FontMeta {
        family: base_family(&font),
        weight: font.attributes().weight.value().round() as u32,
        script: script(&font),
        category: category(&font),
    })
}

/// The family, without the style words some fonts put in it ("MOBO-Bold",
/// "ぼくたちのゴシック２ボールド") so their styles still group together. Free
/// fonts do this even in the typographic family name.
fn base_family(font: &FontRef) -> String {
    strip_style(&name(font, &[StringId::TYPOGRAPHIC_FAMILY_NAME, StringId::FAMILY_NAME]))
}

const STYLE_WORDS: &[&str] = &[
    "ExtraLight", "UltraLight", "ExtraBold", "UltraBold", "SemiBold", "DemiBold", "Hairline", "Regular",
    "Medium", "Normal", "Italic", "Oblique", "Light", "Black", "Heavy", "Thin", "Bold", "Book",
];

/// Japanese spellings, taken off even without a separator.
const STYLE_WORDS_JA: &[&str] = &[
    "エクストラライト", "ウルトラライト", "エクストラボールド", "セミボールド", "デミボールド", "レギュラー",
    "ミディアム", "ボールド", "ライト", "ヘビー", "ブラック",
];

/// Takes style words off the end of a family name: "MOBO-Bold" → "MOBO",
/// "Noto Sans JP Light" → "Noto Sans JP", "ヒラギノ角ゴ ProN W3" → "ヒラギノ角ゴ ProN",
/// "BokutachinoGothic2Regular" → "BokutachinoGothic2". A name that is only
/// style words is kept.
pub fn strip_style(family: &str) -> String {
    let mut out = family.trim().to_string();
    loop {
        let before = out.len();
        // "Extra Light" and the like, spelled with a space.
        let squeezed: Vec<&str> = out.rsplitn(3, |c: char| c == ' ' || c == '-' || c == '_').collect();
        if squeezed.len() == 3 {
            let pair = format!("{}{}", squeezed[1], squeezed[0]);
            if STYLE_WORDS.iter().any(|w| w.eq_ignore_ascii_case(&pair)) && !squeezed[2].is_empty() {
                out = squeezed[2].trim_end_matches([' ', '-', '_']).to_string();
                continue;
            }
        }
        for w in STYLE_WORDS {
            let Some(head) = out.len().checked_sub(w.len()).and_then(|i| out.get(..i)) else { continue };
            let tail = &out[head.len()..];
            let after_separator = head.ends_with([' ', '-', '_']) && tail.eq_ignore_ascii_case(w);
            // Glued on: "Gothic2Bold" (capitalised word after a lower-case letter or digit).
            let camel = tail == *w && head.chars().last().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
            if after_separator || camel {
                out = head.trim_end_matches([' ', '-', '_']).to_string();
                break;
            }
        }
        if out.len() == before {
            if let Some(w) = STYLE_WORDS_JA.iter().find(|w| out.ends_with(*w) && out.len() > w.len()) {
                out = out[..out.len() - w.len()].trim_end_matches([' ', '-', '_', '　']).to_string();
            }
        }
        // Japanese weights: W0 - W9.
        if let Some(head) = out.strip_suffix(|c: char| c.is_ascii_digit()).and_then(|h| h.strip_suffix(['W', 'w'])) {
            if head.ends_with([' ', '-', '_']) {
                out = head.trim_end_matches([' ', '-', '_']).to_string();
            }
        }
        if out.len() == before {
            break;
        }
    }
    if out.is_empty() { family.trim().to_string() } else { out }
}

/// The writing system the font is made for, from the characters it has and
/// the code pages it claims (fonts for one CJK language often carry the
/// others' kana or hanzi too).
fn script(font: &FontRef) -> &'static str {
    let cmap = font.charmap();
    let count = |from: u32, to: u32| (from..=to).filter(|&c| char::from_u32(c).is_some_and(|ch| cmap.map(ch).is_some())).count();
    let kana = count(0x3041, 0x30ff);
    let hangul = count(0xac00, 0xd7a3);
    let hanzi = count(0x4e00, 0x9fff);
    let pages = font.os2().ok().and_then(|t| t.ul_code_page_range_1()).unwrap_or(0);
    let (jis, chinese) = (pages & (1 << 17) != 0, pages & (1 << 18 | 1 << 20) != 0);
    // Some display faces have capitals only.
    let latin = ('A'..='Z').all(|c| cmap.map(c).is_some());
    if hangul >= 1000 && !jis {
        "ko"
    } else if kana >= 40 && (jis || !chinese) {
        "ja"
    } else if hanzi >= 2000 {
        "zh"
    } else if kana >= 40 {
        "ja"
    } else if latin {
        "latin"
    } else {
        "other"
    }
}

/// Every name of the font (all languages) as lower-case words, splitting
/// "BokutachinoGothic2" into "bokutachino", "gothic", "2".
fn name_words(font: &FontRef) -> (String, Vec<String>) {
    let ids = [StringId::FAMILY_NAME, StringId::FULL_NAME, StringId::POSTSCRIPT_NAME, StringId::TYPOGRAPHIC_FAMILY_NAME];
    let all: String = ids.iter().flat_map(|&id| font.localized_strings(id).map(|s| s.to_string() + " ")).collect();
    let mut words = Vec::new();
    let mut cur = String::new();
    let mut prev: Option<char> = None;
    for c in all.chars() {
        let boundary = !c.is_alphanumeric()
            || prev.is_some_and(|p| (p.is_lowercase() && c.is_uppercase()) || (p.is_ascii_digit() != c.is_ascii_digit()));
        if boundary && !cur.is_empty() {
            words.push(std::mem::take(&mut cur).to_lowercase());
        }
        if c.is_alphanumeric() {
            cur.push(c);
        }
        prev = Some(c);
    }
    if !cur.is_empty() {
        words.push(cur.to_lowercase());
    }
    (all.to_lowercase(), words)
}

/// 明朝 / ゴシック / ... from the name first (Japanese fonts, free fonts in
/// particular, rarely fill in the classification fields), then the font's
/// own classification (OS/2 family class and PANOSE).
fn category(font: &FontRef) -> Option<&'static str> {
    let (text, words) = name_words(font);
    let word = |ws: &[&str]| words.iter().any(|w| ws.contains(&w.as_str()));
    let has = |ss: &[&str]| ss.iter().any(|s| text.contains(s));
    if word(&["mono", "monospace", "monospaced", "code"]) || has(&["等幅"]) {
        return Some("mono");
    }
    if word(&["maru", "rounded", "round"]) || has(&["丸ゴ", "まる", "ラウンド"]) {
        return Some("maru");
    }
    if word(&["kaisho", "gyosho", "sosho", "kyokasho", "fude", "brush", "script", "hand", "handwriting", "calligraphy"])
        || has(&["筆", "楷書", "行書", "草書", "隷書", "教科書", "手書", "手描"])
    {
        return Some("brush");
    }
    if word(&["mincho", "serif", "song", "ming", "antiqua"]) && !word(&["sans"]) || has(&["明朝", "宋"]) {
        return Some("mincho");
    }
    if word(&["gothic", "sans", "kakugo", "grotesk", "grotesque"]) || has(&["ゴシック", "角ゴ", "ゴチ"]) {
        return Some("gothic");
    }
    if word(&["pop", "display"]) || has(&["ポップ", "ぽっぷ"]) {
        return Some("display");
    }

    let fixed = font.post().is_ok_and(|p| p.is_fixed_pitch() != 0);
    let (panose, class) = font
        .os2()
        .map(|t| (t.panose_10().to_vec(), (t.s_family_class() >> 8) as u8))
        .unwrap_or_default();
    let (family_kind, serif, proportion) = (panose.first().copied(), panose.get(1).copied(), panose.get(3).copied());
    if fixed || (family_kind == Some(2) && proportion == Some(9)) {
        return Some("mono");
    }
    match (family_kind, class) {
        (Some(3), _) | (_, 10) => return Some("brush"),
        (Some(4 | 5), _) | (_, 12) => return Some("display"),
        _ => {}
    }
    // Fonts that leave the family class empty (most free Japanese fonts) tend
    // to carry leftover PANOSE serif values too: not trusted then.
    if class == 0 {
        return None;
    }
    if family_kind == Some(2) && serif == Some(15) {
        return Some("maru");
    }
    match class {
        1..=7 => Some("mincho"),
        8 => Some("gothic"),
        _ => match (family_kind, serif) {
            (Some(2), Some(2..=10)) => Some("mincho"),
            (Some(2), Some(11..=13)) => Some("gothic"),
            _ => None,
        },
    }
}

/// Every face, and the characters of face `index`.
pub fn info(sfnt: &[u8], index: u32) -> Result<FontInfo, String> {
    Ok(FontInfo { faces: faces(sfnt)?, chars: chars(&face_ref(sfnt, index)?) })
}

/// Sample lines for the thumbnail: "Aa" and Japanese / Latin text, using
/// whatever the font actually covers.
fn sample_lines(font: &FontRef) -> (String, String) {
    let cmap = font.charmap();
    let has = |s: &str| s.chars().all(|c| cmap.map(c).is_some());
    let big = if has("Aa") {
        "Aa".to_string()
    } else {
        cmap.mappings()
            .filter_map(|(c, _)| char::from_u32(c))
            .filter(|c| !c.is_whitespace() && !c.is_control())
            .take(2)
            .collect()
    };
    let small = ["あア永", "ABC abc 123", "Abg 123"]
        .into_iter()
        .find(|s| has(&s.replace(' ', "")))
        .map(str::to_string)
        .unwrap_or_default();
    (big, small)
}

/// A line of sample text for the list layout: the first candidate the font
/// fully covers, else whatever characters it has.
pub fn list_sample(sfnt: &[u8]) -> Result<String, String> {
    const CANDIDATES: &[&str] = &[
        "永遠の青い空 いろは アイウ Aa 123",
        "いろはにほへと アイウエオ Aa 123",
        "The quick brown fox jumps over 0123",
        "ABC abc 123",
    ];
    let font = face_ref(sfnt, 0)?;
    let cmap = font.charmap();
    let covered = |s: &str| s.chars().filter(|c| !c.is_whitespace()).all(|c| cmap.map(c).is_some());
    if let Some(s) = CANDIDATES.iter().find(|s| covered(s)) {
        return Ok(s.to_string());
    }
    Ok(chars(&font).into_iter().filter_map(char::from_u32).take(24).collect())
}

/// What the list layout shows for a font: a sample line and the style of the
/// first font in the file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPreview {
    pub sample: String,
    pub style: String,
    /// Fonts in the file (several for TTC / OTC).
    pub faces: u32,
}

pub fn list_preview(sfnt: &[u8]) -> Result<ListPreview, String> {
    let font = face_ref(sfnt, 0)?;
    Ok(ListPreview {
        sample: list_sample(sfnt)?,
        style: name(&font, &[StringId::TYPOGRAPHIC_SUBFAMILY_NAME, StringId::SUBFAMILY_NAME]),
        faces: face_count(sfnt)?,
    })
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// The thumbnail: a sample of the first face, dark on light.
pub fn render_thumb(sfnt: &[u8]) -> Result<DynamicImage, String> {
    let font = face_ref(sfnt, 0)?;
    let face = face_info(&font);
    let (big, small) = sample_lines(&font);
    let style = if face.italic { "italic" } else { "normal" };
    let family = xml_escape(&face.family);
    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{THUMB_W}" height="{THUMB_H}">
<rect width="100%" height="100%" fill="#f4f4f5"/>
<g font-family="{family}" font-weight="{w}" font-style="{style}" fill="#18181b" text-anchor="middle">
<text x="256" y="215" font-size="170">{big}</text>
<text x="256" y="320" font-size="52">{small}</text>
</g></svg>"##,
        w = face.weight.round(),
        big = xml_escape(&big),
        small = xml_escape(&small),
    );
    let mut opt = resvg::usvg::Options::default();
    opt.font_family = face.family.clone();
    opt.fontdb_mut().load_font_data(sfnt.to_vec());
    let tree = resvg::usvg::Tree::from_str(&svg, &opt).map_err(|e| format!("フォント: {e}"))?;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(THUMB_W, THUMB_H).ok_or("フォント: 描画エラー")?;
    resvg::render(&tree, resvg::tiny_skia::Transform::default(), &mut pixmap.as_mut());
    let rgba = RgbaImage::from_raw(THUMB_W, THUMB_H, pixmap.take_demultiplied()).ok_or("フォント: 描画エラー")?;
    Ok(DynamicImage::ImageRgba8(rgba))
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::io::Write;

    /// A font installed with the OS, if there is one at any of `paths`.
    pub fn system_font(paths: &[&str]) -> Option<Vec<u8>> {
        paths.iter().find_map(|p| std::fs::read(p).ok())
    }

    pub const SINGLE: &[&str] = &[
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Geneva.ttf",
        "C:\\Windows\\Fonts\\arial.ttf",
    ];
    pub const VARIABLE: &[&str] = &[
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Supplemental/Skia.ttf",
        "C:\\Windows\\Fonts\\bahnschrift.ttf",
    ];
    pub const COLLECTION: &[&str] = &[
        "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
        "C:\\Windows\\Fonts\\msgothic.ttc",
        "C:\\Windows\\Fonts\\cambria.ttc",
    ];

    /// Packs a single font as WOFF 1.0 (the inverse of `decode_woff`).
    pub fn encode_woff(sfnt: &[u8]) -> Vec<u8> {
        let n = be16(sfnt, 4).unwrap() as usize;
        let mut dir = Vec::new();
        let mut body = Vec::new();
        let start = 44 + 20 * n;
        for i in 0..n {
            let r = 12 + i * 16;
            let (off, len) = (be32(sfnt, r + 8).unwrap() as usize, be32(sfnt, r + 12).unwrap() as usize);
            let table = &sfnt[off..off + len];
            let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
            z.write_all(table).unwrap();
            let z = z.finish().unwrap();
            let stored = if z.len() < len { z } else { table.to_vec() };
            dir.extend(&sfnt[r..r + 4]);
            dir.extend(((start + body.len()) as u32).to_be_bytes());
            dir.extend((stored.len() as u32).to_be_bytes());
            dir.extend((len as u32).to_be_bytes());
            dir.extend(sfnt[r + 4..r + 8].to_vec());
            body.extend(&stored);
            body.resize(body.len().div_ceil(4) * 4, 0);
        }
        let mut out = b"wOFF".to_vec();
        out.extend(&sfnt[0..4]);
        out.extend(((start + body.len()) as u32).to_be_bytes());
        out.extend((n as u16).to_be_bytes());
        out.extend([0u8; 2]);
        out.extend((sfnt.len() as u32).to_be_bytes());
        out.extend([0u8; 24]);
        out.extend(dir);
        out.extend(body);
        out
    }

    /// Fraction of thumbnail pixels that are ink (darker than the background).
    pub fn ink(img: &DynamicImage) -> f32 {
        let g = img.to_luma8();
        g.pixels().filter(|p| p[0] < 128).count() as f32 / g.pixels().len() as f32
    }

    #[test]
    fn single_font_and_woff() {
        let Some(ttf) = system_font(SINGLE) else { return };
        let info = info(&ttf, 0).unwrap();
        assert_eq!(info.faces.len(), 1);
        assert!(!info.faces[0].family.is_empty());
        assert!(info.chars.contains(&('A' as u32)));
        assert!(info.faces[0].glyphs > 50);
        assert_eq!(info.faces[0].char_count, info.chars.len());
        let m = meta(&ttf).unwrap();
        assert_eq!((m.family.as_str(), m.weight), (info.faces[0].family.as_str(), info.faces[0].weight.round() as u32));
        assert_eq!(m.script, "latin");
        assert!(!info.faces[0].version.is_empty());

        let woff = encode_woff(&ttf);
        let back = to_sfnt(&woff, "woff").unwrap();
        // Rebuilt with sorted tables, so compare what the font contains.
        let again = super::info(&back, 0).unwrap();
        assert_eq!((again.faces[0].family.as_str(), again.chars.len()), (info.faces[0].family.as_str(), info.chars.len()));
        assert!(ink(&render_thumb(&back).unwrap()) > 0.02, "the sample is drawn");
        // A Latin font gets the Latin line, every character of it covered.
        let p = list_preview(&ttf).unwrap();
        assert_eq!((p.sample.as_str(), p.faces), ("The quick brown fox jumps over 0123", 1));
        assert!(!p.style.is_empty());
    }

    #[test]
    fn collections() {
        let Some(ttc) = system_font(COLLECTION) else { return };
        let n = face_count(&ttc).unwrap();
        assert!(n >= 2);
        let all = info(&ttc, 0).unwrap();
        assert_eq!(all.faces.len(), n as usize);
        let last = extract_face(&ttc, n - 1).unwrap();
        assert_eq!(face_count(&last).unwrap(), 1);
        assert_eq!(info(&last, 0).unwrap().faces[0].full_name, all.faces[n as usize - 1].full_name);
        assert!(extract_face(&ttc, n).is_err());
        assert!(ink(&render_thumb(&ttc).unwrap()) > 0.02);
        let p = list_preview(&ttc).unwrap();
        assert_eq!(p.faces, n);
        assert!(p.sample.chars().filter(|c| !c.is_whitespace()).count() >= 3);
    }

    #[test]
    fn variable_font() {
        let Some(ttf) = system_font(VARIABLE) else { return };
        let face = &faces(&ttf).unwrap()[0];
        let wght = face.axes.iter().find(|a| a.tag == "wght").expect("a weight axis");
        assert!(wght.min < wght.default && wght.default <= wght.max);
        assert!(face.instances.len() >= 2, "named styles: {:?}", face.instances);
        // A plain font has neither.
        let Some(plain) = system_font(SINGLE) else { return };
        assert!(faces(&plain).unwrap()[0].axes.is_empty());
    }

    #[test]
    fn strips_style_words_from_families() {
        for (from, to) in [
            ("MOBO-Bold", "MOBO"),
            ("MOBO-ExtraLight", "MOBO"),
            ("BokutachinoGothic2Regular", "BokutachinoGothic2"),
            ("Noto Sans JP Light", "Noto Sans JP"),
            ("Noto Sans JP Extra Light", "Noto Sans JP"),
            ("ヒラギノ角ゴ ProN W3", "ヒラギノ角ゴ ProN"),
            ("Senobi Gothic", "Senobi Gothic"),
            ("Kobold", "Kobold"),
            ("Bold", "Bold"),
            ("Arial Black Italic", "Arial"),
            ("ぼくたちのゴシック２ボールド", "ぼくたちのゴシック２"),
            ("モボ-Bold", "モボ"),
            ("ボールド", "ボールド"),
        ] {
            assert_eq!(strip_style(from), to, "{from}");
        }
    }

    /// The OS's own fonts fill in their classification, so the guesses can be checked.
    #[test]
    fn tells_scripts_and_styles() {
        let cases: &[(&[&str], &str, Option<&str>)] = &[
            (&["/System/Library/Fonts/ヒラギノ明朝 ProN.ttc", "C:\\Windows\\Fonts\\yumin.ttf"], "ja", Some("mincho")),
            (&["/System/Library/Fonts/ヒラギノ丸ゴ ProN W4.ttc"], "ja", Some("maru")),
            (&["/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc", "C:\\Windows\\Fonts\\msgothic.ttc"], "ja", Some("gothic")),
            (&["/System/Library/Fonts/Supplemental/Times New Roman.ttf", "C:\\Windows\\Fonts\\times.ttf"], "latin", Some("mincho")),
            (&["/System/Library/Fonts/Supplemental/Arial.ttf", "C:\\Windows\\Fonts\\arial.ttf"], "latin", Some("gothic")),
            (&["/System/Library/Fonts/Supplemental/Courier New.ttf", "C:\\Windows\\Fonts\\cour.ttf"], "latin", Some("mono")),
            (&["/System/Library/Fonts/Supplemental/Apple Chancery.ttf"], "latin", Some("brush")),
            (&["/System/Library/Fonts/AppleSDGothicNeo.ttc", "C:\\Windows\\Fonts\\malgun.ttf"], "ko", Some("gothic")),
        ];
        for (paths, script, category) in cases {
            let Some(data) = system_font(paths) else { continue };
            let m = meta(&data).unwrap();
            assert_eq!((m.script, m.category), (*script, *category), "{}", paths[0]);
        }
    }

    #[test]
    fn rejects_garbage() {
        assert!(to_sfnt(b"nope", "woff").is_err());
        assert!(to_sfnt(b"nope", "woff2").is_err());
        assert!(render_thumb(b"not a font at all").is_err());
        assert!(extract_face(b"ttcf\0\0\0\0\0\0\0\x05", 0).is_err());
    }
}
