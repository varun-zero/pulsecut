#!/usr/bin/env python3
"""PulseCut headless multi-stream chat & spike event logger.

Polls the PulseCut backend's multi-stream monitor engine (`GET /api/monitors`)
and job stream (`GET /api/jobs`) to:

  - Optionally register one or more Kick, YouTube Live, or Twitch streams
  - Log real continuous chat rate (msg/s), learned baseline, Z-score,
    viewer count, and auto/manual clip triggers to durable NDJSON
    (`automation/monitor-events.jsonl`)

Live interactive spike graphs live exclusively in the PulseCut frontend
**Live Streams** page (`http://localhost:3000`).

Usage:
    python automation/chat_monitor.py [--start https://kick.com/eray https://youtube.com/live/...] [--interval 1.0] [--once]
"""

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

API = os.environ.get("PULSECUT_API_URL", "http://127.0.0.1:8756").rstrip("/")
STUDIO_URL = os.environ.get("PULSECUT_FRONTEND_URL", "http://localhost:3000").rstrip("/")
HERE = Path(__file__).resolve().parent
LOG = HERE / "monitor-events.jsonl"
SEEN_JOBS = set()


def api_get(path, timeout=5):
    try:
        with urllib.request.urlopen(API + path, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except Exception:
        return None


def api_post(path, payload, timeout=8):
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            API + path,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except Exception as err:
        return {"ok": False, "error": str(err)}


def now_ms():
    return int(time.time() * 1000)


def load_existing():
    if LOG.is_file():
        for line in LOG.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                e = json.loads(line)
                if e.get("job_id"):
                    SEEN_JOBS.add(e["job_id"])
            except Exception:
                pass


def record(event):
    if event.get("job_id"):
        SEEN_JOBS.add(event["job_id"])
    with LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")
    print(
        f"[TRIGGER] {event.get('source')} {event.get('channel')} "
        f"score={event.get('hype_score')} reasons={event.get('reasons')}",
        flush=True,
    )


def poll_once(tick=0):
    mon = api_get("/api/monitors")
    if isinstance(mon, dict) and isinstance(mon.get("monitors"), list):
        if tick % 10 == 0 and mon["monitors"]:
            summary = " | ".join(
                f"{m.get('platform')}/{m.get('channel')}: "
                f"{m.get('current_rate', 0)}/s (base {m.get('baseline_rate', 0)}/s, "
                f"z={m.get('z_score', 0)}, hype={m.get('hype_score', 0)}%, status={m.get('status')})"
                for m in mon["monitors"]
            )
            print(f"[MONITORS] {summary}", flush=True)

        for m in mon["monitors"]:
            for sp in m.get("spikes") or []:
                jid = sp.get("job_id")
                if jid and jid not in SEEN_JOBS:
                    record(
                        {
                            "ts_ms": sp.get("ts_ms") or now_ms(),
                            "source": "direct-monitor",
                            "platform": m.get("platform"),
                            "channel": m.get("channel"),
                            "url": m.get("url"),
                            "job_id": jid,
                            "hype_score": sp.get("hype_score", 0),
                            "z_score": sp.get("z_score", 0),
                            "rate": sp.get("rate", 0),
                            "baseline": sp.get("baseline", 0),
                            "reasons": sp.get("reasons") or [],
                        }
                    )

    jobs_resp = api_get("/api/jobs") or {}
    for j in jobs_resp.get("jobs") or []:
        jid = j.get("id")
        if not jid or jid in SEEN_JOBS:
            continue
        msg = j.get("message") or ""
        if "Extension" in msg or "Live monitor" in msg:
            record(
                {
                    "ts_ms": now_ms(),
                    "source": "extension" if "Extension" in msg else "direct-monitor",
                    "channel": j.get("url") or "",
                    "url": j.get("url") or "",
                    "job_id": jid,
                    "hype_score": 0,
                    "reasons": [msg],
                }
            )


def main():
    parser = argparse.ArgumentParser(description="PulseCut headless multi-stream monitor logger")
    parser.add_argument("--start", nargs="*", default=[], help="Stream URLs to start monitoring")
    parser.add_argument("--template", default="default", help="Short template ID for auto-clips")
    parser.add_argument("--lookback", type=int, default=30, help="Clip lookback seconds")
    parser.add_argument("--threshold", type=int, default=55, help="Spike score threshold (25-95)")
    parser.add_argument("--interval", type=float, default=1.0, help="Polling interval in seconds")
    parser.add_argument("--once", action="store_true", help="Poll once and exit")
    args = parser.parse_args()

    load_existing()

    if args.start:
        resp = api_post(
            "/api/monitors",
            {
                "urls": args.start,
                "template": args.template,
                "lookback_secs": args.lookback,
                "threshold": args.threshold,
                "auto_clip": True,
            },
        )
        print(f"started monitors: {json.dumps(resp)}", flush=True)

    initial = api_get("/api/jobs") or {}
    for j in initial.get("jobs", []):
        if j.get("id"):
            SEEN_JOBS.add(j["id"])

    print(
        f"PulseCut headless monitor logger attached to {API} "
        f"({len(SEEN_JOBS)} prior job(s) indexed). "
        f"View live spike graphs in PulseCut -> Live Streams ({STUDIO_URL}).",
        flush=True,
    )

    if args.once:
        poll_once(0)
        return

    tick = 0
    try:
        while True:
            poll_once(tick)
            tick += 1
            time.sleep(max(0.5, args.interval))
    except KeyboardInterrupt:
        print("\nStopped monitor logger.", flush=True)


if __name__ == "__main__":
    main()
