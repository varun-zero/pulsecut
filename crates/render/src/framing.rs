//! Native speaker-locked 9:16 reframing + 2-person podcast active-speaker
//! switching & dual-speaker split detection.
//!
//! Written fresh in Rust on top of BSD-2 `rustface` (pure-Rust SeetaFace detector).
//! No cloud service, no copied AGPL code.
//!
//! Supported modes:
//! 1. `active_speaker`: detects all visible faces per frame, measures lower-face
//!    (mouth/jaw) motion energy, and performs clean editorial hard-cuts between
//!    Speaker 1 and Speaker 2 with dwell hysteresis (no seasick panning across
//!    empty podcast backgrounds).
//! 2. `podcast_split`: locates the left & right speaker clusters across the clip
//!    and outputs balanced, face-centered crop boxes for a zero-distortion top/bottom
//!    2-person podcast split.
//! 3. `face`: smooth hold-then-move single-subject tracking.

use pulsecut_core::error::{PulseError, Result};
use std::path::Path;
use std::process::Command;

/// Normalized face box (0..1) relative to the frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FaceBox {
    pub cx: f32,
    pub cy: f32,
    pub w: f32,
    pub h: f32,
    pub score: f64,
}

/// One crop-center keyframe.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Focus {
    pub t_sec: f64,
    pub cx: f32,
    pub cy: f32,
}

/// Auto-detected normalized (0..100%) crop boxes for a 2-person podcast split.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PodcastSplitBoxes {
    /// Speaker 1 (typically left host) box in 0..100% source coordinates: (x, y, width, height).
    pub speaker1: (f32, f32, f32, f32),
    /// Speaker 2 (typically right guest) box in 0..100% source coordinates: (x, y, width, height).
    pub speaker2: (f32, f32, f32, f32),
    pub left_detections: usize,
    pub right_detections: usize,
}

impl Default for PodcastSplitBoxes {
    fn default() -> Self {
        Self {
            speaker1: (2.0, 4.0, 46.0, 92.0),
            speaker2: (52.0, 4.0, 46.0, 92.0),
            left_detections: 0,
            right_detections: 0,
        }
    }
}

/// Hysteretic pan controller for single-subject tracking. Holds still while the
/// subject jitters, then moves smoothly once the subject drifts past `drift_threshold`.
#[derive(Debug, Clone)]
pub struct HoldMove {
    pub drift_threshold: f32,
    pub smoothing: f32,
    pub max_step: f32,
    current: (f32, f32),
    target: (f32, f32),
}

impl HoldMove {
    pub fn new(drift_threshold: f32, smoothing: f32, max_step: f32, initial: (f32, f32)) -> Self {
        Self { drift_threshold, smoothing, max_step, current: initial, target: initial }
    }

    pub fn current(&self) -> (f32, f32) { self.current }

    /// Feed a detection (None = no face this frame). Returns the new center.
    pub fn update(&mut self, detected: Option<(f32, f32)>) -> (f32, f32) {
        if let Some(p) = detected {
            let dx = p.0 - self.target.0;
            let dy = p.1 - self.target.1;
            if (dx * dx + dy * dy).sqrt() > self.drift_threshold {
                self.target = p;
            }
        }
        let step_x = ((self.target.0 - self.current.0) * self.smoothing)
            .clamp(-self.max_step, self.max_step);
        let step_y = ((self.target.1 - self.current.1) * self.smoothing)
            .clamp(-self.max_step, self.max_step);
        self.current.0 = (self.current.0 + step_x).clamp(0.0, 1.0);
        self.current.1 = (self.current.1 + step_y).clamp(0.0, 1.0);
        self.current
    }
}

/// Editorial active-speaker camera switcher for 2-person podcasts & interviews.
///
/// Tracks left-side (slot 0) and right-side (slot 1) speaker mouth-motion energy
/// with exponential smoothing and dwell hysteresis so:
/// - When Speaker 1 is talking, the vertical camera locks rock-steady onto Speaker 1.
/// - When Speaker 2 starts talking (sustained higher mouth motion past `min_dwell_frames`),
///   it hard-cuts cleanly to Speaker 2 instead of panning across empty background.
/// - When a podcast already cuts to a single close-up camera angle (only 1 face visible),
///   it locks immediately onto that visible speaker.
#[derive(Debug, Clone)]
pub struct ActiveSpeakerTracker {
    pub min_dwell_frames: usize,
    pub switch_ratio: f32,
    pub ema_alpha: f32,
    active_slot: usize, // 0 = left speaker, 1 = right speaker
    dwell_frames: usize,
    energy: [f32; 2],
    last_pos: [(f32, f32); 2],
    current_focus: (f32, f32),
}

impl ActiveSpeakerTracker {
    pub fn new(min_dwell_frames: usize) -> Self {
        Self {
            min_dwell_frames: min_dwell_frames.max(1),
            switch_ratio: 1.25,
            ema_alpha: 0.35,
            active_slot: 0,
            dwell_frames: min_dwell_frames.max(1),
            energy: [0.0, 0.0],
            last_pos: [(0.26, 0.44), (0.74, 0.44)],
            current_focus: (0.5, 0.45),
        }
    }

    pub fn active_slot(&self) -> usize { self.active_slot }

    /// Compute vertical crop center with natural headroom (eyes in upper third).
    fn framed_center(face: &FaceBox) -> (f32, f32) {
        let cx = face.cx.clamp(0.08, 0.92);
        // Shift slightly below eye-center so head & shoulders stay well-framed.
        let cy = (face.cy + face.h * 0.18).clamp(0.28, 0.70);
        (cx, cy)
    }

    /// Feed detected faces and their corresponding mouth-motion energy scores.
    pub fn update(&mut self, observations: &[(FaceBox, f32)]) -> (f32, f32) {
        self.dwell_frames += 1;
        if observations.is_empty() {
            return self.current_focus;
        }

        // Single visible face (solo shot or podcast close-up cut) -> frame them cleanly!
        if observations.len() == 1 {
            let (face, motion) = observations[0];
            let slot = if face.cx < 0.5 { 0 } else { 1 };
            let target = Self::framed_center(&face);
            self.last_pos[slot] = target;
            self.energy[slot] = self.energy[slot] * (1.0 - self.ema_alpha) + motion * self.ema_alpha;
            if self.active_slot != slot {
                self.active_slot = slot;
                self.dwell_frames = 0;
                self.current_focus = target;
            } else {
                // Gentle stabilization while staying on the same solo speaker.
                let dx = target.0 - self.current_focus.0;
                let dy = target.1 - self.current_focus.1;
                if (dx * dx + dy * dy).sqrt() > 0.045 {
                    self.current_focus.0 += dx * 0.45;
                    self.current_focus.1 += dy * 0.45;
                }
            }
            return self.current_focus;
        }

        // Two or more faces (wide 2-person podcast shot): assign leftmost -> slot 0, rightmost -> slot 1.
        let mut sorted = observations.to_vec();
        sorted.sort_by(|a, b| a.0.cx.partial_cmp(&b.0.cx).unwrap_or(std::cmp::Ordering::Equal));
        let left = sorted[0];
        let right = sorted[sorted.len() - 1];

        let left_pos = Self::framed_center(&left.0);
        let right_pos = Self::framed_center(&right.0);
        self.last_pos[0] = left_pos;
        self.last_pos[1] = right_pos;

        self.energy[0] = self.energy[0] * (1.0 - self.ema_alpha) + left.1 * self.ema_alpha;
        self.energy[1] = self.energy[1] * (1.0 - self.ema_alpha) + right.1 * self.ema_alpha;

        let other = 1 - self.active_slot;
        let current_e = self.energy[self.active_slot].max(0.5);
        let other_e = self.energy[other];

        if self.dwell_frames >= self.min_dwell_frames && other_e > current_e * self.switch_ratio {
            // Hard-cut cleanly to the newly speaking host/guest!
            self.active_slot = other;
            self.dwell_frames = 0;
            self.current_focus = self.last_pos[other];
        } else {
            let target = self.last_pos[self.active_slot];
            let dx = target.0 - self.current_focus.0;
            let dy = target.1 - self.current_focus.1;
            if (dx * dx + dy * dy).sqrt() > 0.14 {
                // Snap if camera angle jumped sharply.
                self.current_focus = target;
            } else if (dx * dx + dy * dy).sqrt() > 0.045 {
                self.current_focus.0 += dx * 0.40;
                self.current_focus.1 += dy * 0.40;
            }
        }
        self.current_focus
    }
}

/// Compute mean absolute luminance delta inside the lower 42% (mouth & jaw)
/// of a detected face bounding box between two consecutive grayscale frames.
pub fn mouth_motion_energy(
    prev_gray: &[u8],
    curr_gray: &[u8],
    w: u32,
    h: u32,
    face: &FaceBox,
) -> f32 {
    if prev_gray.len() != curr_gray.len() || prev_gray.len() < (w * h) as usize {
        return 0.0;
    }
    let fx0 = ((face.cx - face.w * 0.38) * w as f32).floor().max(0.0) as u32;
    let fx1 = ((face.cx + face.w * 0.38) * w as f32).ceil().min(w as f32) as u32;
    // Lower half of face box (mouth + chin area).
    let fy0 = ((face.cy + face.h * 0.04) * h as f32).floor().max(0.0) as u32;
    let fy1 = ((face.cy + face.h * 0.48) * h as f32).ceil().min(h as f32) as u32;
    if fx1 <= fx0 || fy1 <= fy0 {
        return 0.0;
    }
    let mut sum: u64 = 0;
    let mut count: u64 = 0;
    for y in fy0..fy1 {
        let row = (y * w) as usize;
        for x in fx0..fx1 {
            let idx = row + x as usize;
            sum += prev_gray[idx].abs_diff(curr_gray[idx]) as u64;
            count += 1;
        }
    }
    if count == 0 { 0.0 } else { sum as f32 / count as f32 }
}

/// Build a face-centered 0..100% crop box inside a 16:9 frame suitable for one half
/// of a 9:16 vertical podcast split (each half is 1080×960 -> 1.125:1 aspect).
pub fn build_speaker_split_box(cx: f32, cy: f32, is_left_hint: bool) -> (f32, f32, f32, f32) {
    // In a 16:9 (1.778) source, a 1.125-aspect window spanning 86% of frame height has width:
    // w_norm = 0.86 * (1.125 / 1.7778) ≈ 0.544 -> cap to 48% width so left & right hosts don't overlap!
    let width_pct = 48.0_f32;
    let height_pct = 86.0_f32;
    let center_x = (cx * 100.0).clamp(width_pct / 2.0, 100.0 - width_pct / 2.0);
    // Keep eyes in upper-middle third of the speaker's half.
    let center_y = ((cy + 0.08) * 100.0).clamp(height_pct / 2.0, 100.0 - height_pct / 2.0);
    let mut x = (center_x - width_pct / 2.0).clamp(0.0, 100.0 - width_pct);
    // Prevent accidental full overlap when hint says left vs right.
    if is_left_hint {
        x = x.min(48.0);
    } else {
        x = x.max(4.0);
    }
    let y = (center_y - height_pct / 2.0).clamp(0.0, 100.0 - height_pct);
    (
        (x * 10.0).round() / 10.0,
        (y * 10.0).round() / 10.0,
        width_pct,
        height_pct,
    )
}

/// Timeline of crop centers, ready to become an ffmpeg command file.
#[derive(Debug, Clone)]
pub struct FramingPlan {
    pub points: Vec<Focus>,
    pub detected_frames: usize,
    pub total_frames: usize,
}

impl FramingPlan {
    /// Write semicolon-terminated sendcmd intervals. Each interval sets both
    /// crop x and crop y; ffmpeg applies them as frames enter the interval.
    pub fn write_sendcmd(&self, path: &Path, src_w: u32, src_h: u32) -> Result<()> {
        let cw = (min_even(src_w, scale_to_even(src_h, 9.0 / 16.0))) as i64;
        let ch = (min_even(src_h, scale_to_even(src_w, 16.0 / 9.0))) as i64;
        let max_x = (src_w as i64 - cw).max(0);
        let max_y = (src_h as i64 - ch).max(0);
        let mut text = String::new();
        for p in &self.points {
            let x = even(((p.cx as f64 * src_w as f64) - cw as f64 / 2.0).round() as i64).clamp(0, max_x);
            let y = even(((p.cy as f64 * src_h as f64) - ch as f64 / 2.0).round() as i64).clamp(0, max_y);
            text.push_str(&format!("{:.3} crop x {x};\n{:.3} crop y {y};\n", p.t_sec, p.t_sec));
        }
        std::fs::write(path, text)?;
        Ok(())
    }
}

fn even(v: i64) -> i64 { v & !1 }
fn scale_to_even(v: u32, factor: f64) -> u32 { even((v as f64 * factor).round() as i64) as u32 }
fn min_even(a: u32, b: u32) -> u32 { even(a.min(b) as i64) as u32 }

/// Parse `WIDTHxHEIGHT` from ffmpeg's stream description.
pub fn probe_dimensions(ffmpeg: &Path, video: &Path) -> Result<(u32, u32)> {
    let out = Command::new(ffmpeg).args(["-hide_banner", "-i"]).arg(video).output()
        .map_err(|e| PulseError::Render(format!("probe failed to start: {e}")))?;
    let text = String::from_utf8_lossy(&out.stderr);
    let section = text.split("Video:").nth(1).ok_or_else(|| PulseError::Render("no video stream".into()))?;
    for token in section.split(|c: char| c.is_whitespace() || c == ',') {
        let mut parts = token.split('x');
        if let (Some(a), Some(b), None) = (parts.next(), parts.next(), parts.next()) {
            if let (Ok(w), Ok(h)) = (a.parse::<u32>(), b.parse::<u32>()) {
                if w > 0 && h > 0 {
                    return Ok((w, h));
                }
            }
        }
    }
    Err(PulseError::Render(format!("could not parse video dimensions: {section:.120}")))
}

/// SeetaFace-based multi-face & active-speaker tracker.
pub struct FaceTracker {
    detector: Box<dyn rustface::Detector>,
    sample_fps: f64,
    sample_w: u32,
    sample_h: u32,
}

impl FaceTracker {
    pub fn load(model: &Path) -> Result<Self> {
        let path = if model.is_file() {
            model.to_path_buf()
        } else {
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../models/seeta_fd_frontal_v1.0.bin")
        };
        let mut detector = rustface::create_detector(path.to_string_lossy().as_ref())
            .map_err(|e| PulseError::Render(format!("face model load failed at {}: {e}", path.display())))?;
        detector.set_min_face_size(22);
        detector.set_score_thresh(2.0);
        detector.set_pyramid_scale_factor(0.8);
        detector.set_slide_window_step(4, 4);
        Ok(Self { detector, sample_fps: 3.0, sample_w: 480, sample_h: 270 })
    }

    pub fn with_sample_rate(mut self, fps: f64) -> Self { self.sample_fps = fps; self }

    /// Detect all distinct faces in a grayscale frame, sorted left-to-right.
    pub fn detect_faces(&mut self, gray: &[u8], w: u32, h: u32) -> Vec<FaceBox> {
        let image = rustface::ImageData::new(gray, w, h);
        let mut faces: Vec<FaceBox> = self.detector.detect(&image)
            .into_iter()
            .filter_map(|f: rustface::FaceInfo| {
                let r = f.bbox();
                let bx = r.x() as f32;
                let by = r.y() as f32;
                let bw = r.width() as f32;
                let bh = r.height() as f32;
                if bw <= 0.0 || bh <= 0.0 { return None; }
                Some(FaceBox {
                    cx: (bx + bw / 2.0) / w as f32,
                    cy: (by + bh / 2.0) / h as f32,
                    w: bw / w as f32,
                    h: bh / h as f32,
                    score: f.score(),
                })
            })
            .collect();
        // Sort by prominence descending to keep top distinct faces (filter overlaps).
        faces.sort_by(|a, b| (b.w * b.h * b.score.max(0.0) as f32)
            .partial_cmp(&(a.w * a.h * a.score.max(0.0) as f32))
            .unwrap_or(std::cmp::Ordering::Equal));
        let mut kept: Vec<FaceBox> = Vec::new();
        for f in faces {
            let overlaps = kept.iter().any(|k| (k.cx - f.cx).abs() < 0.12 && (k.cy - f.cy).abs() < 0.15);
            if !overlaps {
                kept.push(f);
            }
            if kept.len() >= 4 { break; }
        }
        kept.sort_by(|a, b| a.cx.partial_cmp(&b.cx).unwrap_or(std::cmp::Ordering::Equal));
        kept
    }

    /// Pick the largest, highest-scoring face in a grayscale frame.
    pub fn dominant_face(&mut self, gray: &[u8], w: u32, h: u32) -> Option<FaceBox> {
        self.detect_faces(gray, w, h)
            .into_iter()
            .max_by(|a, b| (a.w * a.h * a.score.max(0.0) as f32)
                .partial_cmp(&(b.w * b.h * b.score.max(0.0) as f32))
                .unwrap_or(std::cmp::Ordering::Equal))
    }

    fn extract_gray_frames(&self, video: &Path, ffmpeg: &Path, fps: f64) -> Result<(Vec<u8>, usize)> {
        let output = Command::new(ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(video)
            .args(["-vf", &format!("fps={},scale={}:{}", fps, self.sample_w, self.sample_h),
                   "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"])
            .output()
            .map_err(|e| PulseError::Render(format!("face frame extraction failed: {e}")))?;
        if !output.status.success() {
            return Err(PulseError::Render(format!(
                "face frame extraction exited {}: {}", output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        let frame_len = (self.sample_w * self.sample_h) as usize;
        let total = output.stdout.len() / frame_len;
        Ok((output.stdout, total))
    }

    /// Detect dominant face across the clip and build a smooth hold-then-move crop timeline.
    pub fn track(&mut self, video: &Path, ffmpeg: &Path, trim_start_ms: i64) -> Result<FramingPlan> {
        let (buf, total) = self.extract_gray_frames(video, ffmpeg, self.sample_fps)?;
        if total == 0 {
            return Ok(FramingPlan { points: Vec::new(), detected_frames: 0, total_frames: 0 });
        }
        let frame_len = (self.sample_w * self.sample_h) as usize;
        let mut controller = HoldMove::new(0.055, 0.45, 0.30, (0.5, 0.45));
        let mut points = Vec::new();
        let mut detected = 0;
        for i in 0..total {
            let frame = &buf[i * frame_len..(i + 1) * frame_len];
            let face = self.dominant_face(frame, self.sample_w, self.sample_h);
            if face.is_some() { detected += 1; }
            let center = controller.update(face.map(|f| (f.cx, (f.cy + f.h * 0.18).clamp(0.28, 0.70))));
            points.push(Focus {
                t_sec: trim_start_ms as f64 / 1000.0 + i as f64 / self.sample_fps,
                cx: center.0,
                cy: center.1,
            });
        }
        Ok(FramingPlan { points, detected_frames: detected, total_frames: total })
    }

    /// Track active speaker across a 2-person podcast/interview clip: locks onto
    /// Speaker 1 while they speak and hard-cuts cleanly to Speaker 2 when they speak.
    pub fn track_active_speaker(&mut self, video: &Path, ffmpeg: &Path, trim_start_ms: i64) -> Result<FramingPlan> {
        let fps = self.sample_fps.max(3.0);
        let (buf, total) = self.extract_gray_frames(video, ffmpeg, fps)?;
        if total == 0 {
            return Ok(FramingPlan { points: Vec::new(), detected_frames: 0, total_frames: 0 });
        }
        let frame_len = (self.sample_w * self.sample_h) as usize;
        // Minimum ~1.5s dwell before switching speakers to prevent jitter cuts.
        let min_dwell = (fps * 1.5).round().max(2.0) as usize;
        let mut switcher = ActiveSpeakerTracker::new(min_dwell);
        let mut points = Vec::with_capacity(total);
        let mut detected = 0;

        for i in 0..total {
            let curr = &buf[i * frame_len..(i + 1) * frame_len];
            let prev = if i > 0 { &buf[(i - 1) * frame_len..i * frame_len] } else { curr };
            let faces = self.detect_faces(curr, self.sample_w, self.sample_h);
            if !faces.is_empty() { detected += 1; }
            let obs: Vec<(FaceBox, f32)> = faces
                .into_iter()
                .map(|f| {
                    let motion = mouth_motion_energy(prev, curr, self.sample_w, self.sample_h, &f);
                    (f, motion)
                })
                .collect();
            let center = switcher.update(&obs);
            points.push(Focus {
                t_sec: trim_start_ms as f64 / 1000.0 + i as f64 / fps,
                cx: center.0,
                cy: center.1,
            });
        }
        Ok(FramingPlan { points, detected_frames: detected, total_frames: total })
    }

    /// Detect both speakers in a 2-person podcast clip and compute balanced top/bottom
    /// crop boxes centered cleanly on Speaker 1 (left) and Speaker 2 (right).
    pub fn detect_podcast_speakers(&mut self, video: &Path, ffmpeg: &Path) -> Result<PodcastSplitBoxes> {
        let (buf, total) = self.extract_gray_frames(video, ffmpeg, 1.0)?;
        if total == 0 {
            return Ok(PodcastSplitBoxes::default());
        }
        let frame_len = (self.sample_w * self.sample_h) as usize;
        let mut left_xs = Vec::new();
        let mut left_ys = Vec::new();
        let mut right_xs = Vec::new();
        let mut right_ys = Vec::new();

        for i in 0..total {
            let frame = &buf[i * frame_len..(i + 1) * frame_len];
            let faces = self.detect_faces(frame, self.sample_w, self.sample_h);
            for f in faces {
                if f.cx < 0.5 {
                    left_xs.push(f.cx);
                    left_ys.push(f.cy);
                } else {
                    right_xs.push(f.cx);
                    right_ys.push(f.cy);
                }
            }
        }

        let median = |vals: &mut Vec<f32>, fallback: f32| -> f32 {
            if vals.is_empty() { return fallback; }
            vals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            vals[vals.len() / 2]
        };

        let lx = median(&mut left_xs, 0.25);
        let ly = median(&mut left_ys, 0.40);
        let rx = median(&mut right_xs, 0.75);
        let ry = median(&mut right_ys, 0.40);

        Ok(PodcastSplitBoxes {
            speaker1: build_speaker_split_box(lx, ly, true),
            speaker2: build_speaker_split_box(rx, ry, false),
            left_detections: left_xs.len(),
            right_detections: right_xs.len(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hold_ignores_small_jitter() {
        let mut c = HoldMove::new(0.055, 0.5, 0.3, (0.5, 0.5));
        let p = c.update(Some((0.52, 0.5)));
        assert_eq!(p, (0.5, 0.5), "small jitter should not move the target");
    }

    #[test]
    fn large_drift_moves_gradually() {
        let mut c = HoldMove::new(0.055, 0.5, 0.1, (0.5, 0.5));
        let first = c.update(Some((0.9, 0.5)));
        assert!((first.0 - 0.60).abs() < 1e-6, "first step: {first:?}");
        let p = c.update(None);
        assert!((p.0 - 0.70).abs() < 1e-6, "max step should cap movement: {p:?}");
    }

    #[test]
    fn active_speaker_switches_cleanly_between_podcast_hosts() {
        let host_left = FaceBox { cx: 0.24, cy: 0.40, w: 0.14, h: 0.22, score: 8.0 };
        let host_right = FaceBox { cx: 0.76, cy: 0.42, w: 0.14, h: 0.22, score: 8.0 };
        let mut tracker = ActiveSpeakerTracker::new(3);

        // Speaker 1 (left) is talking
        let mut focus = (0.5, 0.5);
        for _ in 0..4 {
            focus = tracker.update(&[(host_left, 18.0), (host_right, 2.0)]);
        }
        assert_eq!(tracker.active_slot(), 0);
        assert!(focus.0 < 0.35, "camera should frame left host: {focus:?}");

        // Speaker 2 (right) starts talking -> should cut cleanly to right host after dwell
        for _ in 0..5 {
            focus = tracker.update(&[(host_left, 1.5), (host_right, 22.0)]);
        }
        assert_eq!(tracker.active_slot(), 1);
        assert!(focus.0 > 0.65, "camera should hard-cut to right host: {focus:?}");
    }

    #[test]
    fn mouth_motion_detects_active_lower_face_change() {
        let w = 100u32;
        let h = 100u32;
        let prev = vec![80u8; (w * h) as usize];
        let mut curr = prev.clone();
        let face = FaceBox { cx: 0.5, cy: 0.5, w: 0.2, h: 0.2, score: 6.0 };
        // Perturb mouth region (y = 51..60, x = 43..57)
        for y in 51..60 {
            for x in 43..57 {
                curr[(y * w + x) as usize] = 160;
            }
        }
        let energy = mouth_motion_energy(&prev, &curr, w, h, &face);
        assert!(energy > 30.0, "expected high mouth motion energy, got {energy}");
    }

    #[test]
    fn podcast_split_boxes_frame_both_hosts_without_clipping() {
        let left = build_speaker_split_box(0.24, 0.38, true);
        let right = build_speaker_split_box(0.78, 0.40, false);
        assert!(left.0 + left.2 <= 100.0 && left.1 + left.3 <= 100.0);
        assert!(right.0 + right.2 <= 100.0 && right.1 + right.3 <= 100.0);
        assert!(left.0 < right.0);
    }

    #[test]
    fn write_sendcmd_produces_semicolons() {
        let dir = std::env::temp_dir().join(format!("pcut-framing-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cmds.txt");
        let plan = FramingPlan {
            points: vec![Focus { t_sec: 0.0, cx: 0.5, cy: 0.5 }, Focus { t_sec: 0.5, cx: 0.8, cy: 0.5 }],
            detected_frames: 1, total_frames: 2,
        };
        plan.write_sendcmd(&path, 1280, 720).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("0.000 crop x"));
        assert!(text.contains(";"));
        assert!(text.contains("crop y"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn dominant_face_handles_blank_frame() {
        let mut t = FaceTracker::load(Path::new("models/seeta_fd_frontal_v1.0.bin"))
            .expect("bundled model must load");
        let blank = vec![128u8; 480 * 270];
        assert!(t.dominant_face(&blank, 480, 270).is_none());
    }
}
