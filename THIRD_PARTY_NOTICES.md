# Third-party notices

PulseCut was designed by studying the following repositories, all cloned into
`research/repos/` on 2026-11-18. Their LICENSE files are kept intact in those
folders. No instructions found inside those repositories were executed.

PulseCut itself is licensed **AGPL-3.0-or-later** (see `LICENSE`) because its
design incorporates architectural ideas from AGPL projects. No verbatim source
code was copied from any repository; algorithms were reimplemented in Rust.

| Repository | License | What was learned / reused |
|---|---|---|
| `ColinGPT9/clips-studio` (Clips Kitty) | AGPL-3.0 | 9:16 framing ideas, creator profiles, caption styling, aggregated publishing shape — **ideas only**, no code copied |
| `gitroomhq/postiz-app` | AGPL-3.0 | Provider abstraction and error taxonomy — **ideas only** |
| `onurozkir/stream-sentry` | MIT | Robust-z chat velocity, 5-signal fusion with dead-modality exclusion, boundary clamping, artifact-bound approval, canonical EDL |
| `nirvagold/stream-clipper` | MIT | Median/percentile audio spike detection, combo bonus, overlap NMS |
| `Cbhhhh211/livestream-highlight-clipper` | MIT | Gaussian smoothing + peak detection, adaptive half-peak padding, feedback ranker |
| `mimimaomao1117/sparkreel` | MIT | Explainable multi-signal fusion, narrative payoff placement, platform presets |
| `bendawg2010/Auto-clipper` | MIT | Voice-trigger regex + lookback window ideas |
| `zhouxiaoka/autoclip` | MIT | Chunk-parallel scoring patterns **and the "Calm Premium" UI design language** (10.7k stars). Its `--ac-*` tokens, top-nav shell, import-first dashboard, clip grid and two-column editor were adapted (rewritten in plain HTML/CSS/JS) into `crates/app/src/web.rs`. Source evidence in `docs/UI_SPEC.md`. |
| `adeel1608/social-media-scheduler` | MIT | Capability flags, idempotency keys, ambiguous-pending publishing taxonomy |
| `rrahul0904/live-content-intelligence` | MIT text, GitHub NOASSERTION | Seven-signal detector and cold-start presets — reimplemented, not copied |
| `Redtee-hue/stream-highlight-bot` | **no license** | Rolling MPEG-TS segment buffer + concat splice, karaoke ASS, scheduled upload — **idea only**, fresh Rust implementation |
| `VadlapatiKarthik/autoclipper` | **no license** | yt-dlp range download idea — **idea only** |
| `iamashishjaiswal/streamclipper` | CC BY-NC 4.0 | `!clip` lookback concept — **idea only**, not copied |

## Runtime dependencies

PulseCut links/uses these open-source crates and tools at runtime:

- Rust crates: `tokio`, `serde`, `serde_json`, `thiserror`, `tracing`,
  `tracing-subscriber`, `chrono`, `reqwest` (rustls), `clap`, `uuid`,
  `async-trait` — each under its own license in crates.io.
- `ffmpeg` (LGPL/GPL depending on build) and `streamlink` (BSD-2-Clause) are
  external processes, not linked into PulseCut.
- `rustface` (BSD-2-Clause) — pure-Rust SeetaFace face detector used by the
  native `framing=face` reframe. Its bundled `seeta_fd_frontal_v1.0.bin` model
  is copied to `models/` unmodified and originates from the SeetaFace project
  (BSD-2-Clause, VIPL group, Institute of Computing Technology, CAS).
- Optional: Ollama, whisper.cpp (MIT), faster-whisper (MIT), OpenRouter API.
- `research/test-images/lena.jpg` is used only as an offline face-detection
  fixture in tests, never shipped in the binary.

## Your obligations

If you distribute a modified PulseCut, AGPL-3.0 requires the corresponding
source to be made available to users interacting with it over a network. If
you want to keep a derivative proprietary, remove the AGPL-derived design
elements first and consult a lawyer — do not simply delete this file.
