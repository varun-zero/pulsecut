//! PulseCut HTTP API & minimal engine status page.
//!
//! Serves REST endpoints (`/health`, `/api/jobs`, `/api/clips/*`, `/api/monitors/*`,
//! `/api/extension/*`, `/api/qa/*`) and a lightweight status page on `GET /` linking
//! to the React frontend studio.

use crate::monitor;
use crate::vod;
use pulsecut_ai::{resilient_backend, AiBackend};
use pulsecut_core::config::Config;
use pulsecut_core::edl::EditOp;
use pulsecut_core::error::{PulseError, Result};
use pulsecut_core::model::ClipStatus;
use pulsecut_editor::{Job, JobStatus, JobStore, Store};
use pulsecut_publish::{publisher, PublishJob};
use pulsecut_render::Renderer;
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Semaphore;

struct Shared {
    cfg: Config,
    out: PathBuf,
    store: Mutex<Store>,
    jobs: Mutex<JobStore>,
    renderer: Option<Renderer>,
    ai: Box<dyn AiBackend>,
    job_semaphore: Arc<Semaphore>,
    active_jobs: AtomicUsize,
    monitors: OnceLock<Arc<monitor::MonitorManager>>,
}

impl Shared {
    fn monitors(&self) -> &Arc<monitor::MonitorManager> {
        self.monitors.get().expect("MonitorManager initialized")
    }
}

pub async fn serve(addr: &str, cfg: Config) -> Result<()> {
    let out = PathBuf::from(&cfg.capture.output_dir);
    std::fs::create_dir_all(&out)?;
    let max_concurrent_jobs = std::env::var("PULSECUT_MAX_CONCURRENT_JOBS")
        .ok()
        .and_then(|s| s.trim().parse::<usize>().ok())
        .unwrap_or(2)
        .clamp(1, 6);
    let shared = Arc::new(Shared {
        cfg: cfg.clone(),
        out: out.clone(),
        store: Mutex::new(Store::open(out.join("editor"))?),
        jobs: Mutex::new(JobStore::open(out.join("editor"))?),
        renderer: pulsecut_capture::ffmpeg(&cfg.capture.ffmpeg_path)
            .ok()
            .map(|ff| Renderer::with_ffmpeg(cfg.render.clone(), ff)),
        ai: resilient_backend(&cfg),
        job_semaphore: Arc::new(Semaphore::new(max_concurrent_jobs)),
        active_jobs: AtomicUsize::new(0),
        monitors: OnceLock::new(),
    });

    let weak_shared = Arc::downgrade(&shared);
    let dispatcher: monitor::ClipDispatcher = Arc::new(move |req: monitor::MonitorClipRequest| {
        let Some(st) = weak_shared.upgrade() else {
            return String::new();
        };
        dispatch_monitor_clip(st, req)
    });
    let _ = shared.monitors.set(monitor::MonitorManager::new(dispatcher));

    let listener = TcpListener::bind(addr).await
        .map_err(|e| PulseError::Editor(format!("dashboard bind failed: {e}")))?;
    tracing::info!("PulseCut dashboard listening on http://{addr}");
    loop {
        let (mut socket, _) = listener.accept().await
            .map_err(|e| PulseError::Editor(e.to_string()))?;
        let state = Arc::clone(&shared);
        tokio::spawn(async move {
            // A POST body can arrive in a separate TCP segment from the
            // headers, so read until the declared Content-Length is present.
            let mut buf: Vec<u8> = Vec::with_capacity(8192);
            let mut tmp = [0u8; 8192];
            let mut len = 0usize;
            loop {
                let n = match socket.read(&mut tmp).await { Ok(n) => n, Err(_) => return };
                if n == 0 { break; }
                buf.extend_from_slice(&tmp[..n]);
                if let Some(hpos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                    if len == 0 {
                        let header_text = String::from_utf8_lossy(&buf[..hpos]);
                        for line in header_text.split("\r\n") {
                            if let Some((k, v)) = line.split_once(':') {
                                if k.eq_ignore_ascii_case("content-length") {
                                    len = v.trim().parse().unwrap_or(0);
                                }
                            }
                        }
                    }
                    if buf.len() >= hpos + 4 + len { break; }
                }
                if buf.len() > 2_000_000 { break; }
            }
            if buf.is_empty() { return; }
            let header_end = buf.windows(4).position(|w| w == b"\r\n\r\n");
            let head_bytes = match header_end {
                Some(pos) => &buf[..pos],
                None => &buf[..],
            };
            let head_str = String::from_utf8_lossy(head_bytes);
            let request = head_str.split("\r\n").next().unwrap_or("");
            let mut parts = request.split_whitespace();
            let method = parts.next().unwrap_or("GET").to_string();
            let path = parts.next().unwrap_or("/").to_string();
            let body = if len > 0 {
                match header_end {
                    Some(pos) => {
                        let start = pos + 4;
                        let end = (start + len).min(buf.len());
                        String::from_utf8_lossy(&buf[start..end]).into_owned()
                    }
                    None => String::new(),
                }
            } else { String::new() };

            let mut range_header: Option<String> = None;
            for line in head_str.split("\r\n").skip(1) {
                if let Some((k, v)) = line.split_once(':') {
                    if k.eq_ignore_ascii_case("range") {
                        range_header = Some(v.trim().to_string());
                        break;
                    }
                }
            }

            let (mut status, ctype, mut payload) = handle(Arc::clone(&state), &method, &path, &body).await;
            let mut extra_headers = String::new();
            if status == 200 && ctype.starts_with("video/") {
                extra_headers.push_str("Accept-Ranges: bytes\r\n");
                if let Some(ref rng) = range_header {
                    let total = payload.len();
                    if total > 0 {
                        match parse_byte_range(rng, total) {
                            Some((start, end)) => {
                                status = 206;
                                extra_headers.push_str(&format!(
                                    "Content-Range: bytes {start}-{end}/{total}\r\n"
                                ));
                                payload = payload[start..=end].to_vec();
                            }
                            None => {
                                status = 416;
                                extra_headers.push_str(&format!("Content-Range: bytes */{total}\r\n"));
                                payload.clear();
                            }
                        }
                    }
                }
            }
            let reason = match status {
                200 => "OK",
                202 => "Accepted",
                204 => "No Content",
                206 => "Partial Content",
                400 => "Bad Request",
                404 => "Not Found",
                409 => "Conflict",
                412 => "Precondition Failed",
                416 => "Range Not Satisfiable",
                500 => "Internal Server Error",
                502 => "Bad Gateway",
                _ => "OK",
            };
            let head = format!(
                "HTTP/1.1 {status} {reason}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\n{extra_headers}Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization, Range\r\nAccess-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length\r\nCache-Control: no-store, no-cache, must-revalidate\r\nPragma: no-cache\r\nConnection: close\r\n\r\n",
                payload.len()
            );
            let _ = socket.write_all(head.as_bytes()).await;
            let _ = socket.write_all(&payload).await;
        });
    }
}

fn parse_byte_range(header: &str, total: usize) -> Option<(usize, usize)> {
    let spec = header.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (start_s, end_s) = spec.split_once('-')?;
    if total == 0 {
        return None;
    }
    if start_s.is_empty() {
        let suffix: usize = end_s.trim().parse().ok()?;
        if suffix == 0 {
            return None;
        }
        let start = total.saturating_sub(suffix);
        return Some((start, total - 1));
    }
    let start: usize = start_s.trim().parse().ok()?;
    if start >= total {
        return None;
    }
    let end = if end_s.trim().is_empty() {
        total - 1
    } else {
        end_s.trim().parse::<usize>().ok()?.min(total - 1)
    };
    if start > end {
        return None;
    }
    Some((start, end))
}

fn json_out(status: u16, v: Value) -> (u16, &'static str, Vec<u8>) {
    (status, "application/json; charset=utf-8", serde_json::to_vec(&v).unwrap_or_default())
}

async fn handle(state: Arc<Shared>, method: &str, path: &str, body: &str) -> (u16, &'static str, Vec<u8>) {
    if method == "OPTIONS" {
        return (204, "text/plain", Vec::new());
    }
    let path = path.split('?').next().unwrap_or(path).trim_end_matches('/');
    match (method, path) {
        ("GET", "" | "/") => {
            (200, "text/html; charset=utf-8", index_html().as_bytes().to_vec())
        }
        ("GET", "/health") => json_out(200, json!({"ok": true, "clips": state.store.lock().unwrap().list().len()})),
        ("GET", "/api/extension/status") => json_out(200, json!({
            "ok": true,
            "version": env!("CARGO_PKG_VERSION"),
            "connected": true,
            "clips": state.store.lock().unwrap().list().len(),
            "jobs": state.jobs.lock().unwrap().list().len(),
            "active_jobs": state.active_jobs.load(Ordering::Relaxed),
        })),
        ("POST", "/api/extension/clip") => extension_clip(state, body),
        ("GET", "/api/monitors") => json_out(200, state.monitors().list_json()),
        ("POST", "/api/monitors") => start_monitors(&state, body).await,
        ("POST", "/api/monitors/config") => update_monitor_config(&state, body).await,
        _ if path.starts_with("/api/monitors/") => handle_monitor_item(&state, method, path, body),
        ("GET", "/api/clips") => {
            let store = state.store.lock().unwrap();
            json_out(200, json!({"clips": store.list()}))
        }
        ("GET", "/api/jobs") => {
            let jobs = state.jobs.lock().unwrap();
            json_out(200, json!({"jobs": jobs.list()}))
        }
        ("POST", "/api/jobs") => create_job(state, body),
        ("GET", "/api/app/info") => json_out(200, json!({
            "name": "PulseCut", "version": env!("CARGO_PKG_VERSION"),
            "engine": "rust + ffmpeg", "local_ai": true,
            "templates": pulsecut_render::template_library().iter().map(|t| t.id).collect::<Vec<_>>(),
            "layouts": ["solo", "pip", "split", "centered"],
            "canvas": ["solid", "blur", "padding"],
            "capabilities": ["live-chat spikes", "face framing", "karaoke captions", "outro cards", "social cards", "audio peak", "cross-posting"]
        })),
        ("POST", "/api/engine/call") => engine_call(&state, body).await,
        ("GET", "/api/projects/state") => json_out(200, json!({
            "clips": state.store.lock().unwrap().list().len(),
            "jobs": state.jobs.lock().unwrap().list().len(),
            "persisted": true
        })),
        ("POST", "/api/projects/save") => json_out(200, json!({"saved": true, "clips": state.store.lock().unwrap().list().len()})),
        _ if path.starts_with("/api/jobs/") => {
            let id = path.trim_start_matches("/api/jobs/");
            let jobs = state.jobs.lock().unwrap();
            match jobs.get(id) {
                Some(j) => json_out(200, json!({"job": j})),
                None => json_out(404, json!({"error": "job not found"})),
            }
        }
        // QA frames produced by the verify endpoint (path-traversal hardened).
        _ if path.starts_with("/api/qa/") => {
            let rest = path.trim_start_matches("/api/qa/");
            let rel = Path::new(rest);
            let safe = !rest.is_empty()
                && !rest.contains('\\')
                && rest.ends_with(".jpg")
                && rel.components().all(|c| matches!(c, Component::Normal(_)));
            if !safe {
                return json_out(400, json!({"error": "invalid qa frame path"}));
            }
            let file = state.out.join("qa").join(rel);
            if file.is_file() {
                match tokio::fs::read(&file).await {
                    Ok(bytes) => (200, "image/jpeg", bytes),
                    Err(_) => json_out(404, json!({"error": "frame read failed"})),
                }
            } else {
                json_out(404, json!({"error": "frame not found"}))
            }
        }
        _ => handle_clip(&state, method, path, body).await,
    }
}

/// Unified engine command surface, mirroring the `engine:call` style bridge
/// observed in the desktop editor: one endpoint, an allowlisted command name,
/// explicit errors for anything not implemented.
async fn engine_call(state: &Shared, body: &str) -> (u16, &'static str, Vec<u8>) {
    let v: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(e) => return json_out(400, json!({"error": e.to_string()})),
    };
    let command = v["command"].as_str().unwrap_or("");
    let args = &v["args"];
    match command {
        "templates" => json_out(200, json!({"templates": pulsecut_render::template_library().iter().map(|t| json!({"id":t.id,"name":t.name})).collect::<Vec<_>>()})),
        "layouts" => json_out(200, json!({"layouts": ["solo","pip","split","centered"], "canvas": ["solid","blur","padding"]})),
        "metadata" => {
            let t = pulsecut_render::get_template(args["template"].as_str().unwrap_or("default"))
                .unwrap_or_else(|| pulsecut_render::template_library().remove(0));
            let m = pulsecut_render::apply_metadata(
                &t, args["title"].as_str().unwrap_or(""), args["description"].as_str().unwrap_or(""),
                args["hook"].as_str().unwrap_or(""), &[], args["channel"].as_str().unwrap_or(""),
            );
            json_out(200, json!({"metadata": m}))
        }
        "probe" => {
            let id = args["clip_id"].as_str().unwrap_or("");
            let path = if !id.is_empty() {
                match state.store.lock().unwrap().get(id) {
                    Some(p) => PathBuf::from(&p.video_path),
                    None => return json_out(404, json!({"error": "clip not found"})),
                }
            } else {
                PathBuf::from(args["path"].as_str().unwrap_or(""))
            };
            if !path.is_file() { return json_out(404, json!({"error": "media file not found"})); }
            let ff = match pulsecut_capture::ffmpeg(&state.cfg.capture.ffmpeg_path) {
                Ok(p) => p,
                Err(e) => return json_out(500, json!({"error": e.to_string()})),
            };
            let out = match tokio::process::Command::new(ff).args(["-hide_banner", "-i"]).arg(&path).output().await {
                Ok(o) => o,
                Err(e) => return json_out(500, json!({"error": e.to_string()})),
            };
            let text = String::from_utf8_lossy(&out.stderr);
            let details: Vec<&str> = text.lines().filter(|l| l.contains("Duration:") || l.contains("Video:") || l.contains("Audio:")).collect();
            json_out(200, json!({"probe": details, "path": path.to_string_lossy()}))
        }
        other => json_out(400, json!({"error": format!("unknown engine command '{other}'"), "supported": ["templates","layouts","metadata","probe"]})),
    }
}

fn create_job(state: Arc<Shared>, body: &str) -> (u16, &'static str, Vec<u8>) {
    let v: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(e) => return json_out(400, json!({"error": e.to_string()})),
    };
    let url = v["url"].as_str().unwrap_or("").trim().to_string();
    let is_local = {
        let p = std::path::Path::new(url.strip_prefix("file:///").or_else(|| url.strip_prefix("file://")).unwrap_or(&url));
        p.is_file()
    };
    if !url.starts_with("http") && !is_local {
        return json_out(400, json!({"error": "paste an http(s) link or valid local video file path"}));
    }
    let max_clips = v["max_clips"].as_u64().unwrap_or(6).min(20) as usize;
    let template = v["template"].as_str().unwrap_or("default").to_string();
    let opts = vod::ClipJobOptions {
        playback_url: v["playback_url"].as_str().map(String::from),
        is_live: v["is_live"].as_bool().unwrap_or(false),
        current_time_sec: v["current_time_sec"].as_f64(),
        lookback_secs: v["lookback_secs"].as_u64(),
        channel: v["channel"].as_str().map(String::from),
        video_title: v["video_title"].as_str().map(String::from),
        platform_hint: v["platform"].as_str().map(String::from),
    };
    let job = state.jobs.lock().unwrap().create(&url);

    // Spawn the real download + transcription + viral clipping pipeline in the background.
    let shared = state;
    let job_for_task = job.clone();
    tokio::spawn(async move {
        run_job(shared, job_for_task, max_clips, template, opts).await;
    });
    json_out(202, json!({"job": job}))
}

fn extension_clip(state: Arc<Shared>, body: &str) -> (u16, &'static str, Vec<u8>) {
    let v: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(e) => return json_out(400, json!({"error": e.to_string()})),
    };
    let url = v["url"].as_str().unwrap_or("").trim().to_string();
    if url.is_empty() {
        return json_out(400, json!({"error": "stream or video url is required"}));
    }
    let channel = v["channel"].as_str().unwrap_or("streamer");
    let platform = v["platform"].as_str().unwrap_or("live");
    let lookback = v["lookback_secs"].as_u64().unwrap_or(30);
    let hype_score = v["hype_score"].as_f64().unwrap_or(0.85);
    let is_live = v["is_live"].as_bool().unwrap_or(false);
    let playback_url = v["playback_url"].as_str().map(String::from);
    let current_time_sec = v["current_time_sec"].as_f64();
    let video_title = v["video_title"].as_str().map(String::from);
    let reasons: Vec<String> = v["reasons"].as_array()
        .map(|arr| arr.iter().filter_map(|r| r.as_str().map(String::from)).collect())
        .unwrap_or_else(|| vec![format!("Hype spike detected ({:.0}%)", hype_score * 100.0)]);

    let job = state.jobs.lock().unwrap().create(&url);
    {
        let mut jobs = state.jobs.lock().unwrap();
        let reason_str = reasons.join(", ");
        let msg = format!("Clip requested via Extension for {channel} ({platform}): {lookback}s - {reason_str}");
        let _ = jobs.update(&job.id, JobStatus::Downloading, 10, &msg);
    }

    let template = v["template"].as_str().unwrap_or("default").to_string();
    let opts = vod::ClipJobOptions {
        playback_url,
        is_live,
        current_time_sec,
        lookback_secs: Some(lookback),
        channel: Some(channel.to_string()),
        video_title,
        platform_hint: Some(platform.to_string()),
    };
    let shared = Arc::clone(&state);
    let job_clone = job.clone();
    tokio::spawn(async move {
        run_job(shared, job_clone, 1, template, opts).await;
    });

    json_out(202, json!({
        "ok": true,
        "job_id": job.id,
        "channel": channel,
        "platform": platform,
        "lookback_secs": lookback,
        "hype_score": hype_score,
        "is_live": is_live,
        "message": format!("PulseCut is clipping {lookback}s for {channel}!")
    }))
}

fn dispatch_monitor_clip(state: Arc<Shared>, req: monitor::MonitorClipRequest) -> String {
    let job = state.jobs.lock().unwrap().create(&req.url);
    {
        let mut jobs = state.jobs.lock().unwrap();
        let reason_str = req.reasons.join(", ");
        let tag = if req.manual { "Direct Monitor (manual)" } else { "Direct Monitor" };
        let msg = format!(
            "Clip requested via {tag} for {} ({}): {}s - {reason_str}",
            req.channel, req.platform, req.lookback_secs
        );
        let _ = jobs.update(&job.id, JobStatus::Downloading, 10, &msg);
    }
    let opts = vod::ClipJobOptions {
        playback_url: req.playback_url,
        is_live: true,
        current_time_sec: None,
        lookback_secs: Some(req.lookback_secs),
        channel: Some(req.channel),
        video_title: None,
        platform_hint: Some(req.platform),
    };
    let job_id = job.id.clone();
    let template = if req.template.trim().is_empty() {
        "default".to_string()
    } else {
        req.template
    };
    tokio::spawn(async move {
        run_job(state, job, 1, template, opts).await;
    });
    job_id
}

async fn start_monitors(state: &Shared, body: &str) -> (u16, &'static str, Vec<u8>) {
    let v: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(e) => return json_out(400, json!({"error": e.to_string()})),
    };

    // Apply optional Kick/YouTube config if supplied alongside monitor start request
    if v.get("kick_pusher_key").is_some()
        || v.get("kick_pusher_cluster").is_some()
        || v.get("kick_bridge_url").is_some()
        || v.get("youtube_api_key").is_some()
    {
        let _ = state
            .monitors()
            .update_config(
                v["kick_pusher_key"].as_str().map(String::from),
                v["kick_pusher_cluster"].as_str().map(String::from),
                v["kick_bridge_url"].as_str().map(String::from),
                v["youtube_api_key"].as_str().map(String::from),
            )
            .await;
    }

    let mut urls: Vec<String> = Vec::new();
    if let Some(arr) = v["urls"].as_array() {
        for item in arr {
            if let Some(s) = item.as_str() {
                let t = s.trim();
                if !t.is_empty() {
                    urls.push(t.to_string());
                }
            }
        }
    }
    if let Some(single) = v["url"].as_str() {
        let t = single.trim();
        if !t.is_empty() {
            urls.push(t.to_string());
        }
    }
    if urls.is_empty() {
        return json_out(400, json!({"error": "provide at least one stream URL in `url` or `urls`"}));
    }

    let template = v["template"].as_str().unwrap_or("default").to_string();
    let lookback_secs = v["lookback_secs"].as_u64().unwrap_or(30);
    let cooldown_secs = v["cooldown_secs"].as_u64().unwrap_or(45);
    let threshold = v["threshold"].as_u64().unwrap_or(55) as u32;
    let auto_clip = v["auto_clip"].as_bool().unwrap_or(true);

    let mut started: Vec<Value> = Vec::new();
    let mut errors: Vec<Value> = Vec::new();

    for raw_url in urls {
        let params = monitor::StartMonitorParams {
            url: raw_url.clone(),
            template: template.clone(),
            lookback_secs,
            cooldown_secs,
            threshold,
            auto_clip,
        };
        match state.monitors().start_monitor(params) {
            Ok(m) => started.push(m),
            Err(err) => errors.push(json!({"url": raw_url, "error": err})),
        }
    }

    let status = if started.is_empty() { 400 } else { 200 };
    json_out(
        status,
        json!({
            "ok": !started.is_empty(),
            "started": started,
            "errors": errors,
            "list": state.monitors().list_json(),
        }),
    )
}

async fn update_monitor_config(state: &Shared, body: &str) -> (u16, &'static str, Vec<u8>) {
    let v: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(e) => return json_out(400, json!({"error": e.to_string()})),
    };
    let out = state
        .monitors()
        .update_config(
            v["kick_pusher_key"].as_str().map(String::from),
            v["kick_pusher_cluster"].as_str().map(String::from),
            v["kick_bridge_url"].as_str().map(String::from),
            v["youtube_api_key"].as_str().map(String::from),
        )
        .await;
    json_out(200, out)
}

fn handle_monitor_item(state: &Shared, method: &str, path: &str, body: &str) -> (u16, &'static str, Vec<u8>) {
    let rest = path.trim_start_matches("/api/monitors/");
    let parts: Vec<&str> = rest.split('/').collect();
    let id = parts[0];
    if id.is_empty() {
        return json_out(400, json!({"error": "monitor id required"}));
    }
    match (method, parts.get(1).copied()) {
        ("POST", Some("pause")) => match state.monitors().set_paused(id, true) {
            Some(m) => json_out(200, json!({"ok": true, "monitor": m})),
            None => json_out(404, json!({"error": "monitor not found"})),
        },
        ("POST", Some("resume")) => match state.monitors().set_paused(id, false) {
            Some(m) => json_out(200, json!({"ok": true, "monitor": m})),
            None => json_out(404, json!({"error": "monitor not found"})),
        },
        ("POST", Some("auto-clip")) => {
            let v: Value = serde_json::from_str(body).unwrap_or_else(|_| json!({}));
            let enabled = v["enabled"].as_bool().unwrap_or(true);
            match state.monitors().set_auto_clip(id, enabled) {
                Some(m) => json_out(200, json!({"ok": true, "monitor": m})),
                None => json_out(404, json!({"error": "monitor not found"})),
            }
        }
        ("POST", Some("clip")) => {
            let v: Value = serde_json::from_str(body).unwrap_or_else(|_| json!({}));
            let lookback = v["lookback_secs"].as_u64();
            match state.monitors().trigger_manual_clip(id, lookback) {
                Some(res) => json_out(202, res),
                None => json_out(404, json!({"error": "monitor not found"})),
            }
        }
        ("DELETE", None) | ("POST", Some("stop")) => {
            if state.monitors().stop_monitor(id) {
                json_out(200, json!({"ok": true, "stopped": id}))
            } else {
                json_out(404, json!({"error": "monitor not found"}))
            }
        }
        _ => json_out(404, json!({"error": "monitor endpoint not found"})),
    }
}

async fn run_job(state: Arc<Shared>, job: Job, max_clips: usize, template: String, opts: vod::ClipJobOptions) {
    if state.job_semaphore.available_permits() == 0 {
        let mut jobs = state.jobs.lock().unwrap();
        let _ = jobs.update(&job.id, JobStatus::Downloading, 5, "queued · waiting for render slot");
    }
    let _permit = match state.job_semaphore.acquire().await {
        Ok(p) => p,
        Err(_) => return,
    };
    state.active_jobs.fetch_add(1, Ordering::Relaxed);
    {
        let mut jobs = state.jobs.lock().unwrap();
        let _ = jobs.update(
            &job.id,
            JobStatus::Downloading,
            10,
            if opts.is_live {
                "capturing live stream lookback"
            } else {
                "downloading highest quality source"
            },
        );
    }
    let state_for_cb = Arc::clone(&state);
    let job_id_for_cb = job.id.clone();
    let result = vod::make_clips_with_options(
        &state.cfg,
        &job.url,
        max_clips,
        &template,
        &state.out,
        state.ai.as_ref(),
        opts,
        move |pct, msg| {
            let status = if pct < 35 { JobStatus::Downloading } else { JobStatus::Clipping };
            if let Ok(mut jobs) = state_for_cb.jobs.lock() {
                let _ = jobs.update(&job_id_for_cb, status, pct, msg);
            }
        },
    )
    .await;
    state.active_jobs.fetch_sub(1, Ordering::Relaxed);
    let mut jobs = state.jobs.lock().unwrap();
    match result {
        Ok(packages) => {
            let ids: Vec<String> = packages.iter().map(|p| p.id.clone()).collect();
            {
                let mut store = state.store.lock().unwrap();
                for pkg in packages {
                    if let Err(e) = store.upsert(pkg) {
                        let _ = jobs.fail(&job.id, &e.to_string());
                        return;
                    }
                }
            }
            let _ = jobs.finish(&job.id, ids);
        }
        Err(e) => { let _ = jobs.fail(&job.id, &e.to_string()); }
    }
}

async fn handle_clip(state: &Shared, method: &str, path: &str, body: &str) -> (u16, &'static str, Vec<u8>) {
    let rest = match path.strip_prefix("/api/clips/") {
        Some(r) => r,
        None => return json_out(404, json!({"error": "not found"})),
    };
    let parts: Vec<&str> = rest.split('/').collect();
    let id = parts[0];
    match (method, parts.get(1).copied()) {
        ("GET", Some("media")) => {
            let pkg = match state.store.lock().unwrap().get(id).cloned() {
                Some(p) => p,
                None => return json_out(404, json!({"error": "clip not found"})),
            };
            match tokio::fs::read(&pkg.video_path).await {
                Ok(bytes) => (200, "video/mp4", bytes),
                Err(e) => json_out(404, json!({"error": e.to_string()})),
            }
        }
        // Full-resolution source segment (pre-crop). The Framing Studio uses
        // this so crop regions can be placed against the complete original
        // frame (e.g. 1920x1080) rather than the already-cropped 9:16 export.
        ("GET", Some("raw-media")) => {
            let pkg = match state.store.lock().unwrap().get(id).cloned() {
                Some(p) => p,
                None => return json_out(404, json!({"error": "clip not found"})),
            };
            let raw = std::path::PathBuf::from(&pkg.raw_video_path);
            if !raw.is_file() {
                return json_out(404, json!({"error": "raw source not found"}));
            }
            // If raw source is already an MP4 container, serve directly without remuxing.
            let is_mp4 = raw
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("mp4"))
                .unwrap_or(false);
            if is_mp4 {
                return match tokio::fs::read(&raw).await {
                    Ok(bytes) => (200, "video/mp4", bytes),
                    Err(e) => json_out(404, json!({"error": e.to_string()})),
                };
            }
            // Cache remuxed MPEG-TS -> MP4 on disk so browser seeks & concurrent
            // requests reuse the same faststart MP4 without racing on a shared temp file.
            static REMUX_SEQ: AtomicUsize = AtomicUsize::new(1);
            let cache_dir = state.out.join("cache");
            let _ = tokio::fs::create_dir_all(&cache_dir).await;
            let cached = cache_dir.join(format!("raw-{id}.mp4"));
            if let Ok(bytes) = tokio::fs::read(&cached).await {
                if !bytes.is_empty() {
                    return (200, "video/mp4", bytes);
                }
            }
            let ffmpeg = match pulsecut_capture::ffmpeg(&state.cfg.capture.ffmpeg_path) {
                Ok(p) => p,
                Err(e) => return json_out(500, json!({"error": e.to_string()})),
            };
            let seq = REMUX_SEQ.fetch_add(1, Ordering::Relaxed);
            let tmp = cache_dir.join(format!("raw-{id}-{seq}.tmp.mp4"));
            let remux = tokio::process::Command::new(&ffmpeg)
                .args(["-y", "-loglevel", "error", "-i"])
                .arg(&raw)
                .args(["-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart"])
                .arg(&tmp)
                .output()
                .await;
            if remux.map(|o| o.status.success()).unwrap_or(false) && tmp.is_file() {
                let _ = tokio::fs::rename(&tmp, &cached).await;
                let serve_path = if cached.is_file() { &cached } else { &tmp };
                if let Ok(bytes) = tokio::fs::read(serve_path).await {
                    if tmp.is_file() {
                        let _ = tokio::fs::remove_file(&tmp).await;
                    }
                    return (200, "video/mp4", bytes);
                }
            }
            let _ = tokio::fs::remove_file(&tmp).await;
            match tokio::fs::read(&raw).await {
                Ok(bytes) => (200, "video/mp2t", bytes),
                Err(e) => json_out(404, json!({"error": e.to_string()})),
            }
        }
        ("GET", None) => {
            let store = state.store.lock().unwrap();
            match store.get(id) {
                Some(pkg) => json_out(200, json!({"clip": pkg, "edl": store.edl(id)})),
                None => json_out(404, json!({"error": "clip not found"})),
            }
        }
        ("POST", Some("approve")) => {
            let result = state.store.lock().unwrap().set_status(id, ClipStatus::Approved);
            match result {
                Ok(_) => json_out(200, json!({"ok": true})),
                Err(e) => json_out(500, json!({"error": e.to_string()})),
            }
        }
        ("POST", Some("reject")) => {
            let result = state.store.lock().unwrap().reject(id);
            match result {
                Ok(_) => json_out(200, json!({"ok": true})),
                Err(e) => json_out(500, json!({"error": e.to_string()})),
            }
        }
        ("POST", Some("delete")) | ("DELETE", None) => {
            let result = state.store.lock().unwrap().delete(id);
            match result {
                Ok(true) => json_out(200, json!({"ok": true})),
                Ok(false) => json_out(404, json!({"error": "clip not found"})),
                Err(e) => json_out(500, json!({"error": e.to_string()})),
            }
        }
        ("POST", Some("edits")) => {
            let ops: Vec<EditOp> = match serde_json::from_str(body) {
                Ok(o) => o,
                Err(e) => return json_out(400, json!({"error": e.to_string()})),
            };
            match state.store.lock().unwrap().append_edits(id, ops) {
                Ok(edl) => json_out(200, json!(edl)),
                Err(e) => json_out(500, json!({"error": e.to_string()})),
            }
        }
        ("POST", Some("configure")) => rerender(state, id, body).await,
        // ---- Automation-agent hooks -------------------------------------
        // Objective verification of a finished short: codec/canvas/duration/
        // bitrate/decode checks + a 0-100 vitality score and QA frame paths.
        ("POST", Some("verify")) => verify_clip_endpoint(state, id).await,
        // Overwrite generated metadata (title/description/hashtags/hook) with
        // researched, emoji-rich captions before publishing.
        ("POST", Some("metadata")) => set_metadata(state, id, body),
        // Publish a single approved clip to the requested targets. Returns one
        // receipt per target. This is the API path for the automation agent.
        ("POST", Some("publish")) => publish_clip(state, id, body).await,
        _ => json_out(404, json!({"error": "not found"})),
    }
}

async fn rerender(state: &Shared, id: &str, body: &str) -> (u16, &'static str, Vec<u8>) {
    let v: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(e) => return json_out(400, json!({"error": e.to_string()})),
    };
    let renderer = match &state.renderer {
        Some(r) => r,
        None => return json_out(500, json!({"error": "ffmpeg not available"})),
    };
    let pkg = match state.store.lock().unwrap().get(id).cloned() {
        Some(p) => p,
        None => return json_out(404, json!({"error": "clip not found"})),
    };
    let template_id = v["template"].as_str().unwrap_or("default").to_string();
    let style = v["subtitle_style"].as_str().unwrap_or("karaoke").to_string();
    let size = match style.as_str() {
        "bold" => 70, "box" => 60, "accent" => 68, _ => 56,
    };
    let (w, h) = match v["aspect"].as_str().unwrap_or("9:16") {
        "1:1" => (1080, 1080),
        "4:5" => (1080, 1350),
        "4:3" => (1440, 1080),
        "16:9" => (1920, 1080),
        _ => (1080, 1920),
    };
    let font = v["font"].as_str().unwrap_or("Inter").to_string();
    let mut ops = vec![
        EditOp::Template { id: template_id.clone() },
        EditOp::SubtitleFont { family: font, size },
        EditOp::Aspect { width: w, height: h },
    ];
    // A template can imply a layout; explicit UI selection wins.
    let layout = v["layout"].as_str().map(str::to_string)
        .or_else(|| pulsecut_render::template_layout(&template_id).map(str::to_string));
    if let Some(preset) = layout {
        ops.push(EditOp::Layout { preset });
    }
    if let Some(mode) = v["canvas"].as_str() {
        ops.push(EditOp::Canvas { mode: mode.to_string() });
    }
    if let Some(hook) = v["hook"].as_str().filter(|s| !s.is_empty()) {
        ops.push(EditOp::Hook { text: hook.to_string(), duration_ms: 2000 });
    }
    if let Some(text) = v["outro"].as_str().filter(|s| !s.is_empty()) {
        ops.push(EditOp::Outro { text: text.to_string(), duration_ms: v["outro_ms"].as_i64().unwrap_or(3000) });
    }
    let is_kick_tpl = matches!(template_id.as_str(), "kick-stream" | "split-stream" | "dual_react");
    let attr_enabled = v["streamer_attribution"]["enabled"].as_bool().unwrap_or(false);
    let attr_platform = v["streamer_attribution"]["platform"].as_str().unwrap_or("auto");
    let attr_handle = v["streamer_attribution"]["handle"].as_str().unwrap_or("").trim();
    if attr_enabled && !attr_handle.is_empty() && (attr_platform == "kick" || (attr_platform == "auto" && is_kick_tpl)) {
        ops.push(EditOp::SocialCard {
            handle: attr_handle.to_string(),
            style: "kick".into(),
        });
    } else if let Some(handle) = v["social"]["handle"].as_str().filter(|s| !s.is_empty()) {
        let style = if is_kick_tpl {
            "kick".to_string()
        } else {
            v["social"]["style"].as_str().unwrap_or("plain").to_string()
        };
        ops.push(EditOp::SocialCard {
            handle: handle.to_string(),
            style,
        });
    } else if let Some(handle) = v["watermark"].as_str().filter(|s| !s.is_empty()) {
        ops.push(EditOp::SocialCard {
            handle: handle.to_string(),
            style: if is_kick_tpl { "kick".into() } else { "plain".into() },
        });
    }
    if v["audio_peak"].as_bool().unwrap_or(false) {
        ops.push(EditOp::AudioPeak { rise_ms: v["audio_peak_ms"].as_i64().unwrap_or(5000), peak: 0.8 });
    }
    if let Some(trim_start) = v["in_ms"].as_i64().or_else(|| v["trim_start_ms"].as_i64()) {
        let trim_end = v["out_ms"].as_i64().or_else(|| v["trim_end_ms"].as_i64())
            .unwrap_or(pkg.source_window.end_ms);
        ops.push(EditOp::Trim { start_ms: trim_start, end_ms: trim_end });
    }
    let mut edl = state.store.lock().unwrap().edl(id);
    for op in &ops { edl.push(op.clone()); }
    let _ = state.store.lock().unwrap().append_edits(id, ops);

    let raw = PathBuf::from(&pkg.raw_video_path);
    let raw_to_use = if raw.is_file() {
        raw
    } else {
        PathBuf::from(&pkg.video_path)
    };
    let final_path = PathBuf::from(&pkg.video_path);
    let ass = state.out.join("subs").join(format!("{id}.ass"));
    let trim_ms = edl.ops.iter().rev().find_map(|op| match op {
        EditOp::Trim { start_ms, .. } => Some(*start_ms),
        _ => None,
    }).unwrap_or(0);
    // Avoid FFmpeg in-place overwrite errors when raw source falls back to final_path.
    let render_target = if raw_to_use == final_path {
        final_path.with_extension("rerender.tmp.mp4")
    } else {
        final_path.clone()
    };
    if let Err(e) = renderer.render(&raw_to_use, &pkg.words, &edl, &ass, &render_target, trim_ms).await {
        if render_target != final_path {
            let _ = tokio::fs::remove_file(&render_target).await;
        }
        return json_out(500, json!({"error": e.to_string()}));
    }
    if render_target != final_path {
        if let Err(e) = tokio::fs::rename(&render_target, &final_path).await {
            let _ = tokio::fs::remove_file(&render_target).await;
            return json_out(500, json!({"error": format!("failed to finalize rerender: {e}")}));
        }
    }
    let mut updated = pkg;
    updated.template = template_id;
    updated.caption_style = style;
    updated.status = ClipStatus::Ready;
    if let Err(e) = state.store.lock().unwrap().upsert(updated.clone()) {
        return json_out(500, json!({"error": e.to_string()}));
    }
    json_out(200, json!({"clip": updated}))
}

// ---------------------------------------------------------------------------
// Automation-agent hooks: verification, metadata, publishing
// ---------------------------------------------------------------------------

fn resolve_ffprobe(ffmpeg: &Path) -> PathBuf {
    if let Ok(env_path) = std::env::var("PULSECUT_FFPROBE") {
        let p = PathBuf::from(env_path.trim());
        if !env_path.trim().is_empty() && p.is_file() {
            return p;
        }
    }
    let sibling = ffmpeg.with_file_name(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" });
    if sibling.is_file() {
        return sibling;
    }
    PathBuf::from(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" })
}

/// De-duplicated: real implementation lives in `pulsecut_verify`.
fn has_mp4_faststart(path: &Path) -> bool { pulsecut_verify::has_mp4_faststart(path) }

/// Measure mean audio loudness (dB) via FFmpeg `volumedetect` asynchronously.
async fn probe_mean_volume_db(ffmpeg: &Path, path: &Path) -> Option<f64> {
    let out = tokio::process::Command::new(ffmpeg)
        .args(["-hide_banner", "-v", "info", "-i"])
        .arg(path)
        .args(["-af", "volumedetect", "-vn", "-sn", "-dn", "-f", "null", "-"])
        .output()
        .await
        .ok()?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    for line in stderr.lines() {
        if let Some(pos) = line.find("mean_volume:") {
            let after = line[pos + "mean_volume:".len()..].trim();
            if let Some(token) = after.split_whitespace().next() {
                if let Ok(db) = token.parse::<f64>() {
                    return Some(db);
                }
            }
        }
    }
    None
}

fn default_token_env_for_publisher() -> &'static str {
    match std::env::var("PULSECUT_PUBLISHER").unwrap_or_else(|_| "woopsocial".into()).as_str() {
        "uploadpost" => "PULSECUT_UPLOADPOST_TOKEN",
        "postiz" => "PULSECUT_POSTIZ_TOKEN",
        "direct" => "PULSECUT_YOUTUBE_TOKEN",
        "tiktok_direct" => "PULSECUT_TIKTOK_TOKEN",
        "instagram_direct" => "PULSECUT_IG_TOKEN",
        _ => "PULSECUT_WOOPSOCIAL_TOKEN",
    }
}

/// Objective verification of a finished short. Returns a 0-100 vitality score
/// (exact 100-point rubric) and any failed checks, plus 3 QA frames via ffmpeg.
async fn verify_clip_endpoint(state: &Shared, id: &str) -> (u16, &'static str, Vec<u8>) {
    let pkg = match state.store.lock().unwrap().get(id).cloned() {
        Some(p) => p,
        None => return json_out(404, json!({"error": "clip not found"})),
    };
    let ffmpeg = match pulsecut_capture::ffmpeg(&state.cfg.capture.ffmpeg_path) {
        Ok(p) => p,
        Err(e) => return json_out(500, json!({"error": e.to_string()})),
    };
    let ffprobe = resolve_ffprobe(&ffmpeg);
    let out = tokio::process::Command::new(&ffprobe)
        .args(["-v", "error", "-show_streams", "-show_format", "-of", "json"])
        .arg(&pkg.video_path)
        .output()
        .await;
    let raw = match out {
        Ok(o) if o.status.success() => o.stdout,
        Ok(o) => return json_out(500, json!({"error": String::from_utf8_lossy(&o.stderr).to_string()})),
        Err(e) => return json_out(500, json!({"error": e.to_string()})),
    };
    let meta: Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(e) => return json_out(500, json!({"error": format!("ffprobe parse: {e}")})),
    };
    let streams = meta.get("streams").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let v = streams.iter().find(|s| s.get("codec_type").and_then(|x| x.as_str()) == Some("video"));
    let a = streams.iter().find(|s| s.get("codec_type").and_then(|x| x.as_str()) == Some("audio"));
    let num = |s: Option<&Value>| -> u64 { s.and_then(|x| x.as_str()).and_then(|x| x.parse().ok()).unwrap_or(0) };
    let w = v.and_then(|s| s.get("width")).and_then(|x| x.as_u64()).unwrap_or(0) as u32;
    let h = v.and_then(|s| s.get("height")).and_then(|x| x.as_u64()).unwrap_or(0) as u32;
    let abr = num(a.and_then(|s| s.get("bit_rate")));
    let fmt_br = num(meta.get("format").and_then(|f| f.get("bit_rate")));
    let stream_vbr = num(v.and_then(|s| s.get("bit_rate")));
    let vbr = if stream_vbr > 0 { stream_vbr } else { fmt_br.saturating_sub(abr) };
    let dur = meta.get("format").and_then(|f| f.get("duration")).and_then(|x| x.as_str())
        .and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
    let vcodec = v.and_then(|s| s.get("codec_name")).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let acodec = a.and_then(|s| s.get("codec_name")).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let fps = v.and_then(|s| s.get("r_frame_rate")).and_then(|x| x.as_str()).unwrap_or("").to_string();

    // Score via the shared, unit-tested rubric in `pulsecut_verify`
    // (migrated from automation/verify_clip.py — single source of truth).
    let metrics = pulsecut_verify::ProbeMetrics {
        width: w, height: h, duration_s: dur, fps: fps.clone(),
        video_bitrate: vbr, audio_bitrate: abr,
        video_codec: vcodec.clone(), audio_codec: acodec.clone(), has_audio: a.is_some(),
    };
    let dec = tokio::process::Command::new(&ffmpeg)
        .args(["-v", "error", "-i"]).arg(&pkg.video_path)
        .args(["-f", "null", "-"]).output().await;
    let clean = dec.as_ref().map(|o| o.status.success() && o.stderr.is_empty()).unwrap_or(false);
    let faststart = has_mp4_faststart(Path::new(&pkg.video_path));
    let mean_volume_db = probe_mean_volume_db(&ffmpeg, Path::new(&pkg.video_path)).await;
    let audible = mean_volume_db.map(|db| db > -50.0).unwrap_or(false);
    let extra = pulsecut_verify::ExtraSignals { decode_clean: clean, faststart, audible };
    let verdict = pulsecut_verify::rubric(&metrics, &extra);
    let score = verdict.score;
    let reasons = verdict.reasons;
    let hard_failed = verdict.hard_failed;

    let frames_dir = state.out.join("qa").join(id);
    let _ = tokio::fs::create_dir_all(&frames_dir).await;
    let mut frames = Vec::new();
    for (pct, label) in [(0.15_f64, "start"), (0.5, "mid"), (0.85, "end")] {
        let path = frames_dir.join(format!("{label}.jpg"));
        let ok = tokio::process::Command::new(&ffmpeg)
            .args(["-y", "-loglevel", "error", "-ss"]).arg(format!("{:.2}", dur * pct))
            .arg("-i").arg(&pkg.video_path).args(["-frames:v", "1"]).arg(&path)
            .output().await.map(|o| o.status.success()).unwrap_or(false);
        if ok { frames.push(format!("/api/qa/{id}/{label}.jpg")); }
    }
    json_out(200, json!({
        "clip_id": id,
        "status": pkg.status,
        "ok": score >= 75 && !hard_failed,
        "vitality_score": score,
        "viral_score": pkg.confidence,
        "viral_reason": pkg.source_window.snap_reason,
        "has_transcript": !pkg.words.is_empty(),
        "word_count": pkg.words.len(),
        "metrics": {
            "width": w, "height": h, "duration_s": dur, "fps": fps,
            "video_bitrate_mbps": vbr as f64 / 1e6,
            "audio_bitrate_kbps": abr / 1000,
            "video_codec": vcodec, "audio_codec": acodec,
            "faststart": faststart,
            "mean_volume_db": mean_volume_db
        },
        "reasons": reasons,
        "sample_frames": frames
    }))
}

/// Overwrite a clip's metadata with researched captions/hashtags (and optional hook).
fn set_metadata(state: &Shared, id: &str, body: &str) -> (u16, &'static str, Vec<u8>) {
    let v: Value = match serde_json::from_str(body) {
        Ok(x) => x,
        Err(e) => return json_out(400, json!({"error": e.to_string()})),
    };
    let mut pkg = match state.store.lock().unwrap().get(id).cloned() {
        Some(p) => p,
        None => return json_out(404, json!({"error": "clip not found"})),
    };
    if let Some(t) = v.get("title").and_then(|x| x.as_str()) { pkg.title = t.to_string(); }
    if let Some(d) = v.get("description").and_then(|x| x.as_str()) { pkg.description = d.to_string(); }
    if let Some(tags) = v.get("hashtags").and_then(|x| x.as_array()) {
        pkg.hashtags = tags.iter().filter_map(|x| x.as_str())
            .map(|s| s.trim_start_matches('#').to_string())
            .filter(|s| !s.is_empty())
            .collect();
    }
    let hook_text = v.get("hook").and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    {
        let mut store = state.store.lock().unwrap();
        if let Err(e) = store.upsert(pkg.clone()) {
            return json_out(500, json!({"error": e.to_string()}));
        }
        if let Some(hook) = hook_text {
            let dur = pkg.source_window.duration_ms().max(4_000);
            let _ = store.append_edits(id, vec![EditOp::Hook { text: hook, duration_ms: dur }]);
        }
    }
    json_out(200, json!({"ok": true, "clip": pkg}))
}

/// Publish one clip to the requested target platforms.
/// Enforces the approval gate (unless `auto_approve` or `force: true`) and
/// blocks accidental double-publishing (returns 409 unless `force: true`).
async fn publish_clip(state: &Shared, id: &str, body: &str) -> (u16, &'static str, Vec<u8>) {
    let v: Value = serde_json::from_str(body).unwrap_or_else(|_| json!({}));
    let force = v.get("force").and_then(|x| x.as_bool()).unwrap_or(false);
    let targets: Vec<String> = v.get("targets").and_then(|x| x.as_array())
        .and_then(|a| a.iter().map(|x| x.as_str().map(String::from)).collect::<Option<Vec<_>>>())
        .unwrap_or_else(|| state.cfg.publishing.targets.iter()
            .filter(|t| t.enabled).map(|t| t.id.clone()).collect());
    if targets.is_empty() {
        return json_out(400, json!({"ok": false, "error": "no publishing targets specified or enabled"}));
    }
    let token_env = v.get("token_env")
        .and_then(|x| x.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(String::from)
        .unwrap_or_else(|| default_token_env_for_publisher().to_string());
    let pkg = match state.store.lock().unwrap().get(id).cloned() {
        Some(p) => p,
        None => return json_out(404, json!({"error": "clip not found"})),
    };
    if !force && pkg.status == ClipStatus::Published {
        return json_out(409, json!({
            "ok": false,
            "error": "clip is already published",
            "hint": "pass {\"force\": true} to intentionally republish"
        }));
    }
    if !force && !state.cfg.publishing.auto_approve && pkg.status != ClipStatus::Approved {
        return json_out(412, json!({
            "ok": false,
            "error": format!("clip status is {:?}; approve the clip before publishing", pkg.status),
            "hint": "call POST /api/clips/{id}/approve first (or pass {\"force\": true})"
        }));
    }
    let job = PublishJob { package: pkg, targets: targets.clone(), token_env };
    let pubber = publisher(&state.cfg);
    match pubber.publish(&job).await {
        Ok(receipts) => {
            let all_ok = !receipts.is_empty() && receipts.iter().all(|r| r.ok);
            let any_ok = receipts.iter().any(|r| r.ok);
            let next_status = if any_ok { ClipStatus::Published } else { ClipStatus::Failed };
            let _ = state.store.lock().unwrap().set_status(id, next_status);
            json_out(200, json!({
                "ok": all_ok,
                "partial": any_ok && !all_ok,
                "publisher": pubber.name(),
                "receipts": receipts
            }))
        }
        Err(e) => {
            let msg = e.to_string();
            let lower = msg.to_ascii_lowercase();
            let is_missing_config = lower.contains("missing ")
                || lower.contains("token")
                || lower.contains("not set")
                || lower.contains("env var");
            if !is_missing_config {
                let _ = state.store.lock().unwrap().set_status(id, ClipStatus::Failed);
            }
            json_out(502, json!({
                "ok": false,
                "error": msg,
                "status_preserved": is_missing_config,
                "hint": "set the platform token env var (e.g. PULSECUT_WOOPSOCIAL_TOKEN / PULSECUT_IG_TOKEN + PULSECUT_IG_USER_ID / PULSECUT_YOUTUBE_TOKEN)"
            }))
        }
    }
}

// ---------------------------------------------------------------------------
// Minimal Backend Engine Status Page (Full Studio UI runs on the React frontend)
// ---------------------------------------------------------------------------

fn index_html() -> &'static str {
    r##"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PulseCut Engine · Backend API</title>
<style>
  :root{--bg:#0b0c0f;--panel:#13151a;--border:#232732;--ink:#f4f5f7;--sub:#9ba3b4;--accent:#53fc18;--blue:#3b82f6}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  main{width:100%;max-width:640px;background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:24px}
  header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}
  h1{margin:0;font-size:18px;font-weight:700;letter-spacing:-.01em}
  .sub{margin:4px 0 0;font-size:13px;color:var(--sub)}
  .badge{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;background:#102213;color:var(--accent);border:1px solid #1f4d26}
  .dot{width:7px;height:7px;border-radius:50%;background:var(--accent)}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0 20px}
  .stat{background:#0e1014;border:1px solid var(--border);border-radius:10px;padding:12px}
  .stat .label{font-size:11px;color:var(--sub);text-transform:uppercase;letter-spacing:.04em}
  .stat .val{font-size:22px;font-weight:700;margin-top:4px;font-variant-numeric:tabular-nums}
  .cta{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:9px;background:var(--ink);color:#0b0c0f;text-decoration:none;font-size:13px;font-weight:600}
  .cta:hover{opacity:.92}
  .endpoints{margin-top:20px;padding-top:16px;border-top:1px solid var(--border)}
  .endpoints h2{margin:0 0 10px;font-size:12px;color:var(--sub);text-transform:uppercase;letter-spacing:.05em}
  ul{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--sub)}
  li{display:flex;justify-content:space-between;gap:12px;padding:6px 8px;border-radius:6px;background:#0e1014}
  code{color:var(--ink)}
</style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>PulseCut Engine</h1>
        <p class="sub">Local Rust + FFmpeg backend API. Use the Studio frontend for clipping, live graphs, framing, and shorts.</p>
      </div>
      <span class="badge" id="status-badge"><span class="dot"></span><span id="status-text">Online</span></span>
    </header>

    <div class="stats">
      <div class="stat"><div class="label">Clips</div><div class="val" id="stat-clips">—</div></div>
      <div class="stat"><div class="label">Active Jobs</div><div class="val" id="stat-jobs">—</div></div>
      <div class="stat"><div class="label">Live Monitors</div><div class="val" id="stat-monitors">—</div></div>
    </div>

    <a class="cta" id="studio-link" href="http://localhost:3000">Open PulseCut Studio &rarr;</a>

    <section class="endpoints">
      <h2>REST API Endpoints</h2>
      <ul>
        <li><code>GET /health</code><span>Health &amp; clip count</span></li>
        <li><code>GET|POST /api/monitors</code><span>Direct multi-stream chat monitors</span></li>
        <li><code>GET|POST /api/jobs</code><span>VOD &amp; live ingest jobs</span></li>
        <li><code>GET /api/clips</code><span>Generated clips library</span></li>
        <li><code>POST /api/clips/{id}/configure</code><span>Re-render short &amp; template</span></li>
        <li><code>POST /api/clips/{id}/verify</code><span>QA rubric &amp; sample frames</span></li>
      </ul>
    </section>
  </main>
  <script>
    const params = new URLSearchParams(location.search);
    if (params.get('studio')) document.getElementById('studio-link').href = params.get('studio');
    async function refresh() {
      try {
        const [st, mon] = await Promise.all([
          fetch('/api/extension/status').then(r => r.json()),
          fetch('/api/monitors').then(r => r.json())
        ]);
        document.getElementById('stat-clips').textContent = st.clips ?? 0;
        document.getElementById('stat-jobs').textContent = st.active_jobs ?? 0;
        document.getElementById('stat-monitors').textContent = mon.count ?? (mon.monitors || []).length;
        document.getElementById('status-text').textContent = 'Online · v' + (st.version || '0.1');
      } catch (_) {
        document.getElementById('status-text').textContent = 'Reconnecting…';
      }
    }
    refresh();
    setInterval(refresh, 4000);
  </script>
</body>
</html>"##
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_byte_range_handles_standard_suffix_and_invalid() {
        assert_eq!(parse_byte_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_byte_range("bytes=500-", 1000), Some((500, 999)));
        assert_eq!(parse_byte_range("bytes=0-9999", 1000), Some((0, 999)));
        assert_eq!(parse_byte_range("bytes=-200", 1000), Some((800, 999)));
        assert_eq!(parse_byte_range("bytes=1000-1001", 1000), None);
        assert_eq!(parse_byte_range("bytes=200-100", 1000), None);
        assert_eq!(parse_byte_range("bytes=0-10", 0), None);
    }
}
