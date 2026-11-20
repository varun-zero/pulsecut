//! Non-destructive edit decision list.
//!
//! The editor never rewrites the exported MP4 in place. It appends operations
//! to an EDL; the render crate re-evaluates the EDL into a final ffmpeg graph.
//! This is the single most important design choice borrowed from the better
//! open-source editors: nothing is lost, and every edit is reversible.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum EditOp {
    /// Replace the source window with a tighter one (ms relative to source).
    Trim { start_ms: i64, end_ms: i64 },
    /// Insert a hard cut; segments are addressed by index after splitting.
    Split { at_ms: i64 },
    /// Normalized crop rectangle (0.0..1.0) inside the 9:16 frame.
    Crop { x: f32, y: f32, w: f32, h: f32 },
    /// Override or add one caption cue.
    Caption { id: String, text: String, start_ms: i64, end_ms: i64 },
    /// Pinned hook text shown for the first N milliseconds.
    Hook { text: String, duration_ms: i64 },
    /// Reorder segments produced by earlier splits.
    Reorder { from: usize, to: usize },
    /// Mute a word range (used for profanity cleanup).
    Mute { start_ms: i64, end_ms: i64 },
    /// Switch the visual/metadata template for this clip. Last one wins.
    Template { id: String },
    /// Override the subtitle font family and size for re-renders.
    SubtitleFont { family: String, size: u32 },
    /// Override the output aspect ratio (e.g. 1080x1920, 1080x1080).
    Aspect { width: u32, height: u32 },
    /// Compositional layout: solo | pip | split | centered.
    Layout { preset: String },
    /// Canvas treatment behind the subject: solid | blur | padding.
    Canvas { mode: String },
    /// Animated-feeling end card shown in the final seconds.
    Outro { text: String, duration_ms: i64 },
    /// Social card / verified-handle overlay.
    SocialCard { handle: String, style: String },
    /// Duck the bed under speech then rise to `peak` at the end.
    AudioPeak { rise_ms: i64, peak: f64 },
    /// 16:9 source region (0..100%) to crop for the streamer facecam in Reaction PiP / Split Stream.
    FacecamCrop { x: f32, y: f32, width: f32, height: f32 },
    /// Output placement of the cropped facecam inside the vertical frame.
    FacecamLayout {
        enabled: bool,
        placement: String,
        output_x: f32,
        output_y: f32,
        output_width: f32,
        output_aspect: String,
        split_ratio: f32,
        rounded: u32,
    },
    /// Framing of the primary video inside the vertical mobile canvas (9:16 | 4:3 | 16:9 | 1:1).
    MainVideoFrame { aspect: String, fit: String, offset_y: f32 },
    /// Smart camera framing mode: active_speaker | podcast_split | face | static,
    /// with optional manual 0..100% crop boxes for Speaker 1 and Speaker 2 in 2-person podcasts.
    FramingMode {
        mode: String,
        #[serde(default)]
        speaker1_x: Option<f32>,
        #[serde(default)]
        speaker1_y: Option<f32>,
        #[serde(default)]
        speaker1_w: Option<f32>,
        #[serde(default)]
        speaker1_h: Option<f32>,
        #[serde(default)]
        speaker2_x: Option<f32>,
        #[serde(default)]
        speaker2_y: Option<f32>,
        #[serde(default)]
        speaker2_w: Option<f32>,
        #[serde(default)]
        speaker2_h: Option<f32>,
        #[serde(default)]
        split_ratio: Option<f32>,
        #[serde(default)]
        swap_speakers: Option<bool>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct FacecamCropSpec {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FacecamLayoutSpec {
    pub enabled: bool,
    pub placement: String,
    pub output_x: f32,
    pub output_y: f32,
    pub output_width: f32,
    pub output_aspect: String,
    pub split_ratio: f32,
    pub rounded: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MainVideoFrameSpec {
    pub aspect: String,
    pub fit: String,
    pub offset_y: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FramingModeSpec {
    pub mode: String,
    pub speaker1: Option<(f32, f32, f32, f32)>,
    pub speaker2: Option<(f32, f32, f32, f32)>,
    pub split_ratio: f32,
    pub swap_speakers: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct EditDecisionList {
    pub clip_id: String,
    pub version: u32,
    pub ops: Vec<EditOp>,
}

impl EditDecisionList {
    pub fn new(clip_id: &str) -> Self {
        Self { clip_id: clip_id.into(), version: 0, ops: Vec::new() }
    }

    pub fn push(&mut self, op: EditOp) {
        self.ops.push(op);
        self.version += 1;
    }

    /// Resolve the effective source window after all trim operations.
    /// Later trims win, but they are clamped to the previous window so an
    /// editor can never accidentally request a range outside the source.
    pub fn effective_window(&self, original: &crate::model::ClipWindow) -> crate::model::ClipWindow {
        let mut start = original.start_ms;
        let mut end = original.end_ms;
        let mut reason = original.snap_reason.clone();
        for op in &self.ops {
            if let EditOp::Trim { start_ms, end_ms } = op {
                let s = original.start_ms.max(*start_ms);
                let e = original.end_ms.min(*end_ms);
                if e > s {
                    start = s;
                    end = e;
                    reason = format!("editor trim [{}, {}]", s, e);
                }
            }
        }
        crate::model::ClipWindow { start_ms: start, end_ms: end, snap_reason: reason }
    }

    /// Caption overrides keyed by cue id, applied last-wins.
    pub fn caption_overrides(&self) -> std::collections::HashMap<String, String> {
        let mut map = std::collections::HashMap::new();
        for op in &self.ops {
            if let EditOp::Caption { id, text, .. } = op {
                map.insert(id.clone(), text.clone());
            }
        }
        map
    }

    /// Last subtitle font override, if any.
    pub fn font(&self) -> Option<(String, u32)> {
        self.ops.iter().rev().find_map(|op| match op {
            EditOp::SubtitleFont { family, size } => Some((family.clone(), *size)),
            _ => None,
        })
    }

    /// Last aspect-ratio override, if any.
    pub fn aspect(&self) -> Option<(u32, u32)> {
        self.ops.iter().rev().find_map(|op| match op {
            EditOp::Aspect { width, height } => Some((*width, *height)),
            _ => None,
        })
    }

    pub fn layout(&self) -> Option<String> {
        self.ops.iter().rev().find_map(|op| match op {
            EditOp::Layout { preset } => Some(preset.clone()),
            _ => None,
        })
    }
    pub fn canvas(&self) -> Option<String> {
        self.ops.iter().rev().find_map(|op| match op {
            EditOp::Canvas { mode } => Some(mode.clone()),
            _ => None,
        })
    }
    pub fn outro(&self) -> Option<(String, i64)> {
        self.ops.iter().rev().find_map(|op| match op {
            EditOp::Outro { text, duration_ms } => Some((text.clone(), *duration_ms)),
            _ => None,
        })
    }
    pub fn social_card(&self) -> Option<(String, String)> {
        self.ops.iter().rev().find_map(|op| match op {
            EditOp::SocialCard { handle, style } => Some((handle.clone(), style.clone())),
            _ => None,
        })
    }
    pub fn audio_peak(&self) -> Option<(i64, f64)> {
        self.ops.iter().rev().find_map(|op| match op {
            EditOp::AudioPeak { rise_ms, peak } => Some((*rise_ms, *peak)),
            _ => None,
        })
    }

    pub fn hook(&self) -> Option<(String, i64)> {
        self.ops.iter().rev().find_map(|op| match op {
            EditOp::Hook { text, duration_ms } => Some((text.clone(), *duration_ms)),
            _ => None,
        })
    }

    pub fn facecam_crop(&self) -> Option<FacecamCropSpec> {
        self.ops.iter().rev().find_map(|op| match op {
            EditOp::FacecamCrop { x, y, width, height } => Some(FacecamCropSpec {
                x: *x, y: *y, width: *width, height: *height,
            }),
            _ => None,
        })
    }

    pub fn facecam_layout(&self) -> Option<FacecamLayoutSpec> {
        self.ops.iter().rev().find_map(|op| match op {
            EditOp::FacecamLayout {
                enabled, placement, output_x, output_y, output_width, output_aspect, split_ratio, rounded,
            } => Some(FacecamLayoutSpec {
                enabled: *enabled,
                placement: placement.clone(),
                output_x: *output_x,
                output_y: *output_y,
                output_width: *output_width,
                output_aspect: output_aspect.clone(),
                split_ratio: *split_ratio,
                rounded: *rounded,
            }),
            _ => None,
        })
    }

    pub fn main_video_frame(&self) -> Option<MainVideoFrameSpec> {
        self.ops.iter().rev().find_map(|op| match op {
            EditOp::MainVideoFrame { aspect, fit, offset_y } => Some(MainVideoFrameSpec {
                aspect: aspect.clone(),
                fit: fit.clone(),
                offset_y: *offset_y,
            }),
            _ => None,
        })
    }

    pub fn framing_mode(&self) -> Option<FramingModeSpec> {
        self.ops.iter().rev().find_map(|op| match op {
            EditOp::FramingMode {
                mode,
                speaker1_x, speaker1_y, speaker1_w, speaker1_h,
                speaker2_x, speaker2_y, speaker2_w, speaker2_h,
                split_ratio, swap_speakers,
            } => {
                let speaker1 = match (speaker1_x, speaker1_y, speaker1_w, speaker1_h) {
                    (Some(x), Some(y), Some(w), Some(h)) => Some((*x, *y, *w, *h)),
                    _ => None,
                };
                let speaker2 = match (speaker2_x, speaker2_y, speaker2_w, speaker2_h) {
                    (Some(x), Some(y), Some(w), Some(h)) => Some((*x, *y, *w, *h)),
                    _ => None,
                };
                Some(FramingModeSpec {
                    mode: mode.clone(),
                    speaker1,
                    speaker2,
                    split_ratio: split_ratio.unwrap_or(50.0).clamp(30.0, 70.0),
                    swap_speakers: swap_speakers.unwrap_or(false),
                })
            }
            _ => None,
        })
    }

    pub fn to_json(&self) -> crate::Result<String> { Ok(serde_json::to_string_pretty(self)?) }

    pub fn from_json(s: &str) -> crate::Result<Self> { Ok(serde_json::from_str(s)?) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ClipWindow;

    #[test]
    fn trim_is_clamped_to_source() {
        let src = ClipWindow { start_ms: 1000, end_ms: 6000, snap_reason: "silence".into() };
        let mut edl = EditDecisionList::new("c1");
        edl.push(EditOp::Trim { start_ms: 500, end_ms: 9000 });
        let w = edl.effective_window(&src);
        assert_eq!((w.start_ms, w.end_ms), (1000, 6000));
    }

    #[test]
    fn later_trim_wins() {
        let src = ClipWindow { start_ms: 0, end_ms: 10_000, snap_reason: "x".into() };
        let mut edl = EditDecisionList::new("c1");
        edl.push(EditOp::Trim { start_ms: 2000, end_ms: 8000 });
        edl.push(EditOp::Trim { start_ms: 3000, end_ms: 7000 });
        let w = edl.effective_window(&src);
        assert_eq!((w.start_ms, w.end_ms), (3000, 7000));
        assert_eq!(edl.version, 2);
    }

    #[test]
    fn edl_roundtrip() {
        let mut edl = EditDecisionList::new("c1");
        edl.push(EditOp::Hook { text: "wait for it".into(), duration_ms: 1500 });
        edl.push(EditOp::FacecamCrop { x: 68.0, y: 60.0, width: 28.0, height: 35.0 });
        edl.push(EditOp::FacecamLayout {
            enabled: true,
            placement: "bottom".into(),
            output_x: 50.0,
            output_y: 78.0,
            output_width: 54.0,
            output_aspect: "4:3".into(),
            split_ratio: 42.0,
            rounded: 12,
        });
        edl.push(EditOp::MainVideoFrame { aspect: "4:3".into(), fit: "cover".into(), offset_y: 36.0 });
        edl.push(EditOp::FramingMode {
            mode: "podcast_split".into(),
            speaker1_x: Some(4.0), speaker1_y: Some(8.0), speaker1_w: Some(44.0), speaker1_h: Some(84.0),
            speaker2_x: Some(52.0), speaker2_y: Some(8.0), speaker2_w: Some(44.0), speaker2_h: Some(84.0),
            split_ratio: Some(50.0), swap_speakers: Some(false),
        });
        let json = edl.to_json().unwrap();
        let back = EditDecisionList::from_json(&json).unwrap();
        assert_eq!(back, edl);
        assert_eq!(back.facecam_crop().unwrap().width, 28.0);
        assert_eq!(back.facecam_layout().unwrap().placement, "bottom");
        assert_eq!(back.main_video_frame().unwrap().aspect, "4:3");
        assert_eq!(back.framing_mode().unwrap().mode, "podcast_split");
    }
}
