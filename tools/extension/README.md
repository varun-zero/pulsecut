# PulseCut Live Chat Hype Extension ⚡🔥

A browser extension for Chrome, Brave, and Edge that monitors live chat on **Twitch**, **YouTube Live**, and **Kick** in real-time. When chat goes crazy (high velocity, emote bursts, ALL CAPS / hype keywords), it detects the spike and triggers a **30-second lookback clip** sent directly to your local PulseCut editor.

---

## Features

- **Real-Time Hype Meter HUD**: Floating dark-glass widget on Twitch, YouTube Live, and Kick showing live chat velocity (`msg/s`) and a 0–100% Hype Meter.
- **Smart 30s Lookback Clipping**: Captures the action *before* chat reacted—the clip starts 30–40 seconds before the hype spike so you never miss the punchline or clutch play.
- **Auto-Clip or Prompt Modes**:
  - **Ask Mode (Default)**: Pops up an on-screen prompt: *"🔥 Chat is going crazy! (85% hype). Clip the last 30s? [Clip Now] [Dismiss]"*.
  - **Auto-Clip Mode**: Automatically clips immediately when chat exceeds your threshold.
  - **Manual HUD Mode**: Click "🔥 Clip Last 30s" anytime you want on the floating HUD.
- **Zero Configuration**: Connects automatically to your local PulseCut server running at `http://127.0.0.1:8756`.

---

## How to Install in Chrome / Brave / Edge

1. Ensure the PulseCut local server is running:
   ```bash
   pulsecut editor --addr 127.0.0.1:8756
   ```
2. Open your browser's extension settings:
   - **Chrome**: Navigate to `chrome://extensions/`
   - **Brave**: Navigate to `brave://extensions/`
   - **Edge**: Navigate to `edge://extensions/`
3. Toggle on **Developer mode** (top-right corner).
4. Click **Load unpacked** (top-left).
5. Select the folder:
   ```
   C:\Users\varun\pulsecut\tools\extension
   ```
6. Open any live stream on **Twitch**, **YouTube Live**, or **Kick**. You will see the floating **PulseCut Hype HUD** appear at the bottom right!

---

## Settings & Sensitivity

Click the PulseCut extension icon in your browser toolbar to:
- Adjust **Sensitivity** (Low 50%, Normal 70%, High 85%).
- Change **Lookback Window** (15s, 30s, 45s, 60s).
- Switch between **Ask Confirmation** and **Automatic Instant Clip**.
- Open the PulseCut Editor dashboard (`http://127.0.0.1:8756`).
