//! Non-destructive rotate / flip. The original file is never touched: the
//! orientation is stored per item and applied to the thumbnail (here) and
//! in the viewer (CSS transform).
//!
//! An orientation is "flip horizontally (optional), then rotate clockwise by
//! `rotation` quarter turns" — the same order as the CSS
//! `rotate(..) scaleX(-1)` the frontend uses.

use image::DynamicImage;
use serde::Deserialize;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Orientation {
    /// Clockwise quarter turns, 0..=3.
    pub rotation: u8,
    pub flipped: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OrientOp {
    RotateCw,
    RotateCcw,
    FlipH,
    FlipV,
    Reset,
}

impl Orientation {
    pub fn new(rotation: u8, flipped: bool) -> Self {
        Self { rotation: rotation % 4, flipped }
    }

    pub fn is_identity(self) -> bool {
        self == Self::default()
    }

    /// Whether width and height are swapped relative to the file.
    pub fn swaps_axes(self) -> bool {
        self.rotation % 2 == 1
    }

    /// Applies `op` on top of the current orientation, as seen on screen
    /// (a horizontal flip mirrors what is displayed now).
    pub fn then(self, op: OrientOp) -> Self {
        let r = self.rotation;
        match op {
            OrientOp::RotateCw => Self::new(r + 1, self.flipped),
            OrientOp::RotateCcw => Self::new(r + 3, self.flipped),
            // Mirroring after a rotation by r equals the rotation by -r after mirroring.
            OrientOp::FlipH => Self::new(4 - r, !self.flipped),
            // A vertical flip is a horizontal flip turned by 180°.
            OrientOp::FlipV => Self::new(6 - r, !self.flipped),
            OrientOp::Reset => Self::default(),
        }
    }

    pub fn apply(self, img: &DynamicImage) -> DynamicImage {
        let img = if self.flipped { img.fliph() } else { img.clone() };
        match self.rotation {
            1 => img.rotate90(),
            2 => img.rotate180(),
            3 => img.rotate270(),
            _ => img,
        }
    }

    /// Thumbnail file for this orientation, derived from the base (unrotated)
    /// thumbnail `<id>.<ext>`. The name depends only on the orientation, so a
    /// cached image under that name is always the right one.
    pub fn thumb_name(self, base: &str) -> String {
        if self.is_identity() {
            return base.to_string();
        }
        let (stem, ext) = base.rsplit_once('.').unwrap_or((base, "jpg"));
        format!("{stem}_o{}{}.{ext}", self.flipped as u8, self.rotation)
    }
}

/// The unrotated thumbnail a (possibly oriented) thumbnail was made from.
pub fn base_thumb(thumb: &str) -> String {
    let Some((stem, ext)) = thumb.rsplit_once('.') else {
        return thumb.to_string();
    };
    match stem.rsplit_once("_o") {
        Some((id, tag)) if tag.len() == 2 && tag.bytes().all(|b| b.is_ascii_digit()) => format!("{id}.{ext}"),
        _ => thumb.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};
    use OrientOp::*;

    /// 3×2 image whose pixels are all distinct, to compare transforms exactly.
    fn sample() -> DynamicImage {
        DynamicImage::ImageRgb8(RgbImage::from_fn(3, 2, |x, y| Rgb([x as u8, y as u8, 0])))
    }

    fn rotate_cw(img: &DynamicImage) -> DynamicImage {
        img.rotate90()
    }

    #[test]
    fn composition_matches_pixels() {
        let ops = [RotateCw, RotateCcw, FlipH, FlipV];
        // Every reachable orientation, then every op on top of it, compared
        // with doing the same thing to the pixels directly.
        for flipped in [false, true] {
            for rotation in 0..4 {
                let o = Orientation::new(rotation, flipped);
                let shown = o.apply(&sample());
                for op in ops {
                    let expected = match op {
                        RotateCw => rotate_cw(&shown),
                        RotateCcw => shown.rotate270(),
                        FlipH => shown.fliph(),
                        FlipV => shown.flipv(),
                        Reset => unreachable!(),
                    };
                    let got = o.then(op).apply(&sample());
                    assert_eq!(got.to_rgb8(), expected.to_rgb8(), "{o:?} then {op:?}");
                }
            }
        }
    }

    #[test]
    fn round_trips() {
        let o = Orientation::default();
        assert!(o.then(RotateCw).then(RotateCcw).is_identity());
        assert!(o.then(FlipH).then(FlipH).is_identity());
        assert!(o.then(FlipV).then(FlipV).is_identity());
        assert!(o.then(RotateCw).then(FlipH).then(Reset).is_identity());
        assert!(o.then(RotateCw).swaps_axes());
        assert!(!o.then(FlipV).swaps_axes());
    }

    #[test]
    fn thumb_names() {
        let o = Orientation::new(1, true);
        assert_eq!(o.thumb_name("abc.jpg"), "abc_o11.jpg");
        assert_eq!(Orientation::default().thumb_name("abc.png"), "abc.png");
        assert_eq!(base_thumb("abc_o11.jpg"), "abc.jpg");
        assert_eq!(base_thumb("abc_o03.png"), "abc.png");
        assert_eq!(base_thumb("abc.jpg"), "abc.jpg");
        // Item ids are hex, so a real id never looks like a suffix, but be strict anyway.
        assert_eq!(base_thumb("photo_one.jpg"), "photo_one.jpg");
    }
}
