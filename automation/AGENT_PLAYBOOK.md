# PulseCut Automation Agent — Integration Playbook

This defines how the AI agent (me) controls the whole workflow, from finding a
live stream to publishing a verified short. The integration lives in
`automation/` and the API hooks added to `crates/app/src/web.rs`.

## Architecture

```
        ┌─────────────────────────────────────────────────────┐
        │  ME (automation agent)                              │
        │  automation/agent.py  <- I drive this via commands   │
        └───────────────┬─────────────────────────────────────┘
                        │ HTTP (localhost:8756)
        ┌───────────────▼─────────────────────────────────────┐
        │  PulseCut backend (web.rs)                           │
        │  POST /api/jobs           -> download+clip (vertical)│
        │  GET  /api/jobs/{id}      -> progress monitor        │
        │  POST /api/clips/{id}/verify -> vitality + QA frames │
        │  POST /api/clips/{id}/metadata -> captions/hashtags  │
        │  POST /api/clips/{id}/publish  -> platform publishing│
        │  GET  /api/qa/{id}/{frame}.jpg -> visual review      │
        └─────────────────────────────────────────────────────┘
```

## The workflow I run (and what each step checks)

1. **Find / supply a stream** — the Chrome extension (`tools/extension`)
   detects Kick/Twitch/YouTube/Instagram live streams and hype spikes and posts
   `/api/extension/clip`. I can also take a direct URL via `agent.py run <url>`.
2. **Download + clip** — `POST /api/jobs` starts the full pipeline:
   highest-quality source (1080p) → word-level transcription → AI viral-moment
   discovery (Hook/Emotion/Value/Shareability) → 1080×1920 render at CRF 16.
3. **Monitor** — I poll `/api/jobs/{id}` (12/35/58/65-95% stage signals) until
   done. `agent.py run` does this and logs to `automation/ledger.json`.
4. **Verify every short** (`agent.py verify`) — objective, no guesswork:
   - H.264 + AAC present, 1080×1920 canvas, 8–60s, video ≥2 Mbps, audio ≥128 kbps,
     fps 20–61, clean full decode → a **0–100 vitality score** + reasons.
   - Returns the pipeline's **viral score** (`confidence`) + its reason.
   - Extracts start/middle/end QA frames (`agent.py qa`) for **visual review** —
     I check captions/overlays are actually visible and not clipped by UI chrome.
5. **Captions + hashtags** (`agent.py caption`) — I write the title, description
   and hashtags with emojis into the clip metadata (researched/trending tags),
   before publishing.
6. **Approve** — `/api/clips/{id}/approve` (human gate is the default).
7. **Publish** (`agent.py publish`) — `POST /api/clips/{id}/publish` calls the
   real publisher and writes one receipt per platform, setting status
   Published/Failed. Targets: youtube, instagram, tiktok (direct) or the
   aggregators (woopsocial / uploadpost / postiz) via `PULSECUT_PUBLISHER`.
8. **Monitor** — `agent.py status` + `automation/ledger.json` track every run,
   verification, caption and publish. Nothing is published without passing steps 4–6.

## Commands (what I type)

```powershell
$py = "$env:USERPROFILE\AppData\Local\Programs\Python\Python313\python.exe"
$agent = "<repo>\automation\agent.py"

& $py $agent status
& $py $agent run "https://www.youtube.com/watch?v=..." --max-clips 6
& $py $agent verify              # verifies all clips, writes ledger
& $py $agent qa <clip_id>        # QA frame URLs for visual review
& $py $agent caption <clip_id> --title "..." --description "..." --hashtags "a,b,c"
& $py $agent publish <clip_id> --targets youtube,instagram
```

## Current blockers (what I need from you to publish for real)

- **Publishing tokens are not configured.** No `PULSECUT_*_TOKEN` env vars exist.
  To publish you must provide (via environment, not chat, for security):
  - Aggregator (recommended, one token → 9 platforms): `PULSECUT_WOOPSOCIAL_TOKEN`
    (or `PULSECUT_UPLOADPOST_TOKEN` / `PULSECUT_POSTIZ_TOKEN`), then set
    `PULSECUT_PUBLISHER=woopsocial|uploadpost|postiz`.
  - Direct YouTube: `PULSECUT_YOUTUBE_TOKEN` + `PULSECUT_PUBLISHER=direct`.
  - Direct Instagram Reels: `PULSECUT_IG_TOKEN` + `PULSECUT_IG_USER_ID` +
    `PULSECUT_PUBLISHER=instagram_direct` (app review required for public posting).
  Without these, `publish` returns 502 with a clear hint (verified).
- **AI backend for rich metadata is down.** Ollama is not running and no
  OpenRouter key exists, so the pipeline falls back to offline titles/hashtags.
  I can write captions/hashtags manually through `agent.py caption`, or start
  Ollama (`ollama serve` + `gemma3:4b`) / set `OPENROUTER_API_KEY` for automatic
  AI metadata.
- **Trending-hashtag research is unavailable right now** — the web search
  integration returned HTTP 402 (no credits). I can supply researched tags once
  a search integration is available, or you can give me a tag list to use.
- **Finding streams automatically** still requires the Chrome extension to be
  installed and open on the stream page; the backend has no stream-discovery
  scanner of its own.

## Files

- `automation/agent.py` — controller I drive (status/run/verify/caption/publish/qa).
- `automation/verify_clip.py` — standalone verifier (same checks, CLI).
- `automation/ledger.json` — run/verification/caption/publish audit trail.
- `crates/app/src/web.rs` — added `/verify`, `/metadata`, `/publish`, `/api/qa/*`.
- `pulsecut.json` — CRF set to 16 (max quality).
