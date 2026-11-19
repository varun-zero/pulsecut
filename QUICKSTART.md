# PulseCut quick start

## 1. Prerequisites (Windows)

```powershell
winget install Gyan.FFmpeg
winget install streamlink          # optional but recommended
```

Optional local AI:

```powershell
# Ollama + a small model
winget install Ollama.Ollama
ollama pull gemma3:4b

# whisper.cpp or faster-whisper for word-level captions
pip install faster-whisper
```

Check: `ffmpeg -version`, `cargo --version`.

## 2. Build

```powershell
cd C:\Users\varun\pulsecut
cargo build --release
.\target\release\pulsecut.exe init
```

## 3a. Watch Twitch

Anonymous read-only IRC needs no token:

```powershell
$env:RUST_LOG = "info"
.\target\release\pulsecut.exe watch `
  --platform twitch `
  --channel some_streamer `
  --link https://www.twitch.tv/some_streamer
```

## 3b. Watch YouTube Live

Create a Google Cloud API key with YouTube Data API v3 enabled. Find the live
video ID (the `v=` parameter). The app resolves `activeLiveChatId` itself.

```powershell
$env:PULSECUT_YOUTUBE_KEY = "AIza..."
.\target\release\pulsecut.exe watch `
  --platform youtube `
  --channel VIDEO_ID `
  --link VIDEO_ID
```

## 3c. Watch Kick

Kick chat runs over Pusher with a rotating key. Run the bundled bridge:

```powershell
pip install -r tools\kick-chat-bridge\requirements.txt
python tools\kick-chat-bridge\bridge.py some_kick_channel --port 8765
```

Then (in another terminal):

```powershell
$env:PULSECUT_KICK_CHAT_RELAY = "http://127.0.0.1:8765/chat"
.\target\release\pulsecut.exe watch `
  --platform kick `
  --channel some_kick_channel `
  --link https://kick.com/some_kick_channel
```

## 4. The all-in-one dashboard

```powershell
.\target\release\pulsecut.exe editor --addr 127.0.0.1:8756
```

Open **http://127.0.0.1:8756/** — three pages:

1. **Dashboard** — paste a video link (YouTube/Kick/Twitch/direct MP4), pick a
   template and max clips, press *Generate clips*. The app downloads the video
   with yt-dlp (or plain HTTP), splits it into 30s segments, ranks them by
   measured loudness and renders the best ones as shorts. Progress is polled
   live with a 4px accent bar and a mono percentage.
2. **Clips** — choose template, subtitle font, caption style and aspect ratio
   (9:16 / 1:1 / 16:9) for all clips, then *Re-render selected*. Each card has a
   playable preview, score tag and template tag.
3. **Editor** — sticky video player, scene start/end fields, hook text, caption
   style and aspect controls, plus *Save draft*, *Export clip* and *Approve*.
   The editor now mirrors the desktop app: **Framing / Templates / Text / Media**
   tabs, template chooser modal, card theme, verified handle, radius/padding
   sliders, typography controls, audio/outro/watermark panels, timeline tracks,
   layout buttons and the sticky *Live 9:16 Preview (Ctrl+L)* and lime
   *Export 9:16 Video* buttons. Shortcuts: `Space` play/pause, `I`/`O` adjust
   scene start, `Ctrl+S` save draft, `Ctrl+L` live preview.

API endpoints (same server):

- `GET  /` – full dashboard UI
- `GET  /api/clips` – list clips
- `GET  /api/jobs` / `POST /api/jobs` – VOD job queue (`{"url":...,"max_clips":6,"template":"default"}`)
- `GET  /api/clips/{id}/media` – rendered MP4 bytes
- `POST /api/clips/{id}/configure` – `{"template","font","subtitle_style","aspect"}` → re-render from raw source
- `GET  /api/clips/{id}` – package + current EDL
- `POST /api/clips/{id}/edits` – JSON array of edit ops, e.g.
  `[{"op":"hook","text":"wait for it","duration_ms":1500}]`
- `POST /api/clips/{id}/approve`
- `POST /api/clips/{id}/reject`

Ops: `trim`, `split`, `crop`, `caption`, `hook`, `reorder`, `mute`.

## 5. Publish

By default clips wait for approval. Pick a publisher:

```powershell
# Fastest: one upload -> 9 platforms (WoopSocial free tier = 2 accounts, ~5 YT posts/day)
$env:PULSECUT_PUBLISHER = "woopsocial"
$env:PULSECUT_WOOPSOCIAL_TOKEN = "..."
$env:PULSECUT_AUTO_APPROVE = "false"   # keep the human gate on

# Alternatives: uploadpost | postiz | direct | tiktok_direct | instagram_direct
# Direct adapters need your own approved apps / Business account:
#   TikTok:       PULSECUT_TIKTOK_TOKEN  (SELF_ONLY until app audit passes)
#   Instagram:    PULSECUT_IG_TOKEN + PULSECUT_IG_USER_ID
```

`direct` currently implements YouTube `videos.insert` end-to-end. TikTok and
Instagram need app review / a Business account; the aggregators handle them
without that friction. Details: `docs/PUBLISHING.md`.

## Face-tracked framing

By default the 9:16 crop is centred. To keep the speaker framed while they
move, enable the bundled SeetaFace detector:

```json
"render": {
  "framing": "face",
  "face_model": "models/seeta_fd_frontal_v1.0.bin"
}
```

Detection runs locally at 2 fps. A hysteresis controller holds the crop still
through small jitter and pans smoothly when the subject really moves. If no
face is found, rendering falls back to the centred crop automatically.

## Templates

Seven ready-made looks ship in the binary. Pick one before starting:

```json
"render": { "template": "tiktok_hook", "watermark": "@yourhandle" }
```

`default`, `clean`, `x_light`, `x_dark`, `tiktok_hook`, `breaking_news`,
`gradient_cta`. A template sets the canvas/card/headline/ticker/watermark,
the caption preset, title and hook patterns, and merges its hashtag set. In
the editor you can override it per clip by posting an EDL op:

```json
[{"op":"template","id":"breaking_news"}]
```

## Tuning

Edit `pulsecut.json` (or set env overrides). If clips fire too often, raise
`detection.zscore_threshold`, `detection.confidence_threshold` or
`detection.cooldown_secs`. If they fire too rarely on a small stream, lower
`detection.min_messages` and `detection.min_unique_ratio`.

## Troubleshooting

- **`ffmpeg not found`** – set `PULSECUT_FFMPEG` to the full path.
- **No clips on a quiet stream** – the detector needs at least
  `min_messages` in a 1–5 s window and a robust z-score above threshold.
- **Kick bridge fails** – Kick changed its Pusher key; update the regex in
  `bridge.py` or supply `KICK_PUSHER_KEY` manually.
- **Publish errors** – check the token env var and provider quota; the queue
  records the last error and retries on the next cycle.
