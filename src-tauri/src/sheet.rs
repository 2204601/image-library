//! Images for the contact sheet (まとめて出力, src/lib/sheet.ts): each item
//! scaled down to the size it takes on the sheet, with its rotation / flip
//! applied. The sheet itself is laid out and drawn by the frontend.

use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ExtendedColorType, ImageEncoder};

/// Largest side handed out (a cell is never wider than the sheet).
pub const MAX_SIDE: u32 = 4096;

/// `img` fitted inside `max_side` × `max_side` (never enlarged), encoded as
/// PNG when it has transparent pixels and as JPEG otherwise (much smaller).
pub fn fit(img: &DynamicImage, max_side: u32) -> Result<Vec<u8>, String> {
    let max_side = max_side.clamp(16, MAX_SIDE);
    let img = if img.width() > max_side || img.height() > max_side {
        // A big step down with Lanczos is slow (the kernel grows with the
        // ratio): shrink quickly to twice the size first.
        let img = if img.width().max(img.height()) > max_side * 3 {
            img.thumbnail(max_side * 2, max_side * 2)
        } else {
            img.clone()
        };
        img.resize(max_side, max_side, FilterType::Lanczos3)
    } else {
        img.clone()
    };
    let (w, h) = (img.width(), img.height());
    let mut out = Vec::new();
    let rgba = img.color().has_alpha().then(|| img.to_rgba8());
    match rgba {
        Some(rgba) if rgba.pixels().any(|p| p.0[3] < 255) => {
            PngEncoder::new(&mut out).write_image(&rgba, w, h, ExtendedColorType::Rgba8)
        }
        _ => JpegEncoder::new_with_quality(&mut out, 90).write_image(&img.to_rgb8(), w, h, ExtendedColorType::Rgb8),
    }
    .map_err(|e| e.to_string())?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn decode(bytes: &[u8]) -> DynamicImage {
        image::load_from_memory(bytes).unwrap()
    }

    #[test]
    fn shrinks_to_fit_and_keeps_aspect() {
        let img = DynamicImage::ImageRgb8(image::RgbImage::new(2000, 1000));
        let out = fit(&img, 500).unwrap();
        assert_eq!(&out[..2], &[0xFF, 0xD8], "opaque images become JPEG");
        let back = decode(&out);
        assert_eq!((back.width(), back.height()), (500, 250));
        // Never enlarged.
        let back = decode(&fit(&img, 4000).unwrap());
        assert_eq!((back.width(), back.height()), (2000, 1000));
    }

    #[test]
    fn keeps_transparency_as_png() {
        let mut rgba = RgbaImage::from_pixel(40, 80, Rgba([255, 0, 0, 255]));
        rgba.put_pixel(0, 0, Rgba([0, 0, 0, 0]));
        let out = fit(&DynamicImage::ImageRgba8(rgba), 20).unwrap();
        assert_eq!(&out[..4], b"\x89PNG");
        let back = decode(&out);
        assert_eq!((back.width(), back.height()), (10, 20));
        // An alpha channel without transparent pixels is still a JPEG.
        let opaque = RgbaImage::from_pixel(10, 10, Rgba([0, 0, 255, 255]));
        assert_eq!(&fit(&DynamicImage::ImageRgba8(opaque), 20).unwrap()[..2], &[0xFF, 0xD8]);
    }
}
