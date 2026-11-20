//! Full-video SupoClip-style VOD & live-stream clipping pipeline:
//!
//! 1. Download highest available quality (4K/1440p/1080p60 via yt-dlp, or
//!    direct HLS capture for live Kick/Twitch/YouTube streams).
//! 2. Transcribe the ENTIRE video to word-level timestamps (Local Whisper CLI ->
//!    Groq/OpenAI Whisper API -> zero-key native YouTube/platform json3/VTT).
//! 3. Discover the strongest viral moments across the whole video (LLM full-
//!    transcript viral rubric when Ollama/OpenRouter is available, fused with
//!    our multi-signal Hook + Audio Contrast + Pacing + Clean-Ending scorer).
//! 4. Slice frame-accurately at natural sentence boundaries and render vertical
//!    shorts with burned white titles + yellow word-synced karaoke subtitles.

use pulsecut_ai::{
    build_prompt, format_timestamped_transcript, parse_vtt_words, parse_youtube_json3_words,
    transcribe_whisper_api, AiBackend, GeneratedMetadata, Transcriber, WhisperCli,
};
use pulsecut_capture::{ffmpeg, normalize_audio, resolve_binary, rms_f32};
use pulsecut_core::config::Config;
use pulsecut_core::edl::{EditDecisionList, EditOp};
use pulsecut_core::error::{PulseError, Result};
use pulsecut_core::model::{ClipPackage, ClipStatus, ClipWindow, Platform, Word, default_profiles};
use pulsecut_render::{apply_metadata, Renderer};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Extra context supplied by the Dashboard or Browser Extension.
#[derive(Debug, Clone, Default)]
pub struct ClipJobOptions {
    /// Direct HLS `.m3u8` URL captured inside the authenticated browser tab
    /// (critical for Kick live streams protected by Cloudflare).
    pub playback_url: Option<String>,
    /// True when clipping an active live broadcast (never pass `--download-sections`).
    pub is_live: bool,
    /// Current playback timestamp (seconds) for VOD lookback clipping from the extension.
    pub current_time_sec: Option<f64>,
    /// Desired lookback window in seconds (typically 15..90s from the extension).
    pub lookback_secs: Option<u64>,
    /// Streamer/channel handle detected from the page or URL.
    pub channel: Option<String>,
    /// Video or stream title detected from the page.
    pub video_title: Option<String>,
    /// Platform hint ("kick" | "twitch" | "youtube" | "instagram").
    pub platform_hint: Option<String>,
}

/// Download a VOD at the highest available resolution (no 1080p cap, no forced
/// 180s truncation) or capture a live stream via direct HLS + FFmpeg.
/// Returns `(video_path, section_offset_ms)` where `section_offset_ms` is non-zero
/// only when a specific VOD window was downloaded.
pub async fn download_with_options(
    url: &str,
    dir: &Path,
    opts: &ClipJobOptions,
    ffmpeg_bin: Option<&Path>,
) -> Result<(PathBuf, i64)> {
    std::fs::create_dir_all(dir)?;

    let trimmed = url.trim();
    let local_path = if let Some(stripped) = trimmed.strip_prefix("file:///") {
        PathBuf::from(stripped)
    } else if let Some(stripped) = trimmed.strip_prefix("file://") {
        PathBuf::from(stripped)
    } else {
        PathBuf::from(trimmed)
    };

    if local_path.is_file() {
        let ext = local_path.extension().and_then(|e| e.to_str()).unwrap_or("mp4");
        let target = dir.join(format!("source.{ext}"));
        std::fs::copy(&local_path, &target)?;
        return Ok((target, 0));
    }

    // Live stream path (Kick / Twitch / YouTube Live / direct .m3u8).
    // Never pass `--download-sections` to yt-dlp on live HLS streams.
    if should_use_live_capture(trimmed, opts) {
        let ff = match ffmpeg_bin {
            Some(p) => p.to_path_buf(),
            None => ffmpeg("")?,
        };
        let target = capture_live_stream(trimmed, dir, opts, &ff).await?;
        return Ok((target, 0));
    }

    let mut extractor_error = String::new();
    if let Some(bin) = resolve_binary("", "PULSECUT_YTDLP", &["yt-dlp", "yt-dlp.exe"]) {
        let pattern = dir.join("source.%(ext)s");

        // Automatically fetch the highest resolution & audio bitrate available
        // (4K/2160p, 1440p, 1080p60, etc.) and merge cleanly into MP4.
        let quality_format = std::env::var("PULSECUT_SOURCE_FORMAT")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "bestvideo+bestaudio/best".to_string());

        // Optional section bounds:
        // 1) Extension VOD lookback window around current_time_sec
        // 2) Explicit PULSECUT_MAX_SOURCE_SECONDS env override (unset = FULL video)
        let mut section_spec: Option<String> = None;
        let mut section_offset_ms: i64 = 0;

        if let (Some(cur), Some(lookback)) = (opts.current_time_sec, opts.lookback_secs) {
            if cur > 1.0 && lookback >= 5 {
                let start_s = (cur - lookback as f64 - 4.0).max(0.0);
                let end_s = cur + 4.0;
                section_spec = Some(format!("*{start_s:.1}-{end_s:.1}"));
                section_offset_ms = (start_s * 1000.0).round() as i64;
            }
        } else if let Ok(raw_max) = std::env::var("PULSECUT_MAX_SOURCE_SECONDS") {
            if let Ok(secs) = raw_max.trim().parse::<u64>() {
                if secs > 0 {
                    section_spec = Some(format!("*0-{secs}"));
                }
            }
        }

        let ffmpeg_loc = ffmpeg_bin
            .and_then(|p| p.parent())
            .map(|p| p.to_string_lossy().into_owned());

        let build_args = |fmt: &str, with_section: bool, with_merge: bool| -> Vec<String> {
            let mut args = vec![
                "-f".into(), fmt.into(),
                "--no-playlist".into(),
                "--no-update".into(),
            ];
            if with_merge {
                args.push("--merge-output-format".into());
                args.push("mp4".into());
            }
            if let Some(ref loc) = ffmpeg_loc {
                args.push("--ffmpeg-location".into());
                args.push(loc.clone());
            }
            if with_section {
                if let Some(ref sec) = section_spec {
                    args.push("--download-sections".into());
                    args.push(sec.clone());
                    args.push("--force-keyframes-at-cuts".into());
                }
            }
            args.push("-o".into());
            args.push(pattern.to_string_lossy().into_owned());
            args.push(trimmed.to_string());
            args
        };

        let mut attempts: Vec<(Vec<String>, i64)> = Vec::new();
        if section_spec.is_some() {
            attempts.push((build_args(&quality_format, true, true), section_offset_ms));
            attempts.push((
                build_args("bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best", true, true),
                section_offset_ms,
            ));
        }
        // Full-video max quality attempts (default for all Dashboard VOD links).
        attempts.push((build_args(&quality_format, false, true), 0));
        attempts.push((
            build_args("bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best", false, true),
            0,
        ));
        attempts.push((build_args("best", false, false), 0));

        for (args, offset_ms) in attempts {
            let output = Command::new(&bin)
                .args(&args)
                .output()
                .map_err(|e| PulseError::Process(format!("yt-dlp failed to start: {e}")))?;
            if output.status.success() {
                if let Some(p) = find_downloaded_source(dir)? {
                    return Ok((p, offset_ms));
                }
            }
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if !detail.is_empty() {
                extractor_error = detail.lines().last().unwrap_or(&detail).to_string();
            }
            tracing::warn!("yt-dlp attempt failed: {extractor_error}");
        }
    }

    // Direct media HTTP fallback (only for real video files, never HTML/JSON pages).
    let looks_like_media = trimmed.split('?').next().map_or(false, |p| {
        [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]
            .iter()
            .any(|ext| p.to_ascii_lowercase().ends_with(ext))
    });
    let response = reqwest::get(trimmed)
        .await
        .map_err(|e| PulseError::Http(format!("download failed: {e}")))?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !looks_like_media && !content_type.starts_with("video/") {
        return Err(PulseError::Http(format!(
            "link is not a direct video (content-type: {}). {}",
            if content_type.is_empty() { "unknown" } else { &content_type },
            if extractor_error.is_empty() {
                "Paste a YouTube/VOD URL or direct MP4/WebM link.".to_string()
            } else {
                format!("yt-dlp could not fetch it: {extractor_error}")
            }
        )));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| PulseError::Http(e.to_string()))?;
    if !is_media_bytes(&bytes) {
        return Err(PulseError::Http("download did not contain a playable video container".into()));
    }
    let out = dir.join("source.mp4");
    std::fs::write(&out, &bytes)?;
    Ok((out, 0))
}

fn find_downloaded_source(dir: &Path) -> Result<Option<PathBuf>> {
    let found = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .find(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            name.starts_with("source.")
                && !name.ends_with(".part")
                && !name.ends_with(".ytdl")
                && !name.ends_with(".vtt")
                && !name.ends_with(".json3")
        });
    Ok(found)
}

fn should_use_live_capture(url: &str, opts: &ClipJobOptions) -> bool {
    if opts.is_live {
        return true;
    }
    if opts.playback_url.as_deref().map_or(false, |u| u.contains(".m3u8")) {
        return true;
    }
    let lower = url.to_ascii_lowercase();
    if lower.contains(".m3u8") {
        return true;
    }
    // Kick channel URL (not a VOD `/video/` or `/clips/` page) is a live stream.
    if extract_kick_slug(url).is_some() {
        return true;
    }
    // Twitch channel URL (not `/videos/` or `/clip/`) is a live stream.
    if lower.contains("twitch.tv/")
        && !lower.contains("/videos/")
        && !lower.contains("/clip/")
        && !lower.contains("clips.twitch.tv")
    {
        return true;
    }
    false
}

/// Extract the Kick channel slug from `https://kick.com/<slug>` (returns `None`
/// for VODs like `/video/...` or `/clips/...`).
pub fn extract_kick_slug(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();
    if !host.ends_with("kick.com") {
        return None;
    }
    let segs: Vec<&str> = parsed.path_segments()?.filter(|s| !s.is_empty()).collect();
    if segs.is_empty() {
        return None;
    }
    let first = segs[0].to_ascii_lowercase();
    if matches!(
        first.as_str(),
        "video" | "videos" | "clips" | "categories" | "browse" | "following" | "search"
    ) {
        return None;
    }
    if segs.len() >= 2 && matches!(segs[1].to_ascii_lowercase().as_str(), "videos" | "clips") {
        return None;
    }
    Some(segs[0].to_string())
}

async fn resolve_kick_playback_url(slug: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
        .ok()?;
    let api_url = format!("https://kick.com/api/v2/channels/{slug}");
    let resp = client
        .get(&api_url)
        .header("Accept", "application/json")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let v: serde_json::Value = resp.json().await.ok()?;
    v["playback_url"]
        .as_str()
        .or_else(|| v["livestream"]["playback_url"].as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Capture `lookback_secs` of a live stream (Kick, Twitch, YouTube Live, HLS)
/// directly with FFmpeg using the browser-provided `playback_url`, Kick API,
/// or `yt-dlp -g` stream URL resolution.
async fn capture_live_stream(
    url: &str,
    dir: &Path,
    opts: &ClipJobOptions,
    ffmpeg_bin: &Path,
) -> Result<PathBuf> {
    let mut hls_url = opts
        .playback_url
        .as_deref()
        .map(str::trim)
        .filter(|s| s.starts_with("http"))
        .map(String::from);

    if hls_url.is_none() && url.to_ascii_lowercase().contains(".m3u8") {
        hls_url = Some(url.to_string());
    }

    if hls_url.is_none() {
        if let Some(slug) = extract_kick_slug(url) {
            tracing::info!("resolving Kick live playback URL for {slug}");
            hls_url = resolve_kick_playback_url(&slug).await;
        }
    }

    if hls_url.is_none() {
        if let Some(ytdlp) = resolve_binary("", "PULSECUT_YTDLP", &["yt-dlp", "yt-dlp.exe"]) {
            let out = Command::new(&ytdlp)
                .args(["-g", "--no-playlist", "--no-update", "-f", "best", url])
                .output();
            if let Ok(o) = out {
                if o.status.success() {
                    let stdout = String::from_utf8_lossy(&o.stdout);
                    if let Some(first_line) = stdout.lines().find(|l| l.trim().starts_with("http")) {
                        hls_url = Some(first_line.trim().to_string());
                    }
                }
            }
        }
    }

    let stream_url = hls_url.ok_or_else(|| {
        PulseError::Http(format!(
            "Could not resolve live HLS stream for {url}. On Kick/Twitch live channels, click Clip in the PulseCut Chrome Extension while the stream is playing (it extracts the live .m3u8 URL directly from your browser tab) or verify the streamer is currently live."
        ))
    })?;

    let duration_secs = opts.lookback_secs.unwrap_or(30).clamp(15, 120);
    let target = dir.join("source.mp4");
    tracing::info!("capturing {duration_secs}s live HLS stream -> {}", target.display());

    // Fast lossless stream-copy capture first.
    let copy_status = Command::new(ffmpeg_bin)
        .args([
            "-y",
            "-v", "error",
            "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "-i", &stream_url,
            "-t", &duration_secs.to_string(),
            "-c", "copy",
            "-bsf:a", "aac_adtstoasc",
            "-movflags", "+faststart",
        ])
        .arg(&target)
        .output()
        .map_err(|e| PulseError::Process(format!("ffmpeg live capture failed to start: {e}")))?;

    if copy_status.status.success() && target.is_file() && std::fs::metadata(&target)?.len() > 16_384 {
        return Ok(target);
    }

    // Fallback: re-encode cleanly if stream copy failed (e.g. non-AAC audio or TS discontinuity).
    let encode_out = Command::new(ffmpeg_bin)
        .args([
            "-y",
            "-v", "error",
            "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "-i", &stream_url,
            "-t", &duration_secs.to_string(),
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "17",
            "-c:a", "aac",
            "-b:a", "192k",
            "-movflags", "+faststart",
        ])
        .arg(&target)
        .output()
        .map_err(|e| PulseError::Process(format!("ffmpeg live capture failed: {e}")))?;

    if encode_out.status.success() && target.is_file() && std::fs::metadata(&target)?.len() > 16_384 {
        return Ok(target);
    }

    let detail = String::from_utf8_lossy(&encode_out.stderr).trim().to_string();
    Err(PulseError::Process(format!(
        "live stream capture failed for {url}: {}",
        if detail.is_empty() { "stream ended or blocked".into() } else { detail }
    )))
}

/// Cheap container-signature check so an HTML error page is never written as
/// a video file (the "moov atom not found" failure mode).
fn is_media_bytes(bytes: &[u8]) -> bool {
    if bytes.len() < 12 { return false; }
    &bytes[4..8] == b"ftyp"                       // MP4 / MOV / M4V
        || bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) // WebM / MKV
        || (bytes.starts_with(b"RIFF") && &bytes[8..12] == b"AVI ")
}

/// Transcribe the ENTIRE video into word-level timestamps so clip discovery has
/// complete context over the full video arc (SupoClip workflow).
///
/// Waterfall:
/// 1. Local Whisper CLI (`cfg.ai.whisper_binary` / `PULSECUT_WHISPER` / `whisper-cli` / `whisper`)
/// 2. Cloud Whisper API (`GROQ_API_KEY` or `OPENAI_API_KEY`)
/// 3. Native YouTube/platform subtitles (`yt-dlp --write-auto-subs --write-subs --sub-format json3/vtt`)
async fn transcribe_full_video(
    cfg: &Config,
    url: &str,
    source: &Path,
    dir: &Path,
    ffmpeg_bin: &Path,
    section_offset_ms: i64,
    duration_ms: i64,
) -> Vec<Word> {
    // 1. Local Whisper CLI (PULSECUT_WHISPER env overrides pulsecut.json whisper_binary)
    let whisper_override = std::env::var("PULSECUT_WHISPER")
        .ok()
        .filter(|s| !s.trim().is_empty());
    let whisper_explicit = whisper_override.as_deref().unwrap_or(&cfg.ai.whisper_binary);
    if let Some(whisper_bin) = resolve_binary(
        whisper_explicit,
        "PULSECUT_WHISPER",
        &["whisper-cli", "whisper-cli.exe", "whisper", "whisper.exe", "faster-whisper"],
    ) {
        let whisper_model = std::env::var("PULSECUT_WHISPER_MODEL")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| cfg.ai.whisper_model.clone());
        let wav = dir.join("full_audio.wav");
        let extracted = Command::new(ffmpeg_bin)
            .args(["-y", "-v", "error", "-i"])
            .arg(source)
            .args(["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"])
            .arg(&wav)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if extracted && wav.is_file() {
            let cli = WhisperCli::new(whisper_bin, whisper_model, dir.join("whisper"));
            match cli.transcribe(&wav, 0).await {
                Ok(words) if !words.is_empty() => {
                    tracing::info!("full-video transcription via local whisper: {} words", words.len());
                    return words;
                }
                Ok(_) => tracing::warn!("local whisper returned 0 words; trying fallback"),
                Err(e) => tracing::warn!("local whisper failed ({e}); trying fallback"),
            }
        }
    }

    // 2. Cloud Whisper API (Groq fast Whisper or OpenAI Whisper) if an API key is configured.
    let cloud_whisper = std::env::var("GROQ_API_KEY")
        .ok()
        .filter(|k| !k.trim().is_empty())
        .map(|k| (k, "https://api.groq.com/openai/v1/audio/transcriptions", "whisper-large-v3-turbo"))
        .or_else(|| {
            std::env::var("OPENAI_API_KEY")
                .ok()
                .filter(|k| !k.trim().is_empty())
                .map(|k| (k, "https://api.openai.com/v1/audio/transcriptions", "whisper-1"))
        });

    if let Some((api_key, endpoint, model)) = cloud_whisper {
        let mp3 = dir.join("full_audio.mp3");
        // 16kHz mono 32kbps MP3 keeps even a 90-minute video under 22 MB.
        let extracted = Command::new(ffmpeg_bin)
            .args(["-y", "-v", "error", "-i"])
            .arg(source)
            .args(["-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k"])
            .arg(&mp3)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if extracted && mp3.is_file() {
            let size = std::fs::metadata(&mp3).map(|m| m.len()).unwrap_or(u64::MAX);
            if size < 24 * 1024 * 1024 {
                match transcribe_whisper_api(&mp3, endpoint, &api_key, model, 0).await {
                    Ok(words) if !words.is_empty() => {
                        tracing::info!("full-video transcription via Whisper API ({model}): {} words", words.len());
                        return words;
                    }
                    Ok(_) => tracing::warn!("Whisper API returned 0 words; trying subtitles"),
                    Err(e) => tracing::warn!("Whisper API failed ({e}); trying subtitles"),
                }
            }
        }
    }

    // 3. Zero-key native platform subtitles (YouTube auto/manual json3 or vtt).
    if url.starts_with("http") && !url.to_ascii_lowercase().contains(".m3u8") {
        if let Some(ytdlp) = resolve_binary("", "PULSECUT_YTDLP", &["yt-dlp", "yt-dlp.exe"]) {
            let sub_dir = dir.join("subs_fetch");
            let _ = std::fs::create_dir_all(&sub_dir);
            let sub_pattern = sub_dir.join("track.%(ext)s");
            let sub_status = Command::new(&ytdlp)
                .args([
                    "--skip-download",
                    "--no-playlist",
                    "--no-update",
                    "--write-subs",
                    "--write-auto-subs",
                    "--sub-lang", "en.*,en",
                    "--sub-format", "json3/vtt/best",
                    "-o",
                ])
                .arg(&sub_pattern)
                .arg(url)
                .output();
            if sub_status.map(|o| o.status.success()).unwrap_or(false) {
                if let Ok(entries) = std::fs::read_dir(&sub_dir) {
                    let mut paths: Vec<PathBuf> = entries
                        .filter_map(|e| e.ok())
                        .map(|e| e.path())
                        .collect();
                    // Prefer json3 (exact per-word timestamps) over vtt.
                    paths.sort_by_key(|p| {
                        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
                        if ext == "json3" { 0 } else if ext == "vtt" { 1 } else { 2 }
                    });
                    for path in paths {
                        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                        let Ok(text) = std::fs::read_to_string(&path) else { continue };
                        let raw_words = if ext == "json3" {
                            parse_youtube_json3_words(&text, 0).unwrap_or_default()
                        } else if ext == "vtt" {
                            parse_vtt_words(&text, 0)
                        } else {
                            Vec::new()
                        };
                        if !raw_words.is_empty() {
                            let shifted: Vec<Word> = raw_words
                                .into_iter()
                                .filter_map(|mut w| {
                                    w.start_ms -= section_offset_ms;
                                    w.end_ms -= section_offset_ms;
                                    if w.end_ms <= 0 || (duration_ms > 0 && w.start_ms > duration_ms + 500) {
                                        None
                                    } else {
                                        w.start_ms = w.start_ms.max(0);
                                        w.end_ms = w.end_ms.max(w.start_ms + 60);
                                        Some(w)
                                    }
                                })
                                .collect();
                            if !shifted.is_empty() {
                                tracing::info!(
                                    "full-video transcript via native {ext} captions: {} words",
                                    shifted.len()
                                );
                                return shifted;
                            }
                        }
                    }
                }
            }
        }
    }

    Vec::new()
}

/// Measure normalized RMS energy (0..1) for every 1-second bucket of the video
/// in a single fast FFmpeg PCM pass.
fn audio_energy_per_second(path: &Path, ffmpeg_bin: &Path) -> Vec<f64> {
    let out = Command::new(ffmpeg_bin)
        .args(["-v", "error", "-i"])
        .arg(path)
        .args(["-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"])
        .output();
    let Ok(o) = out else { return Vec::new() };
    if !o.status.success() || o.stdout.is_empty() {
        return Vec::new();
    }
    // 8000 samples/sec * 4 bytes/sample = 32_000 bytes per second.
    let bytes_per_sec = 8_000 * 4;
    o.stdout
        .chunks(bytes_per_sec)
        .map(|chunk| normalize_audio(rms_f32(chunk)))
        .collect()
}

/// Probe media duration in milliseconds via FFmpeg banner output.
fn probe_duration_ms(path: &Path, ffmpeg_bin: &Path) -> i64 {
    let out = Command::new(ffmpeg_bin)
        .args(["-hide_banner", "-i"])
        .arg(path)
        .output();
    let Ok(o) = out else { return 0 };
    let stderr = String::from_utf8_lossy(&o.stderr);
    for line in stderr.lines() {
        if let Some(pos) = line.find("Duration:") {
            let after = line[pos + "Duration:".len()..].trim();
            let token = after.split(',').next().unwrap_or("").trim();
            let parts: Vec<&str> = token.split(':').collect();
            if parts.len() == 3 {
                let h = parts[0].parse::<f64>().unwrap_or(0.0);
                let m = parts[1].parse::<f64>().unwrap_or(0.0);
                let s = parts[2].parse::<f64>().unwrap_or(0.0);
                let ms = ((h * 3600.0 + m * 60.0 + s) * 1000.0).round() as i64;
                if ms > 0 {
                    return ms;
                }
            }
        }
    }
    0
}

#[derive(Debug, Clone)]
struct SelectedClip {
    start_ms: i64,
    end_ms: i64,
    score: f64,
    reason: String,
    title: Option<String>,
    hook: Option<String>,
    description: Option<String>,
    hashtags: Vec<String>,
}

const HOOK_WORDS: &[&str] = &[
    "no way", "wait", "actually", "insane", "crazy", "never", "secret", "truth",
    "why", "how", "stop", "listen", "look", "bro", "chat", "what", "omg",
    "mistake", "million", "thousand", "dollar", "exposed", "finally", "unbelievable",
    "everyone", "nobody", "literally", "realized", "imagine", "remember", "shocking",
];

const PAYOFF_WORDS: &[&str] = &[
    "insane", "crazy", "win", "won", "clutch", "dead", "killed", "laugh", "haha",
    "bro", "no way", "let's go", "lets go", "wtf", "holy", "genius", "perfect",
    "destroyed", "wrecked", "exact", "boom", "done", "finally", "fire", "goat",
];

fn window_overlap_ratio(a_start: i64, a_end: i64, b_start: i64, b_end: i64) -> f64 {
    let inter = (a_end.min(b_end) - a_start.max(b_start)).max(0) as f64;
    let min_len = (a_end - a_start).min(b_end - b_start).max(1) as f64;
    inter / min_len
}

fn snap_start_to_word(words: &[Word], target_ms: i64) -> i64 {
    if words.is_empty() {
        return target_ms.max(0);
    }
    words
        .iter()
        .min_by_key(|w| (w.start_ms - target_ms).abs())
        .filter(|w| (w.start_ms - target_ms).abs() <= 2_500)
        .map(|w| (w.start_ms - 180).max(0))
        .unwrap_or_else(|| target_ms.max(0))
}

fn snap_end_to_word(words: &[Word], target_ms: i64, duration_ms: i64) -> i64 {
    if words.is_empty() {
        return target_ms.min(duration_ms);
    }
    words
        .iter()
        .min_by_key(|w| (w.end_ms - target_ms).abs())
        .filter(|w| (w.end_ms - target_ms).abs() <= 2_500)
        .map(|w| (w.end_ms + 250).min(duration_ms))
        .unwrap_or_else(|| target_ms.min(duration_ms))
}

fn audio_contrast_score(energy: &[f64], start_ms: i64, end_ms: i64, global_mean: f64) -> f64 {
    if energy.is_empty() {
        return 0.5;
    }
    let s = ((start_ms.max(0) / 1000) as usize).min(energy.len().saturating_sub(1));
    let e = (((end_ms.max(start_ms + 1000) / 1000) as usize) + 1).min(energy.len());
    if e <= s {
        return 0.5;
    }
    let slice = &energy[s..e];
    let mean = slice.iter().sum::<f64>() / slice.len() as f64;
    let peak = slice.iter().copied().fold(0.0_f64, f64::max);
    let lift = ((peak - global_mean) * 1.6 + (mean - global_mean) * 0.8 + 0.45).clamp(0.0, 1.0);
    (0.55 * peak + 0.45 * lift).clamp(0.0, 1.0)
}

/// Multi-signal SupoClip-inspired viral moment selection across the ENTIRE video:
/// 1) LLM full-transcript viral rubric (when Ollama/OpenRouter is reachable)
/// 2) Multi-signal semantic + audio scoring over sentence-bounded 24s-55s windows:
///    Hook (30%) + Audio Dynamic Contrast (25%) + Speech Pacing (20%) + Payoff/Clean Arc (25%)
/// 3) Audio-only contrast peaks fallback if the video has no speech/captions.
async fn select_best_clips(
    words: &[Word],
    energy: &[f64],
    duration_ms: i64,
    max_clips: usize,
    opts: &ClipJobOptions,
    ai: &dyn AiBackend,
) -> Vec<SelectedClip> {
    let target_count = max_clips.max(1);
    let duration_ms = duration_ms.max(energy.len() as i64 * 1000).max(5_000);
    let global_mean = if energy.is_empty() {
        0.35
    } else {
        energy.iter().sum::<f64>() / energy.len() as f64
    };

    // Single live/lookback capture from the browser extension: keep the whole
    // captured lookback window cleanly intact.
    if (opts.is_live || opts.current_time_sec.is_some()) && target_count == 1 && duration_ms <= 95_000 {
        return vec![SelectedClip {
            start_ms: 0,
            end_ms: duration_ms,
            score: audio_contrast_score(energy, 0, duration_ms, global_mean).max(0.8),
            reason: if opts.is_live {
                "live stream lookback capture".into()
            } else {
                "extension VOD lookback capture".into()
            },
            title: opts.video_title.clone(),
            hook: None,
            description: None,
            hashtags: Vec::new(),
        }];
    }

    // Short video (<= 65s): return the whole clip as 1 crisp short.
    if duration_ms <= 65_000 {
        return vec![SelectedClip {
            start_ms: 0,
            end_ms: duration_ms,
            score: audio_contrast_score(energy, 0, duration_ms, global_mean).max(0.75),
            reason: "full short clip".into(),
            title: opts.video_title.clone(),
            hook: None,
            description: None,
            hashtags: Vec::new(),
        }];
    }

    let mut chosen: Vec<SelectedClip> = Vec::new();

    // Tier 1: AI Full-Video Transcript Viral Moment Discovery (SupoClip workflow).
    if !words.is_empty() && ai.is_available() {
        let formatted = format_timestamped_transcript(words, 24_000);
        let duration_secs = duration_ms as f64 / 1000.0;
        match ai.discover_clips(&formatted, target_count.max(3), duration_secs).await {
            Ok(proposals) if !proposals.is_empty() => {
                tracing::info!("AI viral discovery proposed {} clips", proposals.len());
                for p in proposals {
                    let raw_start = (p.start_sec * 1000.0).round() as i64;
                    let raw_end = (p.end_sec * 1000.0).round() as i64;
                    let start_ms = snap_start_to_word(words, raw_start).clamp(0, duration_ms - 12_000);
                    let mut end_ms = snap_end_to_word(words, raw_end, duration_ms);
                    if end_ms - start_ms < 15_000 {
                        end_ms = (start_ms + 30_000).min(duration_ms);
                    }
                    if end_ms - start_ms > 70_000 {
                        end_ms = (start_ms + 55_000).min(duration_ms);
                    }
                    if chosen.iter().any(|c| window_overlap_ratio(c.start_ms, c.end_ms, start_ms, end_ms) > 0.2) {
                        continue;
                    }
                    let audio = audio_contrast_score(energy, start_ms, end_ms, global_mean);
                    let fused = (0.75 * p.virality_score + 0.25 * audio).clamp(0.0, 1.0);
                    chosen.push(SelectedClip {
                        start_ms,
                        end_ms,
                        score: fused,
                        reason: format!("AI viral {:.0}% · {}", fused * 100.0, p.reason),
                        title: if p.title.is_empty() { None } else { Some(p.title) },
                        hook: if p.hook.is_empty() { None } else { Some(p.hook) },
                        description: if p.description.is_empty() { None } else { Some(p.description) },
                        hashtags: p.hashtags,
                    });
                    if chosen.len() >= target_count {
                        break;
                    }
                }
            }
            Ok(_) => {}
            Err(e) => tracing::warn!("AI clip discovery failed ({e}); using multi-signal scorer"),
        }
    }

    // Tier 2: Multi-Signal Semantic + Audio Highlight Engine over sentence-bounded windows.
    if chosen.len() < target_count && words.len() >= 15 {
        let mut candidates = score_transcript_windows(words, energy, duration_ms, global_mean);
        candidates.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        for cand in candidates {
            if chosen.iter().any(|c| window_overlap_ratio(c.start_ms, c.end_ms, cand.start_ms, cand.end_ms) > 0.15) {
                continue;
            }
            chosen.push(cand);
            if chosen.len() >= target_count {
                break;
            }
        }
    }

    // Tier 3: Audio-Contrast Peak Windows (when no transcript is available or to fill remaining slots).
    if chosen.len() < target_count {
        let window_ms: i64 = 32_000;
        let step_ms: i64 = 6_000;
        let mut peaks: Vec<SelectedClip> = Vec::new();
        let mut pos: i64 = 0;
        while pos + 15_000 < duration_ms {
            let end_ms = (pos + window_ms).min(duration_ms);
            let audio = audio_contrast_score(energy, pos, end_ms, global_mean);
            peaks.push(SelectedClip {
                start_ms: pos,
                end_ms,
                score: audio,
                reason: format!("audio energy peak {:.0}%", audio * 100.0),
                title: None,
                hook: None,
                description: None,
                hashtags: Vec::new(),
            });
            pos += step_ms;
        }
        peaks.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        for cand in peaks {
            if chosen.iter().any(|c| window_overlap_ratio(c.start_ms, c.end_ms, cand.start_ms, cand.end_ms) > 0.15) {
                continue;
            }
            chosen.push(cand);
            if chosen.len() >= target_count {
                break;
            }
        }
    }

    chosen.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    chosen.truncate(target_count);
    chosen
}

fn score_transcript_windows(
    words: &[Word],
    energy: &[f64],
    duration_ms: i64,
    global_mean: f64,
) -> Vec<SelectedClip> {
    // Identify clean candidate start indices (sentence start or pause >= 550ms).
    let mut starts: Vec<usize> = vec![0];
    for i in 1..words.len() {
        let prev = &words[i - 1];
        let gap = words[i].start_ms - prev.end_ms;
        let sentence_break = prev.text.ends_with('.') || prev.text.ends_with('!') || prev.text.ends_with('?');
        if sentence_break || gap >= 550 {
            if let Some(&last_idx) = starts.last() {
                if words[i].start_ms - words[last_idx].start_ms >= 3_500 {
                    starts.push(i);
                }
            }
        }
    }
    // Ensure full-video coverage even on unpunctuated auto-captions by adding
    // periodic anchors every ~10 seconds.
    if starts.len() < ((duration_ms / 15_000) as usize).max(3) {
        starts.clear();
        let mut next_ms = 0i64;
        for (i, w) in words.iter().enumerate() {
            if w.start_ms >= next_ms {
                starts.push(i);
                next_ms = w.start_ms + 8_000;
            }
        }
    }

    let mut out = Vec::new();
    for &start_idx in &starts {
        let start_ms = (words[start_idx].start_ms - 180).max(0);
        if duration_ms - start_ms < 18_000 {
            continue;
        }
        // Try ideal viral short durations: ~32s and ~48s, snapping end to a
        // sentence break or speech pause.
        for target_dur in [32_000i64, 48_000i64] {
            let target_end = (start_ms + target_dur).min(duration_ms);
            let mut best_end_idx = start_idx;
            for j in start_idx..words.len() {
                if words[j].end_ms > target_end + 6_000 {
                    break;
                }
                if words[j].end_ms >= start_ms + 20_000 {
                    best_end_idx = j;
                    let ends_sentence = words[j].text.ends_with('.')
                        || words[j].text.ends_with('!')
                        || words[j].text.ends_with('?');
                    let next_gap = words
                        .get(j + 1)
                        .map(|n| n.start_ms - words[j].end_ms)
                        .unwrap_or(1000);
                    if words[j].end_ms >= target_end - 4_000 && (ends_sentence || next_gap >= 450) {
                        break;
                    }
                }
            }
            if best_end_idx <= start_idx + 12 {
                continue;
            }
            let slice = &words[start_idx..=best_end_idx];
            let end_ms = (slice.last().unwrap().end_ms + 260).min(duration_ms);
            let dur_sec = ((end_ms - start_ms) as f64 / 1000.0).max(1.0);
            if !(18.0..=65.0).contains(&dur_sec) {
                continue;
            }

            // 1. Hook Strength (30%): opening 4.5 seconds
            let hook_text = slice
                .iter()
                .take_while(|w| w.start_ms <= start_ms + 4_500)
                .map(|w| w.text.as_str())
                .collect::<Vec<_>>()
                .join(" ")
                .to_ascii_lowercase();
            let hook_hits = HOOK_WORDS.iter().filter(|kw| hook_text.contains(**kw)).count() as f64;
            let hook_punct = if hook_text.contains('?') || hook_text.contains('!') { 0.25 } else { 0.0 };
            let hook_digits = if hook_text.chars().any(|c| c.is_ascii_digit()) { 0.15 } else { 0.0 };
            let hook_score = (0.28 + hook_hits * 0.22 + hook_punct + hook_digits).clamp(0.0, 1.0);

            // 2. Audio Dynamic Contrast (25%)
            let audio_score = audio_contrast_score(energy, start_ms, end_ms, global_mean);

            // 3. Speech Pacing & Density (20%): ideal 2.2..3.8 words/sec
            let wps = slice.len() as f64 / dur_sec;
            let pacing_score = if (2.1..=4.0).contains(&wps) {
                1.0
            } else if wps < 2.1 {
                (wps / 2.1).clamp(0.1, 1.0)
            } else {
                (1.0 - (wps - 4.0) * 0.15).clamp(0.3, 1.0)
            };

            // 4. Emotional Payoff & Clean Ending (25%)
            let full_lower = slice
                .iter()
                .map(|w| w.text.as_str())
                .collect::<Vec<_>>()
                .join(" ")
                .to_ascii_lowercase();
            let payoff_hits = PAYOFF_WORDS.iter().filter(|kw| full_lower.contains(**kw)).count() as f64;
            let excl_count = full_lower.chars().filter(|&c| c == '!' || c == '?').count() as f64;
            let last_word = &slice.last().unwrap().text;
            let clean_end = if last_word.ends_with('.') || last_word.ends_with('!') || last_word.ends_with('?') {
                0.28
            } else {
                0.08
            };
            let payoff_score = (0.2 + payoff_hits * 0.14 + excl_count * 0.08 + clean_end).clamp(0.0, 1.0);

            let total = (0.30 * hook_score + 0.25 * audio_score + 0.20 * pacing_score + 0.25 * payoff_score)
                .clamp(0.0, 1.0);

            let mut tags = Vec::new();
            if hook_score >= 0.65 { tags.push("strong hook"); }
            if audio_score >= 0.65 { tags.push("audio peak"); }
            if payoff_score >= 0.65 { tags.push("high payoff"); }
            if tags.is_empty() { tags.push("clean arc"); }

            out.push(SelectedClip {
                start_ms,
                end_ms,
                score: total,
                reason: format!("viral {:.0}% · {}", total * 100.0, tags.join(" + ")),
                title: None,
                hook: None,
                description: None,
                hashtags: Vec::new(),
            });
        }
    }
    out
}

/// Derive a clean, punchy white-title headline from the clip's transcript when
/// no LLM title was generated.
fn fallback_metadata(
    source: &Path,
    rank: usize,
    clip_words: &[Word],
    video_title: Option<&str>,
) -> GeneratedMetadata {
    let spoken_hook: String = clip_words
        .iter()
        .take(8)
        .map(|w| w.text.trim())
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    let title = if spoken_hook.len() >= 10 {
        let trimmed: String = spoken_hook.chars().take(52).collect();
        trimmed.trim_end_matches(|c: char| c == ',' || c == ';').to_string()
    } else if let Some(vt) = video_title.filter(|t| !t.trim().is_empty()) {
        format!("{} · Part {rank}", vt.trim().chars().take(42).collect::<String>())
    } else {
        let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("clip");
        format!("Highlight {rank} · {stem}")
    };

    let hook = title.chars().take(42).collect();
    GeneratedMetadata {
        title,
        description: if spoken_hook.is_empty() {
            "Auto-clipped by PulseCut".into()
        } else {
            clip_words
                .iter()
                .take(26)
                .map(|w| w.text.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        },
        hashtags: vec!["shorts".into(), "clips".into(), "viral".into()],
        hook,
    }
}

fn detect_platform(url: &str, opts: &ClipJobOptions) -> Platform {
    if let Some(hint) = opts.platform_hint.as_deref() {
        match hint.to_ascii_lowercase().as_str() {
            "kick" => return Platform::Kick,
            "twitch" => return Platform::Twitch,
            "youtube" => return Platform::Youtube,
            _ => {}
        }
    }
    let lower = url.to_ascii_lowercase();
    if lower.contains("kick.com") {
        Platform::Kick
    } else if lower.contains("twitch.tv") {
        Platform::Twitch
    } else {
        Platform::Youtube
    }
}

fn extract_channel(url: &str, opts: &ClipJobOptions) -> String {
    if let Some(ch) = opts.channel.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        return ch.to_string();
    }
    if let Some(slug) = extract_kick_slug(url) {
        return slug;
    }
    if let Ok(parsed) = reqwest::Url::parse(url) {
        let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
        if host.contains("twitch.tv") {
            if let Some(first) = parsed.path_segments().and_then(|mut s| s.next()) {
                if !first.is_empty() && first != "videos" {
                    return first.to_string();
                }
            }
        }
    }
    "vod".into()
}

/// Full SupoClip-style VOD/live pipeline with stage progress callback.
pub async fn make_clips_with_options<F>(
    cfg: &Config,
    url: &str,
    max_clips: usize,
    template_id: &str,
    out: &Path,
    ai: &dyn AiBackend,
    opts: ClipJobOptions,
    mut on_progress: F,
) -> Result<Vec<ClipPackage>>
where
    F: FnMut(u32, &str),
{
    let ffmpeg_bin = ffmpeg(&cfg.capture.ffmpeg_path)?;
    let dir = out.join("downloads").join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&dir)?;
    for d in ["raw", "final", "subs"] {
        std::fs::create_dir_all(out.join(d))?;
    }

    on_progress(12, if opts.is_live { "capturing live stream (highest quality)" } else { "downloading highest quality video" });
    let (source, section_offset_ms) = download_with_options(url, &dir, &opts, Some(&ffmpeg_bin)).await?;
    tracing::info!("downloaded {} -> {}", url, source.display());

    on_progress(35, "analyzing audio & transcribing full video");
    let energy = audio_energy_per_second(&source, &ffmpeg_bin);
    let probed_ms = probe_duration_ms(&source, &ffmpeg_bin);
    let duration_ms = if probed_ms > 0 {
        probed_ms
    } else {
        (energy.len() as i64 * 1000).max(5_000)
    };

    let full_words = transcribe_full_video(
        cfg,
        url,
        &source,
        &dir,
        &ffmpeg_bin,
        section_offset_ms,
        duration_ms,
    )
    .await;

    on_progress(
        58,
        if full_words.is_empty() {
            "scoring audio highlight peaks across full video"
        } else {
            "selecting best viral moments from full transcript"
        },
    );
    let selected = select_best_clips(&full_words, &energy, duration_ms, max_clips, &opts, ai).await;
    if selected.is_empty() {
        return Err(PulseError::Render("video produced no clippable moments".into()));
    }

    let resolved_template_id = if template_id.trim().is_empty() { "default" } else { template_id };
    let template = pulsecut_render::get_template(resolved_template_id)
        .unwrap_or_else(|| pulsecut_render::get_template("default").unwrap_or_else(|| pulsecut_render::template_library().remove(0)));
    let renderer = Renderer::with_ffmpeg(cfg.render.clone(), ffmpeg_bin.clone());
    let platform = detect_platform(url, &opts);
    let channel = extract_channel(url, &opts);
    let mut packages = Vec::new();
    let total_selected = selected.len().max(1);

    for (rank, clip) in selected.into_iter().enumerate() {
        let pct = 65 + ((rank as u32 * 30) / total_selected as u32);
        on_progress(pct, &format!("rendering clip {} of {}", rank + 1, total_selected));

        let id = uuid::Uuid::new_v4().to_string();
        let raw = out.join("raw").join(format!("{id}.ts"));
        let final_path = out.join("final").join(format!("{id}.mp4"));
        let ass = out.join("subs").join(format!("{id}.ass"));

        let start_sec = (clip.start_ms as f64 / 1000.0).max(0.0);
        let dur_sec = ((clip.end_ms - clip.start_ms) as f64 / 1000.0).max(1.0);

        // Frame-accurate high-quality slice (CRF 16 + 256k AAC) into raw/{id}.ts
        // so sentence starts never freeze on a late keyframe and Framing Studio
        // gets crisp native-resolution frames.
        let slice_status = Command::new(&ffmpeg_bin)
            .args([
                "-y",
                "-v", "error",
                "-ss", &format!("{start_sec:.3}"),
                "-i",
            ])
            .arg(&source)
            .args([
                "-t", &format!("{dur_sec:.3}"),
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "16",
                "-c:a", "aac",
                "-b:a", "256k",
                "-f", "mpegts",
            ])
            .arg(&raw)
            .status()
            .map_err(|e| PulseError::Process(format!("clip slice failed: {e}")))?;
        if !slice_status.success() {
            return Err(PulseError::Process(format!("ffmpeg slice failed for clip {}", rank + 1)));
        }

        // Slice matching word-level timestamps relative to the clip start (0..dur_ms).
        let clip_words: Vec<Word> = full_words
            .iter()
            .filter(|w| w.end_ms > clip.start_ms && w.start_ms < clip.end_ms)
            .map(|w| {
                let s = (w.start_ms - clip.start_ms).max(0);
                let e = (w.end_ms - clip.start_ms).max(s + 60);
                Word {
                    text: w.text.clone(),
                    start_ms: s,
                    end_ms: e,
                    confidence: w.confidence,
                }
            })
            .collect();

        let clip_transcript: String = clip_words
            .iter()
            .map(|w| w.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");

        let generated = if let Some(ai_title) = clip.title.clone().filter(|t| !t.trim().is_empty()) {
            GeneratedMetadata {
                title: ai_title.clone(),
                hook: clip.hook.clone().unwrap_or(ai_title),
                description: clip.description.clone().unwrap_or_else(|| {
                    if clip_transcript.is_empty() {
                        "Auto-clipped by PulseCut".into()
                    } else {
                        clip_transcript.chars().take(160).collect()
                    }
                }),
                hashtags: if clip.hashtags.is_empty() {
                    vec!["shorts".into(), "clips".into(), "viral".into()]
                } else {
                    clip.hashtags.clone()
                },
            }
        } else {
            let hints = format!(
                "source={url} channel={channel} score={:.2} reason={} rank={}",
                clip.score, clip.reason, rank + 1
            );
            match ai.generate(&build_prompt(&clip_transcript, &hints)).await {
                Ok(m) if !m.title.trim().is_empty() => m,
                Ok(_) => fallback_metadata(&source, rank + 1, &clip_words, opts.video_title.as_deref()),
                Err(e) => {
                    tracing::warn!("AI metadata unavailable ({e}); using transcript fallback");
                    fallback_metadata(&source, rank + 1, &clip_words, opts.video_title.as_deref())
                }
            }
        };

        let meta = apply_metadata(
            &template,
            &generated.title,
            &generated.description,
            &generated.hook,
            &generated.hashtags,
            &channel,
        );

        let mut edl = EditDecisionList::new(&id);
        edl.push(EditOp::Template { id: template.id.to_string() });
        let headline_text = if !meta.hook.trim().is_empty() {
            meta.hook.clone()
        } else {
            meta.title.clone()
        };
        if !headline_text.trim().is_empty() {
            edl.push(EditOp::Hook {
                text: headline_text,
                duration_ms: (clip.end_ms - clip.start_ms).max(4_000),
            });
        }

        renderer.render(&raw, &clip_words, &edl, &ass, &final_path, 0).await?;

        let pkg = ClipPackage {
            id: id.clone(),
            channel: channel.clone(),
            platform,
            source_window: ClipWindow {
                start_ms: clip.start_ms + section_offset_ms,
                end_ms: clip.end_ms + section_offset_ms,
                snap_reason: clip.reason,
            },
            video_path: final_path.to_string_lossy().into_owned(),
            raw_video_path: raw.to_string_lossy().into_owned(),
            words: clip_words,
            title: meta.title,
            description: meta.description,
            hashtags: meta.hashtags,
            caption_style: template.caption_preset.to_string(),
            template: meta.template_id,
            profiles: default_profiles(),
            status: ClipStatus::Ready,
            created_at_ms: now_ms(),
            confidence: clip.score,
        };
        packages.push(pkg);
    }

    Ok(packages)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_html_but_accepts_video_containers() {
        let html = b"<!doctype html><html><body>YouTube</body></html>";
        assert!(!is_media_bytes(html));
        let mp4 = [0u8, 0, 0, 0x18, b'f', b't', b'y', b'p', b'i', b's', b'o', b'm'];
        assert!(is_media_bytes(&mp4));
        assert!(is_media_bytes(&[0x1A, 0x45, 0xDF, 0xA3, 0, 0, 0, 0, 0, 0, 0, 0]));
    }

    #[test]
    fn extracts_kick_live_slug_only_for_live_channels() {
        assert_eq!(extract_kick_slug("https://kick.com/funnyhoodvidz").as_deref(), Some("funnyhoodvidz"));
        assert_eq!(extract_kick_slug("https://kick.com/video/abc-123"), None);
        assert_eq!(extract_kick_slug("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), None);
    }

    #[test]
    fn scores_viral_hook_and_audio_peak_higher_than_flat_filler() {
        let mut words = Vec::new();
        // Flat low-energy filler (0..35s)
        for i in 0..70 {
            words.push(Word {
                text: if i == 69 { "okay.".into() } else { "so".into() },
                start_ms: i * 480,
                end_ms: i * 480 + 350,
                confidence: 0.9,
            });
        }
        // High-energy viral hook + payoff (40..72s)
        let viral_tokens = [
            "No", "way!", "Wait", "did", "he", "actually", "just", "win", "a", "million", "dollars?",
            "Bro", "that", "was", "literally", "the", "most", "insane", "clutch", "ever!",
        ];
        for i in 0..80 {
            let tok = viral_tokens[i % viral_tokens.len()];
            words.push(Word {
                text: tok.into(),
                start_ms: 40_000 + (i as i64) * 380,
                end_ms: 40_000 + (i as i64) * 380 + 300,
                confidence: 0.95,
            });
        }
        let mut energy = vec![0.15; 90];
        for e in energy.iter_mut().take(72).skip(40) {
            *e = 0.88;
        }
        let mut scored = score_transcript_windows(&words, &energy, 90_000, 0.35);
        scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
        assert!(!scored.is_empty());
        assert!(scored[0].start_ms >= 35_000, "top clip should pick the viral hook + peak section");
    }
}
