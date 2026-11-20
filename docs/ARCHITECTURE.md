# PulseCut architecture

## Why Rust

The whole pipeline is I/O-bound except the detector and the ffmpeg argument
construction. Rust gives us: a single statically linked binary, predictable
memory while a 2-hour HLS buffer is being pruned, safe concurrency between
chat ingestion and capture supervision, and no GC pause while a clip is being
cut. The hot paths (ring buffer, statistics, concatenation planning) are
allocation-light. Heavy media work is delegated to ffmpeg, which is the right
tool for video; PulseCut is the orchestrator, not a decoder.

## Crate map

```
crates/
  core      config, errors, domain types, non-destructive EDL
  capture   ffmpeg/streamlink discovery, segmented rolling buffer, clip extraction
  chat      Twitch IRC, YouTube liveChat API, Kick relay adapter
  detect    multi-window robust-z hype detector, NMS, window snapping
  render    ASS karaoke captions, 9:16 reframing, encoder selection
  ai        Ollama / OpenRouter metadata, whisper word timestamps
  publish   WoopSocial / Upload-Post / Postiz / YouTube, approval queue
  editor    JSON store + local HTTP API for after-clip editing
  app       CLI orchestrator (watch / editor / list / init)
```

## Data flow

```
live URL ──streamlink/HLS──> ffmpeg segment muxer ──> seg_%06d.ts files
                                                        │
chat ──> ChatMessage ──> HypeDetector ──> HypeEvent ──> ClipWindow
                                                        │
                          buffer.extract (ffmpeg -c copy, <1s)
                                                        │
                          WhisperCli ──> Vec<Word> ──> ASS karaoke
                                                        │
                          AiBackend ──> title/description/hashtags
                                                        │
                          Renderer ──> 1080x1920 MP4 + burned captions
                                                        │
                          Store + PublishQueue ──> approval ──> Publisher
```

## What was cherry-picked, and where it lives

| Borrowed design | Source | PulseCut implementation |
|---|---|---|
| Robust median/MAD chat velocity, multi-signal fusion, boundary clamping | `stream-sentry` (MIT) | `crates/detect/src/detector.rs` (`zscore_threshold`, `mad_floor`, `snap_window`) |
| Segmented `.ts` rolling buffer with margin pruning + concat splice | `stream-highlight-bot` (no license → idea only) | `crates/capture/src/buffer.rs` |
| Multi-window scoring so 1-second bursts are not diluted | refinement of the above | `HypeDetector::tick` evaluates 1/2/3/5s windows and keeps best z |
| Cooldown + time-based NMS | `nirvagold/stream-clipper` (MIT), `live-content-intelligence` | `ChannelState::last_accept_ms` + `recent` suppression |
| Non-max suppression / overlap merge idea | `nirvagold/stream-clipper` |Same, with confidence kept on the winner |
| Karaoke ASS subtitles from word timings | `stream-highlight-bot`, Clips Kitty (AGPL → idea only) | `crates/render/src/ass.rs` (`\k` per word, safe-zone margins) |
| 9:16 framing + platform safe zones | Clips Kitty, SparkReel | `crates/render/src/lib.rs` + `PlatformProfile` in core |
| Non-destructive EDL | Canonical EDL schema in `stream-sentry` (MIT) | `crates/core/src/edl.rs` |
| Explainable signals / dead-modality exclusion | SparkReel, `live-content-intelligence` | `HypeEvent::reasons`, normalization to 0..1 |
| Provider abstraction for publishing | Postiz (AGPL → interface idea only), `social-media-scheduler` (MIT) | `pulsecut_publish::Publisher` trait + 3 tiers |
| Explicit approval gate bound to artifact | `stream-sentry` | `PublishQueue` + `ClipStatus::Approved` |
| Direct TikTok / Instagram publishing | `social-media-scheduler` capability flags | `crates/publish/src/direct.rs` (TikTok POST/PUT v2, Instagram Graph resumable) |
| Word-timestamp transcription | faster-whisper / whisper.cpp conventions | `crates/ai/src/transcribe.rs` |
| Ready-made visual + metadata templates | Clips Kitty template library (AGPL → idea only) | `crates/render/src/templates.rs` (7 built-ins, EDL override, title/hook/hashtag patterns) |
| Hold-then-move speaker-locked reframe | Clips Kitty (AGPL → idea only) | `crates/render/src/framing.rs` — rustface/SeetaFace detection + hysteretic pan + ffmpeg sendcmd |
| Rolling-buffer audio loudness | SparkReel / stream-sentry audio signal | `crates/capture/src/audio.rs` → `HypeDetector::tick` |

## Design decisions that matter

1. **Never hold raw video in RAM.** Segments live on disk; the buffer keeps
   only ~150 seconds by default. Extraction is a stream copy, so it finishes
   in well under a second and does not compete with the live encode.
2. **Baseline cannot be contaminated.** The baseline distribution explicitly
   excludes the longest evaluation window, so a spike cannot raise its own
   reference point.
2b. **Extraction never uses `-ss` with stream copy.** On a concat of MPEG-TS
   segments this silently drops the video stream (found by the synthetic e2e
   test). We keep whole segments for a sub-4s pre-roll and trim precisely in
   the render stage, which already re-encodes. No extra encode pass.
3. **A single chatter cannot trigger a clip.** Hard gates require minimum
   messages, minimum unique-chatter ratio and a velocity z-score. A 40-message
   "POG" spam from one account is rejected (covered by a unit test).
4. **One event per moment.** Cooldown + NMS prevent five clips of the same
   laugh. The lookback is 40 s by default, post-roll 15 s, with min/max clamps.
5. **Human gate is the default.** `auto_approve=false`. Clips wait in the
   editor store until approved. This avoids publishing a raid banner.
6. **Local first, cloud optional.** Ollama and whisper.cpp are preferred;
   OpenRouter is a transparent fallback only when configured.
7. **Publishing is abstraction, not hard-coding.** Aggregators hold OAuth for
   nine platforms; Postiz and direct APIs are drop-in alternatives.

## Known limits (honest)

- Kick chat requires a small local Pusher bridge (`tools/kick-chat-bridge`)
  because Kick rotates its Pusher key; the Rust core reads NDJSON from it.
- YouTube uses the official `liveChatMessages.list`; it needs an API key and
  respects the API polling interval. Continuation tokens are handled.
- Audio energy is measured from the newest captured `.ts` segment by
  `pulsecut_capture::AudioMeter` and passed into `detector.tick()` as 0..1.
  The meter decodes the segment once per segment index and caches the value.
- Face tracking uses SeetaFace (frontal faces). Gaming streams with no person
  on camera or VTubers fall back to the centred crop; a body/game-event
  tracker would be a separate future detector.
- Aggregator field names follow the documented shape; verify against your
  provider's current API before relying on unattended posting.
- Direct TikTok/Instagram adapters are implemented but cannot be verified here
  without credentials and platform app approval; TikTok posts are SELF_ONLY
  until its audit passes.
