//! Live stream capture and segmented rolling buffer.

pub mod audio;
pub mod buffer;
pub mod ffmpeg;

pub use audio::{normalize as normalize_audio, rms_f32, AudioMeter};
pub use buffer::{RollingBuffer, Segment};
pub use ffmpeg::{ffmpeg, resolve_binary, resolve_stream_url, streamlink};

use pulsecut_core::config::CaptureConfig;
use pulsecut_core::error::{PulseError, Result};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// A live capture session. Dropping it kills the ffmpeg child.
pub struct CaptureSession {
    pub buffer: RollingBuffer,
    pub dir: PathBuf,
    child: tokio::process::Child,
}

impl Drop for CaptureSession {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

/// Start recording `link` into rolling segments.
///
/// `link` may be a direct HLS URL or a stream page URL; in the latter case
/// streamlink is used to resolve the HLS URL first. The buffer is refreshed
/// and pruned by `tick()`.
pub async fn start_capture(link: &str, cfg: &CaptureConfig, channel: &str) -> Result<CaptureSession> {
    let url = if link.starts_with("http") && (link.contains(".m3u8") || cfg.streamlink_path.is_empty()) {
        link.to_string()
    } else {
        ffmpeg::resolve_stream_url(link, &cfg.streamlink_path).await?
    };

    let dir = PathBuf::from(&cfg.output_dir)
        .join("buffer")
        .join(format!("{}-{}", channel, chrono_like_ms()));
    let started = chrono_like_ms();
    let buffer = RollingBuffer::new(&dir, cfg.segment_seconds, cfg.buffer_seconds, started)?;

    let bin = ffmpeg::ffmpeg(&cfg.ffmpeg_path)?;
    let pattern = dir.join("seg_%06d.ts");
    let mut cmd = tokio::process::Command::new(bin);
    cmd.args([
        "-y",
        "-loglevel", "error",
        "-i", &url,
        "-c", "copy",
        "-f", "segment",
        "-segment_time", &cfg.segment_seconds.to_string(),
        "-segment_start_number", "0",
        "-reset_timestamps", "1",
        "-segment_format", "mpegts",
        &pattern.to_string_lossy(),
    ]);
    let child = cmd.spawn().map_err(|e| PulseError::Process(format!("failed to start ffmpeg capture: {e}")))?;
    Ok(CaptureSession { buffer, dir, child })
}

impl CaptureSession {
    /// Refresh the segment inventory and prune old data. Returns the number
    /// of segments deleted.
    pub async fn tick(&mut self) -> Result<u32> {
        if let Some(status) = self.child.try_wait()? {
            if status.success() {
                return Err(PulseError::Process("capture ffmpeg ended unexpectedly".into()));
            }
            return Err(PulseError::Process(format!("capture ffmpeg exited {status}")));
        }
        self.buffer.refresh()?;
        self.buffer.prune(chrono_like_ms())
    }

    /// Wait until the rolling buffer covers the requested window.
    pub async fn wait_for_coverage(&mut self, window: &pulsecut_core::model::ClipWindow, cancel: &Arc<AtomicBool>, timeout: Duration) -> Result<()> {
        let started = std::time::Instant::now();
        while !cancel.load(Ordering::Relaxed) && started.elapsed() < timeout {
            self.tick().await?;
            if self.buffer.can_cover(window) {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        Err(PulseError::Process("timed out waiting for buffer coverage".into()))
    }
}

/// Small helper so capture does not need a chrono dependency.
fn chrono_like_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
