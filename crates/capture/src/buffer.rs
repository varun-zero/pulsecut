//! Disk-backed rolling buffer of HLS segments.
//!
//! Keeping raw video in memory is a non-starter for a 2-hour stream. We keep
//! small MPEG-TS segments on disk (4 seconds each), track their wall-clock
//! ranges, prune anything older than the configured window, and splice the
//! segments covering a clip window with ffmpeg's concat demuxer.
//!
//! Extraction uses `-c copy`: no re-encode, so it finishes in well under a
//! second even while the stream is still running. Vertical framing and
//! subtitles are added later by `pulsecut-render`.

use pulsecut_core::error::Result;
use pulsecut_core::model::ClipWindow;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Segment {
    pub index: u64,
    pub path: PathBuf,
    pub start_ms: i64,
    pub end_ms: i64,
}

#[derive(Debug)]
pub struct RollingBuffer {
    pub dir: PathBuf,
    pub segment_secs: u32,
    pub buffer_secs: u32,
    /// Wall-clock time of segment index 0.
    pub started_at_ms: i64,
    pub segments: Vec<Segment>,
}

impl RollingBuffer {
    pub fn new(dir: impl AsRef<Path>, segment_secs: u32, buffer_secs: u32, started_at_ms: i64) -> Result<Self> {
        let dir = dir.as_ref().to_path_buf();
        fs::create_dir_all(&dir)?;
        // Concat-demuxer lists are resolved relative to the list file, which
        // may live in a different directory (out/raw). Absolute segment paths
        // are the only safe option.
        let dir = dir.canonicalize()?;
        Ok(Self { dir, segment_secs, buffer_secs, started_at_ms, segments: Vec::new() })
    }

    /// Rescan the segment directory. Segment names are `seg_%06d.ts`, produced
    /// by the ffmpeg segment muxer with `-segment_start_number 0`.
    pub fn refresh(&mut self) -> Result<()> {
        let mut found: Vec<(u64, PathBuf)> = Vec::new();
        for entry in fs::read_dir(&self.dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("seg_") || !name.ends_with(".ts") {
                continue;
            }
            let digits = &name[4..name.len() - 3];
            if let Ok(index) = digits.parse::<u64>() {
                found.push((index, entry.path()));
            }
        }
        found.sort_by_key(|(i, _)| *i);
        let dur = self.segment_secs as i64 * 1000;
        self.segments = found
            .into_iter()
            .map(|(index, path)| Segment {
                index,
                start_ms: self.started_at_ms + index as i64 * dur,
                end_ms: self.started_at_ms + (index as i64 + 1) * dur,
                path,
            })
            .collect();
        Ok(())
    }

    /// Delete segments fully outside the retention window. Called on every
    /// supervisor tick so disk usage stays bounded.
    pub fn prune(&mut self, now_ms: i64) -> Result<u32> {
        let cutoff = now_ms - self.buffer_secs as i64 * 1000;
        let mut removed = 0;
        self.segments.retain(|s| {
            if s.end_ms < cutoff {
                let _ = fs::remove_file(&s.path);
                removed += 1;
                false
            } else {
                true
            }
        });
        Ok(removed)
    }

    /// The wall-clock range currently available for clipping.
    pub fn coverage(&self) -> Option<(i64, i64)> {
        if self.segments.is_empty() {
            return None;
        }
        Some((self.segments[0].start_ms, self.segments[self.segments.len() - 1].end_ms))
    }

    pub fn can_cover(&self, window: &ClipWindow) -> bool {
        self.coverage().map_or(false, |(a, b)| window.start_ms >= a && window.end_ms <= b)
    }

    /// Milliseconds of extra pre-roll in front of the requested window caused
    /// by using whole segments. The render stage trims it precisely.
    pub fn lead_ms(&self, window: &ClipWindow) -> i64 {
        self.segments
            .iter()
            .find(|s| s.end_ms > window.start_ms && s.start_ms < window.end_ms)
            .map(|s| (window.start_ms - s.start_ms).max(0))
            .unwrap_or(0)
    }

    /// Write a concat-demuxer list and return the ffmpeg args that copy the
    /// requested segments into `out`.
    ///
    /// Important: we deliberately do NOT pass `-ss` here. With a concat of
    /// MPEG-TS segments whose first video PTS is non-zero, `-ss` + stream copy
    /// silently drops the video stream (verified with a synthetic stream).
    /// Keeping whole segments and trimming in the re-encoding render stage is
    /// both correct and just as fast, because that stage already re-encodes.
    pub fn extract_args(&self, window: &ClipWindow, out: &Path, _ffmpeg: &Path) -> Result<Option<Vec<String>>> {
        let overlapping: Vec<&Segment> = self
            .segments
            .iter()
            .filter(|s| s.end_ms > window.start_ms && s.start_ms < window.end_ms)
            .collect();
        if overlapping.is_empty() || !self.can_cover(window) {
            return Ok(None);
        }
        let list_path = out.with_extension("concat.txt");
        let mut list = String::new();
        for seg in &overlapping {
            let p = seg.path.to_string_lossy().replace('\\', "/").replace('\'', "'\\''");
            list.push_str(&format!("file '{p}'\n"));
        }
        fs::write(&list_path, list)?;
        let base = overlapping[0].start_ms;
        let duration = (window.end_ms - base).max(1000) as f64 / 1000.0;
        Ok(Some(vec![
            "-y".into(),
            "-f".into(), "concat".into(),
            "-safe".into(), "0".into(),
            "-i".into(), list_path.to_string_lossy().into_owned(),
            "-t".into(), format!("{duration:.3}"),
            "-c".into(), "copy".into(),
            "-avoid_negative_ts".into(), "make_zero".into(),
            out.to_string_lossy().into_owned(),
        ]))
    }

    /// Convenience wrapper that runs the extraction command.
    pub async fn extract(&self, window: &ClipWindow, out: &Path, ffmpeg: &Path) -> Result<bool> {
        let args = match self.extract_args(window, out, ffmpeg)? {
            Some(a) => a,
            None => return Ok(false),
        };
        let mut cmd = tokio::process::Command::new(ffmpeg);
        cmd.args(&args);
        super::ffmpeg::run(cmd, "ffmpeg extract").await?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(p: &Path) { fs::write(p, b"fake ts").unwrap(); }

    #[test]
    fn refresh_and_coverage() {
        let dir = std::env::temp_dir().join(format!("pulsecut-buf-{}", uuid::Uuid::new_v4()));
        let mut b = RollingBuffer::new(&dir, 4, 60, 1000).unwrap();
        for i in 0..5 {
            touch(&dir.join(format!("seg_{i:06}.ts")));
        }
        b.refresh().unwrap();
        assert_eq!(b.segments.len(), 5);
        assert_eq!(b.coverage(), Some((1000, 1000 + 5 * 4000)));
        let window = ClipWindow { start_ms: 1000, end_ms: 9000, snap_reason: "test".into() };
        assert!(b.can_cover(&window));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn prune_removes_old_segments() {
        let dir = std::env::temp_dir().join(format!("pulsecut-buf-{}", uuid::Uuid::new_v4()));
        let mut b = RollingBuffer::new(&dir, 4, 8, 0).unwrap();
        for i in 0..5 {
            touch(&dir.join(format!("seg_{i:06}.ts")));
        }
        b.refresh().unwrap();
        let n = b.prune(20_000).unwrap();
        assert!(n >= 2, "expected old segments removed, got {n}");
        assert!(b.segments.iter().all(|s| s.end_ms >= 20_000 - 8000));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn extract_args_cover_window() {
        let dir = std::env::temp_dir().join(format!("pulsecut-buf-{}", uuid::Uuid::new_v4()));
        let mut b = RollingBuffer::new(&dir, 4, 60, 0).unwrap();
        for i in 0..10 {
            touch(&dir.join(format!("seg_{i:06}.ts")));
        }
        b.refresh().unwrap();
        let w = ClipWindow { start_ms: 5000, end_ms: 20_000, snap_reason: "x".into() };
        let out = dir.join("clip.mp4");
        let args = b.extract_args(&w, &out, Path::new("ffmpeg")).unwrap().unwrap();
        assert!(args.iter().any(|a| a == "concat"));
        assert!(args.iter().any(|a| a == "copy"));
        fs::remove_dir_all(dir).unwrap();
    }
}
