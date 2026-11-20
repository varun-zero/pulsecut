//! Objective clip verification — the 100-point vitality rubric, migrated from
//! `automation/verify_clip.py` and de-duplicated from `app/src/web.rs`.
//!
//! Pure functions (faststart inspection, ffprobe JSON parsing, rubric scoring)
//! live here so both the HTTP `/verify` endpoint and the automation CLI share
//! one implementation. Process-launching helpers stay thin and injectable.

use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Inspect top-level ISO-BMFF boxes; `true` when `moov` precedes `mdat`
/// (real `+faststart` streaming readiness).
pub fn has_mp4_faststart(path: &Path) -> bool {
    let Ok(mut f) = std::fs::File::open(path) else { return false };
    let Ok(file_len) = f.metadata().map(|m| m.len()) else { return false };
    let mut pos: u64 = 0;
    let mut header = [0u8; 8];
    let mut ext = [0u8; 8];
    while pos + 8 <= file_len {
        if f.seek(SeekFrom::Start(pos)).is_err() || f.read_exact(&mut header).is_err() { break; }
        let size32 = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as u64;
        let box_type = &header[4..8];
        if box_type == b"moov" { return true; }
        if box_type == b"mdat" { return false; }
        let box_size = if size32 == 1 {
            if f.read_exact(&mut ext).is_err() { break; }
            u64::from_be_bytes(ext)
        } else if size32 == 0 { break; } else { size32 };
        if box_size < 8 { break; }
        pos = pos.saturating_add(box_size);
    }
    false
}

/// Metrics parsed from an ffprobe `-show_streams -show_format -of json` output.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ProbeMetrics {
    pub width: u32,
    pub height: u32,
    pub duration_s: f64,
    pub fps: String,
    pub video_bitrate: u64,
    pub audio_bitrate: u64,
    pub video_codec: String,
    pub audio_codec: String,
    pub has_audio: bool,
}

fn as_num(v: Option<&Value>) -> u64 {
    v.and_then(|x| x.as_str()).and_then(|s| s.parse().ok())
        .or_else(|| v.and_then(|x| x.as_u64()))
        .unwrap_or(0)
}

/// Parse ffprobe JSON into normalized metrics. Pure — unit-testable.
pub fn parse_probe(meta: &Value) -> ProbeMetrics {
    let streams = meta.get("streams").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let v = streams.iter().find(|s| s.get("codec_type").and_then(|x| x.as_str()) == Some("video"));
    let a = streams.iter().find(|s| s.get("codec_type").and_then(|x| x.as_str()) == Some("audio"));
    let w = v.and_then(|s| s.get("width")).and_then(|x| x.as_u64()).unwrap_or(0) as u32;
    let h = v.and_then(|s| s.get("height")).and_then(|x| x.as_u64()).unwrap_or(0) as u32;
    let abr = as_num(a.and_then(|s| s.get("bit_rate")));
    let fmt_br = as_num(meta.get("format").and_then(|f| f.get("bit_rate")));
    let stream_vbr = as_num(v.and_then(|s| s.get("bit_rate")));
    let vbr = if stream_vbr > 0 { stream_vbr } else { fmt_br.saturating_sub(abr) };
    let dur = meta.get("format").and_then(|f| f.get("duration")).and_then(|x| x.as_str())
        .and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
    ProbeMetrics {
        width: w, height: h, duration_s: dur,
        fps: v.and_then(|s| s.get("r_frame_rate")).and_then(|x| x.as_str()).unwrap_or("").to_string(),
        video_bitrate: vbr, audio_bitrate: abr,
        video_codec: v.and_then(|s| s.get("codec_name")).and_then(|x| x.as_str()).unwrap_or("").to_string(),
        audio_codec: a.and_then(|s| s.get("codec_name")).and_then(|x| x.as_str()).unwrap_or("").to_string(),
        has_audio: a.is_some(),
    }
}

/// Result of scoring a clip against the 100-point rubric.
#[derive(Debug, Clone, Serialize)]
pub struct Verdict {
    pub score: u32,
    pub ok: bool,
    pub hard_failed: bool,
    pub reasons: Vec<String>,
}

/// Extra signals that require process I/O, supplied by the caller.
#[derive(Debug, Clone, Default)]
pub struct ExtraSignals {
    pub decode_clean: bool,
    pub faststart: bool,
    pub audible: bool,
}

/// Score the exact 100-point rubric:
/// h264(10) + audio(10) + aac(5) + canvas(15) + dur(10) + vbr(15) + abr(5)
/// + fps(5) + decode(10) + faststart(10) + non_silent(5) = 100.
/// `ok = score >= 75 && !hard_failed`.
pub fn rubric(m: &ProbeMetrics, extra: &ExtraSignals) -> Verdict {
    let mut score = 0u32;
    let mut reasons: Vec<String> = Vec::new();
    let mut hard = false;
    let mut check = |cond: bool, pts: u32, is_hard: bool, msg: &str| {
        if cond { score += pts; } else {
            reasons.push(msg.to_string());
            if is_hard { hard = true; }
        }
    };
    check(m.video_codec == "h264", 10, true, "video codec is not h264");
    check(m.has_audio, 10, true, "no audio stream");
    check(m.audio_codec == "aac", 5, true, "audio codec is not aac");
    check((m.width == 1080 && m.height == 1920) || (m.width == 1920 && m.height == 1080) || (m.width == 1080 && m.height == 1080), 15, true, "canvas is not 1080x1920");
    check((8.0..=60.0).contains(&m.duration_s), 10, true, "duration outside 8-60s");
    check(m.video_bitrate >= 2_000_000, 15, false, "video bitrate below 2 Mbps");
    check(m.audio_bitrate >= 96_000, 5, false, "audio bitrate below 96 kbps");
    let fr = m.fps.split('/').next().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0)
        / m.fps.split('/').nth(1).and_then(|s| s.parse::<f64>().ok()).unwrap_or(1.0).max(1.0);
    check((20.0..=61.0).contains(&fr), 5, true, "fps outside 20-61");
    check(extra.decode_clean, 10, true, "ffmpeg decode reported errors");
    check(extra.faststart, 10, false, "mp4 missing faststart (moov atom not before mdat)");
    check(extra.audible, 5, true, "audio appears silent (mean_volume <= -50 dB)");
    Verdict { score, ok: score >= 75 && !hard, hard_failed: hard, reasons }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good_metrics() -> ProbeMetrics {
        ProbeMetrics {
            width: 1080, height: 1920, duration_s: 30.0, fps: "24000/1001".into(),
            video_bitrate: 5_000_000, audio_bitrate: 160_000,
            video_codec: "h264".into(), audio_codec: "aac".into(), has_audio: true,
        }
    }
    fn good_extra() -> ExtraSignals {
        ExtraSignals { decode_clean: true, faststart: true, audible: true }
    }

    #[test]
    fn perfect_clip_scores_100_and_ok() {
        let v = rubric(&good_metrics(), &good_extra());
        assert_eq!(v.score, 100);
        assert!(v.ok && !v.hard_failed);
        assert!(v.reasons.is_empty());
    }

    #[test]
    fn parse_probe_reads_ffprobe_json() {
        let j: Value = serde_json::from_str(r#"{
            "streams":[
              {"codec_type":"video","codec_name":"h264","width":1080,"height":1920,"bit_rate":"5500000","r_frame_rate":"30/1"},
              {"codec_type":"audio","codec_name":"aac","bit_rate":"160000"}
            ],
            "format":{"duration":"30.5","bit_rate":"5660000"}
        }"#).unwrap();
        let m = parse_probe(&j);
        assert_eq!((m.width, m.height), (1080, 1920));
        assert_eq!(m.video_codec, "h264");
        assert!(m.has_audio);
        assert_eq!(m.duration_s, 30.5);
        assert!(m.video_bitrate >= 5_000_000);
    }

    #[test]
    fn low_bitrate_and_no_faststart_lose_points_but_not_hard_fail() {
        let mut m = good_metrics();
        m.video_bitrate = 800_000;
        let e = ExtraSignals { faststart: false, ..good_extra() };
        let v = rubric(&m, &e);
        assert_eq!(v.score, 75);
        assert!(v.ok, "soft failures should still pass at >=75");
        assert!(!v.hard_failed);
    }

    #[test]
    fn hard_failure_blocks_even_with_high_score() {
        let mut m = good_metrics();
        m.video_codec = "vp9".into();
        let v = rubric(&m, &good_extra());
        assert_eq!(v.score, 90);
        assert!(v.hard_failed);
        assert!(!v.ok, "hard failure must block regardless of score");
    }
}
