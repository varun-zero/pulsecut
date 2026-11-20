#!/usr/bin/env python3
"""PulseCut automation controller — the agent-facing orchestration layer.

Drives the whole workflow through the local HTTP API so every short is
created, verified, scored, inspected, captioned, approved, and published
under strict audit control:

    doctor -> run -> verify + QA frames -> inspect transcript ->
    caption/hashtags -> approve -> publish -> status/ledger

Commands:
  doctor                     Pre-flight check (backend, ffmpeg, whisper, yt-dlp, AI, tokens)
  status                     Show workspace/jobs/clips state
  run <url> [opts]           Create a clipping job and wait for completion
  verify [clip_id]           Verify all clips (or one) and record vitality + viral scores
  inspect <clip_id>          Read full transcript, viral score, reason, status & metadata
  qa <clip_id>               Return QA frame URLs (and local paths) for visual review
  configure <id> [opts]      Re-render a clip with updated template/hook/watermark/aspect
  caption <id> --title ...   Set researched title/description/hashtags (and optional --hook)
  approve <id>               Approve a clip for publishing (required gate)
  reject <id>                Mark a clip rejected
  delete <id>                Delete a clip from the store
  publish <id> [opts]        Publish an approved, verified clip (blocks duplicates)
  full <url> [opts]          run + verify ONLY the new clips + print transcript & QA summary

All state is atomically persisted to automation/ledger.json (UTF-8, no BOM).
"""
import argparse
import importlib.util
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request

# Force UTF-8 console output on Windows so emoji captions print cleanly.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = os.environ.get("PULSECUT_API_URL", "http://127.0.0.1:8756").rstrip("/")
LEDGER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ledger.json")


def api(method, path, data=None, timeout=None, base_url=None):
    url = (base_url or BASE) + path
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout or 30) as r:
            raw = r.read()
            ct = r.headers.get("Content-Type", "")
            return r.status, (json.loads(raw.decode("utf-8")) if "json" in ct and raw else raw)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw.decode("utf-8", errors="replace"))
        except Exception:
            return e.code, {"error": raw.decode("utf-8", errors="replace")}
    except urllib.error.URLError as e:
        return 0, {"error": f"cannot reach PulseCut API at {url}: {e.reason}"}
    except Exception as e:
        return 0, {"error": f"request error: {e}"}


def load_ledger(path=None):
    target = path or LEDGER
    base = {"runs": [], "verifications": {}, "captions": {}, "approvals": {}, "publishes": {}}
    if os.path.isfile(target):
        try:
            with open(target, "r", encoding="utf-8-sig") as f:
                loaded = json.load(f)
            if isinstance(loaded, dict):
                base.update(loaded)
        except Exception:
            pass
    return base


def save_ledger(data, path=None):
    target = path or LEDGER
    os.makedirs(os.path.dirname(os.path.abspath(target)), exist_ok=True)
    tmp = target + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, target)


def _check_bin(env_var, fallback_names):
    val = os.environ.get(env_var, "").strip()
    if val and os.path.isfile(val):
        return {"ok": True, "path": val}
    for name in fallback_names:
        found = shutil.which(name)
        if found:
            return {"ok": True, "path": found}
    return {"ok": False, "path": None}


def cmd_doctor(_a):
    status_code, health = api("GET", "/health", timeout=5)
    backend_ok = status_code == 200 and isinstance(health, dict) and bool(health.get("ok"))

    ollama_ok = False
    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=2) as r:
            ollama_ok = r.status == 200
    except Exception:
        ollama_ok = False

    publisher_mode = os.environ.get("PULSECUT_PUBLISHER", "woopsocial")
    tokens = {
        "PULSECUT_WOOPSOCIAL_TOKEN": bool(os.environ.get("PULSECUT_WOOPSOCIAL_TOKEN")),
        "PULSECUT_YOUTUBE_TOKEN": bool(os.environ.get("PULSECUT_YOUTUBE_TOKEN")),
        "PULSECUT_IG_TOKEN": bool(os.environ.get("PULSECUT_IG_TOKEN")),
        "PULSECUT_IG_USER_ID": bool(os.environ.get("PULSECUT_IG_USER_ID")),
        "PULSECUT_TIKTOK_TOKEN": bool(os.environ.get("PULSECUT_TIKTOK_TOKEN")),
        "PULSECUT_UPLOADPOST_TOKEN": bool(os.environ.get("PULSECUT_UPLOADPOST_TOKEN")),
        "PULSECUT_POSTIZ_TOKEN": bool(os.environ.get("PULSECUT_POSTIZ_TOKEN")),
        "OPENROUTER_API_KEY": bool(os.environ.get("OPENROUTER_API_KEY")),
        "GROQ_API_KEY": bool(os.environ.get("GROQ_API_KEY")),
        "OPENAI_API_KEY": bool(os.environ.get("OPENAI_API_KEY")),
    }
    report = {
        "api_url": BASE,
        "backend": {"ok": backend_ok, "status": status_code, "health": health},
        "binaries": {
            "ffmpeg": _check_bin("PULSECUT_FFMPEG", ["ffmpeg", "ffmpeg.exe"]),
            "ffprobe": _check_bin("PULSECUT_FFPROBE", ["ffprobe", "ffprobe.exe"]),
            "yt_dlp": _check_bin("PULSECUT_YTDLP", ["yt-dlp", "yt-dlp.exe"]),
            "whisper": _check_bin("PULSECUT_WHISPER", ["whisper-cli", "whisper-cli.exe", "whisper"]),
        },
        "faster_whisper_installed": importlib.util.find_spec("faster_whisper") is not None,
        "ai": {
            "ollama_reachable": ollama_ok,
            "openrouter_configured": tokens["OPENROUTER_API_KEY"],
        },
        "publisher": {
            "mode": publisher_mode,
            "tokens_present": tokens,
        },
        "ready_to_clip": backend_ok,
        "ready_to_publish": backend_ok and any([
            tokens["PULSECUT_WOOPSOCIAL_TOKEN"],
            tokens["PULSECUT_YOUTUBE_TOKEN"],
            tokens["PULSECUT_IG_TOKEN"] and tokens["PULSECUT_IG_USER_ID"],
            tokens["PULSECUT_TIKTOK_TOKEN"],
            tokens["PULSECUT_UPLOADPOST_TOKEN"],
            tokens["PULSECUT_POSTIZ_TOKEN"],
        ]),
    }
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if backend_ok else 1


def cmd_status(_a):
    hs, health = api("GET", "/health")
    if hs != 200:
        print(json.dumps({"ok": False, "error": health}, indent=2, ensure_ascii=False))
        return 1
    jobs = api("GET", "/api/jobs")[1]
    clips = api("GET", "/api/clips")[1]
    print(json.dumps({
        "health": health,
        "jobs": jobs.get("jobs", [])[-5:] if isinstance(jobs, dict) else [],
        "clips": [
            {
                "id": c["id"],
                "title": c.get("title"),
                "template": c.get("template"),
                "words": len(c.get("words") or []),
                "confidence": round(float(c.get("confidence", 0)), 3),
                "status": c.get("status"),
            }
            for c in (clips.get("clips", []) if isinstance(clips, dict) else [])
        ],
    }, indent=2, ensure_ascii=False))
    return 0


def wait_job(jid, timeout=900, interval=3):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        code, r = api("GET", f"/api/jobs/{jid}")
        if code != 200 or not isinstance(r, dict):
            return {"status": "failed", "error": r}
        j = r.get("job", r)
        line = f"{j.get('status')} {j.get('progress')}% {j.get('message')}"
        if line != last:
            print(f"[{int(time.time() - t0)}s] {line}", file=sys.stderr, flush=True)
            last = line
        if j.get("status") in ("done", "failed"):
            return j
        time.sleep(interval)
    return {"status": "timeout", "message": f"timed out after {timeout}s"}


def _run_job(a):
    data = {"url": a.url, "max_clips": a.max_clips, "template": a.template}
    if a.is_live:
        data.update(is_live=True, channel=a.channel or "live", platform=a.platform or "kick")
    s, r = api("POST", "/api/jobs", data)
    if s not in (200, 202) or not isinstance(r, dict) or "job" not in r:
        return None, {"status": "failed", "http_status": s, "error": r}
    jid = r["job"]["id"]
    print(f"job {jid} created", file=sys.stderr, flush=True)
    final = wait_job(jid, timeout=a.timeout)
    ledger = load_ledger()
    ledger["runs"].append({"job_id": jid, "url": a.url, "final": final, "at": time.time()})
    save_ledger(ledger)
    return jid, final


def cmd_run(a):
    jid, final = _run_job(a)
    print(json.dumps({"job_id": jid, "final": final}, indent=2, ensure_ascii=False))
    return 0 if isinstance(final, dict) and final.get("status") == "done" else 1


def verify_one(cid):
    return api("POST", f"/api/clips/{cid}/verify", {}, timeout=120)


def _verify_ids(ids):
    ledger = load_ledger()
    out = []
    all_ok = True
    for cid in ids:
        s, r = verify_one(cid)
        ledger["verifications"][cid] = {"status": s, "result": r, "at": time.time()}
        is_ok = s == 200 and isinstance(r, dict) and bool(r.get("ok"))
        if not is_ok:
            all_ok = False
        out.append({
            "id": cid,
            "ok": is_ok,
            "status": r.get("status") if isinstance(r, dict) else None,
            "vitality": r.get("vitality_score") if isinstance(r, dict) else None,
            "viral": r.get("viral_score") if isinstance(r, dict) else None,
            "viral_reason": r.get("viral_reason") if isinstance(r, dict) else None,
            "has_transcript": r.get("has_transcript") if isinstance(r, dict) else None,
            "word_count": r.get("word_count") if isinstance(r, dict) else None,
            "reasons": r.get("reasons") if isinstance(r, dict) else r,
            "sample_frames": [f"{BASE}{p}" for p in (r.get("sample_frames") or [])] if isinstance(r, dict) else [],
        })
    save_ledger(ledger)
    return out, all_ok


def cmd_verify(a):
    if a.clip_id:
        ids = [a.clip_id]
    else:
        cs, resp = api("GET", "/api/clips")
        if cs != 200 or not isinstance(resp, dict):
            print(json.dumps({"ok": False, "error": resp}, indent=2, ensure_ascii=False))
            return 1
        ids = [c["id"] for c in resp.get("clips", [])]
    out, all_ok = _verify_ids(ids)
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0 if (all_ok or not getattr(a, "strict", False)) else 1


def cmd_inspect(a):
    s, r = api("GET", f"/api/clips/{a.clip_id}")
    if s != 200 or not isinstance(r, dict) or "clip" not in r:
        print(json.dumps({"ok": False, "status": s, "error": r}, indent=2, ensure_ascii=False))
        return 1
    clip = r["clip"]
    words = clip.get("words") or []
    transcript = " ".join((w.get("text") or "").strip() for w in words if (w.get("text") or "").strip())
    win = clip.get("source_window") or {}
    dur_s = round(max(0, (win.get("end_ms", 0) - win.get("start_ms", 0))) / 1000.0, 2)
    summary = {
        "id": clip["id"],
        "status": clip.get("status"),
        "platform": clip.get("platform"),
        "channel": clip.get("channel"),
        "template": clip.get("template"),
        "duration_s": dur_s,
        "viral_score": round(float(clip.get("confidence", 0)), 3),
        "viral_reason": win.get("snap_reason"),
        "title": clip.get("title"),
        "description": clip.get("description"),
        "hashtags": clip.get("hashtags") or [],
        "word_count": len(words),
        "transcript": transcript,
        "video_path": clip.get("video_path"),
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


def cmd_configure(a):
    payload = {}
    if a.template:
        payload["template"] = a.template
    if a.hook:
        payload["hook"] = a.hook
    if a.watermark:
        payload["watermark"] = a.watermark
    if a.aspect:
        payload["aspect"] = a.aspect
    if a.layout:
        payload["layout"] = a.layout
    if a.subtitle_style:
        payload["subtitle_style"] = a.subtitle_style
    s, r = api("POST", f"/api/clips/{a.clip_id}/configure", payload, timeout=300)
    print(json.dumps({"status": s, "result": r}, indent=2, ensure_ascii=False))
    return 0 if s == 200 else 1


def cmd_caption(a):
    data = {"title": a.title}
    if a.description:
        data["description"] = a.description
    if a.hashtags:
        data["hashtags"] = [h.strip() for h in a.hashtags.split(",") if h.strip()]
    if a.hook:
        data["hook"] = a.hook
    s, r = api("POST", f"/api/clips/{a.clip_id}/metadata", data)
    ledger = load_ledger()
    ledger["captions"][a.clip_id] = {"data": data, "status": s, "at": time.time()}
    save_ledger(ledger)
    print(json.dumps({"status": s, "result": r}, indent=2, ensure_ascii=False))
    return 0 if s == 200 else 1


def cmd_approve(a):
    s, r = api("POST", f"/api/clips/{a.clip_id}/approve", {})
    ledger = load_ledger()
    ledger["approvals"][a.clip_id] = {"action": "approve", "status": s, "at": time.time()}
    save_ledger(ledger)
    print(json.dumps({"status": s, "result": r}, indent=2, ensure_ascii=False))
    return 0 if s == 200 else 1


def cmd_reject(a):
    s, r = api("POST", f"/api/clips/{a.clip_id}/reject", {})
    ledger = load_ledger()
    ledger["approvals"][a.clip_id] = {"action": "reject", "status": s, "at": time.time()}
    save_ledger(ledger)
    print(json.dumps({"status": s, "result": r}, indent=2, ensure_ascii=False))
    return 0 if s == 200 else 1


def cmd_delete(a):
    s, r = api("POST", f"/api/clips/{a.clip_id}/delete", {})
    print(json.dumps({"status": s, "result": r}, indent=2, ensure_ascii=False))
    return 0 if s == 200 else 1


def cmd_publish(a):
    ledger = load_ledger()
    if not a.force:
        ver = ledger.get("verifications", {}).get(a.clip_id, {})
        ver_ok = ver.get("status") == 200 and isinstance(ver.get("result"), dict) and ver["result"].get("ok")
        if not ver_ok:
            s, r = verify_one(a.clip_id)
            ledger["verifications"][a.clip_id] = {"status": s, "result": r, "at": time.time()}
            save_ledger(ledger)
            if not (s == 200 and isinstance(r, dict) and r.get("ok")):
                print(json.dumps({
                    "ok": False,
                    "blocked": "verification_failed",
                    "verification": r,
                    "hint": "Fix the failed verification checks or pass --force",
                }, indent=2, ensure_ascii=False))
                return 1
        if a.auto_approve:
            api("POST", f"/api/clips/{a.clip_id}/approve", {})
            ledger["approvals"][a.clip_id] = {"action": "auto_approve", "status": 200, "at": time.time()}
            save_ledger(ledger)

    data = {}
    if a.targets:
        data["targets"] = [t.strip() for t in a.targets.split(",") if t.strip()]
    if a.token_env:
        data["token_env"] = a.token_env
    if a.force:
        data["force"] = True

    s, r = api("POST", f"/api/clips/{a.clip_id}/publish", data, timeout=180)
    ledger["publishes"][a.clip_id] = {
        "targets": data.get("targets"),
        "status": s,
        "result": r,
        "at": time.time(),
    }
    save_ledger(ledger)
    print(json.dumps({"status": s, "result": r}, indent=2, ensure_ascii=False))
    return 0 if (s == 200 and isinstance(r, dict) and r.get("ok")) else 1


def cmd_qa(a):
    urls = [f"{BASE}/api/qa/{a.clip_id}/{x}.jpg" for x in ("start", "mid", "end")]
    print(json.dumps({"clip_id": a.clip_id, "frames": urls}, indent=2, ensure_ascii=False))
    return 0


def cmd_full(a):
    jid, final = _run_job(a)
    if not isinstance(final, dict) or final.get("status") != "done":
        print(json.dumps({"ok": False, "job_id": jid, "final": final}, indent=2, ensure_ascii=False))
        return 1

    clip_ids = final.get("clip_ids") or []
    if not clip_ids:
        cs, resp = api("GET", "/api/clips")
        if cs == 200 and isinstance(resp, dict):
            clip_ids = [c["id"] for c in resp.get("clips", [])[: a.max_clips]]

    verifications, all_ok = _verify_ids(clip_ids)
    # Attach transcript previews so OpenCode can pick the winning short immediately.
    for item in verifications:
        cs, cr = api("GET", f"/api/clips/{item['id']}")
        if cs == 200 and isinstance(cr, dict) and "clip" in cr:
            words = cr["clip"].get("words") or []
            item["title"] = cr["clip"].get("title")
            item["transcript_preview"] = " ".join(
                (w.get("text") or "").strip() for w in words[:45] if (w.get("text") or "").strip()
            )
    verifications.sort(key=lambda x: (bool(x.get("ok")), float(x.get("viral") or 0), int(x.get("vitality") or 0)), reverse=True)
    print(json.dumps({
        "ok": all_ok,
        "job_id": jid,
        "clips_created": len(clip_ids),
        "ranked_clips": verifications,
        "next_steps": [
            "1. Review sample_frames for the top clip(s)",
            "2. Run `agent.py inspect <clip_id>` to read the full spoken transcript",
            "3. Run `agent.py caption <clip_id> --title ... --description ... --hashtags ...`",
            "4. Run `agent.py approve <clip_id>`",
            "5. Run `agent.py publish <clip_id> --targets youtube_shorts,instagram_reels,tiktok`",
        ],
    }, indent=2, ensure_ascii=False))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="PulseCut automation controller")
    sub = ap.add_subparsers(dest="cmd")

    sub.add_parser("doctor").set_defaults(func=cmd_doctor)
    sub.add_parser("status").set_defaults(func=cmd_status)

    p = sub.add_parser("run")
    p.add_argument("url")
    p.add_argument("--max-clips", type=int, default=6)
    p.add_argument("--template", default="default")
    p.add_argument("--is-live", action="store_true")
    p.add_argument("--channel")
    p.add_argument("--platform")
    p.add_argument("--timeout", type=int, default=900)
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("verify")
    p.add_argument("clip_id", nargs="?")
    p.add_argument("--strict", action="store_true")
    p.set_defaults(func=cmd_verify)

    p = sub.add_parser("inspect")
    p.add_argument("clip_id")
    p.set_defaults(func=cmd_inspect)

    p = sub.add_parser("configure")
    p.add_argument("clip_id")
    p.add_argument("--template")
    p.add_argument("--hook")
    p.add_argument("--watermark")
    p.add_argument("--aspect")
    p.add_argument("--layout")
    p.add_argument("--subtitle-style")
    p.set_defaults(func=cmd_configure)

    p = sub.add_parser("caption")
    p.add_argument("clip_id")
    p.add_argument("--title", required=True)
    p.add_argument("--description")
    p.add_argument("--hashtags", help="comma-separated")
    p.add_argument("--hook", help="optional burned-in hook headline (run configure to re-render)")
    p.set_defaults(func=cmd_caption)

    p = sub.add_parser("approve")
    p.add_argument("clip_id")
    p.set_defaults(func=cmd_approve)

    p = sub.add_parser("reject")
    p.add_argument("clip_id")
    p.set_defaults(func=cmd_reject)

    p = sub.add_parser("delete")
    p.add_argument("clip_id")
    p.set_defaults(func=cmd_delete)

    p = sub.add_parser("publish")
    p.add_argument("clip_id")
    p.add_argument("--targets")
    p.add_argument("--token-env")
    p.add_argument("--auto-approve", action="store_true")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_publish)

    p = sub.add_parser("qa")
    p.add_argument("clip_id")
    p.set_defaults(func=cmd_qa)

    p = sub.add_parser("full")
    p.add_argument("url")
    p.add_argument("--max-clips", type=int, default=6)
    p.add_argument("--template", default="default")
    p.add_argument("--is-live", action="store_true")
    p.add_argument("--channel")
    p.add_argument("--platform")
    p.add_argument("--timeout", type=int, default=900)
    p.set_defaults(func=cmd_full)

    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 0
    return int(a.func(a) or 0)


if __name__ == "__main__":
    sys.exit(main())
