#!/usr/bin/env python3
"""PulseCut extension-trigger monitor.

The browser extension's chat observer runs in the page DOM and only surfaces
its decisions to the backend as POST /api/extension/clip jobs. This monitor
watches the backend job stream in real time and records every trigger event
(channel, platform, hype_score, reasons, is_live, lookback, timestamp) to a
durable NDJSON log, then reports:

  - whether the observer is actually firing (events arriving)
  - inter-trigger spacing (how often chat "goes crazy")
  - the baseline-vs-spike signals carried in each event's reasons
    (velocity Xx vs 60s baseline, msg/s, hype %, caps, emotes)

It also serves a lightweight live graph of trigger timestamps / hype scores on
http://127.0.0.1:8899/ so you can watch spikes accumulate.

Usage: python automation/chat_monitor.py [--port 8899]
"""
import argparse, json, os, subprocess, sys, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

API = os.environ.get("PULSECUT_API_URL", "http://127.0.0.1:8756").rstrip("/")
HERE = Path(__file__).resolve().parent
LOG = HERE / "extension-events.jsonl"
SEEN = set()
EVENTS = []
LOCK = threading.Lock()


def api(path, timeout=5):
    try:
        with urllib.request.urlopen(API + path, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except Exception:
        return None


def load_existing():
    if LOG.is_file():
        for line in LOG.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                e = json.loads(line)
                EVENTS.append(e)
                SEEN.add(e["job_id"])
            except Exception:
                pass


def now_ms():
    return int(time.time() * 1000)


def record(event):
    with LOCK:
        EVENTS.append(event)
        SEEN.add(event["job_id"])
        with LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
    print(f"[TRIGGER] {event.get('channel')} score={event.get('hype_score')} "
          f"reasons={event.get('reasons')}", flush=True)


def poll_loop():
    # Snapshot existing job ids so we only report NEW triggers from now on.
    initial = api("/api/jobs") or {}
    for j in initial.get("jobs", []):
        SEEN.add(j.get("id"))
    print(f"monitoring {API} — baseline snapshot has {len(SEEN)} prior job(s). "
          f"Watching for NEW extension triggers...", flush=True)
    while True:
        data = api("/api/jobs") or {}
        for j in data.get("jobs", []):
            jid = j.get("id")
            if not jid or jid in SEEN:
                continue
            msg = j.get("message", "") or ""
            # Extension triggers announce themselves with this prefix.
            is_ext = "Clip requested via Extension" in msg
            event = {
                "job_id": jid,
                "ts": j.get("created_at_ms") or now_ms(),
                "channel": None, "platform": None, "is_live": None,
                "hype_score": None, "reasons": None, "lookback_secs": None,
                "source": "extension" if is_ext else "other",
                "message": msg,
                "url": j.get("url"),
            }
            # The backend's job record keeps reasons inside the message:
            # "Clip requested via Extension for <channel> (<platform>): <lookback>s - <reasons>"
            if is_ext:
                try:
                    rest = msg.split("Extension for ", 1)[1]
                    chan, rest = rest.split(" (", 1)
                    plat, rest = rest.split("): ", 1)
                    look, reasons = rest.split("s - ", 1)
                    event.update(channel=chan, platform=plat,
                                 lookback_secs=int(look.split()[0]),
                                 reasons=[r.strip() for r in reasons.split(",")])
                except Exception:
                    event["reasons"] = [msg]
            record(event)
        time.sleep(1.5)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", "/index.html"):
            body = PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
        elif self.path == "/events.json":
            with LOCK:
                body = json.dumps(list(EVENTS), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
        else:
            body = b"not found"; self.send_response(404)
            self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


PAGE = r"""<!doctype html><html><head><meta charset="utf-8">
<title>PulseCut live chat-spike monitor</title>
<style>
body{background:#0d0f14;color:#e8eaf0;font:14px system-ui;margin:0;padding:18px}
h1{font-size:18px;margin:0 0 4px} .sub{color:#8b93a7;font-size:12px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:2fr 1fr;gap:16px}
.card{background:#151922;border:1px solid #262c3a;border-radius:12px;padding:14px}
canvas{width:100%;height:260px;background:#0b0d12;border-radius:8px}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #262c3a}
th{color:#8b93a7;font-weight:600} .hot{color:#ff6b6b} .warm{color:#ffd166}
.big{font-size:26px;font-weight:700}
</style></head><body>
<h1>PulseCut — live chat-spike monitor</h1>
<div class="sub">Extension triggers arriving at the backend. Autorefresh 2s. Baseline = rolling 60s chat rate inside the extension.</div>
<div class="grid">
 <div class="card"><canvas id="g" width="760" height="260"></canvas></div>
 <div class="card">
  <div>Triggers logged</div><div class="big" id="count">0</div>
  <div id="rate" class="sub"></div>
  <div id="last" class="sub"></div>
 </div>
</div>
<div class="card" style="margin-top:16px"><table id="t"><thead><tr>
<th>time</th><th>channel</th><th>score</th><th>signals (reasons)</th><th>lookback</th>
</tr></thead><tbody></tbody></table></div>
<script>
const c=document.getElementById('g'),x=c.getContext('2d');
async function load(){const r=await fetch('/events.json');return await r.json()}
function draw(ev){
 x.clearRect(0,0,c.width,c.height);
 x.strokeStyle='#262c3a';x.lineWidth=1;
 for(let i=0;i<=4;i++){const y=20+i*55;x.beginPath();x.moveTo(40,y);x.lineTo(c.width-10,y);x.stroke();
  x.fillStyle='#8b93a7';x.fillText((100-i*25)+'%',4,y+4)}
 if(!ev.length){x.fillStyle='#8b93a7';x.fillText('waiting for triggers...',60,120);return}
 const n=ev.length,step=(c.width-60)/Math.max(n,1);
 let prev=null;
 ev.forEach((e,i)=>{
  const px=50+i*step, py=20+(100-(e.hype_score||0))*2.4;
  x.fillStyle=(e.hype_score>=70)?'#ff6b6b':(e.hype_score>=50?'#ffd166':'#4ade80');
  x.beginPath();x.arc(px,py,4,0,7);x.fill();
  if(prev){x.strokeStyle='#3a4252';x.lineWidth=2;x.beginPath();x.moveTo(prev[0],prev[1]);x.lineTo(px,py);x.stroke()}
  prev=[px,py];
 });
}
function render(ev){
 document.getElementById('count').textContent=ev.length;
 if(ev.length>1){
  const a=ev[0].ts,b=ev[ev.length-1].ts,mins=(b-a)/60000;
  document.getElementById('rate').textContent=`over ${mins.toFixed(1)} min → ${(ev.length/Math.max(mins,0.01)).toFixed(1)} triggers/min`;
 }
 document.getElementById('last').textContent=ev.length?`last: ${new Date(ev[ev.length-1].ts).toLocaleTimeString()}`:'none yet';
 const tb=document.querySelector('#t tbody');tb.innerHTML='';
 ev.slice().reverse().forEach(e=>{
  const tr=document.createElement('tr');
  const sc=e.hype_score||0,cls=sc>=70?'hot':(sc>=50?'warm':'');
  tr.innerHTML=`<td>${new Date(e.ts).toLocaleTimeString()}</td><td>${e.channel||'-'}</td>`+
   `<td class="${cls}">${sc!=null?sc+'%':'-'}</td><td>${(e.reasons||[]).join(' · ')||'-'}</td><td>${e.lookback_secs||'-'}s</td>`;
  tb.appendChild(tr);
 });
}
async function tick(){const ev=await load();draw(ev);render(ev)}
tick();setInterval(tick,2000);
</script></body></html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8899)
    a = ap.parse_args()
    load_existing()
    t = threading.Thread(target=poll_loop, daemon=True)
    t.start()
    print(f"Live graph: http://127.0.0.1:{a.port}/  (log: {LOG})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", a.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
