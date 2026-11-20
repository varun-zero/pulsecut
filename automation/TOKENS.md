# Where to get each token (verified sources)

Publishing and AI need credentials. **Set them as environment variables, not in chat.**
They are read from the process environment (never stored in the repo).

## Recommended: one token → 9 platforms (WoopSocial)

- **Get the API key:** https://app.woopsocial.com/api-access (sign in → API Access → create key)
- Docs: https://docs.woopsocial.com/api-reference/overview.md — Bearer `Authorization` header.
- Set:
  ```powershell
  $env:PULSECUT_WOOPSOCIAL_TOKEN = "<your-api-key>"
  $env:PULSECUT_PUBLISHER = "woopsocial"
  ```
- **Also connect your social accounts once** in the WoopSocial dashboard (OAuth):
  https://app.woopsocial.com → connect Instagram, YouTube, TikTok, etc. The publisher
  discovers connected accounts at runtime via `GET /social-accounts` and skips any
  platform that isn't connected. Optional: `$env:PULSECUT_WOOPSOCIAL_PROJECT = "<projectId>"`.
- The publisher code now implements the verified v1 flow: `GET /projects` →
  `POST /media?projectId` → `GET /social-accounts` → `POST /posts` (PUBLISH_NOW).

## Direct platform tokens (only if you skip the aggregator)

- **YouTube (Shorts):** Google Cloud Console → enable YouTube Data API v3 →
  OAuth consent screen → OAuth client ID → get an access token via OAuth Playground
  (scope `https://www.googleapis.com/auth/youtube.upload`). Short-lived; aggregator is easier.
  Set `PULSECUT_YOUTUBE_TOKEN` + `PULSECUT_PUBLISHER=direct`.
- **Instagram Reels:** Meta for Developers → app with **Instagram Graph API** →
  get a long-lived Page access token + your IG user ID. Requires Meta app review
  for public posting. Set `PULSECUT_IG_TOKEN` + `PULSECUT_IG_USER_ID` +
  `PULSECUT_PUBLISHER=instagram_direct`.
- **TikTok:** TikTok for Developers → app review → access token.
  Set `PULSECUT_TIKTOK_TOKEN` + `PULSECUT_PUBLISHER=tiktok_direct`.
- **Upload-Post (alt aggregator):** https://upload-post.com → API key →
  `PULSECUT_UPLOADPOST_TOKEN` + `PULSECUT_PUBLISHER=uploadpost`.
- **Postiz (self-hosted):** your Postiz instance API key →
  `PULSECUT_POSTIZ_TOKEN` + `PULSECUT_PUBLISHER=postiz`.

## AI / transcription / clip discovery

- **AI metadata + viral-moment scoring:**
  - Local: install Ollama (https://ollama.com), `ollama serve`, then `ollama pull gemma3:4b`.
    No key needed; backend is already set to `ollama` in `pulsecut.json`.
  - Cloud fallback: OpenRouter key from https://openrouter.ai/keys →
    `OPENROUTER_API_KEY`. The code fails over to OpenRouter when local is unavailable.
- **Cloud transcription (Whisper):** free tier available —
  Groq key from https://console.groq.com/keys (`GROQ_API_KEY`) or OpenAI
  (`OPENAI_API_KEY`). Optional now that local faster-whisper is set up.
- **Local transcription:** `faster-whisper` (installed via pip) with a small/base/en
  model — free, runs on CPU, no key. Wrapper in `automation/whisper_cli.py`.

## Security
Never paste tokens into chat or commit them. Export in the shell that starts the
backend, or use a `.env` loaded by your process manager. Rotate keys that leak.
