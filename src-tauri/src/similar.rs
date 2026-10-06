//! Near-duplicate detection with a difference hash (dHash): 64 bits saying
//! whether each pixel of a 9×8 grayscale reduction is brighter than its right
//! neighbour. Resized, re-encoded or format-converted copies of an image land
//! within a few bits of each other. dHash ignores overall brightness and
//! colour (flat images all hash to ~0), so the average colour is compared too.

use image::imageops::FilterType;
use image::DynamicImage;
use std::collections::HashMap;

/// Hashes at most this many bits apart count as the same picture.
pub const MAX_DISTANCE: u32 = 6;
/// Aspect ratios must agree within this factor (guards against unrelated
/// images that merely share a similar brightness layout).
const MAX_ASPECT_RATIO: f64 = 1.1;
/// Largest per-channel difference of the average colours.
const MAX_COLOR_DIFF: i32 = 24;

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

fn colors_close(a: u32, b: u32) -> bool {
    (0..3).all(|k| ((a >> (k * 8) & 0xff) as i32 - (b >> (k * 8) & 0xff) as i32).abs() <= MAX_COLOR_DIFF)
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
pub fn groups(entries: &[Entry]) -> Vec<Vec<usize>> {
    let n = entries.len();
    let mut parent: Vec<usize> = (0..n).collect();
    // Two hashes within 7 bits agree on at least one of their 8 bytes
    // (pigeonhole), so only pairs sharing a byte bucket need comparing.
    let mut buckets: HashMap<(u8, u8), Vec<usize>> = HashMap::new();
    for (i, e) in entries.iter().enumerate() {
        for k in 0..8u8 {
            buckets.entry((k, (e.hash >> (k * 8)) as u8)).or_default().push(i);
        }
    }
    for members in buckets.values() {
        for (a, &i) in members.iter().enumerate() {
            for &j in &members[a + 1..] {
                let (x, y) = (&entries[i], &entries[j]);
                let ar = aspect(x) / aspect(y);
                if (x.hash ^ y.hash).count_ones() <= MAX_DISTANCE
                    && ar <= MAX_ASPECT_RATIO
                    && ar >= 1.0 / MAX_ASPECT_RATIO
                    && colors_close(x.color, y.color)
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
        assert!((dhash(&a) ^ dhash(&c)).count_ones() > MAX_DISTANCE);
        assert!(colors_close(mean_color(&a), mean_color(&b)));
    }

    #[test]
    fn flat_images_differ_by_color() {
        let red = DynamicImage::ImageRgb8(RgbImage::from_pixel(50, 50, Rgb([200, 0, 0])));
        let blue = DynamicImage::ImageRgb8(RgbImage::from_pixel(50, 50, Rgb([0, 0, 200])));
        let entry = |img: &DynamicImage| Entry { hash: dhash(img), color: mean_color(img), width: 50, height: 50 };
        assert_eq!(dhash(&red), dhash(&blue));
        assert!(groups(&[entry(&red), entry(&blue)]).is_empty());
        assert_eq!(groups(&[entry(&red), entry(&red)]), vec![vec![0, 1]]);
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
        assert_eq!(groups(&entries), vec![vec![0, 2], vec![1, 5]]);
    }

    #[test]
    fn groups_are_transitive() {
        // a~b and b~c join even though a and c are further apart.
        let entries = [e(0, 10, 10), e(0b11_1111, 10, 10), e(0b1111_1111_1111, 10, 10)];
        assert_eq!(groups(&entries), vec![vec![0, 1, 2]]);
    }
}
