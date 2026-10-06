//! Near-duplicate detection with a difference hash (dHash): 64 bits saying
//! whether each pixel of a 9×8 grayscale reduction is brighter than its right
//! neighbour. Resized, re-encoded or format-converted copies of an image land
//! within a few bits of each other. dHash ignores overall brightness and
//! colour (flat images all hash to ~0), so the average colour is compared too.

use image::imageops::FilterType;
use image::DynamicImage;
use serde::Deserialize;
use std::collections::HashMap;

/// How alike two images must be to land in the same group.
#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    /// Practically the same picture (re-saved, resized).
    Strict,
    #[default]
    Standard,
    /// Vaguely similar; expect some unrelated pairs.
    Loose,
}

/// The thresholds a level stands for.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Hashes at most this many bits apart count as the same picture.
    pub max_distance: u32,
    /// Aspect ratios must agree within this factor (guards against unrelated
    /// images that merely share a similar brightness layout).
    pub max_aspect_ratio: f64,
    /// Largest per-channel difference of the average colours.
    pub max_color_diff: i32,
}

impl Level {
    pub fn limits(self) -> Limits {
        let (max_distance, max_aspect_ratio, max_color_diff) = match self {
            Level::Strict => (2, 1.05, 12),
            Level::Standard => (6, 1.1, 24),
            Level::Loose => (12, 1.25, 48),
        };
        Limits { max_distance, max_aspect_ratio, max_color_diff }
    }
}

/// Average colour packed as 0xRRGGBB.
pub fn mean_color(img: &DynamicImage) -> u32 {
    let px = img.resize_exact(1, 1, FilterType::Triangle).to_rgb8();
    let [r, g, b] = px.get_pixel(0, 0).0;
    (r as u32) << 16 | (g as u32) << 8 | b as u32
}

pub fn dhash(img: &DynamicImage) -> u64 {
    let small = img.resize_exact(9, 8, FilterType::Triangle).to_luma8();
    let mut h = 0u64;
    for y in 0..8 {
        for x in 0..8 {
            let bit = small.get_pixel(x, y)[0] > small.get_pixel(x + 1, y)[0];
            h = (h << 1) | bit as u64;
        }
    }
    h
}

pub struct Entry {
    pub hash: u64,
    pub color: u32,
    pub width: u32,
    pub height: u32,
}

fn aspect(e: &Entry) -> f64 {
    e.width.max(1) as f64 / e.height.max(1) as f64
}

fn colors_close(a: u32, b: u32, max_diff: i32) -> bool {
    (0..3).all(|k| ((a >> (k * 8) & 0xff) as i32 - (b >> (k * 8) & 0xff) as i32).abs() <= max_diff)
}

pub fn distance(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

fn find(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}

/// Groups of indices into `entries` (two or more each) that look alike.
/// Groups and their members keep the order of `entries`.
pub fn groups(entries: &[Entry], level: Level) -> Vec<Vec<usize>> {
    let lim = level.limits();
    let n = entries.len();
    let mut parent: Vec<usize> = (0..n).collect();
    // Split the hash into `max_distance + 1` chunks: two hashes within
    // `max_distance` bits must agree on at least one whole chunk (pigeonhole),
    // so only pairs sharing a chunk bucket need comparing.
    let chunks = lim.max_distance + 1;
    let span = |c: u32| (c * 64 / chunks, (c + 1) * 64 / chunks);
    let mut buckets: HashMap<(u32, u64), Vec<usize>> = HashMap::new();
    for (i, e) in entries.iter().enumerate() {
        for c in 0..chunks {
            let (lo, hi) = span(c);
            let mask = if hi - lo >= 64 { u64::MAX } else { (1u64 << (hi - lo)) - 1 };
            buckets.entry((c, (e.hash >> lo) & mask)).or_default().push(i);
        }
    }
    for members in buckets.values() {
        for (a, &i) in members.iter().enumerate() {
            for &j in &members[a + 1..] {
                let (x, y) = (&entries[i], &entries[j]);
                let ar = aspect(x) / aspect(y);
                if distance(x.hash, y.hash) <= lim.max_distance
                    && ar <= lim.max_aspect_ratio
                    && ar >= 1.0 / lim.max_aspect_ratio
                    && colors_close(x.color, y.color, lim.max_color_diff)
                {
                    let (ri, rj) = (find(&mut parent, i), find(&mut parent, j));
                    if ri != rj {
                        parent[ri.max(rj)] = ri.min(rj);
                    }
                }
            }
        }
    }
    let mut by_root: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let r = find(&mut parent, i);
        by_root.entry(r).or_default().push(i);
    }
    let mut out: Vec<Vec<usize>> = by_root.into_values().filter(|g| g.len() > 1).collect();
    out.sort_by_key(|g| g[0]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    fn picture(w: u32, h: u32, seed: u32) -> DynamicImage {
        DynamicImage::ImageRgb8(RgbImage::from_fn(w, h, |x, y| {
            let fx = x as f32 / w as f32;
            let fy = y as f32 / h as f32;
            let v = ((fx * 7.0 + seed as f32).sin() * (fy * 5.0 + seed as f32 * 2.0).cos() * 127.0 + 128.0) as u8;
            Rgb([v, v / 2, 255 - v])
        }))
    }

    fn e(hash: u64, width: u32, height: u32) -> Entry {
        Entry { hash, color: 0x808080, width, height }
    }

    #[test]
    fn resized_copy_hashes_close() {
        let a = picture(800, 600, 1);
        let b = a.resize(400, 300, FilterType::Lanczos3);
        let c = picture(800, 600, 9);
        assert!((dhash(&a) ^ dhash(&b)).count_ones() <= 2);
        assert!(distance(dhash(&a), dhash(&c)) > Level::Standard.limits().max_distance);
        assert!(colors_close(mean_color(&a), mean_color(&b), Level::Standard.limits().max_color_diff));
    }

    #[test]
    fn flat_images_differ_by_color() {
        let red = DynamicImage::ImageRgb8(RgbImage::from_pixel(50, 50, Rgb([200, 0, 0])));
        let blue = DynamicImage::ImageRgb8(RgbImage::from_pixel(50, 50, Rgb([0, 0, 200])));
        let entry = |img: &DynamicImage| Entry { hash: dhash(img), color: mean_color(img), width: 50, height: 50 };
        assert_eq!(dhash(&red), dhash(&blue));
        assert!(groups(&[entry(&red), entry(&blue)], Level::Standard).is_empty());
        assert_eq!(groups(&[entry(&red), entry(&red)], Level::Standard), vec![vec![0, 1]]);
    }

    #[test]
    fn groups_by_distance_and_aspect() {
        let base = 0x0123_4567_89ab_cdefu64;
        let entries = [
            e(base, 800, 600),
            e(0xffff_0000_ffff_0000, 800, 600),
            e(base ^ 0b111, 400, 300), // 3 bits off, same shape
            e(base ^ 0b1, 600, 800),   // close hash but portrait: not the same picture
            e(base ^ (0xff << 56) ^ (0xff << 8), 800, 600), // 16 bits off
            e(0xffff_0000_ffff_0001, 1600, 1200),
        ];
        assert_eq!(groups(&entries, Level::Standard), vec![vec![0, 2], vec![1, 5]]);
    }

    #[test]
    fn groups_are_transitive() {
        // a~b and b~c join even though a and c are further apart.
        let entries = [e(0, 10, 10), e(0b11_1111, 10, 10), e(0b1111_1111_1111, 10, 10)];
        assert_eq!(groups(&entries, Level::Standard), vec![vec![0, 1, 2]]);
    }

    #[test]
    fn levels_widen_the_net() {
        let base = 0x0123_4567_89ab_cdefu64;
        let entries = [
            e(base, 800, 600),
            e(base ^ 0b11, 800, 600),                 // 2 bits from the first
            e(base ^ 0b11_1111_1111, 800, 600),       // 10 from the first, 8 from the second
            e(base ^ (0xffff << 48), 800, 600),       // 16 bits away from everything
        ];
        assert_eq!(groups(&entries, Level::Strict), vec![vec![0, 1]]);
        assert_eq!(groups(&entries, Level::Standard), vec![vec![0, 1]]);
        // 1~2 is 8 bits: only the loose level joins it (and chains it to 0).
        assert_eq!(groups(&entries, Level::Loose), vec![vec![0, 1, 2]]);
    }

    #[test]
    fn chunk_buckets_find_every_pair_within_limit() {
        // Brute-force check that the bucketing never misses a pair.
        let mut seed = 0x9e37_79b9_7f4a_7c15u64;
        let mut next = || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        for level in [Level::Strict, Level::Standard, Level::Loose] {
            let max = level.limits().max_distance;
            let a = next();
            let mut b = a;
            for _ in 0..max {
                b ^= 1 << (next() % 64);
            }
            assert!(distance(a, b) <= max);
            assert_eq!(groups(&[e(a, 10, 10), e(b, 10, 10)], level), vec![vec![0, 1]]);
        }
    }
}
