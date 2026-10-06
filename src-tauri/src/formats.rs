//! Decoding every supported format into a `DynamicImage`.
//!
//! - JPEG / PNG / GIF / WebP / BMP / TIFF: the `image` crate (pure Rust).
//! - SVG: rasterised with resvg (pure Rust).
//! - HEIC / HEIF / AVIF: the operating system's decoders — ImageIO via `sips`
//!   on macOS, WIC on Windows (needs Microsoft's free "HEIF Image Extensions"
//!   / "AV1 Video Extension"). Unsupported elsewhere.

use image::{DynamicImage, ImageDecoder, ImageReader, RgbaImage};
use std::io::Cursor;

pub const SUPPORTED_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "svg", "heic", "heif", "avif",
];

/// Formats the web view can't show reliably on every platform (WebView2 has
/// no HEIC / TIFF support), so a JPEG copy is kept for full-size display.
pub fn needs_preview(ext: &str) -> bool {
    matches!(ext, "heic" | "heif" | "tif" | "tiff")
}

/// Longest side of an SVG rasterisation (thumbnails and hashing only).
const SVG_RASTER_MAX: f32 = 1024.0;

pub struct Decoded {
    pub image: DynamicImage,
    /// Intrinsic size (for SVG the document size, not the raster size).
    pub width: u32,
    pub height: u32,
}

pub fn decode(bytes: &[u8], ext: &str) -> Result<Decoded, String> {
    let image = match ext {
        "svg" => return decode_svg(bytes),
        "heic" | "heif" | "avif" => decode_with_os(bytes, ext)?,
        _ => decode_with_image_crate(bytes).map_err(|e| e.to_string())?,
    };
    Ok(Decoded { width: image.width(), height: image.height(), image })
}

fn decode_with_image_crate(bytes: &[u8]) -> image::ImageResult<DynamicImage> {
    let mut decoder = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()?
        .into_decoder()?;
    let orientation = decoder.orientation()?;
    let mut img = DynamicImage::from_decoder(decoder)?;
    img.apply_orientation(orientation);
    Ok(img)
}

fn decode_svg(bytes: &[u8]) -> Result<Decoded, String> {
    let tree = resvg::usvg::Tree::from_data(bytes, &resvg::usvg::Options::default())
        .map_err(|e| format!("SVG: {e}"))?;
    let size = tree.size();
    let (w, h) = (size.width().max(1.0), size.height().max(1.0));
    let scale = SVG_RASTER_MAX / w.max(h);
    let (pw, ph) = ((w * scale).round().max(1.0) as u32, (h * scale).round().max(1.0) as u32);
    let mut pixmap = resvg::tiny_skia::Pixmap::new(pw, ph).ok_or("SVG: invalid size")?;
    resvg::render(&tree, resvg::tiny_skia::Transform::from_scale(scale, scale), &mut pixmap.as_mut());
    let rgba = RgbaImage::from_raw(pw, ph, pixmap.take_demultiplied()).ok_or("SVG: raster error")?;
    Ok(Decoded {
        image: DynamicImage::ImageRgba8(rgba),
        width: w.round() as u32,
        height: h.round() as u32,
    })
}

#[cfg(target_os = "macos")]
fn decode_with_os(bytes: &[u8], ext: &str) -> Result<DynamicImage, String> {
    // sips (ImageIO) converts to PNG and applies the EXIF orientation.
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let src = dir.path().join(format!("in.{ext}"));
    let out = dir.path().join("out.png");
    std::fs::write(&src, bytes).map_err(|e| e.to_string())?;
    let status = std::process::Command::new("/usr/bin/sips")
        .args(["-s", "format", "png"])
        .arg(&src)
        .arg("--out")
        .arg(&out)
        .output()
        .map_err(|e| format!("sips: {e}"))?;
    if !status.status.success() || !out.exists() {
        return Err(format!("{} を読み込めませんでした", ext.to_uppercase()));
    }
    image::open(&out).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn decode_with_os(bytes: &[u8], ext: &str) -> Result<DynamicImage, String> {
    wic::decode(bytes).map_err(|e| {
        format!(
            "{} を読み込めませんでした（Microsoft Store の拡張機能が必要な場合があります）: {e}",
            ext.to_uppercase()
        )
    })
}

#[cfg(not(any(target_os = "macos", windows)))]
fn decode_with_os(_bytes: &[u8], ext: &str) -> Result<DynamicImage, String> {
    Err(format!("{} はこの OS では未対応です", ext.to_uppercase()))
}

#[cfg(windows)]
mod wic {
    use image::{DynamicImage, RgbaImage};
    use windows::Win32::Graphics::Imaging::{
        CLSID_WICImagingFactory, GUID_WICPixelFormat32bppRGBA, IWICImagingFactory,
        WICBitmapDitherTypeNone, WICBitmapPaletteTypeCustom, WICDecodeMetadataCacheOnDemand,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    };

    pub fn decode(bytes: &[u8]) -> windows::core::Result<DynamicImage> {
        unsafe {
            // Rayon worker threads start without COM; an already-initialised
            // thread just returns S_FALSE / RPC_E_CHANGED_MODE, both fine here.
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let factory: IWICImagingFactory =
                CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
            let stream = factory.CreateStream()?;
            stream.InitializeFromMemory(bytes)?;
            let decoder =
                factory.CreateDecoderFromStream(&stream, std::ptr::null(), WICDecodeMetadataCacheOnDemand)?;
            let frame = decoder.GetFrame(0)?;
            let converter = factory.CreateFormatConverter()?;
            converter.Initialize(
                &frame,
                &GUID_WICPixelFormat32bppRGBA,
                WICBitmapDitherTypeNone,
                None,
                0.0,
                WICBitmapPaletteTypeCustom,
            )?;
            let (mut w, mut h) = (0u32, 0u32);
            converter.GetSize(&mut w, &mut h)?;
            let mut buf = vec![0u8; (w as usize) * (h as usize) * 4];
            converter.CopyPixels(std::ptr::null(), w * 4, &mut buf)?;
            RgbaImage::from_raw(w, h, buf)
                .map(DynamicImage::ImageRgba8)
                .ok_or_else(|| windows::core::Error::from_hresult(windows::Win32::Foundation::E_FAIL))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn svg_uses_document_size_and_rasterises() {
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
            <rect width="200" height="100" fill="#f00"/></svg>"##;
        let d = decode(svg, "svg").unwrap();
        assert_eq!((d.width, d.height), (200, 100));
        assert_eq!((d.image.width(), d.image.height()), (1024, 512));
        assert_eq!(d.image.to_rgba8().get_pixel(10, 10).0, [255, 0, 0, 255]);
        assert!(decode(b"not svg", "svg").is_err());
    }

    #[test]
    fn tiff_decodes() {
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(30, 20, image::Rgb([1, 2, 3])));
        let mut buf = Cursor::new(Vec::new());
        img.write_to(&mut buf, image::ImageFormat::Tiff).unwrap();
        let d = decode(buf.get_ref(), "tiff").unwrap();
        assert_eq!((d.width, d.height), (30, 20));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn heic_via_sips() {
        // Make a real HEIC with sips itself, then decode it back.
        let dir = tempfile::tempdir().unwrap();
        let png = dir.path().join("a.png");
        let heic = dir.path().join("a.heic");
        image::RgbImage::from_pixel(64, 48, image::Rgb([0, 128, 255])).save(&png).unwrap();
        let ok = std::process::Command::new("/usr/bin/sips")
            .args(["-s", "format", "heic"])
            .arg(&png)
            .arg("--out")
            .arg(&heic)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !ok {
            eprintln!("skipping: this macOS can't encode HEIC");
            return;
        }
        let d = decode(&std::fs::read(&heic).unwrap(), "heic").unwrap();
        assert_eq!((d.width, d.height), (64, 48));
    }
}
