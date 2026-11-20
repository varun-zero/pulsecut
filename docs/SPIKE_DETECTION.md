# PulseCut — Hype-Spike Detection Algorithm (Rust-ready specification)

Status: **design spec, to be implemented in `pulsecut-detect`**.
All timestamps are **stream-clock seconds** (`f64`, monotonic, aligned to the media
presentation timestamp), not wall-clock. Chat connectors must map platform delivery
time to stream time before feeding the detector. All durations in seconds unless noted.

This document intentionally specifies *one* concrete, implementable algorithm with
default constants. Every constant is overridable through `DetectorConfig`.

---

## 0. Prior art reviewed (data only)

Cloned into a scratch directory outside the project and read as reference material:

| Repo | What it does | What we take / what we reject |
|---|---|---|
| `Redtee-hue/stream-highlight-bot` (`analysis/scoring.py`, `analysis/audio.py`, `config.py`) | Weighted `Detection` pooling with `group_window`, dedupe-by-source, `min_score`, `cooldown`, `pre_seconds/post_seconds/min_seconds/max_seconds`, ambient-RMS tracker with `0.98/0.02` EWMA and `jump_db=9` | Good: grouping, cooldown, dedupe-by-source, duration clamping, slow ambient tracker. We adopt the structure but replace the single raw-threshold with normalized multi-signal fusion and add NMS + boundary snapping + confidence. |
| `rrahul0904/live-content-intelligence` (`docs/DETECTION_ENGINE.md`) | 7 normalized signals (`chat_velocity`, `keyword_intensity`, `emote_burst`, `sentiment_intensity`, `audio_spike`, `viewer_spike`, `silence_burst`), `score = 100*Σwᵢxᵢ/Σwᵢ`, trigger on `score ≥ threshold`, cooldown, idempotency key, cold-start presets, safe learning with calibration versions | Adopted: normalized 0..1 signals, weighted fusion, presets, idempotency key, "never mutate historical scores" rule, second-stage confidence ranker. We add robust MAD, unique-chatter burst, postroll confirmation, NMS, and boundary snapping. |

Licenses: see `TODO.md` discipline — MIT/Apache code may be adapted with attribution;
AGPL code may be learned from but not copied into a proprietary derivative. **This
spec is written fresh; no code was copied.**

---

## 1. Why the naive rule fails

The naive rule is:

```
count(messages in [now-30s, now]) > BASELINE * 2.5      # BASELINE = 10 (hard-coded)
```

It fails for at least the following independent reasons. Each is a concrete bug we
must design against, not a theoretical edge case.

### 1.1 It is not channel-adaptive
- **Slow chat** (e.g. 1 msg/30s): `2.5 * 1 = 2.5`, so **3 messages** fire a clip. Two
  people saying "let's go" produces a highlight. Worse, a *fixed* `BASELINE=10` fires
  on 26 messages even when the channel normally sees 3 — constant false positives.
- **Fast chat** (e.g. 200 msg/30s): a genuine reaction of 300 messages is only `1.5×`
  and never fires, while normal noise of 520 messages fires. The multiplier 2.5 has
  no meaning in absolute terms.
- Chat counts are **overdispersed** (approximately negative-binomial, variance ≫
  mean), not Poisson. A fixed ratio assumes tight variance around the mean; on real
  chat the ratio wanders wildly with time of day and viewer count.

### 1.2 It cannot distinguish a crowd reaction from spam
- **Emote/copy-pasta spam**: 40 users posting `PogChamp` is 40 messages — the rule
  fires, but it carries little information. Conversely a genuine, varied reaction
  ("NO WAY", "LETS GOOO", "what", "clutch") may be fewer messages and not fire.
- A single user filling chat with 50 lines fires the rule. The signal we actually
  want is **unique chatters**, not raw lines.

### 1.3 It is fooled by events that are not highlights
- **Raids**: a raid injects hundreds of `WELCOME RAID` / `W` messages in 2 seconds.
  This is the largest velocity spike a stream will see and produces *zero* useful
  clips. It needs its own signature and suppression path.
- **Giveaways / raffles / "type !giveaway"**: deliberate mass spam that looks like hype.
- **Subscription / resub / bits / announcement floods**: platform-generated messages
  inflate the count.
- **A playlist or music stream** with steady high chat: constant near-threshold firing.

### 1.4 It double-counts
- Twitch EventSub reconnects and YouTube `liveChat` continuation-token overlap deliver
  the same message id twice. Kick mirrors similarly. There is no message-id dedup in
  the naive rule, so replayed messages count again and can *create* a spike.
- Moderator actions and bot replies (`StreamElements`, `Nightbot`) are counted as
  human excitement.

### 1.5 The baseline is contaminated and the trigger point is ambiguous
- Once a spike enters the measurement window, a baseline computed from that same
  window is pulled upward, blinding the detector to the *next* real moment for minutes.
- `now` is not the event time: chat arrives with variable latency (0.3–5 s). The
  naive rule clips `now-15s`, which can miss the actual play. We need an explicit
  anchor `T` and a settle delay.
- No cooldown, no dedup: one hype event fires 5–10 times in as many seconds, producing
  duplicate clips of the same moment.

### 1.6 Missing edge-case handling
- Zero baseline → division by zero / infinite ratio.
- First 30 s of stream → no baseline at all.
- Dead chat during downtime → tiny fluctuations look like "spikes".
- No notion of confidence, no human gate, no way to suppress on `!noclip`.

**Consequence:** the detector must (a) learn a per-channel robust baseline, (b) fuse
several *orthogonal* signals, (c) count people and information rather than lines,
(d) filter and dedup at ingestion, and (e) treat candidate creation as a state machine
with cooldown, NMS, confirmation delay, and an approval gate.

---

## 2. Signal model — overview

Every observed signal is converted to a normalized scalar `xᵢ ∈ [0,1]`. Fusion is a
weighted average over *available* signals:

```
score = Σᵢ (wᵢ · aᵢ · xᵢ) / Σᵢ (wᵢ · aᵢ)          aᵢ ∈ {0,1}  (availability)
```

If a channel has no audio feed, `a_audio = 0` and its weight is redistributed across
the remaining signals — no silent penalty, no silent failure.

| # | Signal | Key | Default weight | Availability condition |
|---|---|---|---:|---|
| a | Message velocity (robust z + acceleration) | `velocity` | **0.26** | chat connected |
| b | Unique-chatter burst | `unique_chatter` | **0.15** | chat connected |
| c | Repeated-token / emote burst | `token_burst` | **0.10** | chat connected |
| d | Keyword / hype intensity | `keyword` | **0.13** | chat connected |
| e | Sentiment / excitement (arousal) | `excitement` | **0.09** | chat connected (lexicon) |
| f | Audio energy + speech energy | `audio` | **0.14** | audio feed + optional ASR |
| g | Viewer-count spike | `viewer` | **0.05** | viewer API sample < 30 s old |
| h | Moderator / command override | `override` | **0.08** | authenticated `!clip` / button |

Weights sum to 1.00. They are channel-overridable via presets (§4).

### Shared normalization helpers

```rust
fn clamp01(x: f32) -> f32 { x.clamp(0.0, 1.0) }
fn logistic(x: f32) -> f32 { 1.0 / (1.0 + (-x).exp()) }
/// z -> [0,1]. `center` is the z at which the signal is half-active.
fn from_z(z: f32, center: f32, width: f32) -> f32 { logistic((z - center) / width) }
/// linear map with clamp.
fn from_range(x: f32, lo: f32, hi: f32) -> f32 { clamp01((x - lo) / (hi - lo)) }
```

All z-scores are clamped to `±Z_CLAMP = 10.0` before normalization.

---

## 3. Per-signal computation

All windows are `[t - L, t]` with `L = WINDOW_SHORT = 30 s`, evaluated on a `TICK = 1 s`
boundary. "Qualifying message" = `kind == Chat` (or `Emote`), not from a mod/bot/system
account, not a duplicate id, not part of a detected raid (§9.3).

### (a) Message velocity — EWMA baseline + robust MAD + acceleration

Maintain two EWMA state variables per channel, updated once per tick from the
per-tick rate `rₜ = qualify_count(tick) / TICK`:

```
μₜ = α · rₜ + (1-α) · μₜ₋₁                       α = 1 - exp(-TICK / τμ),  τμ = 60 s
vₜ = β · (rₜ - μₜ₋₁)² + (1-β) · vₜ₋₁             β = 1 - exp(-TICK / τv),  τv = 300 s
σₜ = sqrt(vₜ)
```

Robust fallback: keep a ring of the last `MAD_WINDOW = 300` per-tick rates; when at
least `MAD_MIN_SAMPLES = 20` samples exist, compute
`median = median(r)`, `MAD = median(|rᵢ - median|)`, and
`σᵣ = 1.4826 · MAD` (consistent estimator of σ for normal data). Use `max(σₜ, σᵣ)`
only when the EWMA is not yet trustworthy — actually use `σ = max(σₜ, σ_floor)` and
prefer the robust estimate when the last `M` ticks contain a known spike (see
§9.4 baseline contamination control).

Floor the denominator to avoid division by zero on quiet channels:

```
σ_eff = max(σ, SIGMA_FLOOR_ABS, SIGMA_FLOOR_REL · μₜ)   # 0.5 msg/s and 0.30·μ
z_v   = (rₜ - μₜ) / σ_eff
```

Add **acceleration** over `ACCEL_WINDOW = 5 s` — hype is a step, not a plateau:

```
r_prev = rate in [t-ACCEL_WINDOW-1, t-ACCEL_WINDOW]
a      = (rₜ - r_prev) / ACCEL_WINDOW
z_a    = (rₜ - r_prev) / (σ_eff · sqrt(2.0) + 1e-6)
```

Signal:

```
velocity = clamp01(0.65 · from_z(z_v, Z0_VELOCITY=3.0, Z_WIDTH=1.0)
                 + 0.35 · from_z(z_a, Z0_ACCEL=2.0,  Z_WIDTH=1.0))
```

*Why both:* a channel that ramps from 5→20 msg/s over 2 minutes has high `z_v` but
low `z_a` → suppressed (that's "more viewers", not "a moment"). A 5→30 msg/s jump in
2 s has both → fires.

### (b) Unique-chatter burst

Let `Uₜ` = number of distinct qualifying authors in `[t-30, t]`, and `Nₜ` = qualifying
messages in the same window. Maintain an EWMA baseline `μ_U, σ_U` exactly as in (a)
(τ=60 s / 300 s, same floors scaled by `1/5` since U ≤ N).

```
z_U        = (Uₜ - μ_U) / σ_U_eff
diversity  = clamp01((Uₜ / max(Nₜ,1)) / 0.70)      # 0.70 ≈ "healthy" msg/author ratio
unique     = clamp01(from_z(z_U, 3.0, 1.0) · (0.5 + 0.5 · diversity))
```

*Why the diversity multiplier:* 50 messages from 2 accounts give `Uₜ=2` (low z) and
`diversity≈0.06`; 50 messages from 40 accounts give `Uₜ=40` and `diversity≈1`. A
single-user spam bot cannot create this signal.

Implementation: `HashSet<UserId>` rebuilt from the per-second ring buckets on each
tick; author ids are hashed to `u64` to avoid storing large strings in the hot path.

### (c) Repeated-token / emote burst

Tokenize qualifying messages: lowercase, strip punctuation, split on whitespace,
keep platform emotes and emoji as tokens, cap at `MAX_TOKENS_PER_MSG = 64`. Maintain
a rolling multiset over `L = 30 s` as an array of 30 per-second `HashMap<Token,u16>`
buckets, merged on query. Also maintain a slowly decaying prior `pᵢ` per token
(EWMA over window fractions, `τ_prior = 600 s`, top `MAX_TRACKED_TOKENS = 4096`).

For the dominant token in the window:

```
c_max  = max_i count_i
p_max  = prior_i (or 1e-4 if unseen)
z_tok  = (c_max - Nₜ·p_max) / sqrt(Nₜ·p_max·(1-p_max) + 1e-6)
dom    = c_max / max(Nₜ, 1)
emote_boost = if is_hype_emote(token) { 1.15 } else { 1.0 }
token_burst = clamp01(emote_boost · (0.55·from_range(dom, 0.10, 0.60)
                                   + 0.45·from_z(z_tok, 2.5, 1.0)))
```

*Important:* this signal alone never triggers a clip (§9.1 requires corroboration).
It exists to *amplify* genuine hype — a chat spamming `POG` during a clutch play is
strong evidence when combined with velocity + audio + excitement.

The lexicon of hype emotes is channel-configurable (default: `pogchamp, pogu, pog,
letsgo, w, hype, insane, clutch, fire, gg, 😂, 🔥, 😱, 💀, ❤️`).

### (d) Keyword / hype intensity

Use an `aho-corasick` automaton built once from a weighted lexicon; match
case-insensitively with word-boundary checks and keep the longest match at each
position (so "holy shit" wins over "holy"). Per message:

```
kw = Σ weight(term) / max(1, token_count)        # weight ∈ [-1, +2]
```

Default positive terms: `let's go (2)`, `insane (2)`, `clutch (2)`, `holy (2)`,
`no way (2)`, `w (1)`, `gg (1)`, `goat (1)`, `insane (2)`, `crazy (1)`, `omg (1)`.
Default negative-excitement terms also count toward *arousal*: `wtf (2)`, `choke (2)`,
`throw (1)`, `sad (1)`, `L (1)`. Neutral/filler words contribute 0.

Maintain EWMA `μ_kw, σ_kw`, and the fraction `f_hype` of messages with `kw > 0.5`:

```
z_kw = (mean_kw - μ_kw) / σ_kw_eff
keyword = clamp01(0.6·from_z(z_kw, 2.0, 1.0) + 0.4·from_range(f_hype, 0.20, 0.70))
```

### (e) Sentiment / excitement (arousal, not valence)

We care about **arousal**: both "LETS GOOOO" and "NOOOOO" are clip-worthy; "this is
okay" is not. Run a cheap deterministic scorer first, with an optional small ONNX
model behind a feature flag:

```
arousal(msg) = clamp01( 0.35·lexicon_arousal
                      + 0.25·caps_ratio(msg)          # fraction of alpha chars uppercase
                      + 0.20·exclamation_density      # min(1, count('!')/3)
                      + 0.20·elongation_density )     # min(1, runs of >=3 repeated char /4)
```

`lexicon_arousal` is a shared word list with continuous intensities. Ignore valence
in fusion; store it only for post-hoc tagging. EWMA baseline over mean window arousal:

```
z_e = (mean_arousal - μ_e) / σ_e_eff
excitement = clamp01(from_z(z_e, 2.0, 1.0))
```

If the optional model is enabled, replace `lexicon_arousal` with model output but keep
the same normalization path so the signal semantics do not change.

### (f) Audio energy + speech energy

Input: 100 ms PCM frames with `rms_db`, `spectral_flux`, `speech_prob` (VAD) produced
by `pulsecut-capture`. Ambient tracker mirrors `stream-highlight-bot`'s proven design:

```
ambient = if first { rms_db } else { 0.98·ambient + 0.02·rms_db }   # slow, τ ≈ 5 s @100ms
jump    = max(0, rms_db - ambient - AUDIO_FLOOR_DB)                  # AUDIO_FLOOR_DB = -55
s_audio = from_range(jump, J0=6.0, J1=18.0)                          # dB above ambient
s_flux  = from_range(flux_z, 2.0, 1.0)                               # onset detector
audio_energy = clamp01(0.7·s_audio + 0.3·s_flux)
```

Speech energy from ASR word timestamps (optional, enabled when `pulsecut-ai` has a
transcriber): `wps = words in [t-30,t] / 30`; `s_speech = from_z(z_wps, 2.0, 1.0)`.
Combine:

```
audio = clamp01(max(audio_energy, 0.6 · s_speech))
```

A door slam alone can produce `s_audio ≈ 1`; that is why §9.1 requires chat
corroboration unless `override` is present.

### (g) Viewer-count spike

Sample viewer count every `VIEWER_SAMPLE_SECONDS = 10 s` from the platform API.
Maintain a slow EWMA `μ_v, σ_v` (τ = 300 s) and:

```
z_v    = (vₜ - μ_v) / max(σ_v, max(5.0, 0.05·μ_v))
viewer = from_z(z_v, 2.0, 1.0)
```

Viewer spikes **lag** the chat moment by 5–20 s (people arrive after the event).
Treat this as confirmatory only: accept a viewer `z_v ≥ 2` whose sample time lies in
`[T - 10s, T + 25s]` of the anchor `T`. Respect API rate limits; a stale sample
(> 30 s) marks the signal unavailable.

### (h) Moderator / command override

An authenticated `!clip`, `!highlight`, or a human "Clip now" button press sets:

```
override = 1.0   with flag force = true
```

Authentication is mandatory: only `is_mod || is_broadcaster` (Twitch/Kick) or
owner-equivalent (YouTube moderator) may issue it. Rate-limit to
`MAX_OVERRIDES_PER_MIN = 6`. A `!noclip` from the same role cancels any pending
candidate whose anchor is within `VETO_WINDOW = 20 s`. Override:
- sets `score = max(score, 0.95)` (bypasses the score threshold),
- still passes through cooldown dedup and NMS (to prevent double-clips),
- forces `confidence ≥ 0.98` (§6) — but still records the human's identity for audit.

---

## 4. Normalization per channel, cold start, presets

### Per-channel state
`ChannelBaseline` holds the EWMA/MAD state, the decaying token prior, the ambient
audio dB, warmup elapsed time, and approval counts. Baselines are keyed by
`ChannelId`, persisted to disk, and **reset when the stream goes offline** (a new
stream is a new distribution). Within a stream, update baseline state on every tick
*except* ticks inside an active candidate window (§9.4).

### Cold start
During the first `WARMUP_SECONDS = 180 s`:
- initialize `μ_velocity = preset.μ0` (msg/s) and `σ_velocity = preset.σ0` rather than 0,
  so a busy channel doesn't look like a permanent 200σ spike;
- multiply `confidence` by `warmup_factor = clamp01(elapsed / WARMUP_SECONDS) * 0.6 + 0.4`
  (0.4 → 1.0);
- require `MIN_CORROBORATING = 2` signals ≥ 0.5 even for a high score, unless override.

### Presets
A `ChannelPreset` supplies `μ0, σ0`, keyword lexicon additions, suppressed keywords,
and threshold/weight deltas. Ship: `default`, `small_streamer`, `fps`, `moba`,
`strategy_chess`, `irl`, `variety_chatting`, `sports`. Example: `small_streamer` has
`μ0=0.4 msg/s, σ0=0.8`, `keyword` weight +0.03, `threshold` −0.05;
`variety_chatting` has `μ0=6.0 msg/s, σ0=4.0` and a higher `Z0_VELOCITY` of 3.5.

### Learning (deliberately conservative)
Never mutate historical scores or baselines with feedback. Store (approvals, rejections)
and, after `MIN_REVIEW_COUNT = 30` decisions, adjust **only** `threshold` by ±0.02 per
calibration batch, bounded to `[τ−0.08, τ+0.08]`, and only if offline evaluation over
the last 100 candidates shows improved estimated precision. Increment
`calibration_version`; keep the old version restorable. Weights are not auto-tuned in
v1.

---

## 5. Trigger decision state machine

Per tick, per channel:

1. **Ingest** new messages/frames/samples; run filters and id dedup.
2. Compute all signals and `score` (§2).
3. If `override.force` → construct candidate with `score = max(score, 0.95)`, jump to 6.
4. If `score < THRESHOLD (0.62)` → no candidate; update baselines (unless inside an
   active candidate window); clear stale pending.
5. **Corroboration gate:** count available signals with `xᵢ ≥ 0.5`. If
   `count < MIN_CORROBORATING (2)` → no candidate (log as `weak_single_signal`).
6. **Sanity gates:** absolute-count floor (§9.6), raid suppression (§9.3), clip-rate
   limit (§9.7), cooldown (§9.2), `!noclip` veto (§9.8).
7. Compute `confidence` (§6). If `confidence < C_MIN (0.50)` → discard with reason.
8. Set anchor `T = t_eval` (the tick time at which the window closed), create a
   `Candidate`, push to `pending`. Do **not** finalize yet: wait `EVENT_SETTLE = 1.5 s`
   plus the postroll requirement (§7).
9. On finalization, run **NMS** over `pending` (§7.4) and **re-clip check** against the
   archive (§7.5). Emit `ClipRequest`.

`EVENT_SETTLE` exists because chat delivery is late and bursty: evaluate 1.5 s after
the window closes so the last messages of the burst have arrived. Anchor `T` remains
the window-close time (corrected by a per-connector `chat_latency_offset` if calibrated).

---

## 6. Confidence score (0..1) and the human approval gate

Confidence estimates "how safe is it to clip/publish this automatically". It is
deliberately *separate* from `score`, which drives triggering.

```
c_score        = logistic((score - THRESHOLD) / 0.08)          // margin above threshold
m              = count of available signals with xᵢ ≥ 0.5
corroboration  = clamp01(0.50 + 0.15·m)                        // m=2 → 0.80, m≥4 → 1.0
spread         = stdev(xᵢ over available signals)
agreement      = 1.0 / (1.0 + spread / max(mean(xᵢ), 1e-3))
prior          = (approvals + 1) / (approvals + rejections + 2) // Beta(1,1) smoothing

confidence = c_score · (0.6·corroboration + 0.4·agreement)
                     · (0.7 + 0.3·prior)
                     · warmup_factor
if override.force: confidence = max(confidence, 0.98)
confidence = clamp01(confidence)
```

Routing:

| Confidence | Action |
|---|---|
| `< C_MIN = 0.50` | discard candidate, record features + reason for calibration |
| `[0.50, 0.85)` | create review-queue item; **human approval required** before render/publish |
| `≥ C_AUTO = 0.85` | auto-clip; publish only if channel policy allows auto-publish, else still queue for a lightweight confirm |

Rationale: a candidate with `score=0.9` but only one elevated signal (`m=1`,
`corroboration=0.65`, high spread) gets `confidence≈0.5` and is held for review —
exactly the emote-spam-only case we want a human to see. A candidate with velocity +
unique + audio + keyword all elevated gets `confidence≈0.9` and can auto-fire.

Every `ClipRequest` carries the full `SignalValues`, `score`, `confidence`, and a
human-readable `reason` string built from the top contributing signals; this powers
the "why this moment" UI and the feedback loop.

---

## 7. Exact clipping window logic

### 7.1 Raw window from anchor `T`

```
raw_start = T - LOOKBACK_SECONDS        # 40.0
raw_end   = T + POSTROLL_SECONDS        # 15.0
```

`T` is the event anchor in stream time. The clip cannot be finalized until data for
`raw_end` exists: schedule finalization at `T + POSTROLL_SECONDS + FINALIZE_MARGIN (0.5 s)`.
Total end-to-end latency ≈ 15 s + 1.5 s settle; this is inherent to "clip from the
moment it went crazy" and must be surfaced in the UI as "processing".

Clamp to the available rolling buffer `[buffer_start, now]`:

```
raw_start = max(raw_start, buffer_start, 0.0)
raw_end   = min(raw_end, now)
if raw_end - raw_start < MIN_DURATION: drop with reason "buffer_underrun"
```

Buffer length must be ≥ `BUFFER_SECONDS = 120 s` so `T-40` is always resident.

### 7.2 Boundary snapping

Goal: don't cut mid-sentence or mid-scene. Search around each raw edge within
`SNAP_SEARCH = 2.0 s`; never move an edge by more than `SNAP_MAX = 2.5 s`.

Priority: **ASR word boundary > scene boundary > RMS silence**.

**RMS silence:** with 100 ms frames, a frame is silent if `rms_db < SILENCE_DB (-45 dBFS)`
for at least `SILENCE_MIN_MS = 100 ms`. For the start, choose the **latest** silent
frame at or before `raw_start` within the search window (extends context); for the
end, choose the **earliest** silent frame at or after `raw_end` (keeps the whole
reaction). If none, keep the raw edge.

**ASR word timestamps:** if `Vec<AsrWord>` covers the edge, snap `start` to
`word.start` of the word whose interval contains `raw_start` (or the next word if
`raw_start` falls in a gap > 0.3 s), and `end` to `word.end` of the word containing
`raw_end`. This avoids cutting through a word.

**Scene boundary:** optional; from a frame-diff/sharp-cut detector near the edge,
snap to the nearest detected cut within `SNAP_SEARCH`. Used only if ASR is absent.

```
snap_start(raw_start, direction=Backward) -> StreamTs
snap_end  (raw_end,   direction=Forward)  -> StreamTs
start = clamp(snapped_start, raw_start - SNAP_MAX, raw_start + SNAP_MAX)
end   = clamp(snapped_end,   raw_end   - SNAP_MAX, raw_end   + SNAP_MAX)
```

### 7.3 Min / max duration, re-clamped

```
if end - start < MIN_DURATION (8.0):
    pad = (MIN_DURATION - (end - start)) / 2.0
    start = max(buffer_start, start - pad)
    end   = end + pad
if end - start > MAX_DURATION (60.0):
    // keep the moment and postroll: trim lookback first
    let excess = (end - start) - MAX_DURATION
    let take_start = min(excess, start - (T - LOOKBACK_MIN=10.0))
    start += take_start
    end   -= (excess - take_start)          // only if still > MIN_DURATION
start = max(start, buffer_start); end = min(end, now)
if end - start < MIN_DURATION: drop "too_short"
```

Then store `window = (start, end)` on the candidate.

### 7.4 Merging overlapping candidates — 1-D non-maximum suppression

Multiple ticks around one hype event produce several candidates. Merge them:

```
fn merge_candidates(cands: Vec<Candidate>, cfg) -> Vec<Candidate>:
    sort cands by score DESC, then by anchor_t ASC (stable tiebreak)
    accepted = []
    for c in cands:
        suppressed = false
        for a in accepted:
            overlap = max(0, min(c.end,a.end) - max(c.start,a.start))
            union   = (c.end-c.start) + (a.end-a.start) - overlap
            iou     = overlap / union
            if iou >= cfg.nms_iou (0.35) or overlap >= cfg.nms_overlap_sec (8.0):
                suppressed = true; break
        if not suppressed: accepted.push(c)
    return accepted
```

For suppressed candidates, merge their `reason` strings and take the max signal
values into the accepted candidate (so the audit trail is not lost). Bound
`pending.len()` to `MAX_PENDING = 32`; if exceeded, keep the top 32 by score and
log the drop.

### 7.5 Preventing re-clipping the same event

Maintain `clip_archive: Vec<ClipRecord>` (bounded to `ARCHIVE_CAP = 256`, TTL =
`ARCHIVE_TTL = 3600 s`) containing `{event_key, window, status}`.

```
event_key = hash64(channel_id, floor(anchor_t / DEDUP_BUCKET=15.0))
```

Before emitting:
- reject if `event_key` is in `fired_keys` LRU (TTL 600 s);
- reject if `iou(window, archived.window) >= RECLIP_IOU (0.5)` for any non-failed
  archived record;
- reject if `anchor_t - last_fired_t < COOLDOWN_SECONDS (25.0)`.

On emission, insert the key, set `last_fired_t = anchor_t`, and push the record with
status `pending_render`. On render failure, keep the record with `status=Failed` but
mark `allow_retry_after` so a transient encoder failure doesn't permanently block the
moment. `event_key` is the idempotency key propagated to rendering/publishing.

### 7.6 Output

```
ClipRequest {
    channel_id, event_key,
    start, end, anchor_t, duration,
    score, confidence, signals, reason,
    preset, calibration_version,
}
```

---

## 8. Rust-friendly data model

```rust
use std::collections::{HashMap, HashSet, VecDeque};

pub type StreamTs = f64;          // seconds, monotonic, media-PTS aligned
pub type ChannelId = String;
pub type MsgId = String;
pub type UserId = u64;            // hashed; avoid storing strings in hot path

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MessageKind {
    Chat, Emote, Subscription, Raid, Join, ModAction, System, Command,
}

#[derive(Clone, Debug)]
pub struct ChatMessage {
    pub id: MsgId,
    pub user_hash: UserId,
    pub ts: StreamTs,
    pub text: String,
    pub kind: MessageKind,
    pub is_mod: bool,
    pub is_broadcaster: bool,
    pub is_known_bot: bool,
    pub emotes: Vec<String>,      // platform-resolved emote codes
}

#[derive(Clone, Copy, Debug)]
pub struct AudioFrame {
    pub ts: StreamTs,
    pub rms_db: f32,
    pub spectral_flux: f32,
    pub speech_prob: f32,
}

#[derive(Clone, Debug)]
pub struct AsrWord {
    pub text: String,
    pub start: StreamTs,
    pub end: StreamTs,
    pub confidence: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct ViewerSample { pub ts: StreamTs, pub count: u32 }

/// All normalized signals. `available()` returns a per-signal availability mask.
#[derive(Clone, Copy, Debug, Default)]
pub struct SignalValues {
    pub velocity: f32,
    pub unique_chatter: f32,
    pub token_burst: f32,
    pub keyword: f32,
    pub excitement: f32,
    pub audio: f32,
    pub viewer: f32,
    pub override_: f32,          // `override` is a Rust keyword
}

#[derive(Clone, Copy, Debug)]
pub struct Ewma {
    pub mean: f32,
    pub var: f32,
    pub alpha: f32,              // 1 - exp(-tick / tau_mean)
    pub beta: f32,               // 1 - exp(-tick / tau_var)
    pub initialized: bool,
}
impl Ewma {
    fn new(mu0: f32, sigma0: f32, tick: f32, tau_mean: f32, tau_var: f32) -> Self {
        Self { mean: mu0, var: sigma0*sigma0,
               alpha: 1.0 - (-tick/tau_mean).exp(),
               beta: 1.0 - (-tick/tau_var).exp(), initialized: false }
    }
    fn update(&mut self, x: f32) {
        if !self.initialized { self.mean = x; self.initialized = true; return; }
        let d = x - self.mean;
        self.mean += self.alpha * d;
        self.var = self.beta * d*d + (1.0 - self.beta) * self.var;
    }
    fn sigma(&self) -> f32 { self.var.max(0.0).sqrt() }
}

pub struct ChannelBaseline {
    pub velocity: Ewma,
    pub unique: Ewma,
    pub keyword: Ewma,
    pub excitement: Ewma,
    pub viewer: Ewma,
    pub rate_ring: VecDeque<f32>,             // last MAD_WINDOW per-tick rates
    pub token_prior: HashMap<u64, f32>,       // decaying token probabilities
    pub token_counts: Vec<HashMap<u64, u16>>, // 30 per-second buckets
    pub ambient_db: Option<f32>,
    pub warmup_elapsed: StreamTs,
    pub approvals: u32,
    pub rejections: u32,
    pub last_viewer_ts: StreamTs,
    pub raid_until: StreamTs,                 // suppress hype counting until this time
    pub last_tick: StreamTs,
    pub stream_ended: bool,
    pub clips_this_hour: u32,
    pub hour_bucket: u64,
}

#[derive(Clone, Debug)]
pub struct Candidate {
    pub event_key: u64,
    pub anchor_t: StreamTs,
    pub start: StreamTs,
    pub end: StreamTs,
    pub score: f32,
    pub confidence: f32,
    pub signals: SignalValues,
    pub reason: String,
    pub forced: bool,
}

#[derive(Clone, Debug)]
pub struct ClipRequest {
    pub channel_id: ChannelId,
    pub event_key: u64,
    pub start: StreamTs,
    pub end: StreamTs,
    pub anchor_t: StreamTs,
    pub score: f32,
    pub confidence: f32,
    pub signals: SignalValues,
    pub reason: String,
    pub calibration_version: u32,
}

pub struct SpikeDetector {
    pub cfg: DetectorConfig,
    pub baselines: HashMap<ChannelId, ChannelBaseline>,
    pub pending: HashMap<ChannelId, Vec<Candidate>>,
    pub last_fired: HashMap<ChannelId, StreamTs>,
    pub fired_keys: LruTtlSet<u64>,           // bounded LRU + TTL
    pub seen_msg_ids: LruTtlSet<u64>,         // message-id dedup
    pub archive: VecDeque<ClipRecord>,
    pub lexicon: aho_corasick::AhoCorasick,   // built once at startup
    pub hype_emotes: HashSet<u64>,
}

struct ClipRecord { event_key: u64, window: (StreamTs, StreamTs), status: ClipStatus, ts: StreamTs }
enum ClipStatus { PendingRender, Done, Failed { retry_after: StreamTs } }
```

`LruTtlSet<T>` = `HashMap<T, Instant>` + `VecDeque<T>` with caps
(`MSG_DEDUP_CAP = 20_000`, `FIRED_KEY_CAP = 512`) and TTL eviction. It is ~20 lines of
Rust and avoids a dependency.

### 8.1 Detector pseudocode (the hot path)

```rust
impl SpikeDetector {
    /// Called by the chat connector for every decoded message.
    fn on_message(&mut self, ch: &ChannelId, m: ChatMessage) {
        let id = hash_msg(&m.id);
        if self.seen_msg_ids.contains(id) { return; }   // reconnect replay / duplicate
        self.seen_msg_ids.insert(id);

        if m.is_known_bot || m.kind == MessageKind::System
           || m.kind == MessageKind::ModAction { return; }  // never count as hype

        let b = self.baselines.entry(ch.clone()).or_insert_with(|| self.new_baseline(ch));

        if is_raid_signature(&m, b) {                    // §9.3
            b.raid_until = m.ts + RAID_SUPPRESS_SECONDS;
            return;
        }
        if m.kind == MessageKind::Command && (m.is_mod || m.is_broadcaster) {
            if let Some(anchor) = parse_clip_command(&m.text) { self.force_candidate(ch, anchor, m.user_hash); }
            else if is_noclip(&m.text) { self.veto(ch, VETO_WINDOW); }
            return;
        }
        if m.ts < b.raid_until { return; }
        b.push_message(m);                               // ring buckets + token counts
    }

    /// Called once per tick (1 s) by the scheduler with virtual or real time.
    fn tick(&mut self, ch: &ChannelId, now: StreamTs) -> Option<ClipRequest> {
        let b = self.baselines.get_mut(ch)?;
        if b.stream_ended || now - b.last_tick < TICK { return None; }

        let q = b.qualifying_messages_in_window(WINDOW_SHORT); // filtered, deduped
        let n = q.len() as f32;
        let rate = n / WINDOW_SHORT;

        // --- signals a-e ---
        b.velocity.update(rate);
        let sigma_v = b.velocity.sigma().max(SIGMA_FLOOR_ABS)
                       .max(SIGMA_FLOOR_REL * b.velocity.mean);
        let z_v = ((rate - b.velocity.mean) / sigma_v).clamp(-Z_CLAMP, Z_CLAMP);
        let prev = b.rate_n_ticks_ago(ACCEL_WINDOW as usize);
        let z_a = ((rate - prev) / (sigma_v * 2.0_f32.sqrt() + 1e-6)).clamp(-Z_CLAMP, Z_CLAMP);

        let u = b.unique_authors_in_window(WINDOW_SHORT) as f32;
        b.unique.update(u);
        let z_u = ((u - b.unique.mean) /
                   b.unique.sigma().max(0.5).max(0.2*b.unique.mean)).clamp(-Z_CLAMP, Z_CLAMP);

        let (dom, z_tok) = b.dominant_token_stats(&self.hype_emotes, n);
        let (kw_mean, f_hype) = score_keywords(&q, &self.lexicon);
        b.keyword.update(kw_mean);
        let z_kw = ((kw_mean - b.keyword.mean) / b.keyword.sigma().max(0.05)).clamp(-Z_CLAMP, Z_CLAMP);
        let arousal = q.iter().map(heuristic_arousal).sum::<f32>() / n.max(1.0);
        b.excitement.update(arousal);
        let z_e = ((arousal - b.excitement.mean) / b.excitement.sigma().max(0.05)).clamp(-Z_CLAMP, Z_CLAMP);

        let mut s = SignalValues {
            velocity:     clamp01(0.65*from_z(z_v, Z0_VELOCITY, Z_WIDTH)
                                + 0.35*from_z(z_a, Z0_ACCEL, Z_WIDTH)),
            unique_chatter: clamp01(from_z(z_u, 3.0, 1.0)
                                * (0.5 + 0.5*clamp01((u / n.max(1.0)) / 0.70))),
            token_burst:  ...from (c)...,
            keyword:      clamp01(0.6*from_z(z_kw, 2.0, 1.0)
                                + 0.4*from_range(f_hype, 0.20, 0.70)),
            excitement:   from_z(z_e, 2.0, 1.0),
            audio:        b.audio_signal_or_unavailable(now), // NaN => unavailable
            viewer:       b.viewer_signal_or_unavailable(now),
            override_:    0.0,
        };

        // --- fusion over available signals ---
        let mask = availability_mask(&s);                    // finite & data-fresh
        let score = weighted_average(&s, &mask, &self.cfg.weights);

        // --- gates ---
        if score < self.cfg.threshold { b.update_baselines_excluding_candidate(); return None; }
        let corroborating = count_ge(&s, &mask, 0.5);
        if corroborating < self.cfg.min_corroborating { return None; }
        if n < self.cfg.abs_min_messages && b.velocity.mean < self.cfg.min_baseline_rate {
            return None;                                      // dead-chat guard
        }
        if now < b.raid_until { return None; }
        if cooldown_blocked(self.last_fired.get(ch), now, self.cfg.cooldown_seconds) { return None; }
        if clip_rate_exceeded(ch, now) { return None; }

        let confidence = compute_confidence(score, &s, &mask, b, now, false);
        if confidence < self.cfg.c_min { return None; }

        let anchor = now - EVENT_SETTLE;
        let key = hash64(ch, (anchor / DEDUP_BUCKET) as u64);
        let cand = Candidate { event_key: key, anchor_t: anchor, start: 0.0, end: 0.0,
                               score, confidence, signals: s, reason: top_reasons(&s), forced: false };
        self.pending.entry(ch.clone()).or_default().push(cand);
        Some(self.finalize_if_ready(ch, now))?              // may return None until postroll
    }

    /// Called when `now >= anchor + POSTROLL + FINALIZE_MARGIN`.
    fn finalize_if_ready(&mut self, ch: &ChannelId, now: StreamTs) -> Option<ClipRequest> {
        // Stable Rust: take the ready candidates out, keep the rest.
        // (Equivalent to Vec::drain_filter, which is not stable; use retain + split_off.)
        let list = self.pending.get_mut(ch)?;
        let cut = list.partition_point(|c| now < c.anchor_t + POSTROLL_SECONDS + FINALIZE_MARGIN);
        let ready: Vec<Candidate> = list.split_off(cut);
        let merged = merge_candidates(ready, &self.cfg);
        let mut out = None;
        for mut c in merged {
            // `buffer_range(ch)` and `asr_for(ch)` are provided by pulsecut-capture / pulsecut-ai.
            let buffer = self.buffer_range(ch);
            let asr = self.asr_for(ch);
            let rms = self.rms_frames_for(ch, c.anchor_t);
            let (start, end) = compute_clip_window(c.anchor_t, &self.cfg, buffer, asr, rms)
                               .expect("clipped to buffer; see underrun guard in §7.1");
            c.start = start; c.end = end;
            if reclip_check(&c, &self.archive, &self.fired_keys, &self.last_fired, &self.cfg) { continue; }
            self.archive.push_back(ClipRecord::from(&c));
            self.fired_keys.insert(c.event_key);
            self.last_fired.insert(ch.clone(), c.anchor_t);
            out = Some(c.into_clip_request(ch.clone(), self.cfg.calibration_version));
        }
        out
    }
}
```

### 8.2 Window computation pseudocode

```rust
fn compute_clip_window(t: StreamTs, cfg: &DetectorConfig,
                       buffer: (StreamTs, StreamTs), asr: Option<&[AsrWord]>,
                       rms: &[(StreamTs, f32)]) -> Option<(StreamTs, StreamTs)> {
    let mut start = (t - cfg.lookback).max(buffer.0).max(0.0);
    let mut end   = (t + cfg.postroll).min(buffer.1);
    if let Some(words) = asr {
        start = snap_start_asr(start, words, cfg.snap_max);
        end   = snap_end_asr(end, words, cfg.snap_max);
    } else {
        start = snap_rms_backward(start, rms, cfg.silence_db, cfg.snap_max);
        end   = snap_rms_forward(end, rms, cfg.silence_db, cfg.snap_max);
    }
    // min / max duration (§7.3)
    if end - start < cfg.min_duration {
        let pad = (cfg.min_duration - (end - start)) / 2.0;
        start = (start - pad).max(buffer.0); end += pad;
    }
    if end - start > cfg.max_duration {
        let excess = (end - start) - cfg.max_duration;
        let shave = excess.min(start - (t - cfg.lookback_min));
        start += shave; end -= excess - shave;
    }
    if end - start < cfg.min_duration || end > buffer.1 { return None; }
    Some((start, end))
}
```

---

## 9. False-positive controls (checklist)

### 9.1 Corroboration requirement
No non-override candidate fires on a single signal. `MIN_CORROBORATING = 2` signals
with `xᵢ ≥ 0.5`, and `confidence` (§6) further penalizes low-signal-count moments.
This is the single most important control: it kills emote-spam-only and audio-only
false positives while preserving genuine multi-modal hype.

### 9.2 Cooldown
`COOLDOWN_SECONDS = 25`, measured on **anchor time** (not wall time) so clock drift
cannot reset it. Also: `MAX_CLIPS_PER_HOUR = 12` per channel, with a token bucket.

### 9.3 Raid and mass-join suppression
Detect raid signature: `Join` messages ≥ `RAID_JOIN_COUNT = 20` within 3 s, or
`join_rate > 5× baseline`, or lexicon hit `welcome raid|raid|!raid`. Set
`raid_until = now + RAID_SUPPRESS_SECONDS (20)` and drop qualifying messages during
that interval. Optionally emit a separate non-clippable `RaidEvent` for the UI.

### 9.4 Baseline contamination control
Do **not** update EWMA/MAD state for ticks whose time lies inside a pending or
recently finalized candidate window (from `anchor-5 s` to `anchor+postroll`). This
prevents a real spike from raising the baseline and blinding the detector to the next
moment. Additionally, update variance `β` faster than the mean `α` (τ_var=300 s is
*longer*, but on a detected spike apply `var *= SPIKE_VAR_BOOST = 1.5` once) so the
detector becomes appropriately more conservative after a surprise.

### 9.5 Moderator, bot, and system filtering
Drop `MessageKind::{Subscription, Raid, Join, ModAction, System}` from hype counts;
drop `is_mod || is_broadcaster || is_known_bot` authors. Maintain a per-channel
known-bot set seeded from platform bot lists plus a regex
(`(?i)(nightbot|streamlements|streamelements|sery_bot|moobot)`). Mod *commands* are
handled on the override path only.

### 9.6 Dead-chat guard
If `μ_velocity < MIN_BASELINE_RATE = 0.05 msg/s`, require `N ≥ ABS_MIN_MESSAGES = 5`
qualifying messages in the 30 s window. This stops a channel with 1 msg/30s baseline
from clipping its normal 3-message chatter.

### 9.7 Rate limits and scheduling
`MAX_CLIPS_PER_HOUR = 12`, `MAX_OVERRIDES_PER_MIN = 6`, global `MAX_PENDING = 32`.
Optional `quiet_hours` in channel config suppresses all non-override candidates.

### 9.8 Veto and audit
`!noclip` cancels pending candidates within `VETO_WINDOW = 20 s`; a rejected clip
feeds `rejections` for calibration. Every candidate stores its deciding signals, so
false positives are diagnosable rather than mysterious.

### 9.9 Postroll confirmation
Because finalization waits until `T+15 s`, we can add a final check: if the qualifying
message count in `[T, T+postroll]` is 0 and the window's audio RMS never exceeds
ambient+3 dB, the spike was likely a raid/giveaway that ended instantly → discard
with reason `no_postroll_confirmation`. (Override bypasses this check.)

---

## 10. Config constants with defaults

```rust
pub struct DetectorConfig {
    // windows / cadence
    pub window_short: f32,          // 30.0
    pub tick: f32,                  // 1.0
    pub ewma_tau_mean: f32,         // 60.0
    pub ewma_tau_var: f32,          // 300.0
    pub mad_window: usize,          // 300
    pub mad_min_samples: usize,     // 20
    pub accel_window: f32,          // 5.0
    pub warmup_seconds: f32,       // 180.0

    // normalization / z
    pub sigma_floor_abs: f32,       // 0.5       msg/s
    pub sigma_floor_rel: f32,       // 0.30      × mean
    pub z_clamp: f32,               // 10.0
    pub z0_velocity: f32,           // 3.0
    pub z0_accel: f32,              // 2.0
    pub z_width: f32,               // 1.0

    // decision
    pub threshold: f32,             // 0.62
    pub c_min: f32,                 // 0.50
    pub c_auto: f32,               // 0.85
    pub min_corroborating: usize,   // 2
    pub min_baseline_rate: f32,     // 0.05 msg/s
    pub abs_min_messages: usize,    // 5
    pub cooldown_seconds: f32,      // 25.0
    pub dedup_bucket: f32,          // 15.0
    pub event_settle: f32,          // 1.5
    pub finalize_margin: f32,       // 0.5
    pub max_clips_per_hour: u32,    // 12
    pub max_overrides_per_min: u32, // 6
    pub max_pending: usize,         // 32

    // clip window
    pub lookback: f32,              // 40.0
    pub postroll: f32,              // 15.0
    pub lookback_min: f32,          // 10.0  (floor when shrinking to max)
    pub min_duration: f32,          // 8.0
    pub max_duration: f32,          // 60.0
    pub buffer_seconds: f32,        // 120.0
    pub snap_search: f32,           // 2.0
    pub snap_max: f32,              // 2.5
    pub silence_db: f32,            // -45.0
    pub silence_min_ms: u32,        // 100
    pub nms_iou: f32,               // 0.35
    pub nms_overlap_sec: f32,       // 8.0
    pub reclip_iou: f32,            // 0.5
    pub archive_cap: usize,         // 256
    pub archive_ttl: f32,           // 3600.0

    // audio / viewer
    pub audio_floor_db: f32,        // -55.0
    pub jump_db_lo: f32,            // 6.0
    pub jump_db_hi: f32,            // 18.0
    pub viewer_sample_seconds: f32, // 10.0
    pub viewer_max_age: f32,        // 30.0

    // ingestion
    pub msg_dedup_cap: usize,       // 20_000
    pub msg_dedup_ttl: f32,         // 600.0
    pub max_tokens_per_msg: usize,  // 64
    pub max_tracked_tokens: usize,  // 4096
    pub raid_join_count: usize,     // 20
    pub raid_suppress_seconds: f32, // 20.0
    pub veto_window: f32,           // 20.0
    pub spike_var_boost: f32,       // 1.5

    // learning
    pub min_review_count: u32,      // 30
    pub threshold_delta: f32,       // 0.02
    pub threshold_bound: f32,       // 0.08

    pub weights: Weights,
    pub calibration_version: u32,   // 1
}
```

`Default` initializes every field to the value in the trailing comment. Weights are
the table in §2; presets override `threshold`, `z0_velocity`, selected weights, and
lexicon additions as described in §4.

---

## 11. Testing strategy with synthetic chat streams

### 11.1 Determinism
Introduce a `Clock` trait (`fn now(&self) -> StreamTs`) and inject a `VirtualClock` in
tests. The detector must contain no `std::thread::sleep`/`SystemTime::now` in its core;
the scheduler owns real time. Tests advance the clock by exact `TICK` steps.

### 11.2 Synthetic stream builder
A helper `synth!` macro emits a `Vec<ChatMessage>` with controlled `(ts, user, text,
kind, badges)`. Parameters: `base_rate`, `burst_rate`, `burst_at`, `burst_len`,
`unique_users`, `token`, `include_mods/bots/dupes`. Pair it with synthetic
`Vec<AudioFrame>` (constant ambient ± injected jump) and `Vec<ViewerSample>`.

### 11.3 Scenario matrix (unit tests, one per row)

| Test | Input | Expected |
|---|---|---|
| `steady_chat_no_fire` | 2 msg/s for 5 min | score < 0.2, no candidate |
| `slow_chat_no_false_fire` | 1 msg/30 s, 3 msg burst | dead-chat guard blocks |
| `sudden_spike_fires` | 1 msg/s → 25 msg/s for 4 s, 20 unique users, hype words | 1 candidate, `score ≥ 0.7`, `confidence ≥ 0.8` |
| `gradual_ramp_no_fire` | 1→20 msg/s over 120 s | velocity high, acceleration low → no candidate |
| `emote_spam_alone_blocked` | 40 `PogChamp` from 2 users | token_burst high, corroboration=1 → blocked |
| `raid_suppressed` | 60 `Join` + `WELCOME RAID`, 100 `W` | `raid_until` set, zero candidates |
| `duplicate_messages_deduped` | each message delivered twice | counts once, no artificial spike |
| `mod_bot_filtered` | 50 bot/sub messages | no candidate |
| `audio_only_blocked` | RMS +15 dB, no chat | corroboration=1 → blocked (or override fires) |
| `override_forces_clip` | `!clip` from mod | candidate with `score=0.95`, `confidence≥0.98` |
| `veto_cancels` | `!clip` then `!noclip` within 5 s | pending candidate removed |
| `cooldown_blocks_second` | two spikes 10 s apart | only first emits |
| `nms_merges_overlap` | 3 candidates with windows overlapping > 0.35 IoU | 1 accepted, reasons merged |
| `reclip_archive_blocks` | same `event_key` replayed | second blocked by archive |
| `snap_to_silence` | raw end inside speech, silence at +1.2 s | end snapped ≤ 2.5 s to silence |
| `min_max_duration` | extreme T near buffer edge | duration ∈ [8, 60] |
| `buffer_underrun` | anchor near buffer start with insufficient lookback | dropped with reason |
| `warmup_stricter` | burst at t=30 s with 1 signal | blocked; override still fires |

### 11.4 Property tests (`proptest`)
- For any inputs: `0 ≤ score ≤ 1`, `0 ≤ confidence ≤ 1`, every signal finite or NaN-for-unavailable.
- After `compute_clip_window`: `start ≤ end`, `end-start ∈ [MIN, MAX]` or result is `None`.
- `merge_candidates` output contains no pair with `IoU ≥ nms_iou` and `overlap ≥ nms_overlap_sec`.
- NMS is idempotent: `merge(merge(x)) == merge(x)`.
- Dedup never increases the qualifying-message count.

### 11.5 Integration test (end-to-end detector loop)
Replay a 5-minute synthetic fixture (chat CSV + audio RMS array + viewer samples)
through `SpikeDetector` with `VirtualClock`. Assert:
- exactly 2 `ClipRequest`s at the two designed hype moments;
- expected `event_key`s and window bounds (within snap tolerance);
- replaying the same fixture a second time yields no new clips (idempotency);
- a snapshot of the final `ChannelBaseline` matches a golden JSON (regression guard).

### 11.6 Robustness / fuzz
- Feed emoji-only, RTL, 10k-char, and null-byte messages; tokenizer must cap at 64
  tokens and never panic.
- Random tokens up to `MAX_TRACKED_TOKENS` to verify LRU eviction and bounded memory.
- Random audio frames with NaN/Inf dB → treated as unavailable, never propagate into score.

### 11.7 Calibration tests
- Simulate 30 approvals → `threshold` moves by exactly `−0.02`, version increments,
  historical candidate rows unchanged.
- Simulate rejections → threshold rises, bounded by `threshold_bound`.
- Offline evaluation over stored features gates a bad calibration from activation.

### 11.8 Performance budget
5 minutes / ~30k synthetic messages processed in < 200 ms on a 2020 laptop; memory
for one channel bounded by `ring(30s) + token_prior(4096) + MAD ring(300) + dedup(20k)`.

---

## 12. Implementation notes / open decisions

- **Clock alignment** is a cross-crate contract: `pulsecut-chat` must expose the
  same stream clock as `pulsecut-capture`. Provide a calibration offset per connector.
- **Availability encoding**: use `f32::NAN` for "unavailable" signals rather than 0,
  so a missing audio feed cannot be confused with "audio silent but present".
- **ASR** is optional and may arrive after detection; if it arrives before
  finalization, use word snapping; otherwise use RMS snapping and note
  `snap_method = "rms"` in the `ClipRequest`.
- **Scene-boundary snapping** is v1.1; the hook is `snap_end_scene` but defaults off.
- **Confidence second stage**: keep the weighted formula as the interpretable first
  stage; later a learned `P(approve|features)` can re-rank review-queue items without
  changing triggering (per `live-content-intelligence` guidance).
- **Audio-only override** is intentionally allowed: a moderator pressing "Clip now"
  during a silent-but-hype moment is trusted.
