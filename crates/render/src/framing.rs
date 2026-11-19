//! Native speaker-locked 9:16 reframing.
//!
//! This is the "hold-then-move" idea from the field's best reframers, written
//! fresh in Rust on top of BSD-2 `rustface` (pure-Rust SeetaFace detector).
//! No cloud service, no copied AGPL code.
//!
//! Pipeline: sample frames with ffmpeg -> detect faces -> pick the dominant
//! face -> hysteretic pan controller -> sendcmd file -> ffmpeg `crop x/y`
//! commands during the final encode.

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

/// Hysteretic pan controller. The crop holds still while the subject jitters,
/// then moves smoothly once the subject drifts beyond a threshold. This is
/// what stops a shaky, seasick-looking vertical video.
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
        // Keep the crop inside the frame.
        self.current.0 = (self.current.0 + step_x).clamp(0.0, 1.0);
        self.current.1 = (self.current.1 + step_y).clamp(0.0, 1.0);
        self.current
    }
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

/// SeetaFace-based tracker. Sample at 2 fps by default: face motion is slow,
/// and 2 fps keeps detection cost negligible next to the video encode.
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
            // Dev convenience: running tests from a crate directory still
            // finds the model bundled at the workspace root.
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../models/seeta_fd_frontal_v1.0.bin")
        };
        let mut detector = rustface::create_detector(path.to_string_lossy().as_ref())
            .map_err(|e| PulseError::Render(format!("face model load failed at {}: {e}", path.display())))?;
        // Settings recommended by the SeetaFace port for real-time use.
        detector.set_min_face_size(20);
        detector.set_score_thresh(2.0);
        detector.set_pyramid_scale_factor(0.8);
        detector.set_slide_window_step(4, 4);
        Ok(Self { detector, sample_fps: 2.0, sample_w: 320, sample_h: 180 })
    }

    pub fn with_sample_rate(mut self, fps: f64) -> Self { self.sample_fps = fps; self }

    /// Pick the largest, highest-scoring face in a grayscale frame.
    pub fn dominant_face(&mut self, gray: &[u8], w: u32, h: u32) -> Option<FaceBox> {
        let image = rustface::ImageData::new(gray, w, h);
        let faces = self.detector.detect(&image);
        faces.into_iter()
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
            .max_by(|a, b| (a.w * a.h * a.score.max(0.0) as f32)
                .partial_cmp(&(b.w * b.h * b.score.max(0.0) as f32))
                .unwrap_or(std::cmp::Ordering::Equal))
    }

    /// Detect faces across the whole clip and build a smoothed crop timeline.
    pub fn track(&mut self, video: &Path, ffmpeg: &Path, trim_start_ms: i64) -> Result<FramingPlan> {
        let output = Command::new(ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(video)
            .args(["-vf", &format!("fps={},scale={}:{}", self.sample_fps, self.sample_w, self.sample_h),
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
        if total == 0 {
            return Ok(FramingPlan { points: Vec::new(), detected_frames: 0, total_frames: 0 });
        }
        let mut controller = HoldMove::new(0.055, 0.45, 0.30, (0.5, 0.5));
        let mut points = Vec::new();
        let mut detected = 0;
        for i in 0..total {
            let frame = &output.stdout[i * frame_len..(i + 1) * frame_len];
            let face = self.dominant_face(frame, self.sample_w, self.sample_h);
            if face.is_some() { detected += 1; }
            let center = controller.update(face.map(|f| (f.cx, f.cy)));
            points.push(Focus {
                t_sec: trim_start_ms as f64 / 1000.0 + i as f64 / self.sample_fps,
                cx: center.0,
                cy: center.1,
            });
        }
        Ok(FramingPlan { points, detected_frames: detected, total_frames: total })
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
        let first = c.update(Some((0.9, 0.5))); // target jumps; cap at +0.10
        assert!((first.0 - 0.60).abs() < 1e-6, "first step: {first:?}");
        let p = c.update(None); // continues at +0.10 per frame
        assert!((p.0 - 0.70).abs() < 1e-6, "max step should cap movement: {p:?}");
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
        let blank = vec![128u8; 320 * 180];
        assert!(t.dominant_face(&blank, 320, 180).is_none());
    }
}
