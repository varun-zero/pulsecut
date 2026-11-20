//! PulseCut automation controller — Rust migration of `automation/agent.py`.
//!
//! Drives the whole workflow through the local HTTP API so every short is
//! created, verified, scored, captioned, approved and published under audit:
//!   doctor -> run -> verify+QA -> inspect -> caption -> approve -> publish -> status
//!
//! All state is atomically persisted to `automation/ledger.json` (UTF-8, no BOM).

use clap::{Parser, Subcommand};
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs_f64()
}
fn base_url() -> String {
    env::var("PULSECUT_API_URL").unwrap_or_else(|_| "http://127.0.0.1:8756".into()).trim_end_matches('/').to_string()
}
fn ledger_path() -> PathBuf {
    // Prefer the repo's automation/ledger.json; fall back to cwd.
    let p = PathBuf::from("automation/ledger.json");
    if p.parent().map(|x| x.is_dir()).unwrap_or(false) { p } else { PathBuf::from("ledger.json") }
}

fn load_ledger() -> Value {
    let mut base = json!({"runs":[],"verifications":{},"captions":{},"approvals":{},"publishes":{}});
    if let Ok(text) = fs::read_to_string(ledger_path()) {
        let text = text.trim_start_matches('\u{feff}'); // BOM-tolerant
        if let Ok(v) = serde_json::from_str::<Value>(text) {
            if v.is_object() {
                if let (Some(a), Some(b)) = (base.as_object_mut(), v.as_object()) {
                    for (k, val) in b { a.insert(k.clone(), val.clone()); }
                }
            }
        }
    }
    base
}
fn save_ledger(data: &Value) {
    let p = ledger_path();
    if let Some(parent) = p.parent() { let _ = fs::create_dir_all(parent); }
    let mut tmp = p.clone();
    tmp.set_extension("tmp");
    let text = serde_json::to_string_pretty(data).unwrap_or_else(|_| "{}".into());
    if let Ok(mut f) = fs::File::create(&tmp) {
        let _ = f.write_all(text.as_bytes());
        let _ = f.write_all(b"\n");
    }
    let _ = fs::rename(&tmp, &p);
}

async fn api(method: &str, path: &str, body: Option<Value>, timeout_secs: u64) -> (u16, Value) {
    let url = format!("{}{}", base_url(), path);
    let client = match reqwest::Client::builder().timeout(Duration::from_secs(timeout_secs)).build() {
        Ok(c) => c,
        Err(e) => return (0, json!({"error": e.to_string()})),
    };
    let mut req = client.request(method.parse().unwrap_or(reqwest::Method::GET), &url);
    if let Some(b) = body { req = req.json(&b); }
    match req.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let v = resp.json::<Value>().await.unwrap_or_else(|_| json!({}));
            (status, v)
        }
        Err(e) => (0, json!({"error": format!("cannot reach PulseCut API at {url}: {e}")})),
    }
}

fn check_bin(env_var: &str, names: &[&str]) -> Value {
    if let Ok(v) = env::var(env_var) {
        if !v.is_empty() && Path::new(&v).is_file() {
            return json!({"ok": true, "path": v});
        }
    }
    for n in names {
        // simple PATH scan
        if let Ok(path) = env::var("PATH") {
            for dir in env::split_paths(&path) {
                let mut p = dir.join(n);
                if cfg!(windows) && p.extension().is_none() { p.set_extension("exe"); }
                if p.is_file() { return json!({"ok": true, "path": p.to_string_lossy()}); }
            }
        }
    }
    json!({"ok": false, "path": Value::Null})
}

#[derive(Parser, Debug)]
#[command(name = "pulsecut-agent", about = "PulseCut automation controller")]
struct Cli {
    #[command(subcommand)]
    cmd: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    Doctor,
    Status,
    Run {
        url: String,
        #[arg(long, default_value_t = 6)] max_clips: usize,
        #[arg(long, default_value = "default")] template: String,
        #[arg(long)] is_live: bool,
        #[arg(long)] channel: Option<String>,
        #[arg(long)] platform: Option<String>,
        #[arg(long, default_value_t = 900)] timeout: u64,
    },
    Verify { clip_id: Option<String>, #[arg(long)] strict: bool },
    Inspect { clip_id: String },
    Configure {
        clip_id: String,
        #[arg(long)] template: Option<String>,
        #[arg(long)] hook: Option<String>,
        #[arg(long)] watermark: Option<String>,
        #[arg(long)] aspect: Option<String>,
        #[arg(long)] layout: Option<String>,
        #[arg(long, long = "subtitle-style")] subtitle_style: Option<String>,
    },
    Caption {
        clip_id: String,
        #[arg(long)] title: String,
        #[arg(long)] description: Option<String>,
        #[arg(long)] hashtags: Option<String>,
        #[arg(long)] hook: Option<String>,
    },
    Approve { clip_id: String },
    Reject { clip_id: String },
    Delete { clip_id: String },
    Publish {
        clip_id: String,
        #[arg(long)] targets: Option<String>,
        #[arg(long)] token_env: Option<String>,
        #[arg(long)] force: bool,
        #[arg(long)] auto_approve: bool,
    },
    Qa { clip_id: String },
    Full {
        url: String,
        #[arg(long, default_value_t = 6)] max_clips: usize,
        #[arg(long, default_value = "default")] template: String,
        #[arg(long)] is_live: bool,
        #[arg(long)] channel: Option<String>,
        #[arg(long)] platform: Option<String>,
        #[arg(long, default_value_t = 900)] timeout: u64,
    },
}

fn print_json(v: &Value) { println!("{}", serde_json::to_string_pretty(v).unwrap_or_else(|_| "{}".into())); }

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    let code = run(cli.cmd).await;
    std::process::exit(code);
}

async fn run(cmd: Command) -> i32 {
    match cmd {
        Command::Doctor => doctor().await,
        Command::Status => status().await,
        Command::Run { url, max_clips, template, is_live, channel, platform, timeout } =>
            run_job(&url, max_clips, &template, is_live, channel.as_deref(), platform.as_deref(), timeout).await,
        Command::Verify { clip_id, strict } => verify(clip_id.as_deref(), strict).await,
        Command::Inspect { clip_id } => inspect(&clip_id).await,
        Command::Configure { clip_id, template, hook, watermark, aspect, layout, subtitle_style } =>
            configure(&clip_id, template.as_deref(), hook.as_deref(), watermark.as_deref(), aspect.as_deref(), layout.as_deref(), subtitle_style.as_deref()).await,
        Command::Caption { clip_id, title, description, hashtags, hook } =>
            caption(&clip_id, &title, description.as_deref(), hashtags.as_deref(), hook.as_deref()).await,
        Command::Approve { clip_id } => approval(&clip_id, "approve", "/approve").await,
        Command::Reject { clip_id } => approval(&clip_id, "reject", "/reject").await,
        Command::Delete { clip_id } => {
            let (s, r) = api("POST", &format!("/api/clips/{clip_id}/delete"), Some(json!({})), 30).await;
            print_json(&json!({"status": s, "result": r})); if s == 200 { 0 } else { 1 }
        }
        Command::Publish { clip_id, targets, token_env, force, auto_approve } =>
            publish(&clip_id, targets.as_deref(), token_env.as_deref(), force, auto_approve).await,
        Command::Qa { clip_id } => {
            let b = base_url();
            print_json(&json!({"clip_id": clip_id, "frames": [
                format!("{b}/api/qa/{clip_id}/start.jpg"),
                format!("{b}/api/qa/{clip_id}/mid.jpg"),
                format!("{b}/api/qa/{clip_id}/end.jpg")
            ]})); 0
        }
        Command::Full { url, max_clips, template, is_live, channel, platform, timeout } =>
            full(&url, max_clips, &template, is_live, channel.as_deref(), platform.as_deref(), timeout).await,
    }
}

async fn doctor() -> i32 {
    let (sc, health) = api("GET", "/health", None, 5).await;
    let backend_ok = sc == 200 && health.get("ok").and_then(|x| x.as_bool()).unwrap_or(false);
    let tokens = json!({
        "PULSECUT_WOOPSOCIAL_TOKEN": env::var("PULSECUT_WOOPSOCIAL_TOKEN").is_ok(),
        "PULSECUT_YOUTUBE_TOKEN": env::var("PULSECUT_YOUTUBE_TOKEN").is_ok(),
        "PULSECUT_IG_TOKEN": env::var("PULSECUT_IG_TOKEN").is_ok(),
        "PULSECUT_IG_USER_ID": env::var("PULSECUT_IG_USER_ID").is_ok(),
        "PULSECUT_TIKTOK_TOKEN": env::var("PULSECUT_TIKTOK_TOKEN").is_ok(),
        "PULSECUT_UPLOADPOST_TOKEN": env::var("PULSECUT_UPLOADPOST_TOKEN").is_ok(),
        "PULSECUT_POSTIZ_TOKEN": env::var("PULSECUT_POSTIZ_TOKEN").is_ok(),
        "OPENROUTER_API_KEY": env::var("OPENROUTER_API_KEY").is_ok(),
        "GROQ_API_KEY": env::var("GROQ_API_KEY").is_ok(),
        "OPENAI_API_KEY": env::var("OPENAI_API_KEY").is_ok(),
    });
    let whisper = check_bin("PULSECUT_WHISPER", &["whisper-cli", "whisper"]);
    // faster-whisper is a Python lib; report whether the shim exists and points to a .py we can check
    let fw = env::var("PULSECUT_WHISPER").map(|p| Path::new(&p).with_file_name("whisper_cli.py").is_file()).unwrap_or(false);
    let report = json!({
        "api_url": base_url(),
        "backend": {"ok": backend_ok, "status": sc, "health": health},
        "binaries": {
            "ffmpeg": check_bin("PULSECUT_FFMPEG", &["ffmpeg", "ffmpeg.exe"]),
            "ffprobe": check_bin("PULSECUT_FFPROBE", &["ffprobe", "ffprobe.exe"]),
            "yt_dlp": check_bin("PULSECUT_YTDLP", &["yt-dlp", "yt-dlp.exe"]),
            "whisper": whisper,
        },
        "faster_whisper_installed": fw,
        "publisher": {"mode": env::var("PULSECUT_PUBLISHER").unwrap_or_else(|_| "woopsocial".into()), "tokens_present": tokens},
        "ready_to_clip": backend_ok,
        "ready_to_publish": backend_ok && tokens.as_object().unwrap().values().any(|v| v.as_bool().unwrap_or(false)),
    });
    print_json(&report); if backend_ok { 0 } else { 1 }
}

async fn status() -> i32 {
    let (hs, health) = api("GET", "/health", None, 30).await;
    if hs != 200 { print_json(&json!({"ok": false, "error": health})); return 1; }
    let jobs = api("GET", "/api/jobs", None, 30).await.1;
    let clips = api("GET", "/api/clips", None, 30).await.1;
    let clip_list = clips.get("clips").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    let out: Vec<Value> = clip_list.iter().map(|c| json!({
        "id": c.get("id"), "title": c.get("title"), "template": c.get("template"),
        "words": c.get("words").and_then(|x| x.as_array()).map(|x| x.len()).unwrap_or(0),
        "confidence": c.get("confidence"), "status": c.get("status"),
    })).collect();
    print_json(&json!({"health": health, "jobs": jobs.get("jobs").cloned().unwrap_or(json!([])), "clips": out})); 0
}

async fn wait_job(jid: &str, timeout: u64) -> Value {
    let start = std::time::Instant::now();
    let mut last = String::new();
    while start.elapsed().as_secs() < timeout {
        let (code, r) = api("GET", &format!("/api/jobs/{jid}"), None, 5).await;
        if code != 200 { return json!({"status": "failed", "error": r}); }
        let j = r.get("job").cloned().unwrap_or(r.clone());
        let line = format!("{} {}% {}", j.get("status").and_then(|x| x.as_str()).unwrap_or("?"),
            j.get("progress").and_then(|x| x.as_u64()).unwrap_or(0),
            j.get("message").and_then(|x| x.as_str()).unwrap_or(""));
        if line != last { eprintln!("[{}s] {line}", start.elapsed().as_secs()); last = line; }
        let st = j.get("status").and_then(|x| x.as_str()).unwrap_or("");
        if st == "done" || st == "failed" { return j; }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
    json!({"status": "timeout", "message": format!("timed out after {timeout}s")})
}

async fn run_job(url: &str, max_clips: usize, template: &str, is_live: bool, channel: Option<&str>, platform: Option<&str>, timeout: u64) -> i32 {
    let mut data = json!({"url": url, "max_clips": max_clips, "template": template});
    if is_live {
        data["is_live"] = json!(true);
        data["channel"] = json!(channel.unwrap_or("live"));
        data["platform"] = json!(platform.unwrap_or("kick"));
    }
    let (s, r) = api("POST", "/api/jobs", Some(data.clone()), 30).await;
    if (s != 200 && s != 202) || !r.get("job").is_some() {
        print_json(&json!({"error": r, "status": s})); return 1;
    }
    let jid = r["job"]["id"].as_str().unwrap_or("").to_string();
    eprintln!("job {jid} created");
    let final_j = wait_job(&jid, timeout).await;
    let mut ledger = load_ledger();
    if let Some(arr) = ledger.get_mut("runs").and_then(|x| x.as_array_mut()) {
        arr.push(json!({"job_id": jid, "url": url, "final": final_j, "at": now()}));
    }
    save_ledger(&ledger);
    print_json(&json!({"job_id": jid, "final": final_j}));
    if final_j.get("status").and_then(|x| x.as_str()) == Some("done") { 0 } else { 1 }
}

async fn verify_one(cid: &str) -> (u16, Value) {
    api("POST", &format!("/api/clips/{cid}/verify"), Some(json!({})), 120).await
}

async fn verify_ids(ids: &[String]) -> (Vec<Value>, bool) {
    let mut ledger = load_ledger();
    let mut out = Vec::new();
    let mut all_ok = true;
    let b = base_url();
    for cid in ids {
        let (s, r) = verify_one(cid).await;
        if let Some(m) = ledger.get_mut("verifications").and_then(|x| x.as_object_mut()) {
            m.insert(cid.clone(), json!({"status": s, "result": r, "at": now()}));
        }
        let is_ok = s == 200 && r.get("ok").and_then(|x| x.as_bool()).unwrap_or(false);
        if !is_ok { all_ok = false; }
        let frames = r.get("sample_frames").and_then(|x| x.as_array()).cloned().unwrap_or_default()
            .iter().map(|f| json!(format!("{b}{}", f.as_str().unwrap_or("")))).collect::<Vec<_>>();
        out.push(json!({
            "id": cid, "ok": is_ok,
            "status": r.get("status").cloned(),
            "vitality": r.get("vitality_score").cloned(),
            "viral": r.get("viral_score").cloned(),
            "viral_reason": r.get("viral_reason").cloned(),
            "has_transcript": r.get("has_transcript").cloned(),
            "word_count": r.get("word_count").cloned(),
            "reasons": r.get("reasons").cloned().unwrap_or(r.clone()),
            "sample_frames": frames,
        }));
    }
    save_ledger(&ledger);
    (out, all_ok)
}

async fn verify(clip_id: Option<&str>, strict: bool) -> i32 {
    let ids: Vec<String> = if let Some(c) = clip_id { vec![c.to_string()] } else {
        let (cs, resp) = api("GET", "/api/clips", None, 30).await;
        if cs != 200 { print_json(&json!({"ok": false, "error": resp})); return 1; }
        resp.get("clips").and_then(|x| x.as_array()).cloned().unwrap_or_default()
            .iter().filter_map(|c| c.get("id").and_then(|x| x.as_str()).map(String::from)).collect()
    };
    let (out, all_ok) = verify_ids(&ids).await;
    print_json(&json!(out));
    if strict && !all_ok { 1 } else { 0 }
}

async fn inspect(clip_id: &str) -> i32 {
    let (s, r) = api("GET", &format!("/api/clips/{clip_id}"), None, 30).await;
    let clip = match r.get("clip") { Some(c) => c, None => { print_json(&json!({"ok": false, "status": s, "error": r})); return 1; } };
    let words = clip.get("words").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    let transcript = words.iter().filter_map(|w| w.get("text").and_then(|x| x.as_str()).map(str::trim).filter(|s| !s.is_empty())).collect::<Vec<_>>().join(" ");
    let win = clip.get("source_window").cloned().unwrap_or(json!({}));
    let dur = ((win.get("end_ms").and_then(|x| x.as_i64()).unwrap_or(0) - win.get("start_ms").and_then(|x| x.as_i64()).unwrap_or(0)).max(0)) as f64 / 1000.0;
    print_json(&json!({
        "id": clip.get("id"), "status": clip.get("status"), "platform": clip.get("platform"),
        "channel": clip.get("channel"), "template": clip.get("template"),
        "duration_s": (dur * 100.0).round() / 100.0,
        "viral_score": clip.get("confidence"), "viral_reason": win.get("snap_reason"),
        "title": clip.get("title"), "description": clip.get("description"),
        "hashtags": clip.get("hashtags").cloned().unwrap_or(json!([])),
        "word_count": words.len(), "transcript": transcript, "video_path": clip.get("video_path"),
    })); 0
}

async fn configure(cid: &str, template: Option<&str>, hook: Option<&str>, watermark: Option<&str>, aspect: Option<&str>, layout: Option<&str>, subtitle_style: Option<&str>) -> i32 {
    let mut p = serde_json::Map::new();
    for (k, v) in [("template", template), ("hook", hook), ("watermark", watermark), ("aspect", aspect), ("layout", layout), ("subtitle_style", subtitle_style)] {
        if let Some(val) = v { p.insert(k.into(), json!(val)); }
    }
    let (s, r) = api("POST", &format!("/api/clips/{cid}/configure"), Some(Value::Object(p)), 300).await;
    print_json(&json!({"status": s, "result": r})); if s == 200 { 0 } else { 1 }
}

async fn caption(cid: &str, title: &str, description: Option<&str>, hashtags: Option<&str>, hook: Option<&str>) -> i32 {
    let mut d = json!({"title": title});
    if let Some(x) = description { d["description"] = json!(x); }
    if let Some(x) = hashtags { d["hashtags"] = json!(x.split(',').map(str::trim).filter(|s| !s.is_empty()).collect::<Vec<_>>()); }
    if let Some(x) = hook { d["hook"] = json!(x); }
    let (s, r) = api("POST", &format!("/api/clips/{cid}/metadata"), Some(d.clone()), 30).await;
    let mut ledger = load_ledger();
    if let Some(m) = ledger.get_mut("captions").and_then(|x| x.as_object_mut()) {
        m.insert(cid.into(), json!({"data": d, "status": s, "at": now()}));
    }
    save_ledger(&ledger);
    print_json(&json!({"status": s, "result": r})); if s == 200 { 0 } else { 1 }
}

async fn approval(cid: &str, action: &str, endpoint: &str) -> i32 {
    let (s, r) = api("POST", &format!("/api/clips/{cid}{endpoint}"), Some(json!({})), 30).await;
    let mut ledger = load_ledger();
    if let Some(m) = ledger.get_mut("approvals").and_then(|x| x.as_object_mut()) {
        m.insert(cid.into(), json!({"action": action, "status": s, "at": now()}));
    }
    save_ledger(&ledger);
    print_json(&json!({"status": s, "result": r})); if s == 200 { 0 } else { 1 }
}

async fn publish(cid: &str, targets: Option<&str>, token_env: Option<&str>, force: bool, auto_approve: bool) -> i32 {
    let mut ledger = load_ledger();
    if !force {
        let ver = ledger.get("verifications").and_then(|x| x.get(cid)).cloned().unwrap_or(json!({}));
        let ver_ok = ver.get("status").and_then(|x| x.as_u64()) == Some(200)
            && ver.get("result").and_then(|x| x.get("ok")).and_then(|x| x.as_bool()).unwrap_or(false);
        if !ver_ok {
            let (s, r) = verify_one(cid).await;
            if let Some(m) = ledger.get_mut("verifications").and_then(|x| x.as_object_mut()) {
                m.insert(cid.into(), json!({"status": s, "result": r, "at": now()}));
            }
            save_ledger(&ledger);
            if !(s == 200 && r.get("ok").and_then(|x| x.as_bool()).unwrap_or(false)) {
                print_json(&json!({"ok": false, "blocked": "verification_failed", "verification": r,
                    "hint": "Fix the failed verification checks or pass --force"})); return 1;
            }
        }
        if auto_approve {
            let _ = api("POST", &format!("/api/clips/{cid}/approve"), Some(json!({})), 30).await;
            if let Some(m) = ledger.get_mut("approvals").and_then(|x| x.as_object_mut()) {
                m.insert(cid.into(), json!({"action": "auto_approve", "status": 200, "at": now()}));
            }
            save_ledger(&ledger);
        }
    }
    let mut d = json!({});
    if let Some(t) = targets { d["targets"] = json!(t.split(',').map(str::trim).filter(|s| !s.is_empty()).collect::<Vec<_>>()); }
    if let Some(t) = token_env { d["token_env"] = json!(t); }
    if force { d["force"] = json!(true); }
    let (s, r) = api("POST", &format!("/api/clips/{cid}/publish"), Some(d.clone()), 180).await;
    if let Some(m) = ledger.get_mut("publishes").and_then(|x| x.as_object_mut()) {
        m.insert(cid.into(), json!({"targets": d.get("targets").cloned(), "status": s, "result": r, "at": now()}));
    }
    save_ledger(&ledger);
    print_json(&json!({"status": s, "result": r}));
    if s == 200 && r.get("ok").and_then(|x| x.as_bool()).unwrap_or(false) { 0 } else { 1 }
}

async fn full(url: &str, max_clips: usize, template: &str, is_live: bool, channel: Option<&str>, platform: Option<&str>, timeout: u64) -> i32 {
    let mut data = json!({"url": url, "max_clips": max_clips, "template": template});
    if is_live { data["is_live"] = json!(true); data["channel"] = json!(channel.unwrap_or("live")); data["platform"] = json!(platform.unwrap_or("kick")); }
    let (s, r) = api("POST", "/api/jobs", Some(data), 30).await;
    let jid = r.get("job").and_then(|x| x.get("id")).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let final_j = if s == 200 || s == 202 { wait_job(&jid, timeout).await } else { json!({"status": "failed"}) };
    if final_j.get("status").and_then(|x| x.as_str()) != Some("done") {
        print_json(&json!({"ok": false, "job_id": jid, "final": final_j})); return 1;
    }
    let mut ids: Vec<String> = final_j.get("clip_ids").and_then(|x| x.as_array()).cloned().unwrap_or_default()
        .iter().filter_map(|x| x.as_str().map(String::from)).collect();
    if ids.is_empty() {
        let resp = api("GET", "/api/clips", None, 30).await.1;
        ids = resp.get("clips").and_then(|x| x.as_array()).cloned().unwrap_or_default().iter()
            .take(max_clips).filter_map(|c| c.get("id").and_then(|x| x.as_str()).map(String::from)).collect();
    }
    let (mut verifications, all_ok) = verify_ids(&ids).await;
    for item in &mut verifications {
        let cid = item.get("id").and_then(|x| x.as_str()).unwrap_or("");
        let cr = api("GET", &format!("/api/clips/{cid}"), None, 30).await.1;
        if let Some(c) = cr.get("clip") {
            let words = c.get("words").and_then(|x| x.as_array()).cloned().unwrap_or_default();
            let preview = words.iter().take(45).filter_map(|w| w.get("text").and_then(|x| x.as_str()).map(str::trim).filter(|s| !s.is_empty())).collect::<Vec<_>>().join(" ");
            item["title"] = c.get("title").cloned().unwrap_or(json!(null));
            item["transcript_preview"] = json!(preview);
        }
    }
    verifications.sort_by(|a, b| {
        let ok_a = a.get("ok").and_then(|x| x.as_bool()).unwrap_or(false);
        let ok_b = b.get("ok").and_then(|x| x.as_bool()).unwrap_or(false);
        let v_a = a.get("viral").and_then(|x| x.as_f64()).unwrap_or(0.0);
        let v_b = b.get("viral").and_then(|x| x.as_f64()).unwrap_or(0.0);
        let t_a = a.get("vitality").and_then(|x| x.as_i64()).unwrap_or(0);
        let t_b = b.get("vitality").and_then(|x| x.as_i64()).unwrap_or(0);
        ok_b.cmp(&ok_a)
            .then_with(|| v_b.partial_cmp(&v_a).unwrap_or(Ordering::Equal))
            .then_with(|| t_b.cmp(&t_a))
    });
    print_json(&json!({
        "ok": all_ok, "job_id": jid, "clips_created": ids.len(),
        "ranked_clips": verifications,
        "next_steps": [
            "1. Review sample_frames for the top clip(s)",
            "2. Run `pulsecut-agent inspect <clip_id>` for the full transcript",
            "3. Run `pulsecut-agent caption <clip_id> --title ... --description ... --hashtags ...`",
            "4. Run `pulsecut-agent approve <clip_id>`",
            "5. Run `pulsecut-agent publish <clip_id> --targets youtube_shorts,instagram_reels,tiktok`"
        ]
    })); 0
}
