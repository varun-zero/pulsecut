# PulseCut Auto-Clipper (Chrome / Brave / Edge Extension)

Monitors live chat velocity & reaction spikes on **Kick**, **Twitch**, and **YouTube Live** (including YouTube's `/live_chat` iframe) and supports one-click viral capture on **YouTube Shorts** and **Instagram Reels**.

## What Was Fixed & Upgraded in v1.1.0
- **Zero Mixed-Content / CORS Failures**: All requests to `http://127.0.0.1:8756` (or your custom `serverUrl`) are proxied through the MV3 background service worker (`background.js`), so HTTPS stream tabs never block localhost fetches.
- **YouTube Live Chat Iframe Relay**: Observes `youtube.com/live_chat` inside its iframe without duplicating the HUD, relaying chat bursts to the top-frame HUD via `chrome.tabs.sendMessage(..., { frameId: 0 })`.
- **SPA Navigation & Real Streamer Handle Detection**: Automatically updates channel username & viral template (`kick-stream`, `yt-short`, `insta-short`, `split-stream`) when switching streams without a page reload.
- **Live Settings Sync**: Changing lookback window, mode, threshold, or server URL in the popup immediately updates open stream tabs and the "Open PulseCut Editor" link.
- **Responsive Manual Clipping**: Manual HUD clicks, popup **"Clip Active Tab Now"**, and the `Alt+Shift+C` keyboard shortcut use a 2s debounce and are never blocked by the 45s auto-clip cooldown.

## Install Unpacked
1. Start the PulseCut local server (default `http://127.0.0.1:8756`).
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select this `tools/extension` directory.
4. Open any Kick, Twitch, YouTube Live, YouTube Shorts, or Instagram Reels tab — the PulseCut HUD will appear in the bottom-right corner with a green status dot when connected.
