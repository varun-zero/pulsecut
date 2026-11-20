#!/usr/bin/env python3
"""PulseCut automation controller — the agent-facing orchestration layer.

Drives the whole workflow through the local HTTP API so every short is
created, verified, scored, captioned and (optionally) published under control:

    discover -> create job -> poll -> verify+vitality -> QA frames ->
    caption/hashtags (agent-supplied) -> approve -> publish -> monitor

Commands:
  status                     Show workspace/jobs/clips state
  run <url> [opts]           Create a clipping job and wait for completion
  verify [clip_id]           Verify all clips (or one) and write ledger entries
  caption <id> --title ..    Set researched title/description/hashtags on a clip
  publish <id> [targets]     Publish a clip (requires token env vars)
  qa <id>                    Open QA frames paths for visual review
  full <url>                 run + verify all clips (publish is explicit)

All state is mirrored to automation/ledger.json for monitoring.
"""
import argparse, json, os, sys, time, urllib.request, urllib.error

# Force UTF-8 console output on Windows so emoji captions print correctly.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = os.environ.get("PULSECUT_API_URL", "http://127.0.0.1:8756")
LEDGER = os.path.join(os.path.dirname(__file__), "ledger.json")

def api(method, path, data=None, timeout=None):
    url = BASE + path
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout or 30) as r:
            raw = r.read()
            ct = r.headers.get("Content-Type", "")
            return r.status, (json.loads(raw) if "json" in ct and raw else raw)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, {"error": raw.decode(errors="replace")}

def load_ledger():
    if os.path.isfile(LEDGER):
        try: return json.load(open(LEDGER, encoding="utf-8"))
        except Exception: pass
    return {"runs": [], "verifications": {}, "captions": {}, "publishes": {}}

def save_ledger(l):
    json.dump(l, open(LEDGER, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

def cmd_status(a):
    health = api("GET", "/health")[1]
    jobs = api("GET", "/api/jobs")[1]
    clips = api("GET", "/api/clips")[1]
    print(json.dumps({"health": health, "jobs": jobs.get("jobs", [])[-5:],
                      "clips": [{"id": c["id"], "title": c.get("title"),
                                 "confidence": round(c.get("confidence", 0), 3),
                                 "status": c.get("status")} for c in clips.get("clips", [])]},
                     indent=2, ensure_ascii=False))

def wait_job(jid, timeout=900, interval=3):
    t0 = time.time(); last = None
    while time.time() - t0 < timeout:
        r = api("GET", f"/api/jobs/{jid}")[1]
        j = r.get("job", r) if isinstance(r, dict) else r
        line = f"{j.get('status')} {j.get('progress')}% {j.get('message')}"
        if line != last:
            print(f"[{int(time.time()-t0)}s] {line}", flush=True); last = line
        if j.get("status") in ("done", "failed"):
            return j
        time.sleep(interval)
    return {"status": "timeout"}

def cmd_run(a):
    data = {"url": a.url, "max_clips": a.max_clips, "template": a.template}
    if a.is_live: data.update(is_live=True, channel=a.channel or "live", platform=a.platform or "kick")
    s, r = api("POST", "/api/jobs", data)
    if s not in (200, 202):
        print(json.dumps({"error": r, "status": s}, indent=2)); return
    jid = r["job"]["id"]
    print(f"job {jid} created")
    final = wait_job(jid, timeout=a.timeout)
    l = load_ledger(); l["runs"].append({"job_id": jid, "url": a.url, "final": final, "at": time.time()}); save_ledger(l)
    print(json.dumps({"final": final}, indent=2, ensure_ascii=False))

def verify_one(cid):
    return api("POST", f"/api/clips/{cid}/verify", {}, timeout=120)

def cmd_verify(a):
    ids = [a.clip_id] if a.clip_id else [c["id"] for c in api("GET", "/api/clips")[1].get("clips", [])]
    l = load_ledger(); out = []
    for cid in ids:
        s, r = verify_one(cid)
        l["verifications"][cid] = {"status": s, "result": r, "at": time.time()}
        out.append({"id": cid, "ok": r.get("ok") if isinstance(r, dict) else None,
                    "vitality": r.get("vitality_score") if isinstance(r, dict) else None,
                    "viral": r.get("viral_score") if isinstance(r, dict) else None,
                    "reasons": r.get("reasons") if isinstance(r, dict) else r})
    save_ledger(l)
    print(json.dumps(out, indent=2, ensure_ascii=False))

def cmd_caption(a):
    data = {"title": a.title}
    if a.description: data["description"] = a.description
    if a.hashtags: data["hashtags"] = [h.strip() for h in a.hashtags.split(",")]
    s, r = api("POST", f"/api/clips/{a.clip_id}/metadata", data)
    l = load_ledger(); l["captions"][a.clip_id] = {"data": data, "status": s, "at": time.time()}; save_ledger(l)
    print(json.dumps({"status": s, "result": r}, indent=2, ensure_ascii=False)[:1500])

def cmd_publish(a):
    data = {"targets": a.targets.split(",") if a.targets else None}
    if a.token_env: data["token_env"] = a.token_env
    data = {k: v for k, v in data.items() if v is not None}
    s, r = api("POST", f"/api/clips/{a.clip_id}/publish", data, timeout=180)
    l = load_ledger(); l["publishes"][a.clip_id] = {"targets": data.get("targets"), "status": s, "result": r, "at": time.time()}; save_ledger(l)
    print(json.dumps({"status": s, "result": r}, indent=2, ensure_ascii=False))

def cmd_full(a):
    cmd_run(a)
    print("verifying all clips...")
    for c in api("GET", "/api/clips")[1].get("clips", []):
        s, r = verify_one(c["id"])
        print(c["id"], "vitality", r.get("vitality_score") if isinstance(r, dict) else r)

def main():
    ap = argparse.ArgumentParser(description="PulseCut automation controller")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("status").set_defaults(func=cmd_status)
    p = sub.add_parser("run"); p.add_argument("url"); p.add_argument("--max-clips", type=int, default=6)
    p.add_argument("--template", default="default"); p.add_argument("--is-live", action="store_true")
    p.add_argument("--channel"); p.add_argument("--platform"); p.add_argument("--timeout", type=int, default=900)
    p.set_defaults(func=cmd_run)
    p = sub.add_parser("verify"); p.add_argument("clip_id", nargs="?"); p.set_defaults(func=cmd_verify)
    p = sub.add_parser("caption"); p.add_argument("clip_id"); p.add_argument("--title", required=True)
    p.add_argument("--description"); p.add_argument("--hashtags", help="comma-separated")
    p.set_defaults(func=cmd_caption)
    p = sub.add_parser("publish"); p.add_argument("clip_id"); p.add_argument("--targets")
    p.add_argument("--token-env"); p.set_defaults(func=cmd_publish)
    p = sub.add_parser("qa"); p.add_argument("clip_id"); p.set_defaults(func=lambda a: print(json.dumps(
        [f"{BASE}/api/qa/{a.clip_id}/{x}.jpg" for x in ("start","mid","end")], indent=2)))
    p = sub.add_parser("full"); p.add_argument("url"); p.add_argument("--max-clips", type=int, default=6)
    p.add_argument("--template", default="default"); p.add_argument("--is-live", action="store_true")
    p.add_argument("--channel"); p.add_argument("--platform"); p.add_argument("--timeout", type=int, default=900)
    p.set_defaults(func=cmd_full)
    a = ap.parse_args()
    if not a.cmd: ap.print_help(); return
    a.func(a)

if __name__ == "__main__":
    main()
