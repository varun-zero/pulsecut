#!/usr/bin/env python3
"""Kick live-chat -> NDJSON bridge for PulseCut.

Kick chat is delivered over Pusher WebSockets using an app key that rotates.
This bridge discovers the key, subscribes to the channel's chatroom (both v2
and legacy channel names), auto-reconnects on drop, and exposes monotonic
sequence-numbered NDJSON over HTTP (`GET /chat?since=<seq>`).

    pip install -r requirements.txt
    python bridge.py some_kick_channel --port 8765
    curl http://127.0.0.1:8765/chat

Environment overrides:
    KICK_PUSHER_KEY   Skip key discovery if Kick changes its page format.
    KICK_PUSHER_HOST  Pusher cluster host (default ws-us2.pusher.com).
"""

import argparse
import asyncio
import json
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_LINES = 2000
MESSAGES = []  # list of (seq: int, json_line: str)
NEXT_SEQ = 0
LOCK = threading.Lock()


def http_get(url, timeout=10):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
            "Accept": "application/json, text/html",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def chatroom_id(slug):
    """Resolve a Kick channel slug to its chatroom id (tries v2 then public v1 API)."""
    slug = slug.strip().lstrip("@")
    endpoints = [
        f"https://kick.com/api/v2/channels/{slug}/chatroom",
        f"https://kick.com/api/v2/channels/{slug}",
        f"https://api.kick.com/public/v1/channels?slug={slug}",
    ]
    last_err = None
    for url in endpoints:
        try:
            data = json.loads(http_get(url))
            if isinstance(data, dict):
                if "id" in data and url.endswith("/chatroom"):
                    return data["id"]
                if isinstance(data.get("chatroom"), dict) and "id" in data["chatroom"]:
                    return data["chatroom"]["id"]
                rows = data.get("data") or []
                if rows and "chatroomId" in rows[0]:
                    return rows[0]["chatroomId"]
        except Exception as err:
            last_err = err
    raise RuntimeError(f"no Kick chatroom found for {slug!r} (last error: {last_err})")


def pusher_key(slug):
    """Discover the Pusher app key from Kick's public channel page or env override."""
    override = os.environ.get("KICK_PUSHER_KEY")
    if override:
        return override
    html = http_get(f"https://kick.com/{slug}")
    patterns = [
        r'"pusherKey"\s*:\s*"([^"]+)"',
        r'PUSHER_APP_KEY["\']?\s*[:=]\s*["\']([^"\']+)',
        r'pusher\.com/app/([a-z0-9]+)',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            return match.group(1)
    raise RuntimeError(
        "could not discover Kick Pusher key; set KICK_PUSHER_KEY manually "
        "(open kick.com/<channel> in a browser and check Network -> wss://*.pusher.com/app/<key>)"
    )


async def listen(slug, room_id, key, host):
    global NEXT_SEQ
    import websockets

    uri = f"wss://{host}/app/{key}?protocol=7&client=js&version=8.4.0&flash=false"
    backoff = 1.5

    while True:
        try:
            print(f"connecting to {host} for chatroom {room_id}", file=sys.stderr)
            async with websockets.connect(uri, ping_interval=20, ping_timeout=20) as ws:
                backoff = 1.5
                for channel_name in (f"chatrooms.{room_id}.v2", f"chatrooms.{room_id}"):
                    await ws.send(json.dumps({
                        "event": "pusher:subscribe",
                        "data": {"auth": "", "channel": channel_name},
                    }))
                print(
                    f"subscribed ({slug} / room {room_id}); serving /chat",
                    file=sys.stderr,
                )
                async for raw in ws:
                    try:
                        frame = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    event = frame.get("event", "")
                    if event == "pusher:ping":
                        await ws.send(json.dumps({"event": "pusher:pong", "data": {}}))
                        continue
                    if event not in ("App\\Events\\ChatMessageEvent", "App\\Events\\ChatMessage"):
                        continue
                    try:
                        data = json.loads(frame["data"]) if isinstance(frame.get("data"), str) else frame.get("data") or {}
                    except (KeyError, json.JSONDecodeError):
                        continue
                    content = data.get("content") or ""
                    if not content:
                        continue
                    sender = data.get("sender") or {}
                    username = sender.get("username", "unknown")
                    identity = sender.get("identity") or {}
                    badges = identity.get("badges") or []
                    badge_types = {str(b.get("type", "")).lower() for b in badges if isinstance(b, dict)}
                    emotes = [e.get("name", "") for e in (data.get("emotes") or []) if isinstance(e, dict) and e.get("name")]
                    with LOCK:
                        NEXT_SEQ += 1
                        seq = NEXT_SEQ
                        line = json.dumps({
                            "seq": seq,
                            "username": username,
                            "content": content,
                            "emotes": emotes,
                            "ts_ms": int(time.time() * 1000),
                            "is_mod": bool(sender.get("is_moderator") or "moderator" in badge_types),
                            "is_subscriber": bool("subscriber" in badge_types),
                        }, ensure_ascii=False)
                        MESSAGES.append((seq, line))
                        if len(MESSAGES) > MAX_LINES:
                            del MESSAGES[: len(MESSAGES) - MAX_LINES]
        except asyncio.CancelledError:
            raise
        except Exception as err:
            print(f"kick ws disconnected ({err}); reconnecting in {backoff:.1f}s", file=sys.stderr)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2.0, 20.0)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path != "/chat":
            self.send_response(404)
            self.end_headers()
            return
        qs = urllib.parse.parse_qs(parsed.query)
        try:
            since = int((qs.get("since") or ["0"])[0])
        except ValueError:
            since = 0

        with LOCK:
            lines = [line for (seq, line) in MESSAGES if seq > since]
        body = ("\n".join(lines) + ("\n" if lines else "")).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("channel", help="Kick channel slug")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    room = chatroom_id(args.channel)
    key = pusher_key(args.channel)
    host = os.environ.get("KICK_PUSHER_HOST", "ws-us2.pusher.com")

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        asyncio.run(listen(args.channel, room, key, host))
    except KeyboardInterrupt:
        print("stopping", file=sys.stderr)
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
