# PulseCut Automation Agent — Integration Playbook

How the AI agent (me) controls the whole workflow, from finding a live stream to
publishing a verified short. Integration lives in `automation/` plus API hooks in
`crates/app/src/web.rs`.

## Workflow (what I run and check)

1. **Find/supply a stream** — Chrome extension (`tools/extension`) detects
   Kick/Twitch/YouTube/Instagram live streams + hype spikes → `/api/extension/clip`.
   Or direct URL via `agent.py run <url>`.
2. **Download + clip** — `POST /api/jobs`: highest-quality source (1080p) →
   **local word-level transcription (faster-whisper, small.en)** → viral-moment
   discovery (Hook/Emotion/Value/Shareability) → 1080×1920 render at CRF 16.
3. **Monitor** — poll `/api/jobs/{id}` (12/35/58/65-95% stages) to done.
4. **Verify every short** (`agent.py verify`) — objective 0–100 **vitality score**
   (codec/canvas/bitrate/fps/clean-decode) + pipeline **viral score** + reasons,
   plus start/mid/end QA frames (`agent.py qa`) for visual confirmation that
   captions/overlays are visible and not clipped.
5. **Captions + hashtags** (`agent.py caption`) — researched, emoji-rich title /
   description / hashtags written into metadata before publishing.
6. **Approve** — `/api/clips/{id}/approve` (human gate default).
7. **Publish** (`agent.py publish`) — `POST /api/clips/{id}/publish` → real
   publisher, per-platform receipts, status Published/Failed. WoopSocial (one
   token → 9 platforms) or direct YouTube/Instagram/TikTok.
8. **Monitor** — `agent.py status` + `automation/ledger.json` audit trail.
   Nothing publishes without passing verify → caption → approve.

## Local stack (no cloud needed for the core pipeline)

- **Transcription:** `faster-whisper` (CTranslate2) installed; wrapper
  `automation/whisper_cli.py` + `whisper-cli.cmd` is a drop-in for PULSECUT_WHISPER.
  Model `small.en` cached in `~/.cache/huggingface`. Verified end-to-end.
  More accuracy: `PULSECUT_WHISPER_MODEL=large-v3-turbo`.
- **Orchestration:** Python controller (`agent.py`) + HTTP API — no n8n needed
  (n8n is not installed on this machine). Local-first; only publish + optional AI
  go external.
- **Publishing:** WoopSocial publisher rewritten to the verified v1 API
  (GET /projects → POST /media → GET /social-accounts → POST /posts).

## What you need to provide (exact sources in automation/TOKENS.md)

1. **Publishing token** — recommended: WoopSocial API key from
   https://app.woopsocial.com/api-access (one key → IG + YT + TikTok + 6 more),
   connect accounts there once, set `PULSECUT_WOOPSOCIAL_TOKEN` +
   `PULSECUT_PUBLISHER=woopsocial`. Direct-platform tokens also supported.
   Without a token, `publish` returns 502 with a clear hint (verified).
2. **AI for auto viral-scoring + rich metadata** (optional — transcription is
   local now): Ollama (`ollama serve` + `ollama pull gemma3:4b`) or
   `OPENROUTER_API_KEY`. Without it the built-in multi-signal scorer still picks
   clips; metadata falls back to offline titles (I can write captions manually).
3. **Trending hashtags** — live web search had no credits (HTTP 402); give me a
   tag list or restore search credits.
4. **Stream discovery** — Chrome extension open on the live-stream page.

## Commands

```powershell
$py = "$env:USERPROFILE\AppData\Local\Programs\Python\Python313\python.exe"
$agent = "<repo>\automation\agent.py"
& $py $agent status
& $py $agent run "https://www.youtube.com/watch?v=..." --max-clips 6
& $py $agent verify
& $py $agent qa <clip_id>
& $py $agent caption <clip_id> --title "..." --description "..." --hashtags "a,b,c"
& $py $agent publish <clip_id> --targets youtube,instagram
```

## Files

- `automation/agent.py` — controller (status/run/verify/caption/publish/qa).
- `automation/verify_clip.py` — standalone verifier (same checks, CLI).
- `automation/whisper_cli.py` + `whisper-cli.cmd` — local transcription wrapper.
- `automation/ledger.json` — audit trail.
- `automation/TOKENS.md` — where to get every token.
- `crates/app/src/web.rs` — `/verify`, `/metadata`, `/publish`, `/api/qa/*`.
- `crates/publish/src/aggregator.rs` — WoopSocial v1 API rewrite.
- `pulsecut.json` — CRF 16, local whisper configured.
