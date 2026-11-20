#!/usr/bin/env python3
"""Multi-channel Kick live-chat -> NDJSON bridge for PulseCut.

Supports watching MULTIPLE Kick channels simultaneously over a single
multiplexed Pusher WebSocket connection, plus live viewer count & HLS
playback_url metadata for fast direct-link clipping.

Usage:
    pip install -r requirements.txt
    python bridge.py --port 8765                    # dynamic multi-channel daemon
    python bridge.py eray xqc --port 8765           # pre-subscribe channels on startup

HTTP Endpoints:
    GET  /status                         Bridge health, Pusher key status & all channels
    GET  /chat/<slug>?since=<seq>        NDJSON chat messages (auto-subscribes <slug>)
    GET  /chat?channel=<slug>&since=0    Legacy/query-param compatible chat feed
    GET  /channel/<slug>/meta            Live viewer_count, is_live & playback_url
    POST /channels                       {"channel": "eray"} -> subscribe channel
    DELETE /channels/<slug>              Unsubscribe channel
    POST /config                         {"pusher_key": "...", "cluster": "us2"} -> hot-update key

Environment overrides:
    KICK_PUSHER_KEY      Pusher app key (bypasses page discovery when Kick rotates keys)
    KICK_PUSHER_CLUSTER  Pusher cluster (default: us2 -> ws-us2.pusher.com)
    KICK_PUSHER_HOST     Full Pusher host override (e.g. ws-us2.pusher.com)
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

MAX_LINES_PER_CHANNEL = 2000
META_REFRESH_INTERVAL_SECS = 30.0

# Known historical Kick Pusher keys tried as a last-resort fallback if HTML/JS scraping fails.
KNOWN_FALLBACK_KEYS = [
    "32cbd69e4b950bf97679",
    "eb1d5f283081a78b932c",
]


def http_get(url, timeout=10):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
            "Accept": "application/json, text/html, */*",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def normalize_slug(raw):
    s = (raw or "").strip().lower()
    if "kick.com/" in s:
        s = s.split("kick.com/", 1)[1]
    s = s.split("?", 1)[0].split("#", 1)[0].strip("/")
    s = s.split("/", 1)[0].lstrip("@")
    return s


def fetch_channel_meta(slug):
    """Resolve chatroom_id, live viewer_count, is_live and HLS playback_url."""
    slug = normalize_slug(slug)
    if not slug:
        raise RuntimeError("empty Kick channel slug")

    room_id = None
    viewer_count = None
    playback_url = None
    is_live = False
    last_err = None

    endpoints = [
        f"https://kick.com/api/v2/channels/{slug}",
        f"https://kick.com/api/v2/channels/{slug}/chatroom",
        f"https://api.kick.com/public/v1/channels?slug={slug}",
    ]
    for url in endpoints:
        try:
            data = json.loads(http_get(url, timeout=10))
            if not isinstance(data, dict):
                continue
            if "id" in data and url.endswith("/chatroom"):
                room_id = room_id or data["id"]
            if isinstance(data.get("chatroom"), dict) and "id" in data["chatroom"]:
                room_id = room_id or data["chatroom"]["id"]
            if isinstance(data.get("playback_url"), str) and data["playback_url"]:
                playback_url = data["playback_url"]
            ls = data.get("livestream")
            if isinstance(ls, dict):
                is_live = bool(ls.get("is_live", True))
                if isinstance(ls.get("viewer_count"), (int, float)):
                    viewer_count = int(ls["viewer_count"])
                if not playback_url and isinstance(ls.get("playback_url"), str):
                    playback_url = ls["playback_url"]
            rows = data.get("data") or []
            if rows and isinstance(rows[0], dict):
                if "chatroomId" in rows[0]:
                    room_id = room_id or rows[0]["chatroomId"]
                stream = rows[0].get("stream") or {}
                if isinstance(stream, dict):
                    if "is_live" in stream:
                        is_live = bool(stream["is_live"])
                    if isinstance(stream.get("viewer_count"), (int, float)):
                        viewer_count = int(stream["viewer_count"])
            if room_id is not None:
                break
        except Exception as err:
            last_err = err

    if room_id is None:
        raise RuntimeError(f"no Kick chatroom found for {slug!r} (last error: {last_err})")

    return {
        "slug": slug,
        "room_id": int(room_id),
        "viewer_count": viewer_count,
        "playback_url": playback_url,
        "is_live": is_live,
    }


def extract_pusher_candidates_from_text(text):
    patterns = [
        r'"pusherKey"\s*:\s*"([a-zA-Z0-9]{16,40})"',
        r'NEXT_PUBLIC_PUSHER_APP_KEY["\']?\s*[:=]\s*["\']([a-zA-Z0-9]{16,40})["\']',
        r'PUSHER_APP_KEY["\']?\s*[:=]\s*["\']([a-zA-Z0-9]{16,40})["\']',
        r'pusher\.com/app/([a-zA-Z0-9]{16,40})',
        r'new\s+[A-Za-z0-9_$]+\(\s*["\']([a-f0-9]{20})["\']\s*,\s*\{[^}]{0,220}cluster',
    ]
    found = []
    for pattern in patterns:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            key = m.group(1)
            if key and key not in found:
                found.append(key)
    return found


def discover_pusher_key(slug_hint=None):
    """Discover the active Kick Pusher app key from env, page HTML, JS chunks, or known fallbacks."""
    env_key = (os.environ.get("KICK_PUSHER_KEY") or "").strip()
    if env_key:
        return env_key, "env"

    urls_to_check = []
    if slug_hint:
        urls_to_check.append(f"https://kick.com/{normalize_slug(slug_hint)}")
    urls_to_check.append("https://kick.com/")

    for page_url in urls_to_check:
        try:
            html = http_get(page_url, timeout=10)
            keys = extract_pusher_candidates_from_text(html)
            if keys:
                return keys[0], "html"
            # Inspect up to 6 Next.js / Vite script chunks referenced in the page
            scripts = re.findall(r'src="((?:https://kick\.com)?/[^"]+\.js(?:\?[^"]*)?)"', html)
            for script_src in scripts[:6]:
                full = script_src if script_src.startswith("http") else f"https://kick.com{script_src}"
                try:
                    js = http_get(full, timeout=8)
                    keys = extract_pusher_candidates_from_text(js)
                    if keys:
                        return keys[0], "js-bundle"
                except Exception:
                    continue
        except Exception:
            continue

    return KNOWN_FALLBACK_KEYS[0], "fallback"


def resolve_pusher_host(cluster=None, explicit_host=None):
    if explicit_host and explicit_host.strip():
        return explicit_host.strip()
    env_host = (os.environ.get("KICK_PUSHER_HOST") or "").strip()
    if env_host:
        return env_host
    c = (cluster or os.environ.get("KICK_PUSHER_CLUSTER") or "us2").strip()
    return f"ws-{c}.pusher.com"


class ChannelBuffer:
    def __init__(self, slug):
        self.slug = slug
        self.room_id = None
        self.viewer_count = None
        self.playback_url = None
        self.is_live = False
        self.subscribed = False
        self.messages = []  # list of (seq: int, json_line: str)
        self.next_seq = 0
        self.last_meta_ts = 0.0
        self.last_msg_ts = 0.0
        self.last_error = None


class MultiChannelBridge:
    def __init__(self, initial_channels=None):
        self.lock = threading.Lock()
        self.channels = {}  # slug -> ChannelBuffer
        self.room_to_slug = {}  # room_id -> slug
        self.default_slug = None
        self.pusher_key = (os.environ.get("KICK_PUSHER_KEY") or "").strip()
        self.pusher_key_source = "env" if self.pusher_key else "auto"
        self.pusher_host = resolve_pusher_host()
        self.ws_connected = False
        self.pusher_error = None
        self._loop = None
        self._reconnect_event = None
        self._subscribe_queue = None

        for ch in (initial_channels or []):
            slug = normalize_slug(ch)
            if slug:
                self.ensure_channel(slug)
                if self.default_slug is None:
                    self.default_slug = slug

    def attach_loop(self, loop):
        self._loop = loop
        self._reconnect_event = asyncio.Event()
        self._subscribe_queue = asyncio.Queue()

    def _signal_reconnect(self):
        if self._loop and self._reconnect_event:
            self._loop.call_soon_threadsafe(self._reconnect_event.set)

    def _enqueue_subscribe(self, slug):
        if self._loop and self._subscribe_queue:
            self._loop.call_soon_threadsafe(self._subscribe_queue.put_nowait, slug)

    def set_config(self, pusher_key=None, cluster=None, pusher_host=None):
        changed = False
        with self.lock:
            if pusher_key is not None:
                cleaned = str(pusher_key).strip()
                if cleaned != self.pusher_key:
                    self.pusher_key = cleaned
                    self.pusher_key_source = "runtime" if cleaned else "auto"
                    self.pusher_error = None
                    changed = True
            if cluster is not None or pusher_host is not None:
                next_host = resolve_pusher_host(cluster=cluster, explicit_host=pusher_host)
                if next_host != self.pusher_host:
                    self.pusher_host = next_host
                    changed = True
        if changed:
            self._signal_reconnect()
        return self.status_snapshot()

    def ensure_channel(self, raw_slug):
        slug = normalize_slug(raw_slug)
        if not slug:
            raise ValueError("invalid Kick channel slug")
        created = False
        with self.lock:
            buf = self.channels.get(slug)
            if buf is None:
                buf = ChannelBuffer(slug)
                self.channels[slug] = buf
                if self.default_slug is None:
                    self.default_slug = slug
                created = True
        if created or buf.room_id is None:
            self._enqueue_subscribe(slug)
        return buf

    def remove_channel(self, raw_slug):
        slug = normalize_slug(raw_slug)
        removed = False
        with self.lock:
            buf = self.channels.pop(slug, None)
            if buf is not None:
                removed = True
                if buf.room_id in self.room_to_slug:
                    del self.room_to_slug[buf.room_id]
                if self.default_slug == slug:
                    self.default_slug = next(iter(self.channels.keys()), None)
        if removed:
            self._signal_reconnect()
        return removed

    def read_messages(self, slug, since=0):
        buf = self.ensure_channel(slug)
        with self.lock:
            return [line for (seq, line) in buf.messages if seq > since]

    def get_channel_meta(self, raw_slug):
        slug = normalize_slug(raw_slug)
        buf = self.ensure_channel(slug)
        now = time.time()
        if buf.room_id is None or now - buf.last_meta_ts > META_REFRESH_INTERVAL_SECS:
            try:
                meta = fetch_channel_meta(slug)
                with self.lock:
                    buf.room_id = meta["room_id"]
                    buf.viewer_count = meta["viewer_count"]
                    buf.playback_url = meta["playback_url"]
                    buf.is_live = meta["is_live"]
                    buf.last_meta_ts = time.time()
                    buf.last_error = None
                    self.room_to_slug[buf.room_id] = slug
            except Exception as err:
                with self.lock:
                    buf.last_error = str(err)
        with self.lock:
            return {
                "slug": buf.slug,
                "room_id": buf.room_id,
                "viewer_count": buf.viewer_count,
                "playback_url": buf.playback_url,
                "is_live": buf.is_live,
                "subscribed": buf.subscribed,
                "message_count": buf.next_seq,
                "last_error": buf.last_error,
            }

    def status_snapshot(self):
        with self.lock:
            key = self.pusher_key
            preview = f"{key[:4]}...{key[-4:]}" if len(key) >= 10 else ("set" if key else "")
            ch_map = {}
            for slug, buf in self.channels.items():
                ch_map[slug] = {
                    "room_id": buf.room_id,
                    "subscribed": buf.subscribed,
                    "viewer_count": buf.viewer_count,
                    "playback_url": buf.playback_url,
                    "is_live": buf.is_live,
                    "message_count": buf.next_seq,
                    "last_msg_ts": int(buf.last_msg_ts * 1000) if buf.last_msg_ts else 0,
                    "last_error": buf.last_error,
                }
            return {
                "ok": True,
                "ws_connected": self.ws_connected,
                "pusher_key_set": bool(key),
                "pusher_key_source": self.pusher_key_source,
                "pusher_key_preview": preview,
                "pusher_host": self.pusher_host,
                "pusher_error": self.pusher_error,
                "channel_count": len(ch_map),
                "channels": ch_map,
            }

    def _record_message(self, room_id, data):
        content = data.get("content") or ""
        if not content:
            return
        sender = data.get("sender") or {}
        username = sender.get("username", "unknown")
        identity = sender.get("identity") or {}
        badges = identity.get("badges") or []
        badge_types = {str(b.get("type", "")).lower() for b in badges if isinstance(b, dict)}
        emotes = [
            e.get("name", "")
            for e in (data.get("emotes") or [])
            if isinstance(e, dict) and e.get("name")
        ]
        now_ms = int(time.time() * 1000)
        with self.lock:
            slug = self.room_to_slug.get(room_id)
            if not slug or slug not in self.channels:
                return
            buf = self.channels[slug]
            buf.next_seq += 1
            seq = buf.next_seq
            buf.last_msg_ts = time.time()
            line = json.dumps(
                {
                    "seq": seq,
                    "channel": slug,
                    "username": username,
                    "content": content,
                    "emotes": emotes,
                    "ts_ms": now_ms,
                    "is_mod": bool(sender.get("is_moderator") or "moderator" in badge_types),
                    "is_subscriber": bool("subscriber" in badge_types),
                },
                ensure_ascii=False,
            )
            buf.messages.append((seq, line))
            if len(buf.messages) > MAX_LINES_PER_CHANNEL:
                del buf.messages[: len(buf.messages) - MAX_LINES_PER_CHANNEL]

    async def _resolve_all_rooms(self):
        with self.lock:
            slugs = list(self.channels.keys())
        for slug in slugs:
            with self.lock:
                buf = self.channels.get(slug)
                needs_refresh = bool(
                    buf
                    and (
                        buf.room_id is None
                        or time.time() - buf.last_meta_ts > META_REFRESH_INTERVAL_SECS
                    )
                )
            if not needs_refresh:
                continue
            try:
                meta = await asyncio.to_thread(fetch_channel_meta, slug)
                with self.lock:
                    if slug in self.channels:
                        b = self.channels[slug]
                        b.room_id = meta["room_id"]
                        b.viewer_count = meta["viewer_count"]
                        b.playback_url = meta["playback_url"]
                        b.is_live = meta["is_live"]
                        b.last_meta_ts = time.time()
                        b.last_error = None
                        self.room_to_slug[b.room_id] = slug
            except Exception as err:
                with self.lock:
                    if slug in self.channels:
                        self.channels[slug].last_error = str(err)

    async def _subscribe_channel_ws(self, ws, slug):
        with self.lock:
            buf = self.channels.get(slug)
            room_id = buf.room_id if buf else None
        if room_id is None:
            try:
                meta = await asyncio.to_thread(fetch_channel_meta, slug)
                with self.lock:
                    buf = self.channels.get(slug)
                    if buf:
                        buf.room_id = meta["room_id"]
                        buf.viewer_count = meta["viewer_count"]
                        buf.playback_url = meta["playback_url"]
                        buf.is_live = meta["is_live"]
                        buf.last_meta_ts = time.time()
                        buf.last_error = None
                        self.room_to_slug[buf.room_id] = slug
                        room_id = buf.room_id
            except Exception as err:
                with self.lock:
                    buf = self.channels.get(slug)
                    if buf:
                        buf.last_error = str(err)
                return
        if room_id is None:
            return
        for ch_name in (f"chatrooms.{room_id}.v2", f"chatrooms.{room_id}"):
            await ws.send(
                json.dumps(
                    {
                        "event": "pusher:subscribe",
                        "data": {"auth": "", "channel": ch_name},
                    }
                )
            )
        with self.lock:
            buf = self.channels.get(slug)
            if buf:
                buf.subscribed = True
        print(f"[kick-bridge] subscribed {slug} (room {room_id})", file=sys.stderr)

    async def run_forever(self):
        import websockets

        backoff = 1.5
        fallback_idx = 0

        while True:
            self._reconnect_event.clear()
            with self.lock:
                has_channels = len(self.channels) > 0
                slug_hint = self.default_slug or next(iter(self.channels.keys()), None)

            if not has_channels:
                # Idle cheaply until at least one Kick channel is added
                try:
                    slug = await asyncio.wait_for(self._subscribe_queue.get(), timeout=2.0)
                    self._subscribe_queue.put_nowait(slug)
                except asyncio.TimeoutError:
                    continue

            await self._resolve_all_rooms()

            with self.lock:
                key = self.pusher_key
                host = self.pusher_host
                source = self.pusher_key_source

            if not key:
                discovered, src = await asyncio.to_thread(discover_pusher_key, slug_hint)
                with self.lock:
                    if not self.pusher_key:
                        self.pusher_key = discovered
                        self.pusher_key_source = src
                        key = discovered
                        source = src

            uri = f"wss://{host}/app/{key}?protocol=7&client=js&version=8.4.0&flash=false"
            try:
                print(
                    f"[kick-bridge] connecting to {host} (key source={source}, channels={len(self.channels)})",
                    file=sys.stderr,
                )
                async with websockets.connect(uri, ping_interval=20, ping_timeout=20) as ws:
                    backoff = 1.5
                    with self.lock:
                        self.ws_connected = True
                        self.pusher_error = None
                        slugs = list(self.channels.keys())

                    for slug in slugs:
                        await self._subscribe_channel_ws(ws, slug)

                    meta_task = asyncio.create_task(self._meta_refresh_loop())
                    try:
                        while not self._reconnect_event.is_set():
                            # Drain any newly added channels onto the live socket
                            while not self._subscribe_queue.empty():
                                new_slug = self._subscribe_queue.get_nowait()
                                if new_slug in self.channels:
                                    await self._subscribe_channel_ws(ws, new_slug)

                            try:
                                raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                            except asyncio.TimeoutError:
                                continue

                            try:
                                frame = json.loads(raw)
                            except json.JSONDecodeError:
                                continue

                            event = frame.get("event", "")
                            if event == "pusher:ping":
                                await ws.send(json.dumps({"event": "pusher:pong", "data": {}}))
                                continue

                            if event == "pusher:error":
                                err_data = frame.get("data")
                                if isinstance(err_data, str):
                                    try:
                                        err_data = json.loads(err_data)
                                    except Exception:
                                        err_data = {"message": err_data}
                                err_msg = (
                                    err_data.get("message")
                                    if isinstance(err_data, dict)
                                    else str(err_data)
                                )
                                err_code = err_data.get("code") if isinstance(err_data, dict) else None
                                detail = (
                                    f"Kick Pusher rejected key (code={err_code}: {err_msg}). "
                                    "Set KICK_PUSHER_KEY in env or in PulseCut Live Streams settings "
                                    "(open kick.com in browser -> DevTools Network -> wss://*.pusher.com/app/<key>)."
                                )
                                print(f"[kick-bridge] {detail}", file=sys.stderr)
                                with self.lock:
                                    self.pusher_error = detail
                                    # If we were using an auto/fallback key, rotate to next known key
                                    if self.pusher_key_source in ("auto", "html", "js-bundle", "fallback"):
                                        fallback_idx += 1
                                        if fallback_idx < len(KNOWN_FALLBACK_KEYS):
                                            self.pusher_key = KNOWN_FALLBACK_KEYS[fallback_idx]
                                            self.pusher_key_source = "fallback"
                                break

                            if event not in ("App\\Events\\ChatMessageEvent", "App\\Events\\ChatMessage"):
                                continue

                            ch_str = str(frame.get("channel", ""))
                            m = re.search(r"chatrooms\.(\d+)", ch_str)
                            if not m:
                                continue
                            room_id = int(m.group(1))
                            try:
                                data = (
                                    json.loads(frame["data"])
                                    if isinstance(frame.get("data"), str)
                                    else frame.get("data") or {}
                                )
                            except (KeyError, json.JSONDecodeError):
                                continue
                            self._record_message(room_id, data)
                    finally:
                        meta_task.cancel()
                        with self.lock:
                            self.ws_connected = False
                            for b in self.channels.values():
                                b.subscribed = False

            except asyncio.CancelledError:
                raise
            except Exception as err:
                msg = str(err)
                with self.lock:
                    self.ws_connected = False
                    if not self.pusher_error:
                        self.pusher_error = (
                            f"Kick WebSocket error: {msg}. If Kick rotated its Pusher key, "
                            "set KICK_PUSHER_KEY or paste it in PulseCut Live Streams settings."
                        )
                print(
                    f"[kick-bridge] ws disconnected ({msg}); reconnecting in {backoff:.1f}s",
                    file=sys.stderr,
                )
                try:
                    await asyncio.wait_for(self._reconnect_event.wait(), timeout=backoff)
                except asyncio.TimeoutError:
                    pass
                backoff = min(backoff * 1.8, 20.0)

    async def _meta_refresh_loop(self):
        while True:
            await asyncio.sleep(META_REFRESH_INTERVAL_SECS)
            await self._resolve_all_rooms()


BRIDGE = MultiChannelBridge()


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        return json.loads(raw.decode("utf-8", "replace") or "{}")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = urllib.parse.parse_qs(parsed.query)

        if path in ("/", "/status", "/health"):
            self._send_json(200, BRIDGE.status_snapshot())
            return

        if path.startswith("/channel/") and path.endswith("/meta"):
            slug = path[len("/channel/") : -len("/meta")].strip("/")
            try:
                self._send_json(200, BRIDGE.get_channel_meta(slug))
            except Exception as err:
                self._send_json(400, {"error": str(err)})
            return

        if path == "/chat" or path.startswith("/chat/"):
            slug = ""
            if path.startswith("/chat/"):
                slug = path[len("/chat/") :].strip("/")
            if not slug:
                slug = (qs.get("channel") or [""])[0]
            if not slug:
                slug = BRIDGE.default_slug or ""
            if not slug:
                self._send_json(400, {"error": "channel slug required (use /chat/<slug>)"})
                return
            try:
                since = int((qs.get("since") or ["0"])[0])
            except ValueError:
                since = 0
            try:
                lines = BRIDGE.read_messages(slug, since)
            except Exception as err:
                self._send_json(400, {"error": str(err)})
                return
            body = ("\n".join(lines) + ("\n" if lines else "")).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
            return

        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path.rstrip("/")

        try:
            body = self._read_json()
        except Exception as err:
            self._send_json(400, {"error": f"invalid json: {err}"})
            return

        if path == "/config":
            snap = BRIDGE.set_config(
                pusher_key=body.get("pusher_key"),
                cluster=body.get("cluster"),
                pusher_host=body.get("pusher_host"),
            )
            self._send_json(200, snap)
            return

        if path == "/channels":
            raw_ch = body.get("channel") or body.get("slug") or ""
            try:
                meta = BRIDGE.get_channel_meta(raw_ch)
                self._send_json(200, {"ok": True, "channel": meta})
            except Exception as err:
                self._send_json(400, {"error": str(err)})
            return

        self._send_json(404, {"error": "not found"})

    def do_DELETE(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path.rstrip("/")
        if path.startswith("/channels/"):
            slug = path[len("/channels/") :].strip("/")
            removed = BRIDGE.remove_channel(slug)
            self._send_json(200, {"ok": True, "removed": removed, "slug": normalize_slug(slug)})
            return
        self._send_json(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        pass


def main():
    global BRIDGE
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("channels", nargs="*", help="Optional initial Kick channel slug(s)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    BRIDGE = MultiChannelBridge(initial_channels=args.channels)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(
        f"[kick-bridge] listening on http://{args.host}:{args.port} "
        f"(initial channels={args.channels or 'none — dynamic via /chat/<slug>'})",
        file=sys.stderr,
    )

    async def runner():
        BRIDGE.attach_loop(asyncio.get_running_loop())
        await BRIDGE.run_forever()

    try:
        asyncio.run(runner())
    except KeyboardInterrupt:
        print("[kick-bridge] stopping", file=sys.stderr)
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
