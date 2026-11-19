//! Word-level transcription through a local whisper binary.
//!
//! faster-whisper and whisper.cpp both emit a JSON file with
//! `segments[].words[]`. We accept either and normalize to millisecond
//! `Word`s. If no word timings exist we fall back to segment-level timing.

use pulsecut_core::error::{PulseError, Result};
use pulsecut_core::model::Word;
use std::path::{Path, PathBuf};

#[async_trait::async_trait]
pub trait Transcriber: Send + Sync {
    fn name(&self) -> &'static str;
    async fn transcribe(&self, media: &Path, clip_start_ms: i64) -> Result<Vec<Word>>;
}

pub struct WhisperCli {
    pub binary: PathBuf,
    pub model: String,
    pub work_dir: PathBuf,
}

impl WhisperCli {
    pub fn new(binary: PathBuf, model: String, work_dir: PathBuf) -> Self {
        Self { binary, model, work_dir }
    }

    /// Parse a whisper JSON document. Public for offline tests.
    pub fn parse_json(text: &str, clip_start_ms: i64) -> Result<Vec<Word>> {
        let v: serde_json::Value = serde_json::from_str(text)
            .map_err(|e| PulseError::Ai(format!("invalid whisper JSON: {e}")))?;
        let mut out = Vec::new();
        if let Some(segments) = v["segments"].as_array() {
            // whisper.cpp emits integer milliseconds; faster-whisper emits
            // fractional seconds. Detect the unit once per file.
            let has_fraction = segments.iter().filter_map(|s| s["words"].as_array()).flatten().any(|w| {
                [w["start"].as_f64(), w["end"].as_f64()]
                    .into_iter()
                    .flatten()
                    .any(|v| v.fract().abs() > 1e-6)
            });
            let all_large = segments.iter().filter_map(|s| s["words"].as_array()).flatten().all(|w| {
                [w["start"].as_f64(), w["end"].as_f64()]
                    .into_iter()
                    .flatten()
                    .all(|v| v > 1000.0)
            });
            let unit_ms = !has_fraction && all_large;
            for seg in segments {
                let words = seg["words"].as_array();
                if let Some(words) = words {
                    for w in words {
                        let token = w["word"].as_str().or_else(|| w["text"].as_str()).unwrap_or("").trim();
                        if token.is_empty() {
                            continue;
                        }
                        let raw_start = w["start"].as_f64().unwrap_or(0.0);
                        let raw_end = w["end"].as_f64().unwrap_or(raw_start + 0.2);
                        let scale = if unit_ms { 1.0 } else { 1000.0 };
                        out.push(Word {
                            text: token.to_string(),
                            start_ms: (raw_start * scale) as i64 + clip_start_ms,
                            end_ms: (raw_end * scale) as i64 + clip_start_ms,
                            confidence: w["probability"].as_f64().unwrap_or(0.8) as f32,
                        });
                    }
                } else if let Some(text) = seg["text"].as_str() {
                    let start = seg["start"].as_f64().unwrap_or(0.0) * 1000.0;
                    let end = seg["end"].as_f64().unwrap_or(start / 1000.0 + 2.0) * 1000.0;
                    out.push(Word {
                        text: text.trim().to_string(),
                        start_ms: start as i64 + clip_start_ms,
                        end_ms: end as i64 + clip_start_ms,
                        confidence: 0.7,
                    });
                }
            }
        }
        Ok(out)
    }
}

#[async_trait::async_trait]
impl Transcriber for WhisperCli {
    fn name(&self) -> &'static str { "whisper-cli" }

    async fn transcribe(&self, media: &Path, clip_start_ms: i64) -> Result<Vec<Word>> {
        tokio::fs::create_dir_all(&self.work_dir).await?;
        let stem = media.file_stem().and_then(|s| s.to_str()).unwrap_or("clip");
        let mut cmd = tokio::process::Command::new(&self.binary);
        cmd.args([
            "-m", &self.model,
            "-f", "json",
            "-o", self.work_dir.to_string_lossy().as_ref(),
            "--word-timestamps", "true",
        ])
        .arg(media);
        let out = cmd.output().await.map_err(|e| PulseError::Ai(format!("whisper failed to start: {e}")))?;
        if !out.status.success() {
            return Err(PulseError::Ai(format!("whisper exited {}: {}", out.status, String::from_utf8_lossy(&out.stderr))));
        }
        let json_path = self.work_dir.join(format!("{stem}.json"));
        let text = tokio::fs::read_to_string(&json_path).await?;
        Self::parse_json(&text, clip_start_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_word_timestamps() {
        let raw = r#"{"segments":[{"words":[
            {"word":"hello","start":0.0,"end":0.3,"probability":0.95},
            {"word":"world","start":0.35,"end":0.7,"probability":0.9}
        ]}]}"#;
        let words = WhisperCli::parse_json(raw, 10_000).unwrap();
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].start_ms, 10_000);
        assert_eq!(words[1].end_ms, 10_700);
    }

    #[test]
    fn parses_millisecond_timestamps() {
        let raw = r#"{"segments":[{"words":[{"word":"yo","start":1200,"end":1500}]}]}"#;
        let w = WhisperCli::parse_json(raw, 0).unwrap();
        assert_eq!(w[0].start_ms, 1200);
    }
}
