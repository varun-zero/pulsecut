# PulseCut Automation Agent — Integration Playbook

How OpenCode controls the full short-form pipeline, from ingesting a stream or
YouTube URL to publishing a verified, captioned, approved short.

## End-to-End Workflow (Enforced Order)

1. **Pre-flight (`agent.py doctor`)** — verify backend (`:8756`), `ffmpeg`,
   `ffprobe`, `yt-dlp`, `faster-whisper`, AI availability, and publisher token
   presence (booleans only, never prints secrets).
2. **Discover / supply source** — Chrome extension (`tools/extension`) detects
   Kick/Twitch/YouTube/Instagram live streams + hype spikes → `/api/extension/clip`,
   or pass a YouTube/VOD/live URL directly via `agent.py full <url>`.
3. **Download + full-video transcribe + viral clip** — `POST /api/jobs`:
   - Highest available quality (`bestvideo+bestaudio/best`, up to 4K/1440p/1080p60)
     or direct HLS capture for live Kick/Twitch streams.
   - Full-video word-level transcription via local `faster-whisper` (`small.en`
     default, VAD enabled; override with `PULSECUT_WHISPER_MODEL=large-v3-turbo`),
     falling back to Groq/OpenAI Whisper API or YouTube `json3`/VTT captions.
   - SupoClip-style viral moment selection across the whole transcript + audio
     contrast envelope → 1080×1920 CRF 16 render with white title + yellow
     word-synced karaoke subtitles (`Classic Short`).
4. **Verify every short (`agent.py verify`)** — exact **100-point vitality rubric**:
   - H.264 video (10) + audio stream (10) + AAC audio (5) + 1080×1920 canvas (15)
   - Duration 8–60s (10) + video bitrate ≥ 2 Mbps (15) + audio bitrate ≥ 128 kbps (5)
   - FPS 20–61 (5) + clean FFmpeg decode (10) + real MP4 `faststart` (`moov < mdat`, 10)
   - Real non-silent audio (`mean_volume > -50 dB`, 5)
   - Extracts `start.jpg`, `mid.jpg`, `end.jpg` QA frames (`agent.py qa <id>`)
     for visual confirmation that captions and title are legible and inside safe zones.
5. **Inspect transcript (`agent.py inspect <id>`)** — read the exact spoken
   words, viral score, and snap reason before writing metadata (never guess
   captions blindly).
6. **Caption + hashtags (`agent.py caption <id>`)** — write a hooky, accurate
   title, description, and niche-matched hashtags via `POST /api/clips/{id}/metadata`.
   If changing the burned-in on-screen hook, follow with `agent.py configure <id> --hook "..."`.
7. **Approve (`agent.py approve <id>`)** — required hard gate enforced by both
   `agent.py` and `crates/app/src/web.rs` (`HTTP 412` if unapproved, `HTTP 409`
   if already published).
8. **Publish (`agent.py publish <id>`)** — `POST /api/clips/{id}/publish` →
   real publisher with per-platform receipts (`WoopSocial` v1 or direct
   YouTube/Instagram/TikTok).
9. **Audit (`agent.py status` + `automation/ledger.json`)** — every run,
   verification, caption update, approval, and publish receipt is atomically
   recorded to `automation/ledger.json`.

## Commands

```powershell
$py = "$env:USERPROFILE\AppData\Local\Programs\Python\Python313\python.exe"
$agent = "<repo>\automation\agent.py"

& $py $agent doctor
& $py $agent full "https://www.youtube.com/watch?v=..." --max-clips 6
& $py $agent qa <clip_id>
& $py $agent inspect <clip_id>
& $py $agent caption <clip_id> --title "..." --description "..." --hashtags "shorts,clips,gaming"
& $py $agent approve <clip_id>
& $py $agent publish <clip_id> --targets youtube_shorts,instagram_reels,tiktok
& $py $agent status
```

## Decision Rules for OpenCode

- **Reject (`agent.py reject <id>`)** if `vitality_score < 75`, any QA frame has
  clipped/unreadable captions, or `word_count == 0` on a dialogue clip.
- **Re-render (`agent.py configure <id>`)** if the clip is strong visually but
  needs a punchier burned-in `--hook` or different `--template`.
- **Never pass `--force`** on `publish` unless the user explicitly asks to
  re-post an already-published clip.

## Files

- `automation/agent.py` — orchestration CLI (`doctor/status/run/full/verify/inspect/qa/configure/caption/approve/reject/delete/publish`).
- `automation/verify_clip.py` — standalone 100-point clip verifier.
- `automation/test_automation.py` — automated unit & integration tests.
- `automation/whisper_cli.py` + `whisper-cli.cmd` — local `faster-whisper` CLI shim (VAD enabled).
- `automation/ledger.json` — BOM-free atomic JSON audit trail.
- `automation/TOKENS.md` — exact credential sources and env var names.
- `crates/app/src/web.rs` — `/verify`, `/metadata`, `/approve`, `/publish`, `/api/qa/*`.
- `crates/publish/src/aggregator.rs` — WoopSocial v1 API publisher.
