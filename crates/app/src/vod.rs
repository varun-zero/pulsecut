//! Paste-a-link VOD pipeline: download -> segment -> rank by loudness ->
//! render platform-ready shorts. Used by the dashboard's "New clip" form.

use pulsecut_ai::{build_prompt, AiBackend, GeneratedMetadata};
use pulsecut_capture::{ffmpeg, normalize_audio, resolve_binary, rms_f32, RollingBuffer};
use pulsecut_core::config::Config;
use pulsecut_core::edl::EditDecisionList;
use pulsecut_core::error::{PulseError, Result};
use pulsecut_core::model::{ClipPackage, ClipStatus, ClipWindow, Platform, default_profiles};
use pulsecut_render::{apply_metadata, Renderer};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Download a URL. Prefers yt-dlp (handles YouTube/Twitch/Kick pages); falls
/// back to a plain HTTP GET for direct media links, or copies local files.
pub async fn download(url: &str, dir: &Path) -> Result<PathBuf> {
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
        return Ok(target);
    }

    let mut extractor_error = String::new();
    if let Some(bin) = resolve_binary("", "PULSECUT_YTDLP", &["yt-dlp", "yt-dlp.exe"]) {
        let pattern = dir.join("source.%(ext)s");
        let section_secs = std::env::var("PULSECUT_MAX_SOURCE_SECONDS")
            .ok().and_then(|v| v.parse::<u64>().ok()).unwrap_or(180);
        // Use the default player client. Forcing alternate clients makes
        // YouTube report "Requested format is not available" even when the
        // default client lists every format correctly.
        let mut attempts: Vec<Vec<String>> = vec![vec![
            "-f".into(), "worst[ext=mp4][height>=360]/worst".into(),
            "--no-playlist".into(), "--no-update".into(),
            "--download-sections".into(), format!("*0-{section_secs}"),
            "--force-keyframes-at-cuts".into(), "-o".into(), pattern.to_string_lossy().into_owned(),
            url.to_string(),
        ]];
        // Fallback for sites where section download is unsupported.
        attempts.push(vec![
            "-f".into(), "best[height<=1080]/best".into(),
            "--no-playlist".into(), "--no-update".into(),
            "-o".into(), pattern.to_string_lossy().into_owned(), url.to_string(),
        ]);
        for args in attempts {
            let output = Command::new(&bin).args(&args).output()
                .map_err(|e| PulseError::Process(format!("yt-dlp failed to start: {e}")))?;
            if output.status.success() {
                if let Some(p) = std::fs::read_dir(dir)?
                    .filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .find(|p| p.file_name().and_then(|n| n.to_str()).map_or(false, |n| n.starts_with("source.")))
                {
                    return Ok(p);
                }
            }
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if !detail.is_empty() {
                extractor_error = detail.lines().last().unwrap_or(&detail).to_string();
            }
            tracing::warn!("yt-dlp attempt failed: {extractor_error}");
        }
    }

    // A blind HTTP GET turns a YouTube page into a bogus ".mp4" and fails
    // later with "moov atom not found". Only fetch URLs that actually look
    // like direct media, then verify the bytes before writing anything.
    let looks_like_media = url.split('?').next().map_or(false, |p| {
        [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"].iter().any(|ext| p.to_ascii_lowercase().ends_with(ext))
    });
    let response = reqwest::get(url).await.map_err(|e| PulseError::Http(format!("download failed: {e}")))?;
    let content_type = response.headers().get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();
    if !looks_like_media && !content_type.starts_with("video/") {
        return Err(PulseError::Http(format!(
            "link is not a direct video (content-type: {}). {}",
            if content_type.is_empty() { "unknown" } else { &content_type },
            if extractor_error.is_empty() { "Paste a direct MP4/WebM URL.".to_string() }
            else { format!("yt-dlp could not fetch it: {extractor_error}") }
        )));
    }
    let bytes = response.bytes().await.map_err(|e| PulseError::Http(e.to_string()))?;
    if !is_media_bytes(&bytes) {
        return Err(PulseError::Http("download did not contain a playable video container".into()));
    }
    let out = dir.join("source.mp4");
    std::fs::write(&out, &bytes)?;
    Ok(out)
}

/// Cheap container-signature check so an HTML error page is never written as
/// a video file (the "moov atom not found" failure mode).
fn is_media_bytes(bytes: &[u8]) -> bool {
    if bytes.len() < 12 { return false; }
    &bytes[4..8] == b"ftyp"                       // MP4 / MOV / M4V
        || bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) // WebM / MKV
        || (bytes.starts_with(b"RIFF") && &bytes[8..12] == b"AVI ")
}

/// Clean, deterministic metadata when no model is configured. Never echoes
/// the prompt back as a title — that reads like generated filler.
fn fallback_metadata(source: &Path, rank: usize) -> GeneratedMetadata {
    let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("video");
    GeneratedMetadata {
        title: format!("Highlight {rank} · {stem}"),
        description: "Auto-clipped by PulseCut".into(),
        hashtags: vec!["shorts".into(), "clips".into(), "fyp".into()],
        hook: String::new(),
    }
}

fn segment_rms(path: &Path, ffmpeg: &Path) -> f64 {
    let out = Command::new(ffmpeg)
        .args(["-v", "error", "-i"])
        .arg(path)
        .args(["-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"])
        .output();
    match out {
        Ok(o) if o.status.success() => normalize_audio(rms_f32(&o.stdout)),
        _ => 0.0,
    }
}

/// Create up to `max_clips` shorts from a downloaded video, ranked by audio
/// energy. Every clip goes through the same renderer as live detections.
pub async fn make_clips(
    cfg: &Config,
    url: &str,
    max_clips: usize,
    template_id: &str,
    out: &Path,
    ai: &dyn AiBackend,
) -> Result<Vec<ClipPackage>> {
    let ffmpeg = ffmpeg(&cfg.capture.ffmpeg_path)?;
    let dir = out.join("downloads").join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&dir)?;
    for d in ["raw", "final", "subs"] {
        std::fs::create_dir_all(out.join(d))?;
    }

    let source = download(url, &dir).await?;
    tracing::info!("downloaded {} -> {}", url, source.display());

    let pattern = dir.join("seg_%06d.ts");
    let status = Command::new(&ffmpeg)
        .args(["-y", "-v", "error", "-i"]).arg(&source)
        .args(["-c", "copy", "-f", "segment", "-segment_time", "30",
               "-segment_start_number", "0", "-reset_timestamps", "1",
               "-segment_format", "mpegts"])
        .arg(&pattern)
        .status()
        .map_err(|e| PulseError::Process(format!("VOD segmentation failed: {e}")))?;
    if !status.success() {
        return Err(PulseError::Process("VOD segmentation failed".into()));
    }

    let mut buffer = RollingBuffer::new(&dir, 30, 3_600, 0)?;
    buffer.refresh()?;
    if buffer.segments.is_empty() {
        return Err(PulseError::Render("video produced no segments".into()));
    }

    // Rank whole segments by measured loudness. Loud moments are usually the
    // interesting ones; this is the VOD equivalent of the live chat spike.
    let mut ranked: Vec<(f64, usize)> = buffer.segments.iter().enumerate()
        .map(|(i, s)| (segment_rms(&s.path, &ffmpeg), i))
        .collect();
    ranked.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    ranked.truncate(max_clips.max(1));

    let template = pulsecut_render::get_template(template_id)
        .unwrap_or_else(|| pulsecut_render::template_library().remove(0));
    let renderer = Renderer::new(cfg.render.clone())?;
    let mut packages = Vec::new();

    for (rank, (energy, idx)) in ranked.into_iter().enumerate() {
        let segment = &buffer.segments[idx];
        let id = uuid::Uuid::new_v4().to_string();
        let raw = out.join("raw").join(format!("{id}.ts"));
        std::fs::copy(&segment.path, &raw)?;
        let final_path = out.join("final").join(format!("{id}.mp4"));
        let ass = out.join("subs").join(format!("{id}.ass"));

        let hints = format!("source={url} segment={idx} loudness={energy:.3} rank={}", rank + 1);
        let generated = match ai.generate(&build_prompt("", &hints)).await {
            Ok(m) if !m.title.trim().is_empty() => m,
            Ok(_) => fallback_metadata(&source, rank + 1),
            Err(e) => {
                tracing::warn!("AI metadata unavailable ({e}); using offline fallback");
                fallback_metadata(&source, rank + 1)
            }
        };
        let meta = apply_metadata(&template, &generated.title, &generated.description,
                                  &generated.hook, &generated.hashtags, "vod");

        let mut edl = EditDecisionList::new(&id);
        edl.push(pulsecut_core::edl::EditOp::Template { id: template.id.to_string() });
        renderer.render(&raw, &[], &edl, &ass, &final_path, 0).await?;

        let pkg = ClipPackage {
            id: id.clone(),
            channel: "vod".into(),
            platform: Platform::Youtube,
            source_window: ClipWindow {
                start_ms: segment.start_ms,
                end_ms: segment.end_ms,
                snap_reason: format!("loudness {energy:.3}"),
            },
            video_path: final_path.to_string_lossy().into_owned(),
            raw_video_path: raw.to_string_lossy().into_owned(),
            words: Vec::new(),
            title: meta.title,
            description: meta.description,
            hashtags: meta.hashtags,
            caption_style: cfg.render.caption_style.clone(),
            template: meta.template_id,
            profiles: default_profiles(),
            status: ClipStatus::Ready,
            created_at_ms: now_ms(),
            confidence: energy,
        };
        packages.push(pkg);
    }
    Ok(packages)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64).unwrap_or(0)
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
}
