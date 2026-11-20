# PulseCut — build task list

Goal: a local-first, Rust-based clipper that watches live chat (YouTube / Kick / Twitch),
detects hype spikes, cuts the moment with lookback, packages platform-ready shorts
(captions, hashtags, subtitles, templates), offers an after-clip editor, and publishes
to all major platforms automatically. Built by cherry-picking the best verified feature
from existing open-source projects.

Legend: [ ] todo  [~] in progress  [x] done

## Phase 0 — Setup and research (evidence first)
- [x] Check toolchain (git, rustc/cargo, node, python, gh; ffmpeg resolved at runtime)
- [x] Create project root + task list
- [x] Clone/reference the best repos into `research/repos/` (13 shallow clones, LICENSEs intact)
- [x] Produce `docs/REPOS.md`: inventory, license, standout feature, reuse verdict
- [x] Produce `docs/SPIKE_DETECTION.md`: refined hype-spike algorithm + Rust-ready spec
- [x] Produce `docs/PUBLISHING.md`: platform APIs, quotas, approvals, service fallbacks
- [x] Produce `docs/ARCHITECTURE.md`: crate boundaries, data flow, why Rust

## Phase 1 — Core Rust workspace
- [x] Cargo workspace + 9 crates, `cargo build --workspace` succeeds
- [x] `pulsecut-core`: config, errors, event types, non-destructive EDL
- [x] `pulsecut-capture`: streamlink/HLS resolution, segmented rolling buffer, stream-copy extraction
- [x] `pulsecut-chat`: Twitch IRC (live socket), YouTube liveChat API, Kick relay adapter
- [x] `pulsecut-detect`: multi-window robust-z detector, unique-chatter + emote gates, NMS/cooldown
- [x] `pulsecut-render`: ffmpeg cut/reframe, ASS karaoke captions, NVENC/AMF/QSV/x264 selection
- [x] `pulsecut-ai`: Ollama + OpenRouter metadata, whisper.cpp/faster-whisper word timestamps
- [x] `pulsecut-publish`: WoopSocial / Upload-Post / Postiz / direct YouTube, approval queue
- [x] `pulsecut-editor`: JSON store + local HTTP API (list, edits, approve, reject)
- [x] `pulsecut-app`: CLI `init | watch | editor | list`, full event pipeline wired

## Phase 2 — Logic refinement
- [x] Lookback logic: event time -> cut window (T-40s .. T+15s) with ASR pause snapping and min/max clamps
- [x] Avoid double-clipping the same hype event (cooldown + time NMS)
- [x] Confidence scoring + human approval gate before publish
- [x] Handle Kick chat via local Pusher bridge (`tools/kick-chat-bridge`)
- [x] Handle YouTube liveChat continuation tokens and polling interval
- [x] Feed real audio RMS into `detector.tick()` via `AudioMeter` (new `audio.rs`)

## Phase 3 — Packaging and editor
- [x] Platform profiles: Shorts / Reels / TikTok / X (safe zones, length, aspect)
- [x] Caption styles + AI title/description/hashtag generator with template field
- [x] Real template engine with 7 ready-made shorts templates (visual + metadata), EDL override
- [x] After-clip editor API: trim, split, crop, caption override, hook, reorder, mute
- [x] Non-destructive EDL JSON with versioning and tests

## Phase 4 — Automation and quality
- [x] End-to-end `watch` loop: capture -> chat -> detect -> cut -> package -> queue -> publish
- [x] Webhook/aggregator publishing path with spacing and approval
- [x] 34 unit tests across all crates; `cargo test --workspace` passes
- [x] README + QUICKSTART + honest limitations/legal notes + license notices
- [x] `cargo build --release` and CLI smoke test (release binary, init/list, editor API verified)
- [x] Offline synthetic-video e2e test (real ffmpeg, 1080x1920 output, captions + template)

## Not yet done (explicitly out of scope for this pass)
- [x] Native face-tracking reframe (BSD-2 rustface/SeetaFace + hold-then-move + ffmpeg sendcmd)
- [ ] Audio RMS extraction from ffmpeg into the detector score
- [ ] SQLite-backed persistent publish queue (currently process-local)
- [x] Built-in minimal editor UI at `/` (framework-free HTML, same API)
- [x] YIZERGE feature pass from REA evidence: layouts, canvas modes, outro/social cards, audio peak, 10 templates, engine-call API, shortcuts
- [x] Editor page rebuilt as a close visual clone of the YIZERGE editor screenshots (dark shell, preview, timeline, 4 tabs, template modal)
- [x] All-in-one 3-page dashboard adapted from autoclip's MIT "Calm Premium" UI (docs/UI_SPEC.md)
- [x] Paste-link VOD pipeline: download (yt-dlp/HTTP) → segment → loudness rank → render
- [x] Clips page style controls with re-render from raw source (template/font/style/aspect)
- [x] Direct TikTok/Instagram adapters (`tiktok_direct`, `instagram_direct` publisher modes)
- [ ] Verified live posting with real credentials (needs user accounts + platform app approval)

## License discipline
- MIT / Apache-2.0 code: may be adapted with attribution — ideas reimplemented here.
- AGPL-3.0 (Clips Kitty, Postiz): learn-only unless derivative stays AGPL; PulseCut is AGPL.
- CC BY-NC (streamclipper): not copied.
- No-license repos: idea only; fresh Rust implementations written.
