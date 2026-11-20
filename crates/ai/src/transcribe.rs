//! Word-level transcription for full videos and clips.
//!
//! Supports three zero-friction paths (following SupoClip's full-video
//! transcription workflow):
//! 1. Local whisper CLI (`whisper.cpp` / `faster-whisper` JSON output)
//! 2. Cloud Whisper API (OpenAI / Groq `verbose_json` with word timestamps)
//! 3. Native YouTube / platform subtitle files (`json3` and `vtt` from yt-dlp)

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

    /// Parse a whisper JSON document (whisper.cpp, faster-whisper, or OpenAI
    /// `verbose_json` top-level `words[]`). Public for offline tests.
    pub fn parse_json(text: &str, clip_start_ms: i64) -> Result<Vec<Word>> {
        let v: serde_json::Value = serde_json::from_str(text)
            .map_err(|e| PulseError::Ai(format!("invalid whisper JSON: {e}")))?;
        let mut out = Vec::new();

        // OpenAI / Groq Whisper API `verbose_json` returns a top-level `words` array.
        if let Some(top_words) = v["words"].as_array() {
            if !top_words.is_empty() {
                for w in top_words {
                    let token = w["word"].as_str().or_else(|| w["text"].as_str()).unwrap_or("").trim();
                    if token.is_empty() {
                        continue;
                    }
                    let raw_start = w["start"].as_f64().unwrap_or(0.0);
                    let raw_end = w["end"].as_f64().unwrap_or(raw_start + 0.2);
                    out.push(Word {
                        text: token.to_string(),
                        start_ms: (raw_start * 1000.0) as i64 + clip_start_ms,
                        end_ms: (raw_end * 1000.0) as i64 + clip_start_ms,
                        confidence: w["probability"].as_f64().unwrap_or(0.9) as f32,
                    });
                }
                return Ok(out);
            }
        }

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
                    let start = (seg["start"].as_f64().unwrap_or(0.0) * 1000.0) as i64 + clip_start_ms;
                    let end = (seg["end"].as_f64().unwrap_or((start - clip_start_ms) as f64 / 1000.0 + 2.0) * 1000.0) as i64 + clip_start_ms;
                    push_interpolated_words(&mut out, text, start, end, 0.75);
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

/// Call an OpenAI-compatible `/audio/transcriptions` endpoint (OpenAI Whisper or
/// Groq Whisper) with word-level timestamps enabled.
pub async fn transcribe_whisper_api(
    audio_path: &Path,
    endpoint: &str,
    api_key: &str,
    model: &str,
    clip_start_ms: i64,
) -> Result<Vec<Word>> {
    let bytes = tokio::fs::read(audio_path).await?;
    let file_name = audio_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("audio.mp3")
        .to_string();
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(file_name)
        .mime_str("audio/mpeg")
        .map_err(|e| PulseError::Ai(format!("invalid multipart mime: {e}")))?;
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", model.to_string())
        .text("response_format", "verbose_json")
        .text("timestamp_granularities[]", "word");

    let client = reqwest::Client::new();
    let resp = client
        .post(endpoint)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| PulseError::Ai(format!("whisper api request failed: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(PulseError::Ai(format!("whisper api {status}: {body}")));
    }
    let body = resp.text().await.map_err(|e| PulseError::Ai(e.to_string()))?;
    WhisperCli::parse_json(&body, clip_start_ms)
}

/// Parse YouTube's native `json3` timed-text subtitle format into word-level
/// `Word`s. Works offline with zero API keys using `yt-dlp --write-auto-subs
/// --write-subs --sub-format json3 --skip-download`.
pub fn parse_youtube_json3_words(json_text: &str, clip_start_ms: i64) -> Result<Vec<Word>> {
    let v: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| PulseError::Ai(format!("invalid json3 subtitles: {e}")))?;
    let mut out: Vec<Word> = Vec::new();
    let Some(events) = v["events"].as_array() else {
        return Ok(out);
    };

    for event in events {
        let Some(t_start) = event["tStartMs"].as_i64() else {
            continue;
        };
        let d_dur = event["dDurationMs"].as_i64().unwrap_or(2000).max(200);
        let Some(segs) = event["segs"].as_array() else {
            continue;
        };

        let mut timed_segs: Vec<(i64, String)> = Vec::new();
        for seg in segs {
            let raw = seg["utf8"].as_str().unwrap_or("");
            let cleaned = raw.replace('\n', " ");
            let trimmed = cleaned.trim();
            if trimmed.is_empty() || is_stage_cue(trimmed) {
                continue;
            }
            let offset = seg["tOffsetMs"].as_i64().unwrap_or(0);
            timed_segs.push((t_start + offset, trimmed.to_string()));
        }

        for i in 0..timed_segs.len() {
            let (seg_start, ref text) = timed_segs[i];
            let seg_end = if i + 1 < timed_segs.len() {
                timed_segs[i + 1].0.max(seg_start + 80)
            } else {
                (t_start + d_dur).max(seg_start + 220)
            };
            push_interpolated_words(
                &mut out,
                text,
                seg_start + clip_start_ms,
                seg_end + clip_start_ms,
                0.85,
            );
        }
    }

    Ok(dedupe_overlapping_words(out))
}

/// Parse a WebVTT subtitle file (both YouTube word-timed `<00:00:01.200><c>word</c>`
/// VTT and standard cue-level VTT) into word-level `Word`s.
pub fn parse_vtt_words(vtt: &str, clip_start_ms: i64) -> Vec<Word> {
    let mut out: Vec<Word> = Vec::new();
    let lines: Vec<&str> = vtt.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i].trim();
        if let Some((start_ms, end_ms)) = parse_vtt_cue_range(line) {
            i += 1;
            let mut body_lines = Vec::new();
            while i < lines.len() && !lines[i].trim().is_empty() {
                body_lines.push(lines[i].trim());
                i += 1;
            }
            let raw_body = body_lines.join(" ");
            if raw_body.contains('<') && raw_body.contains('>') {
                let parsed = parse_inline_vtt_tags(&raw_body, start_ms, end_ms, clip_start_ms);
                if !parsed.is_empty() {
                    out.extend(parsed);
                    continue;
                }
            }
            let plain = strip_html_tags(&raw_body);
            if !plain.is_empty() && !is_stage_cue(&plain) {
                push_interpolated_words(
                    &mut out,
                    &plain,
                    start_ms + clip_start_ms,
                    end_ms + clip_start_ms,
                    0.8,
                );
            }
        } else {
            i += 1;
        }
    }

    dedupe_overlapping_words(out)
}

/// Format a full-video word stream into compact `[MM:SS] ...` timestamped lines
/// suitable for an LLM viral-clip discovery prompt (SupoClip workflow).
pub fn format_timestamped_transcript(words: &[Word], max_chars: usize) -> String {
    if words.is_empty() {
        return String::new();
    }
    let mut lines: Vec<String> = Vec::new();
    let mut cur_start = words[0].start_ms;
    let mut cur_tokens: Vec<&str> = Vec::new();

    for w in words {
        let should_flush = !cur_tokens.is_empty()
            && ((w.start_ms - cur_start) >= 12_000
                || cur_tokens.len() >= 24
                || cur_tokens
                    .last()
                    .map_or(false, |t| t.ends_with('.') || t.ends_with('!') || t.ends_with('?')));
        if should_flush {
            lines.push(format!("[{}] {}", format_mmss(cur_start), cur_tokens.join(" ")));
            cur_tokens.clear();
            cur_start = w.start_ms;
        }
        cur_tokens.push(w.text.as_str());
    }
    if !cur_tokens.is_empty() {
        lines.push(format!("[{}] {}", format_mmss(cur_start), cur_tokens.join(" ")));
    }

    let joined = lines.join("\n");
    if joined.len() <= max_chars || lines.len() <= 2 {
        return joined;
    }

    // Evenly sample lines across the entire video so the model sees beginning,
    // middle, and end even on 2-hour streams/VODs.
    let avg_line_len = (joined.len() / lines.len()).max(20);
    let target_lines = (max_chars / avg_line_len).max(20).min(lines.len());
    let step = lines.len() as f64 / target_lines as f64;
    let mut sampled = Vec::with_capacity(target_lines);
    for idx in 0..target_lines {
        let pos = ((idx as f64) * step).floor() as usize;
        if let Some(line) = lines.get(pos.min(lines.len() - 1)) {
            sampled.push(line.as_str());
        }
    }
    sampled.join("\n")
}

fn format_mmss(ms: i64) -> String {
    let total_secs = (ms.max(0) / 1000) as u64;
    let h = total_secs / 3600;
    let m = (total_secs / 60) % 60;
    let s = total_secs % 60;
    if h > 0 {
        format!("{h:02}:{m:02}:{s:02}")
    } else {
        format!("{m:02}:{s:02}")
    }
}

fn is_stage_cue(text: &str) -> bool {
    let t = text.trim();
    (t.starts_with('[') && t.ends_with(']')) || (t.starts_with('(') && t.ends_with(')'))
}

fn push_interpolated_words(out: &mut Vec<Word>, text: &str, start_ms: i64, end_ms: i64, confidence: f32) {
    let tokens: Vec<&str> = text
        .split_whitespace()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && !is_stage_cue(s))
        .collect();
    if tokens.is_empty() {
        return;
    }
    let dur = (end_ms - start_ms).max(tokens.len() as i64 * 90);
    let step = dur as f64 / tokens.len() as f64;
    for (idx, tok) in tokens.iter().enumerate() {
        let ws = start_ms + (idx as f64 * step).round() as i64;
        let we = start_ms + ((idx + 1) as f64 * step).round() as i64;
        out.push(Word {
            text: (*tok).to_string(),
            start_ms: ws,
            end_ms: we.max(ws + 60),
            confidence,
        });
    }
}

fn parse_vtt_cue_range(line: &str) -> Option<(i64, i64)> {
    let (lhs, rhs) = line.split_once("-->")?;
    let start = parse_vtt_timestamp(lhs.trim())?;
    let end_token = rhs.trim().split_whitespace().next()?;
    let end = parse_vtt_timestamp(end_token)?;
    Some((start, end.max(start + 100)))
}

fn parse_vtt_timestamp(token: &str) -> Option<i64> {
    let clean = token.trim().replace(',', ".");
    let parts: Vec<&str> = clean.split(':').collect();
    let (h, m, s_part) = match parts.len() {
        3 => (
            parts[0].parse::<i64>().ok()?,
            parts[1].parse::<i64>().ok()?,
            parts[2],
        ),
        2 => (0, parts[0].parse::<i64>().ok()?, parts[1]),
        _ => return None,
    };
    let (sec_str, ms_str) = match s_part.split_once('.') {
        Some((s, ms)) => (s, ms),
        None => (s_part, "0"),
    };
    let sec = sec_str.parse::<i64>().ok()?;
    let ms_norm = match ms_str.len() {
        0 => 0,
        1 => ms_str.parse::<i64>().ok()? * 100,
        2 => ms_str.parse::<i64>().ok()? * 10,
        _ => ms_str[..3].parse::<i64>().ok()?,
    };
    Some(((h * 3600 + m * 60 + sec) * 1000) + ms_norm)
}

fn parse_inline_vtt_tags(raw: &str, cue_start: i64, cue_end: i64, clip_start_ms: i64) -> Vec<Word> {
    let mut chunks: Vec<(i64, String)> = Vec::new();
    let mut cur_time = cue_start;
    let mut cur_text = String::new();
    let mut chars = raw.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '<' {
            let mut tag = String::new();
            for tc in chars.by_ref() {
                if tc == '>' {
                    break;
                }
                tag.push(tc);
            }
            if let Some(ts) = parse_vtt_timestamp(&tag) {
                if !cur_text.trim().is_empty() {
                    chunks.push((cur_time, cur_text.trim().to_string()));
                    cur_text.clear();
                }
                cur_time = ts;
            }
        } else {
            cur_text.push(c);
        }
    }
    if !cur_text.trim().is_empty() {
        chunks.push((cur_time, cur_text.trim().to_string()));
    }

    let mut out = Vec::new();
    for i in 0..chunks.len() {
        let (ts, ref text) = chunks[i];
        let next_ts = chunks.get(i + 1).map(|c| c.0).unwrap_or(cue_end).max(ts + 90);
        push_interpolated_words(&mut out, text, ts + clip_start_ms, next_ts + clip_start_ms, 0.85);
    }
    out
}

fn strip_html_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for c in input.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .trim()
        .to_string()
}

/// YouTube rolling auto-captions often repeat the previous line when scrolling.
/// Remove near-simultaneous duplicate tokens so captions and scoring stay clean.
fn dedupe_overlapping_words(mut words: Vec<Word>) -> Vec<Word> {
    words.sort_by_key(|w| w.start_ms);
    let mut cleaned: Vec<Word> = Vec::with_capacity(words.len());
    for w in words {
        let duplicate = cleaned.iter().rev().take(6).any(|prev| {
            prev.text.eq_ignore_ascii_case(&w.text) && (w.start_ms - prev.start_ms).abs() < 650
        });
        if !duplicate {
            cleaned.push(w);
        }
    }
    cleaned
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

    #[test]
    fn parses_youtube_json3_subtitles() {
        let raw = r#"{"events":[
            {"tStartMs":1000,"dDurationMs":1500,"segs":[
                {"utf8":"No","tOffsetMs":0},
                {"utf8":" way","tOffsetMs":300},
                {"utf8":" chat","tOffsetMs":700}
            ]}
        ]}"#;
        let words = parse_youtube_json3_words(raw, 0).unwrap();
        assert_eq!(words.len(), 3);
        assert_eq!(words[0].text, "No");
        assert_eq!(words[1].start_ms, 1300);
        assert_eq!(words[2].text, "chat");
    }

    #[test]
    fn parses_vtt_with_inline_timestamps() {
        let vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nBro<00:00:01.500><c> that</c><00:00:02.000><c> was</c><00:00:02.400><c> insane</c>\n";
        let words = parse_vtt_words(vtt, 0);
        assert_eq!(words.len(), 4);
        assert_eq!(words[0].text, "Bro");
        assert_eq!(words[1].start_ms, 1500);
        assert_eq!(words[3].text, "insane");
    }
}
