# Kick chat bridge

Kick does not expose a stable public chat API; live chat travels over Pusher
WebSockets with an app key that can rotate. Keeping that detail in one small
Python process means the Rust core stays free of a WebSocket dependency and
continues to work when the key changes.

```powershell
pip install -r requirements.txt
python bridge.py <kick_channel_slug> --port 8765
```

Then point PulseCut at it:

```powershell
$env:PULSECUT_KICK_CHAT_RELAY = "http://127.0.0.1:8765/chat"
pulsecut watch --platform kick --channel <slug> --link https://kick.com/<slug>
```

The bridge:

1. Resolves `chatroomId` from `https://api.kick.com/public/v1/channels?slug=…`.
2. Discovers the Pusher key from the public channel page (or `KICK_PUSHER_KEY`).
3. Subscribes to `chatrooms.<chatroomId>` and handles `pusher:ping`.
4. Exposes the last 2000 normalized messages as NDJSON at `/chat`.

If discovery fails, open the channel in a browser, find the Pusher key in the
page source, and set `KICK_PUSHER_KEY`.
