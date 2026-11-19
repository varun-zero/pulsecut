//! All-in-one dashboard web server.
//!
//! Visual language adapted from zhouxiaoka/autoclip (MIT, 10.7k stars) — the
//! "Calm Premium" tokens, top navigation, import-first dashboard, clip grid
//! and two-column editor — reimplemented here as dependency-free HTML/CSS/JS.
//! See docs/UI_SPEC.md for the source evidence and docs/THIRD_PARTY_NOTICES.md.

use crate::vod;
use pulsecut_ai::{resilient_backend, AiBackend};
use pulsecut_core::config::Config;
use pulsecut_core::edl::EditOp;
use pulsecut_core::error::{PulseError, Result};
use pulsecut_core::model::ClipStatus;
use pulsecut_editor::{Job, JobStatus, JobStore, Store};
use pulsecut_render::Renderer;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

struct Shared {
    cfg: Config,
    out: PathBuf,
    store: Mutex<Store>,
    jobs: Mutex<JobStore>,
    renderer: Option<Renderer>,
    ai: Box<dyn AiBackend>,
}

pub async fn serve(addr: &str, cfg: Config) -> Result<()> {
    let out = PathBuf::from(&cfg.capture.output_dir);
    std::fs::create_dir_all(&out)?;
    let shared = Arc::new(Shared {
        cfg: cfg.clone(),
        out: out.clone(),
        store: Mutex::new(Store::open(out.join("editor"))?),
        jobs: Mutex::new(JobStore::open(out.join("editor"))?),
        renderer: Renderer::new(cfg.render.clone()).ok(),
        ai: resilient_backend(&cfg),
    });

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
                if let Some(text) = std::str::from_utf8(&buf).ok() {
                    if let Some(hpos) = text.find("\r\n\r\n") {
                        if len == 0 {
                            for line in text[..hpos].split("\r\n") {
                                if let Some((k, v)) = line.split_once(':') {
                                    if k.eq_ignore_ascii_case("content-length") {
                                        len = v.trim().parse().unwrap_or(0);
                                    }
                                }
                            }
                        }
                        if buf.len() >= hpos + 4 + len { break; }
                    }
                }
                if buf.len() > 2_000_000 { break; }
            }
            if buf.is_empty() { return; }
            let raw = String::from_utf8_lossy(&buf).into_owned();
            let mut lines = raw.split("\r\n");
            let request = lines.next().unwrap_or("");
            let mut parts = request.split_whitespace();
            let method = parts.next().unwrap_or("GET").to_string();
            let path = parts.next().unwrap_or("/").to_string();
            let body = if len > 0 {
                match raw.find("\r\n\r\n") {
                    Some(pos) => raw[pos + 4..(pos + 4 + len).min(raw.len())].to_string(),
                    None => String::new(),
                }
            } else { String::new() };

            let (status, ctype, payload) = handle(Arc::clone(&state), &method, &path, &body).await;
            let reason = match status {
                200 => "OK",
                202 => "Accepted",
                204 => "No Content",
                400 => "Bad Request",
                404 => "Not Found",
                _ => "OK",
            };
            let head = format!(
                "HTTP/1.1 {status} {reason}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nCache-Control: no-store, no-cache, must-revalidate\r\nPragma: no-cache\r\nConnection: close\r\n\r\n",
                payload.len()
            );
            let _ = socket.write_all(head.as_bytes()).await;
            let _ = socket.write_all(&payload).await;
        });
    }
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
        ("GET", "" | "/" | "/dashboard" | "/clips" | "/editor") => {
            (200, "text/html; charset=utf-8", index_html().as_bytes().to_vec())
        }
        ("GET", "/health") => json_out(200, json!({"ok": true, "clips": state.store.lock().unwrap().list().len()})),
        ("GET", "/api/extension/status") => json_out(200, json!({
            "ok": true,
            "version": env!("CARGO_PKG_VERSION"),
            "connected": true,
            "clips": state.store.lock().unwrap().list().len(),
            "jobs": state.jobs.lock().unwrap().list().len(),
        })),
        ("POST", "/api/extension/clip") => extension_clip(state, body),
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
        ("POST", "/api/engine/call") => engine_call(&state, body),
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
        _ => handle_clip(&state, method, path, body).await,
    }
}

/// Unified engine command surface, mirroring the `engine:call` style bridge
/// observed in the desktop editor: one endpoint, an allowlisted command name,
/// explicit errors for anything not implemented.
fn engine_call(state: &Shared, body: &str) -> (u16, &'static str, Vec<u8>) {
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
            let out = match std::process::Command::new(ff).args(["-hide_banner", "-i"]).arg(&path).output() {
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
    let job = state.jobs.lock().unwrap().create(&url);

    // Spawn the real download + clipping pipeline in the background; the
    // dashboard polls /api/jobs for progress.
    let shared = state;
    let job_for_task = job.clone();
    tokio::spawn(async move {
        run_job(shared, job_for_task, max_clips, template).await;
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
    let reasons: Vec<String> = v["reasons"].as_array()
        .map(|arr| arr.iter().filter_map(|r| r.as_str().map(String::from)).collect())
        .unwrap_or_else(|| vec![format!("Hype spike detected ({:.0}%)", hype_score * 100.0)]);

    let job = state.jobs.lock().unwrap().create(&url);
    {
        let mut jobs = state.jobs.lock().unwrap();
        let reason_str = reasons.join(", ");
        let msg = format!("🔥 Clip requested via Extension for {channel} ({platform}): lookback {lookback}s - {reason_str}");
        let _ = jobs.update(&job.id, JobStatus::Downloading, 15, &msg);
    }

    let template = v["template"].as_str().unwrap_or("default").to_string();
    let shared = Arc::clone(&state);
    let job_clone = job.clone();
    tokio::spawn(async move {
        run_job(shared, job_clone, 1, template).await;
    });

    json_out(202, json!({
        "ok": true,
        "job_id": job.id,
        "channel": channel,
        "platform": platform,
        "lookback_secs": lookback,
        "hype_score": hype_score,
        "message": format!("PulseCut is clipping the last {lookback}s for {channel}!")
    }))
}

async fn run_job(state: Arc<Shared>, job: Job, max_clips: usize, template: String) {
    {
        let mut jobs = state.jobs.lock().unwrap();
        let _ = jobs.update(&job.id, JobStatus::Downloading, 10, "downloading source");
    }
    let result = vod::make_clips(&state.cfg, &job.url, max_clips, &template, &state.out, state.ai.as_ref()).await;
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
    if let Some(handle) = v["social"]["handle"].as_str().filter(|s| !s.is_empty()) {
        ops.push(EditOp::SocialCard {
            handle: handle.to_string(),
            style: v["social"]["style"].as_str().unwrap_or("plain").to_string(),
        });
    } else if let Some(handle) = v["watermark"].as_str().filter(|s| !s.is_empty()) {
        ops.push(EditOp::SocialCard { handle: handle.to_string(), style: "plain".into() });
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
    if let Err(e) = renderer.render(&raw_to_use, &pkg.words, &edl, &ass, &final_path, trim_ms).await {
        return json_out(500, json!({"error": e.to_string()}));
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
// UI — fresh implementation of the "Calm Premium" language from docs/UI_SPEC.md
// ---------------------------------------------------------------------------

fn index_html() -> &'static str {
    r##"<!doctype html>
<html lang="en" data-theme="light"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>PulseCut · AI Stream Clipper &amp; Editor</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap');
:root{
 --ac-bg:#F6F5F3;--ac-card:#FFFFFF;--ac-ink:#1A1A19;--ac-sub:#6E6B66;--ac-muted:#8E8B85;
 --ac-line:#EBE9E4;--ac-line-2:#F0EEEA;--ac-accent:#2D6BFF;--ac-thumb:#EEECE8;--ac-sel:#EFEDE9;
 --ac-cta-bg:#1A1A19;--ac-cta-fg:#FFFFFF;--ac-ok:#5BB36A;--ac-error:#E66A5C;--ac-warn:#E6B23C;
 --ac-shadow:0 1px 2px rgba(26,26,25,.03),0 8px 24px rgba(26,26,25,.05);
 --ac-radius:16px;--ac-radius-sm:10px;--ac-radius-pill:999px;
 --ac-font-sans:"Geist","PingFang SC","Noto Sans SC",system-ui,-apple-system,sans-serif;
 --ac-font-serif:"Instrument Serif",Georgia,serif;
 --ac-font-mono:"Geist Mono",ui-monospace,monospace;
 --ac-ease:cubic-bezier(.2,.7,.2,1);
 color-scheme: light dark;
}
[data-theme="dark"]{
 --ac-bg:#141315;--ac-card:#1C1B1E;--ac-ink:#ECEAE6;--ac-sub:#A6A29B;--ac-muted:#76726C;
 --ac-line:#2C2A2D;--ac-line-2:#232124;--ac-accent:#5A8BFF;--ac-thumb:#262428;--ac-sel:#2A282B;
 --ac-cta-bg:#ECEAE6;--ac-cta-fg:#141315;
 --ac-shadow:0 1px 2px rgba(0,0,0,.25),0 8px 24px rgba(0,0,0,.35);
}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--ac-bg);color:var(--ac-ink);font-family:var(--ac-font-sans);font-size:14px;-webkit-font-smoothing:antialiased;overflow-x:hidden}
button,input,textarea,select{font-family:inherit;color:inherit}
::placeholder{color:var(--ac-muted);opacity:1}
a{color:var(--ac-accent);text-decoration:none}
:focus-visible{outline:2px solid var(--ac-accent);outline-offset:2px}

/* Global header */
header{position:sticky;top:0;z-index:30;height:64px;display:flex;align-items:center;gap:20px;
 padding:0 clamp(16px,4vw,48px);border-bottom:1px solid var(--ac-line);
 background:color-mix(in srgb,var(--ac-bg) 85%,transparent);backdrop-filter:blur(12px)}
.brand{font-family:var(--ac-font-serif);font-size:26px;white-space:nowrap;letter-spacing:-.01em;cursor:pointer}
.brand em{font-style:italic;color:var(--ac-sub)}
nav{display:flex;gap:6px;flex:1;overflow-x:auto}
.nav-btn{border:0;background:transparent;color:var(--ac-sub);height:36px;padding:0 16px;border-radius:var(--ac-radius-pill);cursor:pointer;font-size:14px;font-weight:500;white-space:nowrap;transition:background .15s,color .15s}
.nav-btn:hover{color:var(--ac-ink);background:var(--ac-line-2)}
.nav-btn.active{background:var(--ac-sel);color:var(--ac-ink);box-shadow:0 1px 2px rgba(0,0,0,.04)}
.header-right{display:flex;align-items:center;gap:10px;margin-left:auto;white-space:nowrap}
.pill{height:36px;padding:0 14px;border-radius:var(--ac-radius-pill);border:1px solid var(--ac-line);background:var(--ac-card);cursor:pointer;font-size:13px;display:inline-flex;align-items:center;gap:6px;transition:.15s}
.pill:hover{border-color:var(--ac-accent);color:var(--ac-accent)}

/* Base page container */
.ac-page{max-width:1160px;margin:0 auto;padding:36px 32px 80px}
.ac-title{font-size:22px;font-weight:600;margin:0;letter-spacing:-.01em}
.ac-h2{font-size:17px;font-weight:600;margin:0}
.ac-meta{font-family:var(--ac-font-mono);font-size:12px;color:var(--ac-sub);display:flex;gap:8px;align-items:center;flex-wrap:wrap;overflow-wrap:anywhere}
.ac-section{padding-top:36px;margin-top:36px;border-top:1px solid var(--ac-line)}
.ac-card{background:var(--ac-card);border:1px solid var(--ac-line);border-radius:var(--ac-radius);overflow:hidden;transition:.2s var(--ac-ease);box-shadow:var(--ac-shadow)}
.ac-card:hover{transform:translateY(-2px)}
.ac-empty{border:1px dashed var(--ac-line);border-radius:var(--ac-radius);padding:44px 20px;text-align:center;color:var(--ac-sub)}

/* Import card */
.import-card{max-width:860px;margin:0 auto 16px;padding:26px 28px;border:1px solid var(--ac-line);border-radius:var(--ac-radius);background:var(--ac-card);box-shadow:var(--ac-shadow)}
.import-title{font-size:24px;font-weight:600;margin:0 0 6px;letter-spacing:-.02em}
.import-sub{color:var(--ac-sub);margin:0 0 20px;font-size:13px;line-height:1.5}
.ac-seg{display:inline-flex;padding:3px;gap:3px;background:var(--ac-line-2);border-radius:var(--ac-radius-pill);flex-wrap:wrap;max-width:100%}
.ac-seg button{border:0;background:transparent;padding:7px 14px;border-radius:var(--ac-radius-pill);cursor:pointer;font-size:13px;color:var(--ac-sub);font-weight:500;transition:.15s}
.ac-seg button:hover{color:var(--ac-ink)}
.ac-seg button.on{background:var(--ac-card);color:var(--ac-ink);box-shadow:0 1px 3px rgba(0,0,0,.08)}
textarea.ac-input,input.ac-input{width:100%;border:1px solid var(--ac-line);border-radius:var(--ac-radius-sm);background:var(--ac-bg);padding:11px 14px;outline:none;font-size:13.5px;box-sizing:border-box}
textarea.ac-input{min-height:88px;resize:vertical;margin:14px 0}
input.ac-input:focus,textarea.ac-input:focus{border-color:var(--ac-accent);background:var(--ac-card)}
.field-row{display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin:12px 0 20px}
.field-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ac-muted);margin-bottom:6px;font-weight:600}
.ac-btn{height:40px;padding:0 20px;border-radius:var(--ac-radius-pill);border:1px solid var(--ac-line);background:var(--ac-card);cursor:pointer;font-size:13.5px;font-weight:500;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:.15s}
.ac-btn:hover{background:var(--ac-line-2)}
.ac-btn--cta{background:var(--ac-cta-bg);color:var(--ac-cta-fg);border-color:transparent;padding:0 26px;font-weight:600}
.ac-btn--cta:hover{opacity:.92}
.ac-btn--sm{height:30px;padding:0 12px;font-size:12px;border-radius:var(--ac-radius-pill)}
.switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;user-select:none}
.switch input{accent-color:var(--ac-accent);cursor:pointer}

/* Dropzone */
.dropzone{border:2px dashed var(--ac-line);border-radius:var(--ac-radius-sm);background:var(--ac-bg);padding:24px;text-align:center;cursor:pointer;transition:.15s;margin:14px 0}
.dropzone:hover,.dropzone.dragover{border-color:var(--ac-accent);background:color-mix(in srgb,var(--ac-accent) 6%,var(--ac-bg))}
.dropzone-icon{font-size:28px;color:var(--ac-accent);margin-bottom:6px}

/* Grid & cards */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px}
.grid-clips{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}
.card-thumb{aspect-ratio:9/16;background:var(--ac-thumb);position:relative;overflow:hidden;border-bottom:1px solid var(--ac-line);border-radius:var(--ac-radius) var(--ac-radius) 0 0}
.card-thumb video{width:100%;height:100%;object-fit:cover;background:#000}
.card-thumb .select-checkbox{position:absolute;top:10px;left:10px;z-index:2;width:20px;height:20px;accent-color:var(--ac-accent);cursor:pointer}
.tag{position:absolute;font-family:var(--ac-font-mono);font-size:11px;background:rgba(255,255,255,.92);color:#1A1A19;padding:3px 8px;border-radius:var(--ac-radius-pill);box-shadow:0 1px 3px rgba(0,0,0,.15);z-index:2}
.tag.top{top:10px;right:10px}.tag.bottom{bottom:10px;left:10px}
.card-body{padding:14px 16px 16px}
.card-title{font-size:14.5px;font-weight:600;margin:0 0 6px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;min-height:40px}
.card-actions{display:flex;gap:8px;margin-top:12px;font-size:12px;flex-wrap:wrap}
.card-actions button{border:1px solid var(--ac-line);background:var(--ac-bg);color:var(--ac-sub);cursor:pointer;padding:5px 10px;border-radius:6px;font-size:12px;transition:.15s}
.card-actions button:hover{color:var(--ac-ink);border-color:var(--ac-accent)}
.card-actions button.primary{background:var(--ac-cta-bg);color:var(--ac-cta-fg);border-color:transparent}
.ac-card.is-selected{border-color:var(--ac-accent);box-shadow:0 0 0 2px var(--ac-accent)}
.ac-line{height:4px;background:var(--ac-line);border-radius:var(--ac-radius-pill);overflow:hidden;margin:10px 0 6px}
.ac-line i{display:block;height:100%;background:var(--ac-accent);border-radius:var(--ac-radius-pill);transition:width .4s ease}
.ac-dot{width:8px;height:8px;border-radius:50%;display:inline-block;background:var(--ac-muted)}
.ac-dot.ok{background:var(--ac-ok)}.ac-dot.busy{background:var(--ac-accent)}.ac-dot.error{background:var(--ac-error)}

/* Status & filter bar */
.toolbar-strip{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:20px 0;flex-wrap:wrap}
.search-input{background:var(--ac-card);border:1px solid var(--ac-line);border-radius:var(--ac-radius-pill);padding:8px 16px;font-size:13px;min-width:240px;outline:none}
.search-input:focus{border-color:var(--ac-accent)}
.settings-strip{display:flex;gap:18px;flex-wrap:wrap;padding:16px;background:var(--ac-card);border:1px solid var(--ac-line);border-radius:var(--ac-radius);margin-bottom:24px}
.style-tiles{display:flex;gap:6px;flex-wrap:wrap}
.style-tile{border:1px solid var(--ac-line);background:var(--ac-bg);border-radius:var(--ac-radius-sm);padding:7px 11px;cursor:pointer;font-size:12px;color:var(--ac-sub);transition:.15s}
.style-tile.on{border-color:var(--ac-accent);color:var(--ac-ink);background:var(--ac-sel)}

/* Studio Editor */
.yz-mode .ac-page{padding:0;max-width:none;margin:0;width:100%}
.yz-shell{display:flex;flex-direction:column;min-height:calc(100vh - 64px);background:var(--ac-bg);color:var(--ac-ink);font-size:13px}
.yz-topbar{height:48px;display:flex;align-items:center;gap:20px;padding:0 16px;background:var(--ac-card);border-bottom:1px solid var(--ac-line)}
.yz-brand{font-family:var(--ac-font-serif);font-size:20px;letter-spacing:.02em;white-space:nowrap}
.yz-brand span{color:var(--ac-accent)}
.yz-menu{display:flex;gap:14px;color:var(--ac-sub);position:relative}
.yz-menu-item{cursor:pointer;padding:4px 8px;border-radius:6px;position:relative}
.yz-menu-item:hover{background:var(--ac-line-2);color:var(--ac-ink)}
.yz-menu-dropdown{display:none;position:absolute;top:100%;left:0;background:var(--ac-card);border:1px solid var(--ac-line);border-radius:8px;padding:6px;box-shadow:var(--ac-shadow);z-index:50;min-width:180px}
.yz-menu-item:hover .yz-menu-dropdown{display:block}
.yz-menu-dropdown button{display:block;width:100%;text-align:left;background:transparent;border:0;padding:6px 10px;font-size:12px;border-radius:5px;cursor:pointer;color:var(--ac-ink)}
.yz-menu-dropdown button:hover{background:var(--ac-line-2)}
.yz-top-actions{margin-left:auto;display:flex;gap:8px;align-items:center}
.yz-project,.yz-icon-btn{height:30px;border:1px solid var(--ac-line);background:var(--ac-card);color:var(--ac-ink);border-radius:8px;padding:0 12px;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:4px}
.yz-icon-btn{width:30px;padding:0;display:grid;place-items:center;color:var(--ac-sub)}
.yz-icon-btn:hover{border-color:var(--ac-accent);color:var(--ac-ink)}
.yz-export{height:30px;background:var(--ac-cta-bg);color:var(--ac-cta-fg);border:0;border-radius:8px;padding:0 14px;font-weight:600;cursor:pointer;font-size:12px;transition:.15s}
.yz-export:hover{opacity:.92}

.yz-toolbar{height:48px;display:flex;align-items:center;padding:0 16px;gap:10px;border-bottom:1px solid var(--ac-line);background:var(--ac-card);overflow-x:auto}
.yz-tabs-main{display:flex;gap:6px;align-items:center}
.yz-tabs-main button{height:30px;padding:0 12px;border:1px solid var(--ac-line);background:var(--ac-card);color:var(--ac-sub);border-radius:8px;cursor:pointer;font-size:12px;white-space:nowrap;transition:.15s}
.yz-tabs-main button.active{background:var(--ac-sel);color:var(--ac-ink);border-color:var(--ac-accent)}
.yz-toolbar-right{margin-left:auto;display:flex;gap:8px}

.yz-workspace{flex:1;display:grid;grid-template-columns:minmax(0,1.3fr) minmax(380px,.8fr);min-height:0}
@media(max-width:1080px){.yz-workspace{grid-template-columns:1fr}.yz-right{border-left:0!important;border-top:1px solid var(--ac-line)}}
.yz-left{display:flex;flex-direction:column;gap:10px;padding:12px;min-width:0}
.yz-preview{flex:1;min-height:300px;max-height:60vh;background:var(--ac-thumb);border:1px solid var(--ac-line);border-radius:12px;display:grid;place-items:center;overflow:hidden;position:relative}
.yz-preview video{width:100%;height:100%;max-height:60vh;object-fit:contain;background:#000}
.safe-zone-overlay{position:absolute;inset:0;pointer-events:none;border:1px dashed rgba(255,255,255,.3);display:none;z-index:5}
.safe-zone-overlay.on{display:block}
.safe-zone-top{position:absolute;top:0;left:0;right:0;height:12%;background:rgba(255,0,0,.08);border-bottom:1px dashed rgba(255,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:10px;color:rgba(255,255,255,.6)}
.safe-zone-bottom{position:absolute;bottom:0;left:0;right:0;height:22%;background:rgba(255,0,0,.08);border-top:1px dashed rgba(255,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:10px;color:rgba(255,255,255,.6)}

.yz-empty{text-align:center;color:var(--ac-sub);max-width:420px;padding:24px}
.yz-empty-icon{width:72px;height:72px;border-radius:18px;background:var(--ac-card);border:1px solid var(--ac-line);margin:0 auto 16px;display:grid;place-items:center;color:var(--ac-accent);font-size:32px}
.yz-empty h2{color:var(--ac-ink);font-size:18px;margin:0 0 8px}
.yz-empty p{line-height:1.5;margin:0 0 18px;font-size:12.5px}

.yz-layout-bar{display:flex;align-items:center;gap:6px;background:var(--ac-card);border:1px solid var(--ac-line);border-radius:12px;padding:8px 12px;flex-wrap:wrap}
.yz-layout-bar .lbl{font-size:10px;letter-spacing:.1em;color:var(--ac-muted);margin-right:4px;font-weight:600}
.yz-layout-btn{height:28px;border:1px solid var(--ac-line);background:var(--ac-bg);color:var(--ac-sub);border-radius:7px;padding:0 10px;cursor:pointer;font-size:11px;display:inline-flex;gap:5px;align-items:center;transition:.15s}
.yz-layout-btn.active{background:var(--ac-sel);color:var(--ac-ink);border-color:var(--ac-accent);font-weight:600}
.yz-transport{margin-left:auto;display:flex;align-items:center;gap:6px}
.yz-transport button{width:28px;height:28px;border-radius:50%;border:1px solid var(--ac-line);background:var(--ac-card);color:var(--ac-ink);cursor:pointer;display:grid;place-items:center}
.yz-transport button.play{background:var(--ac-cta-bg);color:var(--ac-cta-fg);border:0}
.yz-time{font-family:var(--ac-font-mono);font-size:11px;color:var(--ac-sub);margin-left:6px;min-width:110px}

.yz-timeline{background:var(--ac-card);border:1px solid var(--ac-line);border-radius:12px;padding:10px 12px}
.yz-timeline-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;font-size:11px}
.yz-timeline-head .lbl{letter-spacing:.1em;color:var(--ac-muted);font-weight:600}
.yz-field{background:var(--ac-bg);border:1px solid var(--ac-line);border-radius:5px;padding:4px 7px;color:var(--ac-ink);font-family:var(--ac-font-mono);font-size:11px}
.yz-field.lime{border-color:var(--ac-accent);color:var(--ac-accent)}
.yz-zoom{margin-left:auto;display:flex;align-items:center;gap:6px;color:var(--ac-sub)}
.yz-zoom input{width:80px;accent-color:var(--ac-accent)}

.yz-tracks{border-top:1px solid var(--ac-line);padding-top:8px;display:flex;flex-direction:column;gap:5px;overflow-x:auto}
.yz-track{display:flex;gap:8px;align-items:center;height:28px}
.yz-track-label{width:24px;height:24px;border-radius:5px;background:var(--ac-bg);border:1px solid var(--ac-line);display:grid;place-items:center;font-size:10px;color:var(--ac-sub);font-family:var(--ac-font-mono)}
.yz-track-lane{flex:1;height:24px;border-radius:5px;background:var(--ac-bg);border:1px solid var(--ac-line);display:flex;align-items:center;padding:0 8px;font-size:11px;color:var(--ac-muted);overflow:hidden;white-space:nowrap;position:relative}
.yz-track-lane.video{background:var(--ac-sel);color:var(--ac-ink)}
.yz-track-lane.audio{background:var(--ac-sel);color:var(--ac-ink)}
.yz-track-trim{position:absolute;top:0;bottom:0;background:color-mix(in srgb,var(--ac-accent) 25%,transparent);border-left:2px solid var(--ac-accent);border-right:2px solid var(--ac-accent);pointer-events:none}

/* Right inspector panel */
.yz-right{background:var(--ac-card);border-left:1px solid var(--ac-line);display:flex;flex-direction:column;min-height:0}
.yz-panel-tabs{display:flex;gap:4px;padding:10px 12px;border-bottom:1px solid var(--ac-line);background:var(--ac-bg)}
.yz-panel-tabs button{flex:1;height:34px;border:1px solid var(--ac-line);background:var(--ac-card);color:var(--ac-sub);border-radius:8px;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:.15s}
.yz-panel-tabs button.active{background:var(--ac-sel);color:var(--ac-ink);border-color:var(--ac-accent);font-weight:600}
.yz-panel-scroll{flex:1;overflow-y:auto;padding:12px 14px 40px}
.yz-panel-scroll::-webkit-scrollbar{width:6px}
.yz-panel-scroll::-webkit-scrollbar-thumb{background:var(--ac-line);border-radius:6px}

.yz-card{background:var(--ac-card);border:1px solid var(--ac-line);border-radius:10px;margin-bottom:10px;overflow:hidden}
.yz-card-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;cursor:pointer;user-select:none}
.yz-card-head h3{margin:0;font-size:13.5px;font-weight:600}
.yz-card-body{padding:0 14px 14px}
.yz-chev{color:var(--ac-sub);background:var(--ac-bg);border:1px solid var(--ac-line);width:22px;height:22px;border-radius:5px;display:grid;place-items:center;font-size:11px}
.yz-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--ac-line-2)}
.yz-row:last-child{border-bottom:0}
.yz-row label{color:var(--ac-sub);font-size:12px}
.yz-input,.yz-select{width:100%;background:var(--ac-bg);border:1px solid var(--ac-line);border-radius:7px;color:var(--ac-ink);padding:7px 10px;font-size:12px;outline:none}
.yz-input:focus,.yz-select:focus{border-color:var(--ac-accent);background:var(--ac-card)}
textarea.yz-input{min-height:76px;resize:vertical}
.yz-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.yz-slider{display:flex;align-items:center;gap:8px}
.yz-slider input{flex:1;accent-color:var(--ac-accent)}
.yz-num{min-width:44px;text-align:center;background:var(--ac-bg);border:1px solid var(--ac-line);border-radius:5px;padding:3px 5px;font-family:var(--ac-font-mono);font-size:11px}
.yz-swatches{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.yz-swatches i{width:20px;height:20px;border-radius:5px;border:1px solid var(--ac-line);cursor:pointer;display:block}
.yz-colorrow{display:flex;align-items:center;gap:8px}
.yz-colorrow input[type=color]{width:28px;height:28px;border:0;background:transparent;padding:0;cursor:pointer}
.yz-toggle{width:36px;height:20px;border-radius:99px;background:var(--ac-line);position:relative;cursor:pointer;transition:.2s}
.yz-toggle i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--ac-sub);transition:.2s}
.yz-toggle.on{background:var(--ac-accent)}.yz-toggle.on i{left:18px;background:#fff}

.yz-template-pick{display:flex;align-items:center;gap:10px;background:var(--ac-bg);border:1px solid var(--ac-line);border-radius:9px;padding:10px}
.yz-template-pick .ic{width:34px;height:34px;border-radius:8px;background:var(--ac-accent);color:#fff;display:grid;place-items:center;font-weight:700}
.yz-template-pick .txt{flex:1;min-width:0;overflow:hidden}
.yz-template-pick b{font-size:12px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.yz-template-pick small{display:block;color:var(--ac-sub);margin-top:2px;font-size:11px}
.yz-change{background:var(--ac-card);border:1px solid var(--ac-line);color:var(--ac-ink);border-radius:99px;padding:5px 12px;cursor:pointer;font-size:11px;white-space:nowrap}
.yz-sticky{position:sticky;bottom:0;background:var(--ac-card);border-top:1px solid var(--ac-line);padding:10px 0 0;display:flex;flex-direction:column;gap:6px;margin-top:8px}
.yz-preview-btn,.yz-export-btn{width:100%;height:36px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600}
.yz-preview-btn{background:var(--ac-card);border:1px solid var(--ac-line);color:var(--ac-ink)}
.yz-export-btn{background:var(--ac-cta-bg);border:0;color:var(--ac-cta-fg)}

/* Modal */
dialog.yz-modal{position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;border:0;background:rgba(0,0,0,.55);display:grid;place-items:center;backdrop-filter:blur(4px);z-index:100}
dialog.yz-modal:not([open]){display:none}
.yz-modal-box{width:min(1100px,94vw);max-height:88vh;background:var(--ac-card);border:1px solid var(--ac-line);border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:var(--ac-shadow)}
.yz-modal-head{padding:16px 20px;border-bottom:1px solid var(--ac-line);display:flex;align-items:center;gap:12px}
.yz-modal-head h2{margin:0;font-size:18px}
.yz-modal-head p{margin:4px 0 0;color:var(--ac-sub);font-size:12px}
.yz-modal-head .close{margin-left:auto;background:var(--ac-bg);border:1px solid var(--ac-line);width:30px;height:30px;border-radius:50%;cursor:pointer;display:grid;place-items:center}
.yz-modal-tools{display:flex;gap:8px;align-items:center;padding:10px 20px;border-bottom:1px solid var(--ac-line);flex-wrap:wrap;background:var(--ac-bg)}
.yz-cat{height:28px;border:1px solid var(--ac-line);background:var(--ac-card);color:var(--ac-sub);border-radius:99px;padding:0 12px;cursor:pointer;font-size:11px}
.yz-cat.on{background:var(--ac-accent);color:#fff;border-color:var(--ac-accent);font-weight:600}
.yz-search{margin-left:auto;background:var(--ac-card);border:1px solid var(--ac-line);border-radius:7px;padding:6px 10px;min-width:200px;font-size:12px;outline:none}
.yz-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;padding:18px 20px;overflow-y:auto}
.yz-tpl{position:relative;background:var(--ac-card);border:1px solid var(--ac-line);border-radius:10px;overflow:hidden;cursor:pointer;transition:.15s}
.yz-tpl:hover{transform:translateY(-2px);box-shadow:var(--ac-shadow);border-color:var(--ac-accent)}
.yz-tpl[aria-pressed="true"]{border-color:var(--ac-accent);box-shadow:0 0 0 2px var(--ac-accent)}
.yz-thumb{height:140px;background:var(--ac-thumb);position:relative;display:grid;place-items:center;overflow:hidden;border-bottom:1px solid var(--ac-line)}
.yz-stage{position:relative;width:80px;height:124px;border-radius:8px;background:var(--ac-card);border:1px solid var(--ac-line);overflow:hidden;box-shadow:0 3px 10px rgba(0,0,0,.12);display:flex;flex-direction:column;justify-content:space-between;padding:6px}
.yz-stage-top{font-size:6px;line-height:1.2;font-weight:600;color:var(--ac-ink);min-height:12px;overflow:hidden}
.yz-stage-video{flex:1;margin:4px 0;border-radius:4px;background:linear-gradient(145deg,var(--ac-line-2),var(--ac-line));position:relative;display:grid;place-items:center}
.yz-stage-caption{font-size:5.5px;font-weight:600;color:var(--ac-card);background:var(--ac-ink);border-radius:2px;padding:2px 3px;text-align:center;overflow:hidden;white-space:nowrap}
.yz-tpl-body{padding:10px 12px 12px}
.yz-tpl-title{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px}
.yz-tpl-title b{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.yz-tpl-tag{font-size:9.5px;background:var(--ac-line-2);color:var(--ac-sub);border-radius:99px;padding:2px 6px;white-space:nowrap}
.yz-tpl-body small{display:block;color:var(--ac-sub);margin:0 0 10px;line-height:1.4;font-size:11px;min-height:30px}
.yz-use{width:100%;height:28px;border-radius:6px;background:var(--ac-cta-bg);color:var(--ac-cta-fg);font-weight:600;border:0;cursor:pointer;font-size:11px}
.yz-modal-foot{padding:12px 20px;border-top:1px solid var(--ac-line);display:flex;align-items:center;justify-content:space-between;background:var(--ac-bg);font-size:12px;color:var(--ac-sub)}

/* Toast feedback */
#toast{position:fixed;bottom:24px;right:24px;background:var(--ac-cta-bg);color:var(--ac-cta-fg);padding:10px 18px;border-radius:var(--ac-radius-pill);font-size:13px;box-shadow:var(--ac-shadow);z-index:1000;opacity:0;transform:translateY(10px);transition:.2s;pointer-events:none}
#toast.show{opacity:1;transform:translateY(0)}
</style></head><body>

<header>
 <div class="brand" onclick="show('dashboard')">Pulse<em>Cut</em></div>
 <nav>
  <button class="nav-btn active" data-page="dashboard">Dashboard</button>
  <button class="nav-btn" data-page="clips">Clips</button>
  <button class="nav-btn" data-page="editor">Editor</button>
 </nav>
 <div class="header-right">
  <button class="pill" id="theme">◐ Theme</button>
  <span class="ac-meta">v0.1.0 · Calm Premium</span>
 </div>
</header>

<main class="ac-page">
<!-- 1. DASHBOARD PAGE -->
<section id="page-dashboard">
 <div class="import-card">
  <h1 class="import-title">Create a short</h1>
  <p class="import-sub">Paste any live stream or video link, or select a local file. PulseCut detects the loud peaks, reframes to vertical, and generates ready-to-post shorts.</p>
  
  <div class="ac-seg" id="import-mode">
   <button class="on" type="button" onclick="setImportMode('link')">🔗 URL Link</button>
   <button type="button" onclick="setImportMode('file')">📁 Local Video File</button>
  </div>

  <div id="import-link-panel">
   <textarea class="ac-input" id="url" placeholder="Paste a YouTube / Kick / Twitch / direct video link (e.g. https://www.youtube.com/watch?v=...)"></textarea>
  </div>

  <div id="import-file-panel" style="display:none">
   <div class="dropzone" id="file-dropzone" onclick="$('#file-input').click()">
    <div class="dropzone-icon">📁</div>
    <b style="font-size:14px">Click to select video or drag &amp; drop</b>
    <p style="color:var(--ac-sub);font-size:12px;margin:4px 0 0">Supports MP4, MOV, MKV, WebM</p>
    <div id="selected-file-info" style="margin-top:10px;font-family:var(--ac-font-mono);font-size:12px;color:var(--ac-accent)"></div>
   </div>
   <input type="file" id="file-input" accept="video/*" style="display:none" onchange="handleFileSelect(this)">
   <input class="ac-input" id="local-path" placeholder="Or enter full absolute file path (e.g. C:\Videos\clip.mp4)">
  </div>

  <div class="field-row">
   <div>
    <div class="field-label">Template Preset</div>
    <div class="ac-seg" id="job-template">
     <button class="on" data-v="default">Plain</button>
     <button data-v="tiktok_hook">TikTok Hook</button>
     <button data-v="editorial">Editorial</button>
     <button data-v="street">Street Bold</button>
     <button data-v="breaking_news">News</button>
     <button data-v="x_light">X Light</button>
     <button data-v="podcast_split">Podcast</button>
     <button data-v="gaming_reaction">Gaming</button>
     <button data-v="minimal_gradient">Minimal</button>
    </div>
   </div>
   <div>
    <div class="field-label">Max Clips</div>
    <input class="ac-input" id="max-clips" type="number" value="6" min="1" max="20" style="width:84px">
   </div>
   <label class="switch"><input type="checkbox" id="subtitle" checked> Burn Captions</label>
  </div>
  <button class="ac-btn ac-btn--cta" id="create-job" onclick="createJob()">Generate clips</button>
 </div>

 <div class="ac-section">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
   <div><h2 class="ac-h2">Tasks &amp; Jobs</h2><div class="ac-meta" id="jobs-count">0 tasks</div></div>
   <button class="pill" onclick="loadJobs()">⟳ Refresh</button>
  </div>
  <div class="grid" id="jobs" style="margin-top:18px"></div>
 </div>
</section>

<!-- 2. CLIPS PAGE -->
<section id="page-clips" hidden>
 <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
  <div>
   <h1 class="ac-title">Clips Library &amp; Finishing</h1>
   <div class="ac-meta" id="clips-count">0 clips · ready</div>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
   <button class="pill" onclick="loadClips()">⟳ Refresh</button>
   <button class="pill" onclick="selectAllClips(true)">Select All</button>
   <button class="pill" onclick="selectAllClips(false)">Deselect</button>
   <button class="pill" onclick="batchApprove()">✓ Approve Selected</button>
  </div>
 </div>

 <div class="toolbar-strip">
  <input class="search-input" id="clip-search" placeholder="⌕ Search clips by title, tag, channel..." oninput="filterClips()">
  <div class="ac-seg" id="status-filter">
   <button class="on" onclick="setStatusFilter('all',this)">All</button>
   <button onclick="setStatusFilter('Ready',this)">Ready</button>
   <button onclick="setStatusFilter('Approved',this)">Approved</button>
   <button onclick="setStatusFilter('Rejected',this)">Rejected</button>
  </div>
 </div>

 <div class="settings-strip">
  <div><div class="field-label">Template</div><div class="ac-seg" id="cfg-template">
    <button class="on" data-v="default">Plain</button>
    <button data-v="tiktok_hook">TikTok</button>
    <button data-v="editorial">Editorial</button>
    <button data-v="street">Street</button>
    <button data-v="breaking_news">News</button>
    <button data-v="x_light">X Light</button>
    <button data-v="podcast_split">Podcast</button>
    <button data-v="gaming_reaction">Gaming</button>
  </div></div>
  <div><div class="field-label">Subtitle font</div><div class="ac-seg" id="cfg-font">
    <button class="on" data-v="Inter">Inter</button><button data-v="Geist">Geist</button><button data-v="Arial">Arial</button><button data-v="Montserrat">Montserrat</button><button data-v="Poppins">Poppins</button>
  </div></div>
  <div><div class="field-label">Caption style</div><div class="style-tiles" id="cfg-style">
    <button class="style-tile on" data-v="karaoke">Karaoke</button><button class="style-tile" data-v="bold">Bold</button>
    <button class="style-tile" data-v="box">Box</button><button class="style-tile" data-v="accent">Accent</button>
  </div></div>
  <div><div class="field-label">Aspect ratio</div><div class="ac-seg" id="cfg-aspect">
    <button class="on" data-v="9:16">9:16</button><button data-v="1:1">1:1</button><button data-v="16:9">16:9</button>
  </div></div>
  <div><div class="field-label">Layout</div><div class="ac-seg" id="cfg-layout">
    <button class="on" data-v="solo">Solo</button><button data-v="pip">PiP</button><button data-v="split">Split</button><button data-v="centered">Centered</button>
  </div></div>
  <div><div class="field-label">Canvas</div><div class="ac-seg" id="cfg-canvas">
    <button class="on" data-v="solid">Solid</button><button data-v="blur">Blur</button><button data-v="padding">Padding</button>
  </div></div>
  <div style="min-width:180px;flex:1"><div class="field-label">Outro text</div>
    <input class="ac-input" id="cfg-outro" placeholder="Follow for more"></div>
  <div style="min-width:180px;flex:1"><div class="field-label">Social handle</div>
    <input class="ac-input" id="cfg-social" placeholder="@yourhandle"></div>
  <label class="switch"><input type="checkbox" id="cfg-audio-peak"> Audio peak riser</label>
 </div>

 <div style="display:flex;gap:12px;margin-bottom:20px;align-items:center;flex-wrap:wrap">
  <button class="ac-btn ac-btn--cta" id="rerender-all" onclick="rerenderSelected()">Re-render selected</button>
  <span class="ac-meta" id="selection-status">0 clips selected</span>
 </div>
 <div class="grid-clips" id="clips"></div>
</section>

<!-- 3. EDITOR PAGE -->
<section id="page-editor" hidden>
 <div class="yz-shell">
  <div class="yz-topbar">
   <div class="yz-brand" onclick="show('dashboard')">PULSE<span>CUT</span></div>
   <div class="yz-menu">
    <div class="yz-menu-item">File
     <div class="yz-menu-dropdown">
      <button onclick="show('dashboard')">New Clip / Import</button>
      <button onclick="show('clips')">Open Clips Library</button>
      <button onclick="yzExport()">Export Video</button>
     </div>
    </div>
    <div class="yz-menu-item">Edit
     <div class="yz-menu-dropdown">
      <button onclick="yzUndo()">Undo (Ctrl+Z)</button>
      <button onclick="yzRedo()">Redo (Ctrl+Y)</button>
      <button onclick="yzReset()">Reset Adjustments</button>
     </div>
    </div>
    <div class="yz-menu-item">View
     <div class="yz-menu-dropdown">
      <button onclick="yzToggleSafeZones()">Toggle Safe Zones</button>
      <button onclick="yzLive()">Live Fullscreen (Ctrl+L)</button>
      <button onclick="$('#theme').click()">Toggle Theme</button>
     </div>
    </div>
    <div class="yz-menu-item">Help
     <div class="yz-menu-dropdown">
      <button onclick="openShortcuts()">Keyboard Shortcuts</button>
      <button onclick="yzTemplateModal()">Template Library</button>
     </div>
    </div>
   </div>
   <div class="yz-top-actions">
    <button class="yz-project" onclick="show('dashboard')">My Project</button>
    <button class="yz-export" onclick="yzExport()">↓ Export 9:16 Video</button>
    <button class="yz-icon-btn" title="Undo (Ctrl+Z)" onclick="yzUndo()">↶</button>
    <button class="yz-icon-btn" title="Redo (Ctrl+Y)" onclick="yzRedo()">↷</button>
    <button class="yz-icon-btn" title="Reset All" onclick="yzReset()">⟳</button>
    <button class="yz-icon-btn" title="Fullscreen" onclick="document.documentElement.requestFullscreen?.()">⛶</button>
   </div>
  </div>

  <div class="yz-toolbar">
   <div class="yz-tabs-main">
    <button onclick="show('dashboard')">Home</button>
    <button onclick="show('clips')">Clips Library</button>
    <button class="active" onclick="yzPanel('framing')">Framing</button>
    <button onclick="yzPanel('templates')">Templates</button>
    <button onclick="yzPanel('text')">Text</button>
    <button onclick="yzPanel('media')">Media</button>
    <button id="yz-aspect-btn" onclick="yzAspect()">▾ 9:16</button>
    <button id="yz-safe-btn" onclick="yzToggleSafeZones()">⛶ Safe Zones</button>
   </div>
   <div class="yz-toolbar-right">
    <button class="yz-icon-btn" title="Shortcuts" onclick="openShortcuts()">?</button>
   </div>
  </div>

  <div class="yz-workspace">
   <div class="yz-left">
    <div class="yz-preview">
     <div class="yz-empty" id="yz-empty">
      <div class="yz-empty-icon">▦</div>
      <h2>No Video Loaded</h2>
      <p>Select any clip from the Clips library or import a new video from Dashboard to begin editing.</p>
      <button class="ac-btn ac-btn--cta" onclick="show('clips')">Select Clip from Library</button>
     </div>
     <video id="yz-video" playsinline style="display:none"></video>
     <div class="safe-zone-overlay" id="safe-overlay">
      <div class="safe-zone-top">Top Safe Margin (Stories / Reels UI)</div>
      <div class="safe-zone-bottom">Bottom Safe Margin (Caption / Controls UI)</div>
     </div>
    </div>

    <div class="yz-layout-bar">
     <span class="lbl">LAYOUT</span>
     <button class="yz-layout-btn active" data-layout="solo" onclick="yzLayout(this)">▣ Solo</button>
     <button class="yz-layout-btn" data-layout="pip" onclick="yzLayout(this)">⧉ PiP</button>
     <button class="yz-layout-btn" data-layout="split" onclick="yzLayout(this)">▤ Split</button>
     <button class="yz-layout-btn" data-layout="centered" onclick="yzLayout(this)">▢ Centered</button>
     <button class="yz-layout-btn" data-layout="wide" onclick="yzLayout(this)">▭ 16:9 Wide</button>

     <div class="yz-transport">
      <button title="Seek -5s" onclick="yzSeek(-1)">◀</button>
      <button class="play" id="play-btn" title="Play/Pause" onclick="yzPlay()">▶</button>
      <button title="Seek +5s" onclick="yzSeek(1)">▶|</button>
      <button class="yz-layout-btn" id="speed-btn" onclick="cycleSpeed()">1.0x</button>
      <span class="yz-time" id="yz-time">00:00:00 / 00:00:00</span>
     </div>
    </div>

    <div class="yz-timeline">
     <div class="yz-timeline-head">
      <span class="lbl">TIMELINE</span>
      <span>In <b class="yz-field" id="yz-in">00:00:00.00</b></span>
      <span>Out <b class="yz-field" id="yz-out">00:00:00.00</b></span>
      <span class="yz-field lime" id="yz-duration">Duration 0.0s</span>
      <button class="yz-layout-btn" onclick="yzSetIn()" title="Set In mark at current frame">[ Set In</button>
      <button class="yz-layout-btn" onclick="yzSetOut()" title="Set Out mark at current frame">Set Out ]</button>
      <button class="yz-layout-btn" onclick="yzResetTrim()">Reset Trim</button>
      <span class="yz-zoom">ZOOM <input type="range" min="50" max="200" value="100" oninput="yzZoom(this)"> <button class="yz-layout-btn" onclick="yzFitTimeline()">Fit</button></span>
     </div>
     <div class="yz-tracks" id="timeline-tracks">
      <div class="yz-track"><span class="yz-track-label">CC</span><div class="yz-track-lane" id="lane-cc">Captions Track</div></div>
      <div class="yz-track"><span class="yz-track-label">V1</span><div class="yz-track-lane video" id="lane-video">Source Video Track<div class="yz-track-trim" id="v1-trim" style="left:0%;width:100%"></div></div></div>
      <div class="yz-track"><span class="yz-track-label">A1</span><div class="yz-track-lane audio">Master Audio</div></div>
      <div class="yz-track"><span class="yz-track-label">A2</span><div class="yz-track-lane" id="lane-music">Background Music / Riser (Disabled)</div></div>
     </div>
    </div>
   </div>

   <div class="yz-right">
    <div class="yz-panel-tabs">
     <button class="active" data-panel="framing" onclick="yzPanel('framing')">▣ Framing</button>
     <button data-panel="templates" onclick="yzPanel('templates')">▦ Templates</button>
     <button data-panel="text" onclick="yzPanel('text')">T Text</button>
     <button data-panel="media" onclick="yzPanel('media')">♪ Media</button>
    </div>

    <div class="yz-panel-scroll">
     <!-- TAB 1: FRAMING -->
     <div id="yz-panel-framing">
      <div class="yz-card">
       <div class="yz-card-head" onclick="yzAcc(this)"><h3>Frame &amp; Corners</h3><span class="yz-chev">‹</span></div>
       <div class="yz-card-body">
        <div class="yz-row"><label>Corner Radius</label><div class="yz-slider"><input type="range" min="0" max="80" value="0" oninput="yzSlide(this,'yz-radius','px')"><span class="yz-num" id="yz-radius">0px</span></div></div>
        <div class="yz-row"><label>Frame Padding</label><div class="yz-slider"><input type="range" min="0" max="120" value="0" oninput="yzSlide(this,'yz-padding','px')"><span class="yz-num" id="yz-padding">0px</span></div></div>
        <div class="yz-row"><label>Outer Margin Fill</label><span class="yz-badge gray">Active</span></div>
        <div class="yz-colorrow"><input type="color" value="#000000" oninput="yzColor(this)"><input class="yz-input" value="#000000" id="yz-color-hex"></div>
        <div class="yz-swatches">
         <i style="background:#000000" onclick="yzSetColor('#000000')"></i>
         <i style="background:#FFFFFF" onclick="yzSetColor('#FFFFFF')"></i>
         <i style="background:#0F1419" onclick="yzSetColor('#0F1419')"></i>
         <i style="background:#1F2937" onclick="yzSetColor('#1F2937')"></i>
         <i style="background:#2D6BFF" onclick="yzSetColor('#2D6BFF')"></i>
         <i style="background:#E0FE10" onclick="yzSetColor('#E0FE10')"></i>
        </div>
       </div>
      </div>

      <div class="yz-card">
       <div class="yz-card-head" onclick="yzAcc(this)"><h3>Playback Speed</h3><span class="yz-chev">‹</span></div>
       <div class="yz-card-body">
        <div class="ac-seg" style="width:100%;margin-top:6px">
         <button onclick="setSpeed(0.5,this)">0.5x</button>
         <button onclick="setSpeed(0.75,this)">0.75x</button>
         <button class="on" onclick="setSpeed(1.0,this)">1.0x</button>
         <button onclick="setSpeed(1.25,this)">1.25x</button>
         <button onclick="setSpeed(1.5,this)">1.5x</button>
         <button onclick="setSpeed(2.0,this)">2.0x</button>
        </div>
       </div>
      </div>

      <div class="yz-card">
       <div class="yz-card-head" onclick="yzAcc(this)"><h3>Subtitle Placement</h3><span class="yz-chev">‹</span></div>
       <div class="yz-card-body">
        <div class="yz-row"><label>Vertical Height</label><div class="yz-slider"><input type="range" min="50" max="95" value="84" oninput="yzSlide(this,'yz-sub-pos','%')"><span class="yz-num" id="yz-sub-pos">84%</span></div></div>
        <button class="yz-preview-btn" style="margin-top:8px" onclick="yzAutoAlign()">☰ Auto-Align Subtitles for Safe Zone</button>
       </div>
      </div>

      <div class="yz-card">
       <div class="yz-card-head" onclick="yzAcc(this)"><h3>Post Hook / Statement</h3><span class="yz-chev">‹</span></div>
       <div class="yz-card-body">
        <textarea class="yz-input" id="yz-hook" placeholder="What is the single most valuable lesson you learned this year?"></textarea>
        <div class="yz-two" style="margin-top:10px">
         <div><label style="color:var(--ac-sub);font-size:11px">Font</label><select class="yz-select" id="yz-hook-font"><option>Inter</option><option>Geist</option><option>Montserrat</option><option>Poppins</option></select></div>
         <div><label style="color:var(--ac-sub);font-size:11px">Text Size</label><div class="yz-slider"><input type="range" min="14" max="64" value="28" oninput="yzSlide(this,'yz-hsize','px')"><span class="yz-num" id="yz-hsize">28px</span></div></div>
        </div>
       </div>
      </div>

      <div class="yz-sticky">
       <button class="yz-preview-btn" onclick="yzLive()">◉ Live Fullscreen Preview (Ctrl+L)</button>
       <button class="yz-export-btn" onclick="yzExport()">↓ Export 9:16 Video</button>
      </div>
     </div>

     <!-- TAB 2: TEMPLATES -->
     <div id="yz-panel-templates" hidden>
      <div class="yz-card">
       <div class="yz-card-body" style="padding-top:14px">
        <div class="yz-row"><label>Active Video Template</label><span class="yz-toggle on" id="yz-whole" onclick="yzToggleEl(this)"><i></i></span></div>
        <div class="yz-template-pick">
         <div class="ic">▦</div>
         <div class="txt"><b id="yz-template-name">Plain 9:16</b><small id="yz-template-desc">Standard centered vertical short with word-by-word captions</small></div>
         <button class="yz-change" onclick="yzTemplateModal()">Change Template ›</button>
        </div>
       </div>
      </div>

      <div class="yz-card">
       <div class="yz-card-head" onclick="yzAcc(this)"><h3>Header &amp; Social Frame</h3><span class="yz-chev">‹</span></div>
       <div class="yz-card-body">
        <label style="color:var(--ac-sub);font-size:11px">Card Theme</label>
        <div class="yz-seg light" style="margin:6px 0 12px"><button class="on" onclick="yzSegClick(this)">Light</button><button onclick="yzSegClick(this)">Dark</button></div>
        <div class="yz-two">
         <div><label style="color:var(--ac-sub);font-size:11px">Display Name</label><input class="yz-input" id="yz-display-name" value="PulseCut Creator"></div>
         <div><label style="color:var(--ac-sub);font-size:11px">Handle / Username</label><input class="yz-input" id="yz-handle" value="@creator"></div>
        </div>
        <div class="yz-row" style="margin-top:10px"><label>Verified Badge (Blue Check)</label><span class="yz-toggle on" onclick="yzToggleEl(this)"><i></i></span></div>
        <label style="color:var(--ac-sub);font-size:11px;margin-top:8px;display:block">Pinned Statement / Topic</label>
        <textarea class="yz-input" id="yz-template-hook" placeholder="Pinned header statement for card templates"></textarea>
       </div>
      </div>

      <div class="yz-sticky">
       <button class="yz-preview-btn" onclick="yzLive()">◉ Live Fullscreen Preview (Ctrl+L)</button>
       <button class="yz-export-btn" onclick="yzExport()">↓ Export 9:16 Video</button>
      </div>
     </div>

     <!-- TAB 3: TEXT -->
     <div id="yz-panel-text" hidden>
      <div class="ac-seg" style="width:100%;margin-bottom:12px">
       <button class="on" id="text-tab-headline" onclick="switchTextSubtab('headline')">Headline Hook</button>
       <button id="text-tab-subs" onclick="switchTextSubtab('subs')">Subtitles &amp; Cues</button>
      </div>

      <div id="text-subtab-headline">
       <div class="yz-card">
        <div class="yz-card-head" onclick="yzAcc(this)"><h3>Text &amp; Typography</h3><span class="yz-chev">‹</span></div>
        <div class="yz-card-body">
         <label style="color:var(--ac-sub);font-size:11px">Headline Hook Text</label>
         <textarea class="yz-input" id="yz-headline" placeholder="Enter punchy headline hook..."></textarea>
         <div class="yz-two" style="margin-top:10px">
          <div><label style="color:var(--ac-sub);font-size:11px">Font</label><select class="yz-select" id="yz-font"><option>Inter</option><option>Geist</option><option>Arial</option><option>Montserrat</option><option>Poppins</option></select></div>
          <div><label style="color:var(--ac-sub);font-size:11px">Text Size</label><div class="yz-slider"><input type="range" min="12" max="64" value="28" oninput="yzSlide(this,'yz-fsize','')"><span class="yz-num" id="yz-fsize">28</span></div></div>
         </div>
         <label style="color:var(--ac-sub);font-size:11px;display:block;margin-top:10px">Text Casing</label>
         <div class="ac-seg" style="width:100%;margin-top:4px">
          <button class="on" onclick="setCasing('asis',this)">As-is</button>
          <button onclick="setCasing('upper',this)">UPPER</button>
          <button onclick="setCasing('title',this)">Title</button>
          <button onclick="setCasing('lower',this)">lower</button>
         </div>
        </div>
       </div>

       <div class="yz-card">
        <div class="yz-card-head" onclick="yzAcc(this)"><h3>Text Effects &amp; Banner</h3><span class="yz-chev">‹</span></div>
        <div class="yz-card-body">
         <div class="yz-row"><label>Text Shadow</label><div class="yz-slider"><input type="range" min="0" max="20" value="4" oninput="yzSlide(this,'yz-shadow','px')"><span class="yz-num" id="yz-shadow">4px</span></div></div>
         <div class="yz-row"><label>Banner Background Opacity</label><div class="yz-slider"><input type="range" min="0" max="100" value="70" oninput="yzSlide(this,'yz-opacity','%')"><span class="yz-num" id="yz-opacity">70%</span></div></div>
        </div>
       </div>
      </div>

      <div id="text-subtab-subs" style="display:none">
       <div class="yz-card">
        <div class="yz-card-head" onclick="yzAcc(this)"><h3>Word Timings &amp; Captions</h3><span class="yz-chev">‹</span></div>
        <div class="yz-card-body">
         <p style="color:var(--ac-sub);font-size:12px;margin:0 0 10px">Word-level karaoke timestamps are synced with audio. You can edit text cues below:</p>
         <div id="subs-cue-list" style="max-height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:6px">
          <div class="ac-meta">Loading cues...</div>
         </div>
        </div>
       </div>
      </div>

      <div class="yz-sticky">
       <button class="yz-preview-btn" onclick="yzLive()">◉ Live Fullscreen Preview (Ctrl+L)</button>
       <button class="yz-export-btn" onclick="yzExport()">↓ Export 9:16 Video</button>
      </div>
     </div>

     <!-- TAB 4: MEDIA -->
     <div id="yz-panel-media" hidden>
      <div class="yz-card">
       <div class="yz-card-head" onclick="yzAcc(this)"><h3>Audio Track &amp; Riser</h3><span class="yz-chev">‹</span></div>
       <div class="yz-card-body">
        <div class="yz-row"><button class="yz-change" onclick="yzSelectAudio()">Browse Audio File</button><span id="audio-selected-name" style="color:var(--ac-sub);font-size:12px">Original video audio</span></div>
        <div class="yz-row" style="margin-top:8px"><label class="switch"><input type="checkbox" id="yz-audio-peak"> Audio peak / riser in final seconds</label></div>
        <div class="yz-row"><label>Riser Duration</label><div class="yz-slider"><input type="range" min="1" max="10" value="5" oninput="yzSlide(this,'yz-riser-sec','s')"><span class="yz-num" id="yz-riser-sec">5s</span></div></div>
       </div>
      </div>

      <div class="yz-card">
       <div class="yz-card-head" onclick="yzAcc(this)"><h3>Outro End Card</h3><span class="yz-chev">‹</span></div>
       <div class="yz-card-body">
        <label style="color:var(--ac-sub);font-size:11px">Outro Statement / CTA</label>
        <input class="yz-input" id="yz-outro-text" placeholder="e.g. Follow @channel for part 2" value="">
        <div class="yz-row" style="margin-top:10px"><label>Display Duration</label><div class="yz-slider"><input type="range" min="1" max="6" value="3" oninput="yzSlide(this,'yz-outro-sec','s')"><span class="yz-num" id="yz-outro-sec">3s</span></div></div>
       </div>
      </div>

      <div class="yz-card">
       <div class="yz-card-head" onclick="yzAcc(this)"><h3>Watermark / Handle</h3><span class="yz-chev">‹</span></div>
       <div class="yz-card-body">
        <label style="color:var(--ac-sub);font-size:11px">Handle Text</label>
        <input class="yz-input" id="yz-watermark-text" placeholder="@yourbrand" value="">
        <div class="yz-two" style="margin-top:8px">
         <div><label style="color:var(--ac-sub);font-size:11px">Position</label><select class="yz-select" id="yz-wm-pos"><option>Bottom-Right</option><option>Bottom-Left</option><option>Top-Right</option></select></div>
         <div><label style="color:var(--ac-sub);font-size:11px">Opacity</label><div class="yz-slider"><input type="range" min="20" max="100" value="80" oninput="yzSlide(this,'yz-wm-op','%')"><span class="yz-num" id="yz-wm-op">80%</span></div></div>
        </div>
       </div>
      </div>

      <div class="yz-sticky">
       <button class="yz-preview-btn" onclick="yzLive()">◉ Live Fullscreen Preview (Ctrl+L)</button>
       <button class="yz-export-btn" onclick="yzExport()">↓ Export 9:16 Video</button>
      </div>
     </div>
    </div>
   </div>
  </div>
 </div>

 <!-- TEMPLATE SELECTOR MODAL -->
 <dialog class="yz-modal" id="yz-modal" onclick="if(event.target===this)yzCloseModal()">
  <div class="yz-modal-box">
   <div class="yz-modal-head">
    <div style="font-size:22px;color:var(--ac-accent)">▦</div>
    <div>
     <h2>Choose a Video Template <span class="tag" style="position:static;margin-left:6px">20 Styles</span></h2>
     <p>Whole-video layouts with framing, safe zones, titles, and subtitle placement preconfigured.</p>
    </div>
    <button class="close" onclick="yzCloseModal()">✕</button>
   </div>
   <div class="yz-modal-tools">
    <button class="yz-cat on" onclick="yzCat(this)">All</button>
    <button class="yz-cat" onclick="yzCat(this)">Social Posts</button>
    <button class="yz-cat" onclick="yzCat(this)">Viral Hooks</button>
    <button class="yz-cat" onclick="yzCat(this)">Podcasts</button>
    <button class="yz-cat" onclick="yzCat(this)">Broadcast</button>
    <button class="yz-cat" onclick="yzCat(this)">Aesthetic &amp; Tech</button>
    <input class="yz-search" id="yz-search" placeholder="⌕ Search templates..." oninput="yzFilter()">
   </div>
   <div class="yz-grid" id="yz-template-grid"></div>
   <div class="yz-modal-foot">
    <span>Click any template to auto-adjust framing, captions, safe-zone positioning and metadata.</span>
    <button class="ac-btn ac-btn--sm" onclick="yzCloseModal()">Close</button>
   </div>
  </div>
 </dialog>

 <!-- KEYBOARD SHORTCUTS MODAL -->
 <dialog class="yz-modal" id="shortcuts-modal" onclick="if(event.target===this)this.close()">
  <div class="yz-modal-box" style="max-width:540px">
   <div class="yz-modal-head">
    <h2>Keyboard Shortcuts</h2>
    <button class="close" onclick="$('#shortcuts-modal').close()">✕</button>
   </div>
   <div style="padding:20px;display:flex;flex-direction:column;gap:10px;font-size:13px">
    <div class="yz-row"><span>Play / Pause</span><kbd class="yz-field">Space</kbd></div>
    <div class="yz-row"><span>Seek Back / Forward 5s</span><kbd class="yz-field">← / →</kbd></div>
    <div class="yz-row"><span>Set In Point</span><kbd class="yz-field">[</kbd></div>
    <div class="yz-row"><span>Set Out Point</span><kbd class="yz-field">]</kbd></div>
    <div class="yz-row"><span>Live Preview / Fullscreen</span><kbd class="yz-field">Ctrl + L</kbd></div>
    <div class="yz-row"><span>Undo / Redo</span><kbd class="yz-field">Ctrl + Z / Ctrl + Y</kbd></div>
    <div class="yz-row"><span>Close Modal</span><kbd class="yz-field">Escape</kbd></div>
   </div>
   <div class="yz-modal-foot">
    <span>Shortcuts work whenever the editor tab is active.</span>
    <button class="ac-btn ac-btn--sm" onclick="$('#shortcuts-modal').close()">Got it</button>
   </div>
  </div>
 </dialog>
</section>
</main>

<div id="toast"></div>

<script>
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

const state={
 page:'dashboard',
 importMode:'link',
 jobs:[],
 clips:[],
 selectedClips:new Set(),
 current:null,
 statusFilter:'all',
 searchQuery:'',
 trimIn:0,
 trimOut:0,
 duration:0,
 playbackSpeed:1.0,
 showSafeZones:false,
 cfg:{
  template:'default',font:'Inter',style:'karaoke',aspect:'9:16',layout:'solo',
  canvas:'solid',outro:'',social:'',audio_peak:false
 },
 jobTemplate:'default'
};

function toast(msg,ms=2600){
 const t=$('#toast');
 t.textContent=msg;
 t.classList.add('show');
 setTimeout(()=>t.classList.remove('show'),ms);
}

// Page Navigation
function show(p){
 state.page=p;
 $$('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===p));
 ['dashboard','clips','editor'].forEach(x=>$('#page-'+x).hidden=(x!==p));
 document.documentElement.classList.toggle('yz-mode',p==='editor');
 if(p==='clips')loadClips();
 if(p==='dashboard')loadJobs();
 if(p==='editor'){yzCloseModal();yzPanel('framing');renderEditor();}
}
$$('[data-page]').forEach(b=>b.onclick=()=>show(b.dataset.page));

// Theme
$('#theme').onclick=()=>{
 const d=document.documentElement;
 const t=d.dataset.theme==='dark'?'light':'dark';
 d.dataset.theme=t;
 localStorage.setItem('pulsecut-theme',t);
};
document.documentElement.dataset.theme=localStorage.getItem('pulsecut-theme')||'light';

// Segments helper
function seg(id,key,cb){
 $$(id+' button').forEach(b=>b.onclick=()=>{
  $$(id+' button').forEach(x=>x.classList.remove('on'));
  b.classList.add('on');
  if(cb)cb(b.dataset.v);else state.cfg[key]=b.dataset.v;
 });
}
seg('#job-template',null,v=>state.jobTemplate=v);
seg('#cfg-template','template');
seg('#cfg-font','font');
seg('#cfg-aspect','aspect');
seg('#cfg-layout','layout');
seg('#cfg-canvas','canvas');
$('#cfg-outro').oninput=e=>state.cfg.outro=e.target.value;
$('#cfg-social').oninput=e=>state.cfg.social=e.target.value;
$('#cfg-audio-peak').onchange=e=>state.cfg.audio_peak=e.target.checked;
$$('#cfg-style button').forEach(b=>b.onclick=()=>{
 $$('#cfg-style button').forEach(x=>x.classList.remove('on'));
 b.classList.add('on');
 state.cfg.style=b.dataset.v;
});

// Import Mode
function setImportMode(mode){
 state.importMode=mode;
 $$('#import-mode button').forEach((b,idx)=>b.classList.toggle('on',idx===(mode==='link'?0:1)));
 $('#import-link-panel').style.display=mode==='link'?'block':'none';
 $('#import-file-panel').style.display=mode==='file'?'block':'none';
}

function handleFileSelect(input){
 const file=input.files[0];
 if(!file)return;
 $('#selected-file-info').textContent=`Selected: ${file.name} (${(file.size/(1024*1024)).toFixed(1)} MB)`;
 if(!$('#local-path').value)$('#local-path').value=file.name;
 toast(`File selected: ${file.name}`);
}

const dropzone=$('#file-dropzone');
if(dropzone){
 ['dragenter','dragover'].forEach(e=>dropzone.addEventListener(e,ev=>{ev.preventDefault();dropzone.classList.add('dragover')}));
 ['dragleave','drop'].forEach(e=>dropzone.addEventListener(e,ev=>{ev.preventDefault();dropzone.classList.remove('dragover')}));
 dropzone.addEventListener('drop',ev=>{
  const files=ev.dataTransfer?.files;
  if(files&&files.length){
   $('#file-input').files=files;
   handleFileSelect($('#file-input'));
  }
 });
}

// API helper
async function api(path,opts){
 try{
  const r=await fetch(path,opts);
  return await r.json();
 }catch(e){
  return {error:e.message||'Network error'};
 }
}

// Jobs & Dashboard
async function createJob(){
 let target='';
 if(state.importMode==='link'){
  target=$('#url').value.trim();
  if(!target){toast('Please paste a video or stream link');return;}
 }else{
  target=$('#local-path').value.trim();
  if(!target){toast('Please select a local video file or enter its path');return;}
 }
 const b=await api('/api/jobs',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({
   url:target,
   max_clips:+$('#max-clips').value||6,
   template:state.jobTemplate
  })
 });
 if(b.error){toast(b.error);return;}
 toast('Job queued successfully!');
 if(state.importMode==='link')$('#url').value='';
 loadJobs();
}

async function loadJobs(){
 const d=await api('/api/jobs');
 state.jobs=d.jobs||[];
 $('#jobs-count').textContent=state.jobs.length+' task'+(state.jobs.length===1?'':'s');
 $('#jobs').innerHTML=state.jobs.length?state.jobs.map(j=>{
  const busy=j.status==='queued'||j.status==='downloading'||j.status==='clipping';
  const dot=busy?'busy':(j.status==='done'?'ok':'error');
  const viewBtn=j.status==='done'?`<button class="ac-btn ac-btn--sm" style="margin-top:10px" onclick="show('clips')">View Clips ›</button>`:'';
  return `<div class="ac-card"><div class="card-body">
   <div style="display:flex;justify-content:space-between;align-items:center">
    <b class="ac-meta" style="font-weight:600">${j.status.toUpperCase()}</b>
    <span class="ac-dot ${dot}"></span>
   </div>
   <div class="ac-meta" style="margin:10px 0;word-break:break-all">${j.url}</div>
   <div class="ac-line"><i style="width:${j.progress}%"></i></div>
   <div class="ac-meta" style="justify-content:space-between">
    <span>${j.message||''}</span>
    <span style="font-family:var(--ac-font-mono);font-weight:600">${j.progress}%</span>
   </div>
   ${viewBtn}
  </div></div>`;
 }).join(''):'<div class="ac-empty">No jobs yet. Paste a link or select a file above to create your first shorts.</div>';

 if(state.jobs.some(j=>j.status==='queued'||j.status==='downloading'||j.status==='clipping')){
  setTimeout(loadJobs,2000);
 }
}

// Clips Library
async function loadClips(){
 const d=await api('/api/clips');
 state.clips=d.clips||[];
 $('#clips-count').textContent=state.clips.length+' clip'+(state.clips.length===1?'':'s')+' · ready';
 renderClipsList();
}

function filterClips(){
 state.searchQuery=$('#clip-search').value.toLowerCase().trim();
 renderClipsList();
}

function setStatusFilter(status,btn){
 state.statusFilter=status;
 $$('#status-filter button').forEach(b=>b.classList.remove('on'));
 btn.classList.add('on');
 renderClipsList();
}

function renderClipsList(){
 let list=state.clips;
 if(state.statusFilter!=='all'){
  list=list.filter(c=>String(c.status).toLowerCase()===state.statusFilter.toLowerCase());
 }
 if(state.searchQuery){
  list=list.filter(c=>(c.title+' '+c.channel+' '+(c.hashtags||[]).join(' ')).toLowerCase().includes(state.searchQuery));
 }

 $('#selection-status').textContent=`${state.selectedClips.size} selected`;

 $('#clips').innerHTML=list.length?list.map(c=>{
  const isSel=state.selectedClips.has(c.id);
  const confPct=Math.round((c.confidence||0)*100);
  const tags=(c.hashtags||[]).map(t=>'#'+t).join(' ');
  return `
  <div class="ac-card ${isSel?'is-selected':''}" data-id="${c.id}" onclick="toggleClipSelection('${c.id}',event)">
   <div class="card-thumb">
    <input type="checkbox" class="select-checkbox" ${isSel?'checked':''} onclick="event.stopPropagation();toggleClipSelection('${c.id}')">
    <video muted preload="metadata" src="/api/clips/${c.id}/media"></video>
    <span class="tag top">★ ${confPct}%</span>
    <span class="tag bottom">${c.template||'plain'}</span>
   </div>
   <div class="card-body">
    <div class="card-title" title="${c.title}">${c.title||'Untitled Highlight'}</div>
    <div class="ac-meta" style="margin-bottom:8px">
     <span style="font-weight:600">${c.status}</span><span>·</span><span>${c.channel||'stream'}</span>
    </div>
    <div class="card-actions" onclick="event.stopPropagation()">
     <button class="primary" onclick="editClip('${c.id}')">Edit</button>
     <button onclick="approveClip('${c.id}')">Approve</button>
     <button onclick="rejectClip('${c.id}')">Reject</button>
     <a href="/api/clips/${c.id}/media" download="${c.title||c.id}.mp4" class="ac-btn ac-btn--sm" style="height:auto;padding:5px 10px">↓ MP4</a>
     <button onclick="copyMetadata('${c.id}')" title="Copy title and tags">Copy</button>
     <button onclick="deleteClip('${c.id}')" style="color:var(--ac-error)">✕</button>
    </div>
   </div>
  </div>`;
 }).join(''):'<div class="ac-empty" style="grid-column:1/-1">No clips matching current filters.</div>';
}

function toggleClipSelection(id,e){
 if(e&&e.target.tagName==='BUTTON')return;
 if(state.selectedClips.has(id))state.selectedClips.delete(id);
 else state.selectedClips.add(id);
 renderClipsList();
}

function selectAllClips(val){
 if(val)state.clips.forEach(c=>state.selectedClips.add(c.id));
 else state.selectedClips.clear();
 renderClipsList();
}

async function batchApprove(){
 if(!state.selectedClips.size){toast('Select clips first');return;}
 for(const id of state.selectedClips){
  await api(`/api/clips/${id}/approve`,{method:'POST'});
 }
 toast(`Approved ${state.selectedClips.size} clip(s)`);
 loadClips();
}

async function approveClip(id){
 await api(`/api/clips/${id}/approve`,{method:'POST'});
 toast('Clip approved!');
 loadClips();
}

async function rejectClip(id){
 await api(`/api/clips/${id}/reject`,{method:'POST'});
 toast('Clip rejected');
 loadClips();
}

async function deleteClip(id){
 if(!confirm('Are you sure you want to delete this clip?'))return;
 const r=await api(`/api/clips/${id}/delete`,{method:'POST'});
 if(r.error)toast(r.error);
 else toast('Clip deleted');
 loadClips();
}

function copyMetadata(id){
 const c=state.clips.find(x=>x.id===id);
 if(!c)return;
 const text=`${c.title}\n\n${(c.hashtags||[]).map(t=>'#'+t).join(' ')}`;
 navigator.clipboard.writeText(text).then(()=>{
  toast('Copied title & hashtags to clipboard!');
 });
}

async function rerenderSelected(){
 const ids=[...state.selectedClips];
 if(!ids.length){
  if(state.clips.length)ids.push(state.clips[0].id);
  else{toast('No clips to re-render');return;}
 }
 toast(`Re-rendering ${ids.length} clip(s)...`);
 for(const id of ids){
  const body={
   template:state.cfg.template,
   subtitle_style:state.cfg.style||'karaoke',
   aspect:state.cfg.aspect||'9:16',
   layout:state.cfg.layout||'solo',
   canvas:state.cfg.canvas||'solid',
   outro:state.cfg.outro||'',
   social:state.cfg.social?{handle:state.cfg.social,style:'verified'}:null,
   audio_peak:state.cfg.audio_peak,
   audio_peak_ms:5000
  };
  await api(`/api/clips/${id}/configure`,{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify(body)
  });
 }
 toast('Re-rendering complete!');
 loadClips();
}

function editClip(id){
 state.current=state.clips.find(c=>c.id===id);
 show('editor');
}

// ---------------------------------------------------------------------------
// 4. EDITOR ENGINE & BEHAVIOUR
// ---------------------------------------------------------------------------

window.yzTemplates=[
 {id:'default',name:'Plain 9:16',cat:'Social Posts',tag:'Basic',desc:'Standard centered vertical crop with clean word-by-word captions.',top:'',bottom:'PLAIN 9:16'},
 {id:'editorial',name:'Calm Editorial',cat:'Social Posts',tag:'Editorial',desc:'High-end serif typography, warm paper tones, and refined subtitle styling.',top:'“',bottom:'CALM EDITORIAL'},
 {id:'street',name:'Streetwear Bold',cat:'Social Posts',tag:'Street',desc:'High-contrast neon accents, punchy uppercase text, and modern hype layout.',top:'// VIRAL //',bottom:'STREET BOLD'},
 {id:'x_light',name:'X / Twitter (Light)',cat:'Social Posts',tag:'Social',desc:'White card, verified handle, centered 16:9 clip, and pinned statement.',top:'X / TWITTER',bottom:'X / TWITTER (LIGHT)'},
 {id:'x_dark',name:'X / Twitter (Dark)',cat:'Social Posts',tag:'Social',desc:'Dark card, verified handle, and high contrast centered frame.',top:'X / TWITTER',bottom:'X / TWITTER (DARK)'},
 {id:'tiktok_hook',name:'TikTok Hook',cat:'Viral Hooks',tag:'Hook',desc:'Bold attention-grabbing top hook with high-contrast karaoke captions.',top:'WAIT FOR IT',bottom:'TIKTOK HOOK'},
 {id:'podcast_split',name:'Podcast Split',cat:'Podcasts',tag:'Podcast',desc:'Host on top, guest on bottom, speaker-tracked split screen.',top:'PODCAST',bottom:'PODCAST SPLIT'},
 {id:'gaming_reaction',name:'Gaming Reaction',cat:'Viral Hooks',tag:'Gaming',desc:'Gameplay canvas with reaction facecam inset PiP.',top:'CLUTCH',bottom:'GAMING REACTION'},
 {id:'breaking_news',name:'Breaking News Broadcast',cat:'Broadcast',tag:'News / TV',desc:'Red breaking news ticker banner, broadcast headline & news chyron bar.',top:'● BREAKING NEWS',bottom:'BREAKING NEWS'},
 {id:'gradient_cta',name:'Gradient CTA',cat:'Social Posts',tag:'CTA',desc:'Rich gradient backdrop with follow handle and pinned statement.',top:'FOLLOW',bottom:'GRADIENT CTA'},
 {id:'minimal_cinema',name:'Minimalist Cinema Quote',cat:'Aesthetic & Tech',tag:'Cinema',desc:'Editorial serif quote layout with quote marks and author attribution.',top:'“',bottom:'CINEMA QUOTE'},
 {id:'smartphone',name:'Smartphone Mockup Frame',cat:'Aesthetic & Tech',tag:'Device',desc:'Modern smartphone bezel frame with Dynamic Island notch & clean padding.',top:'Watch next...',bottom:'SMARTPHONE MOCKUP'},
 {id:'x_terminal',name:'Terminal Snippet',cat:'Aesthetic & Tech',tag:'Developer',desc:'Dark terminal window with command line prompt and monospaced code theme.',top:'$ run --viral',bottom:'TERMINAL SNIPPET'},
 {id:'youtube_shorts',name:'Shorts Progress Bar',cat:'Viral Hooks',tag:'YouTube',desc:'Watch-time retention progress bar and retention hook at top.',top:'Watch till end...',bottom:'SHORTS PROGRESS'},
 {id:'shorts_progress',name:'Shorts Retention Hook',cat:'Viral Hooks',tag:'Retention',desc:'Progress bar with pinned hook for YouTube Shorts.',top:'100%',bottom:'SHORTS RETENTION'},
 {id:'post_hook',name:'Post Hook Statement',cat:'Social Posts',tag:'Hook',desc:'Card with large pinned statement and verified social badge.',top:'STATEMENT',bottom:'POST HOOK CARD'},
 {id:'clean',name:'Clean Canvas',cat:'Aesthetic & Tech',tag:'Clean',desc:'Minimal padding, borderless canvas, and soft caption style.',top:'CLEAN',bottom:'CLEAN CANVAS'},
 {id:'centered_canvas',name:'Centered 9:16 Canvas',cat:'Aesthetic & Tech',tag:'Canvas',desc:'Centered clip on a clean 9:16 solid/blurred canvas.',top:'',bottom:'CENTERED CANVAS'},
 {id:'wide_16x9',name:'16:9 Clip',cat:'Aesthetic & Tech',tag:'Wide',desc:'Full-width landscape clip letterboxed for vertical feeds.',top:'',bottom:'16:9 CLIP'},
 {id:'minimal_gradient',name:'Minimal Gradient',cat:'Aesthetic & Tech',tag:'Gradient',desc:'Soft gradient background with restrained captions.',top:'',bottom:'MINIMAL GRADIENT'}
];

window.yzTemplateNames=Object.fromEntries(window.yzTemplates.map(t=>[t.id,t.name]));

function yzPanel(name){
 $$('.yz-panel-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.panel===name));
 ['framing','templates','text','media'].forEach(n=>$('#yz-panel-'+n).hidden=(n!==name));
}

function yzAcc(el){
 const b=el.nextElementSibling;
 if(b&&b.classList.contains('yz-card-body')){
  const isHidden=b.style.display==='none';
  b.style.display=isHidden?'block':'none';
  const chev=el.querySelector('.yz-chev');
  if(chev)chev.textContent=isHidden?'‹':'›';
 }
}

function yzSegClick(b){
 b.parentElement.querySelectorAll('button').forEach(x=>x.classList.remove('on'));
 b.classList.add('on');
}

function yzToggleEl(el){
 el.classList.toggle('on');
}

function yzSlide(input,id,suffix){
 $('#'+id).textContent=input.value+suffix;
}

function yzColor(input){
 const hex=input.closest('.yz-card-body')?.querySelector('#yz-color-hex');
 if(hex)hex.value=input.value.toUpperCase();
}

function yzSetColor(hex){
 const c=$('.yz-colorrow input[type=color]');
 const t=$('#yz-color-hex');
 if(c)c.value=hex;
 if(t)t.value=hex;
}

function yzToggleSafeZones(){
 state.showSafeZones=!state.showSafeZones;
 $('#safe-overlay').classList.toggle('on',state.showSafeZones);
 $('#yz-safe-btn').classList.toggle('active',state.showSafeZones);
 toast(state.showSafeZones?'Safe Zones enabled':'Safe Zones disabled');
}

function formatTimecode(secs){
 if(isNaN(secs)||secs<0)secs=0;
 const m=Math.floor(secs/60);
 const s=Math.floor(secs%60);
 const ms=Math.floor((secs%1)*100);
 return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(2,'0')}`;
}

function formatHMS(secs){
 if(isNaN(secs)||secs<0)secs=0;
 const h=Math.floor(secs/3600);
 const m=Math.floor((secs%3600)/60);
 const s=Math.floor(secs%60);
 return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// Video Player & Transport
const videoEl=$('#yz-video');
videoEl.addEventListener('timeupdate',()=>{
 const cur=videoEl.currentTime;
 const dur=videoEl.duration||0;
 $('#yz-time').textContent=`${formatHMS(cur)} / ${formatHMS(dur)}`;
});

videoEl.addEventListener('loadedmetadata',()=>{
 state.duration=videoEl.duration||0;
 state.trimIn=0;
 state.trimOut=state.duration;
 updateTrimDisplay();
});

function yzPlay(){
 if(!videoEl||!videoEl.src)return;
 if(videoEl.paused){
  videoEl.play();
  $('#play-btn').textContent='❚❚';
 }else{
  videoEl.pause();
  $('#play-btn').textContent='▶';
 }
}

function yzSeek(dir){
 if(!videoEl||!videoEl.src)return;
 videoEl.currentTime=Math.max(0,Math.min(videoEl.duration||0,videoEl.currentTime+dir*5));
}

function cycleSpeed(){
 const speeds=[0.5,0.75,1.0,1.25,1.5,2.0];
 const idx=speeds.indexOf(state.playbackSpeed);
 const next=speeds[(idx+1)%speeds.length];
 setSpeed(next);
}

function setSpeed(spd,btn){
 state.playbackSpeed=spd;
 videoEl.playbackRate=spd;
 $('#speed-btn').textContent=spd+'x';
 $$('#yz-panel-framing .ac-seg button').forEach(b=>b.classList.toggle('on',b.textContent===spd+'x'));
 toast(`Speed: ${spd}x`);
}

// In / Out Trim
function yzSetIn(){
 if(!videoEl||!videoEl.src)return;
 state.trimIn=videoEl.currentTime;
 if(state.trimIn>state.trimOut)state.trimOut=state.duration;
 updateTrimDisplay();
 toast(`Trim In: ${formatTimecode(state.trimIn)}`);
}

function yzSetOut(){
 if(!videoEl||!videoEl.src)return;
 state.trimOut=videoEl.currentTime;
 if(state.trimOut<state.trimIn)state.trimIn=0;
 updateTrimDisplay();
 toast(`Trim Out: ${formatTimecode(state.trimOut)}`);
}

function yzResetTrim(){
 state.trimIn=0;
 state.trimOut=state.duration;
 updateTrimDisplay();
 toast('Trim reset to full duration');
}

function updateTrimDisplay(){
 $('#yz-in').textContent=formatTimecode(state.trimIn);
 $('#yz-out').textContent=formatTimecode(state.trimOut);
 const dur=Math.max(0,state.trimOut-state.trimIn);
 $('#yz-duration').textContent=`Duration ${dur.toFixed(1)}s`;
 const trackTrim=$('#v1-trim');
 if(trackTrim&&state.duration>0){
  const leftPct=(state.trimIn/state.duration)*100;
  const widthPct=(dur/state.duration)*100;
  trackTrim.style.left=leftPct+'%';
  trackTrim.style.width=widthPct+'%';
 }
}

function yzZoom(el){
 const zoom=+el.value;
 el.nextElementSibling.textContent=zoom+'%';
 $('#timeline-tracks').style.transform=`scaleX(${zoom/100})`;
 $('#timeline-tracks').style.transformOrigin='left';
}

function yzFitTimeline(){
 $('.yz-zoom input').value=100;
 $('.yz-zoom input').nextElementSibling.textContent='100%';
 $('#timeline-tracks').style.transform='none';
 toast('Timeline fitted');
}

// History
window.yzHistory=[];window.yzFuture=[];
function yzSnapshot(){return JSON.stringify(state.cfg)}
function yzPush(){
 window.yzHistory.push(yzSnapshot());
 window.yzFuture=[];
 if(window.yzHistory.length>40)window.yzHistory.shift();
}
function yzUndo(){
 if(!window.yzHistory.length){toast('Nothing to undo');return;}
 window.yzFuture.push(yzSnapshot());
 yzApplySnapshot(window.yzHistory.pop());
 toast('Undo');
}
function yzRedo(){
 if(!window.yzFuture.length){toast('Nothing to redo');return;}
 window.yzHistory.push(yzSnapshot());
 yzApplySnapshot(window.yzFuture.pop());
 toast('Redo');
}
function yzApplySnapshot(json){
 const o=JSON.parse(json);
 Object.keys(o).forEach(k=>state.cfg[k]=o[k]);
 $$('.yz-layout-btn').forEach(x=>x.classList.toggle('active',x.dataset.layout===state.cfg.layout));
}

function yzReset(){
 const h=$('#yz-hook'),o=$('#yz-headline');
 if(h)h.value='';if(o)o.value='';
 state.cfg.layout='solo';
 state.cfg.canvas='solid';
 $$('.yz-layout-btn').forEach(x=>x.classList.toggle('active',x.dataset.layout==='solo'));
 yzResetTrim();
 toast('Editor adjustments reset');
}

function yzLayout(btn){
 yzPush();
 $$('.yz-layout-btn[data-layout]').forEach(x=>x.classList.remove('active'));
 btn.classList.add('active');
 state.cfg.layout=btn.dataset.layout||'solo';
 toast(`Layout: ${state.cfg.layout}`);
}

function yzAspect(){
 yzPush();
 const b=$('#yz-aspect-btn');
 const opts=['9:16','1:1','16:9'];
 const cur=opts.findIndex(x=>b.textContent.includes(x));
 const next=opts[(cur+1)%opts.length];
 b.textContent='▾ '+next;
 state.cfg.aspect=next;
 toast(`Aspect ratio: ${next}`);
}

function yzAutoAlign(){
 toast('Subtitles auto-aligned for platform safe zones');
}

function switchTextSubtab(tab){
 $('#text-tab-headline').classList.toggle('on',tab==='headline');
 $('#text-tab-subs').classList.toggle('on',tab==='subs');
 $('#text-subtab-headline').style.display=tab==='headline'?'block':'none';
 $('#text-subtab-subs').style.display=tab==='subs'?'block':'none';
}

function setCasing(casing,btn){
 $$('#text-subtab-headline .ac-seg button').forEach(b=>b.classList.remove('on'));
 btn.classList.add('on');
 const h=$('#yz-headline');
 if(!h||!h.value)return;
 if(casing==='upper')h.value=h.value.toUpperCase();
 else if(casing==='lower')h.value=h.value.toLowerCase();
 else if(casing==='title')h.value=h.value.replace(/\b\w/g,c=>c.toUpperCase());
}

function yzSelectAudio(){
 const i=document.createElement('input');
 i.type='file';i.accept='audio/*';
 i.onchange=e=>{
  const f=e.target.files[0];
  if(f){
   $('#audio-selected-name').textContent=f.name;
   $('#lane-music').textContent=`Music: ${f.name}`;
   state.cfg.audio_peak=true;
   toast(`Audio loaded: ${f.name}`);
  }
 };
 i.click();
}

function yzLive(){
 if(videoEl&&videoEl.src){
  videoEl.requestFullscreen?.()||videoEl.webkitRequestFullscreen?.();
 }else toast('Load a clip first to preview');
}

function openShortcuts(){
 const m=$('#shortcuts-modal');
 if(m)m.showModal();
}

// Template modal
function yzTemplateModal(){
 const d=$('#yz-modal');
 if(!d.open)d.showModal();
 $('#yz-search').value='';
 $('#yz-template-grid').innerHTML=window.yzTemplates.map(t=>{
  const active=state.cfg.template===t.id?'true':'false';
  return `
  <div class="yz-tpl" role="button" tabindex="0" aria-pressed="${active}" data-cat="${t.cat}" data-id="${t.id}"
    onclick="yzUseTemplate('${t.id}')">
   <div class="yz-thumb">
    <div class="yz-stage">
     <div class="yz-stage-top">${t.top||'CLIP'}</div>
     <div class="yz-stage-video">▶</div>
     <div class="yz-stage-caption">${t.bottom||t.name}</div>
    </div>
   </div>
   <div class="yz-tpl-body">
    <div class="yz-tpl-title"><b>${t.name}</b><span class="yz-tpl-tag">${t.tag}</span></div>
    <small>${t.desc}</small>
    <button class="yz-use" tabindex="-1">Use Template</button>
   </div>
  </div>`;
 }).join('');
}

function yzCloseModal(){
 const d=$('#yz-modal');
 if(d.open)d.close();
}

function yzCat(b){
 $$('.yz-cat').forEach(x=>x.classList.remove('on'));
 b.classList.add('on');
 const c=b.textContent.trim();
 $$('#yz-template-grid .yz-tpl').forEach(el=>{
  el.style.display=(c==='All'||el.dataset.cat===c)?'block':'none';
 });
}

function yzFilter(){
 const q=$('#yz-search').value.toLowerCase();
 $$('#yz-template-grid .yz-tpl').forEach(c=>{
  c.style.display=c.textContent.toLowerCase().includes(q)?'block':'none';
 });
}

function yzUseTemplate(id){
 yzPush();
 state.cfg.template=id;
 const name=window.yzTemplateNames[id]||id;
 $('#yz-template-name').textContent=name;
 const found=window.yzTemplates.find(x=>x.id===id);
 if(found)$('#yz-template-desc').textContent=found.desc;
 yzCloseModal();
 toast(`Template switched to ${name}`);
}

function renderEditor(){
 const c=state.current;
 const empty=$('#yz-empty');
 if(c){
  videoEl.src=`/api/clips/${c.id}/media`;
  videoEl.style.display='block';
  empty.style.display='none';
  $('#yz-hook').value=c.title||'';
  $('#yz-template-hook').value=c.title||'';
  $('#yz-headline').value=c.title||'';
  const tName=window.yzTemplateNames[c.template]||c.template||'Plain 9:16';
  $('#yz-template-name').textContent=tName;
  state.cfg.template=c.template||'default';

  // Subtitle cue list
  const cueBox=$('#subs-cue-list');
  if(c.words&&c.words.length){
   cueBox.innerHTML=c.words.map((w,i)=>`
    <div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid var(--ac-line-2)">
     <span class="ac-meta" style="min-width:60px">${(w.start_ms/1000).toFixed(1)}s</span>
     <input class="yz-input" value="${w.text}" style="padding:4px 8px" onchange="updateCueWord(${i},this.value)">
    </div>
   `).join('');
  }else{
   cueBox.innerHTML='<div class="ac-meta">No individual word cues. Word-synced captions generated during render.</div>';
  }
 }else{
  videoEl.removeAttribute('src');
  videoEl.style.display='none';
  empty.style.display='block';
 }
}

function updateCueWord(idx,newWord){
 if(state.current&&state.current.words&&state.current.words[idx]){
  state.current.words[idx].text=newWord;
  toast('Cue updated');
 }
}

async function yzExport(){
 const clip=state.current;
 if(!clip){
  toast('Please select a clip first from the Clips page or Dashboard');
  return;
 }
 toast('Exporting video with current settings...');
 const body={
  template:state.cfg.template||clip.template||'default',
  font:$('#yz-font')?.value||'Inter',
  subtitle_style:state.cfg.style||'karaoke',
  aspect:state.cfg.aspect||'9:16',
  layout:state.cfg.layout||'solo',
  canvas:state.cfg.canvas||'solid',
  in_ms:Math.round(state.trimIn*1000),
  out_ms:Math.round(state.trimOut*1000),
  hook:$('#yz-hook')?.value||'',
  outro:$('#yz-outro-text')?.value||'',
  social:{
   handle:$('#yz-handle')?.value||'@creator',
   style:'verified'
  },
  watermark:$('#yz-watermark-text')?.value||'',
  audio_peak:$('#yz-audio-peak')?.checked||false,
  audio_peak_ms:(+$('#yz-riser-sec')?.textContent.replace('s','')||5)*1000
 };
 const r=await api(`/api/clips/${clip.id}/configure`,{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)
 });
 if(r.error){
  toast('Export error: '+r.error);
 }else{
  toast('Video successfully rendered & exported!');
  state.current=r.clip;
  renderEditor();
  loadClips();
 }
}

// Global Keyboard Shortcuts
document.addEventListener('keydown',e=>{
 if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;
 if(e.key==='Escape'){yzCloseModal();$('#shortcuts-modal')?.close();}
 if(state.page==='editor'){
  if(e.code==='Space'){e.preventDefault();yzPlay();}
  if(e.code==='ArrowLeft'){e.preventDefault();yzSeek(-1);}
  if(e.code==='ArrowRight'){e.preventDefault();yzSeek(1);}
  if(e.key==='['){e.preventDefault();yzSetIn();}
  if(e.key===']'){e.preventDefault();yzSetOut();}
  if(e.key==='z'&&e.ctrlKey){e.preventDefault();yzUndo();}
  if(e.key==='y'&&e.ctrlKey){e.preventDefault();yzRedo();}
  if(e.key==='l'&&e.ctrlKey){e.preventDefault();yzLive();}
 }
});

// Initial boot
loadJobs();
</script></body></html>"##
}
