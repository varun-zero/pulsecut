//! Lightweight RMS metering from the latest captured segment.
//!
//! The detector accepts a 0..1 audio-energy signal. Measuring it from the
//! live `.ts` segment already on disk avoids a second long-running ffmpeg
//! process: we only decode the newest 4-second segment once per index.

use crate::buffer::Segment;
use pulsecut_core::error::{PulseError, Result};
use std::path::Path;

/// RMS of raw little-endian f32 mono samples.
pub fn rms_f32(bytes: &[u8]) -> f64 {
    let n = bytes.len() / 4;
    if n == 0 {
        return 0.0;
    }
    let mut sum = 0.0f64;
    for chunk in bytes.chunks_exact(4) {
        let sample = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        sum += sample as f64 * sample as f64;
    }
    (sum / n as f64).sqrt()
}

/// Map raw RMS (0..~0.5 for normal speech) to a useful 0..1 detector input.
pub fn normalize(rms: f64) -> f64 {
    if !rms.is_finite() {
        return 0.0;
    }
    (rms * 5.0).clamp(0.0, 1.0)
}

#[derive(Debug, Default)]
pub struct AudioMeter {
    last_index: Option<u64>,
    last_value: f64,
}

impl AudioMeter {
    pub fn new() -> Self { Self::default() }

    /// Return normalized audio energy for the newest segment. Reuses the
    /// previous value when the segment index has not advanced.
    pub fn measure_latest(&mut self, segments: &[Segment], ffmpeg: &Path) -> Result<f64> {
        let latest = match segments.last() {
            Some(s) => s,
            None => return Ok(0.0),
        };
        if self.last_index == Some(latest.index) {
            return Ok(self.last_value);
        }
        let output = std::process::Command::new(ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(&latest.path)
            .args(["-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"])
            .output()
            .map_err(|e| PulseError::Process(format!("audio meter failed to start: {e}")))?;
        if !output.status.success() {
            return Err(PulseError::Process(format!(
                "audio meter ffmpeg exited {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        let value = normalize(rms_f32(&output.stdout));
        self.last_index = Some(latest.index);
        self.last_value = value;
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rms_of_silence_is_zero() {
        assert_eq!(rms_f32(&[0u8; 64]), 0.0);
    }

    #[test]
    fn rms_of_full_scale_sine_is_about_0707() {
        let samples: Vec<f32> = (0..1000)
            .map(|i| (i as f32 * 0.1).sin())
            .collect();
        let mut bytes = Vec::new();
        for s in samples {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        let r = rms_f32(&bytes);
        assert!((0.69..=0.72).contains(&r), "rms was {r}");
    }

    #[test]
    fn normalize_is_bounded() {
        assert_eq!(normalize(0.0), 0.0);
        assert_eq!(normalize(1.0), 1.0);
        assert_eq!(normalize(f64::NAN), 0.0);
    }
}
