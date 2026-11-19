#!/usr/bin/env python3
"""Kick live-chat -> NDJSON bridge for PulseCut.

Kick chat is delivered over Pusher WebSockets using an app key that rotates.
Rather than hard-code a key in the Rust core, this small bridge discovers the
key, subscribes to the channel's chatroom, and exposes the last ~2000 messages
as newline-delimited JSON over HTTP. PulseCut's KickChat connector polls it.

    pip install -r requirements.txt
    python bridge.py some_kick_channel --port 8765
    curl http://127.0.0.1:8765/chat

Environment overrides:
    KICK_PUSHER_KEY   Skip key discovery if Kick changes its page format.
    KICK_PUSHER_HOST  Pusher cluster host (default ws-us3.pusher.com).
"""

import argparse
import asyncio
import json
import os
import re
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_LINES = 2000
MESSAGES = []
LOCK = threading.Lock()


def http_get(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": "pulsecut-chat-bridge/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def chatroom_id(slug):
    """Resolve a Kick channel slug to its chatroom id."""
    url = f"https://api.kick.com/public/v1/channels?slug={slug}"
    data = json.loads(http_get(url))
    rows = data.get("data") or []
    if not rows:
        raise RuntimeError(f"no Kick channel found for {slug!r}")
    return rows[0]["chatroomId"]


def pusher_key(slug):
    """Discover the Pusher app key from Kick's public channel page."""
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
        "(open kick.com/<channel> in a browser and search for 'pusher')"
    )


async def listen(slug, room_id, key, host):
    import websockets

    uri = f"wss://{host}/app/{key}?protocol=7&client=js&version=8.4.0&flash=false"
    print(f"connecting to {host} for chatroom {room_id}", file=sys.stderr)
    async with websockets.connect(uri, ping_interval=20, ping_timeout=20) as ws:
        await ws.send(json.dumps({
            "event": "pusher:subscribe",
            "data": {"channel": f"chatrooms.{room_id}"},
        }))
        print("subscribed; exposing http://127.0.0.1:<port>/chat", file=sys.stderr)
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
                data = json.loads(frame["data"])
            except (KeyError, json.JSONDecodeError):
                continue
            content = data.get("content") or ""
            if not content:
                continue
            sender = (data.get("sender") or {}).get("username", "unknown")
            emotes = [e.get("name", "") for e in (data.get("emotes") or []) if e.get("name")]
            line = json.dumps({
                "username": sender,
                "content": content,
                "emotes": emotes,
                "ts_ms": int(time.time() * 1000),
                "is_mod": bool((data.get("sender") or {}).get("is_moderator")),
                "is_subscriber": False,
            }, ensure_ascii=False)
            with LOCK:
                MESSAGES.append(line)
                if len(MESSAGES) > MAX_LINES:
                    del MESSAGES[: len(MESSAGES) - MAX_LINES]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] != "/chat":
            self.send_response(404)
            self.end_headers()
            return
        with LOCK:
            body = ("\n".join(MESSAGES) + "\n").encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # keep stderr for bridge status only


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("channel", help="Kick channel slug")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    room = chatroom_id(args.channel)
    key = pusher_key(args.channel)
    host = os.environ.get("KICK_PUSHER_HOST", "ws-us3.pusher.com")

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
