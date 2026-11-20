<div align="center">

<img src="public/favicon.svg" alt="PulseCut" width="92" height="92" />

# PulseCut

### *Turn any livestream into scroll-stopping shorts — locally.*

**Rust · React · FFmpeg · AI · 100% local-first**

[![Rust](https://img.shields.io/badge/Rust-1.98-orange.svg)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#quick-start)

</div>

---

## Why PulseCut?

PulseCut watches a livestream's chat and audio, detects the moments that *actually* make people react, and cuts them into ready-to-post vertical shorts — with auto-framing, captions and hooks — all on your own machine. No cloud pipeline, no per-clip cost, no waiting.

```
  ┌──────────────┐   ┌───────────────┐   ┌──────────────┐   ┌──────────────┐
  │  LIVE STREAM │──▶│ SPIKE DETECT  │──▶│  AUTO CLIP   │──▶│  PUBLISH 9+  │
  │ Kick/Twitch/ │   │ chat + audio  │   │ frame+caption│   │ platforms    │
  │ YouTube/IG   │   │ + viewer rate │   │ + hook/outro │   │ (or download)│
  └──────────────┘   └───────────────┘   └──────────────┘   └──────────────┘
       100% on your machine
```

## Features

### Live capture & spike detection
- **Direct link monitoring** — paste a Kick / Twitch / YouTube / Instagram URL; PulseCut connects to the chat source directly (no browser extension needed) and watches continuously.
- **Adaptive baseline** — learns what "normal" chat looks like for that stream (rolling median/MAD of message rate, viewer-count prior, hype-word and emoji density) and fires only when chat genuinely spikes above it.
- **Live monitor dashboard** — a real-time spike graph, per-stream config (threshold, lookback, cooldown, auto-clip on/off), pause/resume, and manual clip triggers.
- **Browser extension** optional — for manual "clip the last 30s" while you're already watching, with an in-page HUD showing live hype score.

### AI that finds the good parts
- **Word-level transcription** — local `faster-whisper` (CTranslate2) with word timestamps, plus cloud Whisper (Groq/OpenAI) and native subtitle (VTT/json3) fallbacks.
- **Viral-moment discovery** — an LLM scores candidate windows on **Hook / Emotional spike / Value / Shareability**, snaps boundaries to spoken words, and fuses that with audio contrast. Falls back to a multi-signal scorer (pacing, payoff, keywords) when no AI backend is configured.
- **Rich metadata** — title, description, hashtags and hook generated per clip; hashtags by detected video niche.

### Framing Studio
- Drag-and-resize, aspect-locked crop boxes on the **full-resolution source** (not the cropped export).
- Layouts: **Solo / Split / Trio / PiP / Centered / 16:9 clip**, with swap slots and full-screen (100%) main video.
- PiP facecam: **16:9 / 4:3 / Free rect / 1:1**, rounded/sharp/circle, corner placement, width, border, shadow, flip.
- Backdrop (blur / color / gradient / image), corners, outer margin fill and padding, playback speed, per-slot media overrides, framing presets.
- Live 2D compositor preview that matches the rendered output.

### Shorts Studio
- Multi-segment stitching from several highlights into one short.
- Music (auto-suggested duck/riser levels), copyright-free catalog, SFX library, outro cards, dual watermarks.
- Subtitle timeline with word-synced karaoke styling, safe zones per platform, custom fonts.

### Quality & verification
- Max-quality source download (up to 1080p), **H.264 / CRF 16 / AAC 256k** encode, `+faststart` MP4.
- **100-point vitality rubric** — codec, canvas, duration, bitrate, audio loudness, clean decode and faststart, with QA frame extraction for visual review.
- Objective viral score + human-readable reason carried through every clip.

### Publishing
- Direct APIs for **YouTube Shorts, TikTok, Instagram Reels**, or one aggregator token (WoopSocial / Upload-Post / Postiz) for **9+ platforms**.
- Safety gates: every clip must be **verified → captioned → approved** before it can publish; duplicate publishes are blocked.

### Automation agent
- A Rust CLI (`pulsecut-agent`) and Python compatibility shim drive the whole workflow: `doctor → monitor → clip → verify → caption → approve → publish`, with an append-only audit ledger.

## Quick start

```powershell
# 1. Backend (API + dashboard on :8756) and frontend (:3000)
.\scripts\START-LOCAL.ps1

# 2. Or start just the backend
cargo run --release -p pulsecut -- editor --addr 127.0.0.1:8756
```

Open **http://127.0.0.1:3000** (or the built-in dashboard at **http://127.0.0.1:8756**), paste a stream URL, and watch the live monitor. Generate shorts, review them in Framing / Shorts Studios, then approve and publish.

## Tests

```powershell
cargo test --workspace          # Rust unit + integration tests
npm test                        # 5 TypeScript logic suites
npm run build                   # production frontend build
```

## Configuration

`pulsecut.json` holds all defaults (capture, detection, render, AI, publishing). Secrets are read from `PULSECUT_*` environment variables and never stored in the repo. See [QUICKSTART.md](QUICKSTART.md) and [docs/PUBLISHING.md](docs/PUBLISHING.md).

## Project layout

| Path | Purpose |
|---|---|
| `crates/` | Rust workspace: core, capture, chat, detect, render, ai, publish, editor, verify, agent, app |
| `src/` | React frontend (studios, live monitor, clip library, dashboard) |
| `automation/` | Automation controller, verifier, chat monitor and local whisper CLI |
| `tools/extension/` | Optional browser extension for manual clipping |
| `tools/kick-chat-bridge/` | Local Kick chat relay for direct monitoring |
| `docs/` | Architecture, spike detection, publishing reference |
| `models/` | Bundled face-detection model |

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).

<div align="center">
  <sub>Built for creators who want the clip, not the cloud bill.</sub>
</div>
