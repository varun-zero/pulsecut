# PulseCut End-to-End Verification Runbook (for OpenCode)

Follow this step-by-step runbook to verify that **PulseCut** (Rust backend + React/Vite frontend + Live Chat readers + Reaction PiP / Facecam editor + Chrome Extension bridge) works end-to-end with a **real YouTube URL** provided by the user.

> **Important:** PulseCut ships with **zero demo or mock clips**. Every clip verified below must come from the real YouTube URL supplied by the user (or a real local MP4 file).

---

## 0. Set Target YouTube URL

Export the YouTube URL provided by the user in your shell before running the steps below:

```bash
export YOUTUBE_URL="https://www.youtube.com/watch?v=REPLACE_WITH_USER_YOUTUBE_LINK"
export PULSECUT_PORT=8756
export FRONTEND_PORT=3000
```

---

## 1. Prerequisites Check

Confirm all required runtimes and media binaries are installed and available on `PATH`:

```bash
rustc --version
cargo --version
ffmpeg -version | head -n 1
ffprobe -version | head -n 1
yt-dlp --version
node --version
npm --version
python3 --version
```

- **FAIL condition:** If `ffmpeg`, `ffprobe`, or `yt-dlp` is missing, clip downloading and MP4 rendering will fail. Install them first (`brew install ffmpeg yt-dlp` or `apt install ffmpeg && pip install -U yt-dlp`).
- Confirm `yt-dlp` can inspect the user's YouTube URL without geo/auth errors:

```bash
yt-dlp --dump-single-json --no-warnings "$YOUTUBE_URL" | jq '{id, title, channel, duration, is_live}'
```

---

## 2. Build & Unit Test Verification

Run all frontend unit tests, production build, Rust workspace tests, and Python bridge syntax check:

```bash
# 1. Frontend TypeScript / logic / Reaction PiP / extension hypeEngine tests
npm install
npx tsx --test src/lib/studioLogic.test.ts

# 2. Frontend lint & production bundle
npm run lint
npm run build

# 3. Rust workspace compilation & unit tests (including chat readers, detector, renderer, editor)
cargo test --workspace

# 4. Kick chat bridge Python syntax check
python3 -m py_compile tools/kick-chat-bridge/bridge.py
```

- **PASS condition:** All 4 commands exit with status `0`.

---

## 3. Start PulseCut Backend & Frontend

Start the Rust editor/API server on `127.0.0.1:8756` and the Vite dev server on port `3000` (which proxies `/api/*` and `/health` to `http://127.0.0.1:8756`):

```bash
# Terminal 1 — Rust backend
cargo run --bin pulsecut -- editor --addr 127.0.0.1:${PULSECUT_PORT} > /tmp/pulsecut-backend.log 2>&1 &
BACKEND_PID=$!

# Terminal 2 — Frontend Studio UI (with /api proxy)
PULSECUT_API_URL="http://127.0.0.1:${PULSECUT_PORT}" npm run dev > /tmp/pulsecut-frontend.log 2>&1 &
FRONTEND_PID=$!
```

Wait 3–5 seconds and verify both servers + the Vite proxy respond cleanly:

```bash
curl -fsS "http://127.0.0.1:${PULSECUT_PORT}/health" && echo " [backend OK]"
curl -fsS "http://127.0.0.1:${FRONTEND_PORT}/health" && echo " [proxy OK]"
curl -fsS "http://127.0.0.1:${FRONTEND_PORT}/api/clips" | jq '{clip_count: (.clips | length)}'
curl -fsS "http://127.0.0.1:${FRONTEND_PORT}/api/jobs"  | jq '{job_count: (.jobs | length)}'
```

- **PASS condition:** On a fresh workspace, `/api/clips` and `/api/jobs` return valid JSON with zero demo entries.

---

## 4. End-to-End Real YouTube Clipping Workflow

### 4A. Submit the User's Real YouTube URL via API (or Dashboard UI)

Submit a real ingest job targeting `reaction-pip` (or `yt-short`) through the frontend proxy (`:3000/api/jobs`):

```bash
JOB_JSON=$(curl -fsS -X POST "http://127.0.0.1:${FRONTEND_PORT}/api/jobs" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg url "$YOUTUBE_URL" '{url: $url, max_clips: 2, template: "reaction-pip", burn_captions: true}')")

echo "$JOB_JSON" | jq .
JOB_ID=$(echo "$JOB_JSON" | jq -r '.job.id')
echo "Created JOB_ID=$JOB_ID"
```

### 4B. Poll Job Until Completion

Poll `GET /api/jobs/$JOB_ID` every 3 seconds until `status` is `done` (or `error`):

```bash
for i in $(seq 1 120); do
  STATUS_JSON=$(curl -fsS "http://127.0.0.1:${FRONTEND_PORT}/api/jobs/${JOB_ID}")
  STATUS=$(echo "$STATUS_JSON" | jq -r '.job.status')
  PROGRESS=$(echo "$STATUS_JSON" | jq -r '.job.progress')
  MSG=$(echo "$STATUS_JSON" | jq -r '.job.message')
  echo "[$i] status=$STATUS progress=${PROGRESS}% msg=$MSG"
  if [ "$STATUS" = "done" ] || [ "$STATUS" = "error" ]; then
    echo "$STATUS_JSON" | jq .
    break
  fi
  sleep 3
done
```

- **PASS condition:** `status` reaches `done` with `clip_ids` containing at least 1 generated clip ID.
- If `status=error`, inspect `/tmp/pulsecut-backend.log` for `yt-dlp` / `ffmpeg` stderr output.

### 4C. Verify Generated Clip Media Stream with `ffprobe`

Fetch the first generated clip and validate its actual MP4 file:

```bash
CLIP_ID=$(curl -fsS "http://127.0.0.1:${FRONTEND_PORT}/api/jobs/${JOB_ID}" | jq -r '.job.clip_ids[0]')
echo "Verifying CLIP_ID=$CLIP_ID"

curl -fsS "http://127.0.0.1:${FRONTEND_PORT}/api/clips/${CLIP_ID}" | jq '{id, title, template, status, duration_sec, aspect}'
curl -fsS "http://127.0.0.1:${FRONTEND_PORT}/api/clips/${CLIP_ID}/media" -o "/tmp/pulsecut_${CLIP_ID}.mp4"

ffprobe -v error -show_entries format=duration,size:stream=codec_type,codec_name,width,height \
  -of json "/tmp/pulsecut_${CLIP_ID}.mp4" | jq .
```

- **PASS condition:** File size > 0 bytes, valid video stream (`width`, `height`), valid audio stream (if source has audio), and `duration > 1.0`.

---

## 5. Verify Reaction PiP, Facecam Crop & Main Video Frame Re-Render

Test configuring the clip with custom **Facecam Source Crop**, **Facecam Placement**, and **Main Video Frame Aspect** via `POST /api/clips/:id/configure`:

```bash
curl -fsS -X POST "http://127.0.0.1:${FRONTEND_PORT}/api/clips/${CLIP_ID}/configure" \
  -H "Content-Type: application/json" \
  -d '{
    "template": "reaction-pip",
    "aspect": "9:16",
    "layout": "pip",
    "canvas": "solid",
    "facecam_crop": { "x": 68, "y": 60, "width": 28, "height": 35 },
    "facecam_layout": {
      "enabled": true,
      "placement": "bottom",
      "output_x": 50,
      "output_y": 78,
      "output_width": 54,
      "output_aspect": "4:3",
      "split_ratio": 40,
      "rounded": 12
    },
    "main_video_frame": {
      "aspect": "4:3",
      "fit": "cover",
      "offset_y": 36
    },
    "hook": "REACTION HIGHLIGHT",
    "font": "TikTok Sans",
    "subtitle_font": "Montserrat",
    "subtitle_style": "hormozi-classic",
    "in_ms": 0,
    "out_ms": 15000
  }' | jq .
```

### Interactive UI Verification Checklist (Browser at `http://localhost:3000`)

1. Open `http://localhost:3000` in a browser (or Playwright).
2. **Dashboard:** Confirm the completed YouTube job appears in **Recent Jobs** with `Done` status and zero fake/demo entries.
3. **Clips:** Click **Clips** → verify the real YouTube clip card renders with a live `<video>` thumbnail (no stock photos) and working **Approve / Reject / Edit / Copy / Delete** controls.
4. **Editor — Reaction PiP & Facecam Source Picker:**
   - Click **Edit** on the clip to enter the `100dvh` 3-pane Studio Editor.
   - Confirm the real YouTube clip plays when pressing **Space** or clicking **Play**.
   - Select **Reaction PiP** template → confirm the **Streamer Facecam & Reaction PiP** section in the **Framing** tab opens automatically.
   - Drag and resize the green **`CAM`** placeholder box over the streamer's face inside the `16:9` Source Frame Picker and verify the cropped facecam updates live on the `9:16` vertical preview.
   - Switch **Facecam Position in Short** across:
     - `Bottom Overlay (PiP)`
     - `Top Overlay (PiP)`
     - `Split Screen (Cam Bottom)`
     - `Split Screen (Cam Top)`
     - `Free Drag PiP` (drag the facecam directly on the vertical canvas)
   - Switch **Main Video Frame (Inside Mobile)** across `9:16`, `4:3`, `16:9`, and `1:1`, plus `Fill (Crop)` vs `Fit (Full Frame)` and `Vertical Position`.
5. **Templates, Captions & Watermark:**
   - Verify **Kick Viral**, **Insta Reels**, **YT Shorts**, and **Reaction PiP** templates switch cleanly.
   - Drag or edit watermark position, streamer badge position, and caption vertical position / alignment / font.
   - Open **Export 9:16 Video** modal → inspect the generated FFmpeg command (confirm it contains `crop=iw*...` and `overlay=` or `vstack=inputs=2`) → click **Apply & Export**.
6. **Console Check:** Confirm **0** uncaught JavaScript errors or failed network requests in DevTools console.

---

## 6. Live Chat Reader & Automation Checks

### 6A. Rust Chat Crate Unit Tests (YouTube / Twitch / Kick)

```bash
cargo test -p pulsecut-chat -- --nocapture
```

Verifies:
- `YouTubeChat::extract_video_id` accepts full YouTube URLs (`watch?v=`, `/live/`, `/shorts/`, `youtu.be/`) as well as raw 11-char IDs.
- `TwitchChat` uses non-blocking bounded draining (`tokio::time::timeout`, up to 100 msgs/tick) and normalizes channel names.
- `KickChat` tracks monotonic `last_seq` with `?since=` pagination so it never stalls when the bridge hits its 2,000-line ring buffer.

### 6B. Optional Live YouTube / Kick Watch Smoke Test

- **YouTube Live (requires `YOUTUBE_API_KEY` env var and an active live stream URL):**
  ```bash
  YOUTUBE_API_KEY="YOUR_KEY" cargo run --bin pulsecut -- watch \
    --platform youtube --channel "live-test" --link "$YOUTUBE_URL"
  ```
- **Kick Live Chat Bridge:**
  ```bash
  python3 tools/kick-chat-bridge/bridge.py --channel "<kick_channel>" --port 8765 &
  sleep 3
  curl -fsS "http://127.0.0.1:8765/health" | jq .
  curl -fsS "http://127.0.0.1:8765/messages?since=0" | jq '{latest_seq, count: (.messages | length)}'
  ```

---

## 7. Browser Extension API Endpoint Check

Verify the Chrome extension endpoints work against the live backend and forward the requested template:

```bash
curl -fsS "http://127.0.0.1:${FRONTEND_PORT}/api/extension/status" | jq .
```

To trigger a real clip via the extension endpoint:

```bash
curl -fsS -X POST "http://127.0.0.1:${FRONTEND_PORT}/api/extension/clip" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg url "$YOUTUBE_URL" '{url: $url, max_clips: 1, template: "yt-short"}')" | jq .
```

---

## 8. Cleanup

Stop the background backend and frontend processes after verification:

```bash
kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
rm -f "/tmp/pulsecut_${CLIP_ID}.mp4"
```

---

## 9. Verification Report Template (Fill Out After Running)

```markdown
### PulseCut Verification Result
- Target YouTube URL: <url>
- Prerequisites (cargo / ffmpeg / ffprobe / yt-dlp / node): PASS / FAIL
- Unit Tests & Build (tsx / lint / build / cargo test): PASS / FAIL
- Clean Workspace (0 demo clips before ingest): PASS / FAIL
- Real YouTube Clip Creation (JOB_ID + CLIP_ID + ffprobe streams): PASS / FAIL
- Reaction PiP Facecam Crop & Placement (UI + /configure): PASS / FAIL
- Main Video Frame Controls (9:16 / 4:3 / 16:9 / Fit / Fill): PASS / FAIL
- Live Chat Reader & Extension Endpoints: PASS / FAIL
- Browser Console Errors: 0
```
