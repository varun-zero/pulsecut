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
        let json = edl.to_json().unwrap();
        let back = EditDecisionList::from_json(&json).unwrap();
        assert_eq!(back, edl);
    }
}
