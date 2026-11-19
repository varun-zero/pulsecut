//! Minimal local HTTP API for the editor. Uses only tokio's TCP primitives so
//! the project does not depend on a web framework for a six-endpoint UI.

use crate::store::Store;
use pulsecut_core::edl::EditOp;
use pulsecut_core::error::Result;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn json_response(status: u16, value: Value) -> (u16, String) {
    (status, serde_json::to_string(&value).unwrap_or_else(|_| "{}".into()))
}

/// Pure router. Returns (HTTP status, JSON body). Exposed for tests and for
/// embedding in another server.
pub fn route(store: &mut Store, method: &str, path: &str, body: &str) -> (u16, String) {
    let path = path.split('?').next().unwrap_or(path).trim_end_matches('/');
    if path == "/health" && method == "GET" {
        return json_response(200, json!({"ok": true}));
    }
    if path == "/api/clips" && method == "GET" {
        let list: Vec<&_> = store.list();
        return json_response(200, json!({"clips": list}));
    }
    let rest = match path.strip_prefix("/api/clips/") {
        Some(r) => r,
        None => return json_response(404, json!({"error": "not found"})),
    };
    let parts: Vec<&str> = rest.split('/').collect();
    let id = parts[0];
    if store.get(id).is_none() {
        return json_response(404, json!({"error": format!("clip {id} not found")}));
    }
    match (method, parts.get(1).copied()) {
        ("GET", None) => json_response(200, json!({"clip": store.get(id), "edl": store.edl(id)})),
        ("GET", Some("edl")) => json_response(200, json!(store.edl(id))),
        ("POST", Some("edits")) => {
            let ops: Vec<EditOp> = match serde_json::from_str(body) {
                Ok(o) => o,
                Err(e) => return json_response(400, json!({"error": e.to_string()})),
            };
            match store.append_edits(id, ops) {
                Ok(edl) => json_response(200, json!(edl)),
                Err(e) => json_response(500, json!({"error": e.to_string()})),
            }
        }
        ("POST", Some("approve")) => match store.approve(id) {
            Ok(_) => json_response(200, json!({"ok": true})),
            Err(e) => json_response(500, json!({"error": e.to_string()})),
        },
        ("POST", Some("reject")) => match store.reject(id) {
            Ok(_) => json_response(200, json!({"ok": true})),
            Err(e) => json_response(500, json!({"error": e.to_string()})),
        },
        ("POST", Some("delete")) | ("DELETE", None) => match store.delete(id) {
            Ok(_) => json_response(200, json!({"ok": true})),
            Err(e) => json_response(500, json!({"error": e.to_string()})),
        },
        _ => json_response(404, json!({"error": "not found"})),
    }
}

/// Start the HTTP server on `addr`. Blocks until the process ends.
pub async fn serve(addr: &str, store: Store) -> Result<()> {
    let listener = TcpListener::bind(addr).await
        .map_err(|e| pulsecut_core::error::PulseError::Editor(format!("editor bind failed: {e}")))?;
    tracing::info!("editor API listening on http://{addr}");
    let mut store = store;
    loop {
        let (mut socket, _) = listener.accept().await
            .map_err(|e| pulsecut_core::error::PulseError::Editor(e.to_string()))?;
        let mut buf = vec![0u8; 65536];
        let n = socket.read(&mut buf).await.unwrap_or(0);
        if n == 0 { continue; }
        let raw = String::from_utf8_lossy(&buf[..n]).into_owned();
        let mut lines = raw.split("\r\n");
        let request_line = lines.next().unwrap_or("");
        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap_or("GET").to_string();
        let path = parts.next().unwrap_or("/").to_string();
        let mut content_len = 0usize;
        for line in lines.by_ref() {
            if let Some((k, v)) = line.split_once(':') {
                if k.eq_ignore_ascii_case("content-length") {
                    content_len = v.trim().parse().unwrap_or(0);
                }
            }
            if line.is_empty() { break; }
        }
        let body = if content_len > 0 && raw.len() > n.saturating_sub(content_len) {
            raw[n - content_len..].to_string()
        } else {
            String::new()
        };
        if method == "GET" && (path == "/" || path == "/ui") {
            let html = ui_html();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                html.len(), html
            );
            let _ = socket.write_all(response.as_bytes()).await;
            continue;
        }
        let (status, payload) = route(&mut store, &method, &path, &body);
        let reason = if status == 200 { "OK" } else if status == 404 { "Not Found" } else { "Error" };
        let response = format!(
            "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            payload.len(), payload
        );
        let _ = socket.write_all(response.as_bytes()).await;
    }
}

/// A deliberately plain, dependency-free editor UI. It uses the same HTTP API
/// as any other client; no framework, no build step, no telemetry.
fn ui_html() -> &'static str {
    r##"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PulseCut editor</title>
<style>
:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
body{margin:0;background:#0b0f14;color:#e6edf3;padding:32px;max-width:960px;margin-inline:auto}
h1{font-size:22px;font-weight:600;letter-spacing:-.02em;margin:0 0 4px}
p.sub{color:#8b98a5;font-size:13px;margin:0 0 28px}
button{background:#1f6feb;border:0;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px}
button.ghost{background:#21262d;border:1px solid #30363d}
button:disabled{opacity:.45;cursor:not-allowed}
.card{background:#111820;border:1px solid #1f2933;border-radius:10px;padding:18px;margin-bottom:12px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.title{font-size:15px;font-weight:600;flex:1;min-width:220px}
.meta{color:#8b98a5;font-size:12px;margin-top:8px}
.badge{font-size:11px;padding:3px 8px;border-radius:99px;background:#1f2933;color:#adbac7}
.badge.Approved{background:#12331f;color:#56d364}
.badge.Published{background:#132a3d;color:#58a6ff}
pre{background:#0d1319;border:1px solid #1f2933;border-radius:6px;padding:10px;overflow:auto;font-size:11px;color:#adbac7}
input{background:#0d1319;border:1px solid #30363d;color:#e6edf3;padding:8px 10px;border-radius:6px;font-size:13px;min-width:220px}
</style></head><body>
<h1>PulseCut · clips</h1>
<p class="sub">Non-destructive editor. Approve a clip to release it to the publish queue.</p>
<div class="row"><button onclick="load()">Refresh</button><span class="meta" id="count"></span></div>
<div id="list" style="margin-top:20px"></div>
<script>
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function api(path,opts){const r=await fetch(path,opts);return r.json()}
async function load(){
 const d=await api('/api/clips');const list=document.getElementById('list');
 document.getElementById('count').textContent=d.clips.length+' clip(s)';
 list.innerHTML=d.clips.map(c=>`<div class="card">
  <div class="row"><span class="title">${esc(c.title)}</span>
   <span class="badge ${esc(c.status)}">${esc(c.status)}</span></div>
  <div class="meta">${esc(c.channel)} · confidence ${c.confidence.toFixed(2)} · ${esc(c.video_path)}</div>
  <div class="row" style="margin-top:14px">
   <button onclick="act('${c.id}','approve')">Approve</button>
   <button class="ghost" onclick="act('${c.id}','reject')">Reject</button>
   <input id="hook-${c.id}" placeholder="Pinned hook text">
   <button class="ghost" onclick="hook('${c.id}')">Add hook</button>
  </div>
  <div class="meta" style="margin-top:10px">tags: ${c.hashtags.map(t=>'#'+esc(t)).join(' ')||'none'}</div>
 </div>`).join('')||'<p class="meta">No clips yet. Start <code>pulsecut watch</code>.</p>';
}
async function act(id,op){await api('/api/clips/'+id+'/'+op,{method:'POST'});load()}
async function hook(id){const v=document.getElementById('hook-'+id).value;
 if(!v)return;await api('/api/clips/'+id+'/edits',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify([{op:'hook',text:v,duration_ms:1500}])});load()}
load();
</script></body></html>"##
}

#[cfg(test)]
mod tests {
    use super::*;
    use pulsecut_core::model::{ClipStatus, ClipWindow, Platform};
    use pulsecut_core::edl::EditOp;

    fn store() -> Store {
        let dir = std::env::temp_dir().join(format!("pulsecut-http-{}", uuid::Uuid::new_v4()));
        let mut s = Store::open(&dir).unwrap();
        s.upsert(pulsecut_core::model::ClipPackage {
            id: "a".into(), channel: "c".into(), platform: Platform::Twitch,
            source_window: ClipWindow { start_ms: 0, end_ms: 10_000, snap_reason: "x".into() },
            video_path: "v.mp4".into(), raw_video_path: "raw.mp4".into(), words: vec![], title: "t".into(), description: String::new(),
            hashtags: vec![], caption_style: "karaoke".into(), template: "d".into(),
            profiles: vec![], status: ClipStatus::Ready, created_at_ms: 1, confidence: 0.7,
        }).unwrap();
        s
    }

    #[test]
    fn health_and_list() {
        let mut s = store();
        assert_eq!(route(&mut s, "GET", "/health", "").0, 200);
        let (status, body) = route(&mut s, "GET", "/api/clips", "");
        assert_eq!(status, 200);
        assert!(body.contains("\"a\""));
    }

    #[test]
    fn append_and_approve() {
        let mut s = store();
        let edits = serde_json::to_string(&vec![EditOp::Hook { text: "yo".into(), duration_ms: 1000 }]).unwrap();
        let (status, _) = route(&mut s, "POST", "/api/clips/a/edits", &edits);
        assert_eq!(status, 200);
        assert_eq!(route(&mut s, "POST", "/api/clips/a/approve", "").0, 200);
        assert_eq!(s.get("a").unwrap().status, ClipStatus::Approved);
        assert_eq!(route(&mut s, "POST", "/api/clips/a/delete", "").0, 200);
        assert!(s.get("a").is_none());
    }
}
