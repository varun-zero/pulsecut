# PulseCut — Publishing / API Layer

Research date: **2026-11-18**. Scope: automated publishing of ready-made vertical shorts to YouTube Shorts, Instagram Reels, TikTok, X, Facebook, LinkedIn, Threads, Pinterest, Bluesky, plus the local-vs-cloud AI backends that feed it.

## Research method & confidence legend

`websearch` was unavailable (HTTP 402), so research was done with `webfetch` via the `r.jina.ai` text proxy against official docs. Items are marked:

- **[V]** Verified against official docs during this research (links in each section / Sources).
- **[K]** From prior knowledge; plausible but **not re-verified** — confirm before coding.
- **[U]** Uncertain / volatile (limits, pricing, exact paths change often) — confirm in the provider console/docs.

Important 2026 change: **YouTube's quota model is no longer the old "10,000 units/day, 1,600 per upload" model** ([V], docs updated 2026-11-12). See the YouTube section — this affects the task brief's assumption.

---

## 1. Platform-by-platform reference

### 1.0 At-a-glance matrix

| Platform | Official API | Auth | Short publish path (main endpoints) | Key friction | Aggregator easier? |
|---|---|---|---|---|---|
| YouTube Shorts | YouTube Data API v3 (`videos.insert`) | OAuth 2.0 user consent, `youtube.upload` | `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status,contentDetails` → `PUT` session URL | New quota buckets (100 uploads/day default, 1 unit each); app review for quota extension; captions cost 400 units | No — direct is fine and stable |
| Instagram Reels | Instagram Platform / Graph API (Instagram API with Instagram Login or Facebook Login) | OAuth 2.0 + Advanced Access for `instagram_content_publish` | `POST /{IG_ID}/media` (`media_type=REELS`) → `POST /{IG_ID}/media_publish` | Professional account, public, Page PPA, 100 posts/24h, media must be publicly fetchable; app review weeks | **Yes** if you don't want Meta app review |
| TikTok | Content Posting API (Direct Post) | OAuth 2.0, `video.publish` scope | `POST /v2/post/publish/video/init/` → `PUT upload_url` → `POST /v2/post/publish/status/fetch/` | **Unaudited clients = SELF_ONLY (private) posts only**; scope approval + app audit; chunked upload | **Yes, strongly** until audited |
| X | X API v2 Media Upload + Create Post | OAuth 2.0 / OAuth 1.0a user context | `POST /2/media/upload/initialize` → `/append` → `/finalize` → `POST /2/tweets` | Paid tiers for write access; duration/size caps by entitlement; 5 MB chunk limit | Sometimes (bundle with others) |
| Facebook | Meta Graph API — Pages API + Video API | Page access token, `pages_manage_posts`, `publish_video` | `POST /{page-id}/videos` (`file_url` or resumable) → `POST /{page-id}/video_reels` [K] | Page required (not profile), `publish_video` review, public media URL, async processing | Yes |
| LinkedIn | UGC Posts API / `/rest/posts` [K] | OAuth 2.0 `w_member_social` / `w_organization_social` | `POST /v2/assets?action=registerUpload` → `POST uploadUrl` → `POST /v2/ugcPosts` or `/rest/posts` [K] | Scope verification, `LinkedIn-Version` header, async processing, limits [U] | Yes |
| Threads | Threads API (`graph.threads.net`) [K] | OAuth 2.0 `threads_basic` + `threads_content_publish` | `POST /v1.0/{IG_USER_ID}/threads` → `POST /v1.0/{IG_USER_ID}/threads_publish` [K] | App review, publicly hosted video URL, ~100 posts/24h [U], no native scheduling | Yes |
| Pinterest | Pinterest REST API v5 | OAuth 2.0 `pins:write` (app review) | `POST /v5/media` → poll → `POST /v5/pins` (`media_source.video_id`) [K] | Business account, app review for write, per-user/app rate limits [U] | Yes |
| Bluesky | AT Protocol XRPC — `app.bsky.video.*` + `com.atproto.repo.createRecord` | App password or OAuth; `com.atproto.server.createSession` | `app.bsky.video.uploadVideo` (video.bsky.app) → `getJobStatus` → `com.atproto.repo.createRecord` with `app.bsky.embed.video` [K] | No app review, but Lexicon/blueprint churn; video limits [U]; you run your own scheduler | Marginal — direct is easy |

### 1.1 YouTube Shorts

- **API:** YouTube Data API v3 ([V]). There is **no separate Shorts API** — a Short is a normal video upload (≤3 min, vertical/square, commonly tagged `#Shorts`).
- **Auth:** OAuth 2.0 installed-app / web flow; scope `https://www.googleapis.com/auth/youtube.upload` (plus `https://www.googleapis.com/auth/youtube` if you also manage videos). Google Cloud project with the API enabled; OAuth consent screen + test users during development.
- **Publish endpoints [V]:**
  - Resumable init: `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status,contentDetails` with JSON metadata and header `X-Upload-Content-Type: video/mp4` / `X-Upload-Content-Length`. Response `Location` header = session URL.
  - Upload: `PUT <Location>` with the byte range (`Content-Range: bytes 0-N/total`). `308 Resume Incomplete` → continue; `201` → created.
  - Simpler non-resumable alternative: `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=...` (fine for ~50 MB shorts, but prefer resumable).
  - Thumbnail: `POST https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=...` (50 units).
  - Captions: `POST https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&sync=true` (400 units — budget carefully; burned-in ASS captions are cheaper).
- **Quota — IMPORTANT 2026 update [V]:** Official docs (updated 2026-11-12) state a default allocation of **100 `search.list` calls/day, 100 `videos.insert` calls/day, and 10,000 units/day combined for all other endpoints**. Each `videos.insert` and `search.list` call costs **1 quota** in its own dedicated bucket. Daily quotas reset at **midnight Pacific Time**. The widely-cited *"1,600 units per upload / 10,000 units ≈ 6 uploads per day"* rule is the **legacy pre-change model** — treat it as **[U]** and verify in your own Cloud Console → Quotas before committing. Other relevant costs ([V]): `captions.insert` 400, `captions.update` 450, `videos.update` 50, `videos.delete` 50, `thumbnails.set` 50, `liveChatMessages.list` 5 (relevant to the capture side). Quota extension: https://support.google.com/youtube/contact/yt_api_form.
- **Account requirements:** A normal Google/YouTube channel; no subscriber minimum for uploads (the old 2,000-subscriber live-streaming restriction was removed in 2024 [K]). Made-for-kids, category, language and privacy status must be set in `snippet`/`status`.
- **Friction:** OAuth consent screen verification if you request sensitive scopes for third parties; quota extension review; YouTube applies its own processing/Shorts classification after ingest; rate limiting on reads.
- **Aggregator easier?** No. Direct is well documented and now has a dedicated 100/day upload bucket.

### 1.2 Instagram Reels

- **API:** Instagram Platform (Graph API). 2026 docs describe three login variants: *Instagram API with Unified Login* (`graph.facebook.com`, Business Integration System User token), *Instagram API with Instagram Login* (`graph.instagram.com`, Instagram User token), and *Instagram API with Facebook Login* (`graph.facebook.com`, Page token) ([V]).
- **Auth:** OAuth; permissions `instagram_basic` + `instagram_content_publish` (Facebook Login) or `instagram_business_basic` + `instagram_business_content_publish` (Instagram Login). **Advanced Access** required to publish in production — app review can take weeks.
- **Publish flow [V]:**
  1. `POST https://graph.facebook.com/v27.0/{IG_ID}/media` with `media_type=REELS`, `video_url=<publicly reachable MP4>`, `caption`, optional `is_ai_generated=true`, `share_to_feed`, `trial_params`. Returns `{ "id": "<IG_CONTAINER_ID>" }`.
     - Large files: create container with `upload_type=resumable`, then `POST https://rupload.facebook.com/ig-api-upload/{VERSION}/{IG_MEDIA_CONTAINER_ID}` with headers `Authorization: OAuth <token>`, `offset: 0`, `file_size: <bytes>` and binary body (or `file_url` header).
  2. Poll `GET /{IG_CONTAINER_ID}?fields=status_code` — states `IN_PROGRESS → FINISHED / EXPIRED / ERROR`; docs recommend once per minute, max 5 minutes.
  3. `POST https://graph.facebook.com/v27.0/{IG_ID}/media_publish` with `creation_id=<container id>` → `{ "id": "<IG_MEDIA_ID>" }`.
  4. Check `GET /{IG_ID}/content_publishing_limit` for remaining quota.
- **Account requirements [V]:** Instagram **professional account** (Business or Creator), connected to a Facebook Page, and historically **public**. If the connected Page requires **Page Publishing Authorization (PPA)**, publishing is blocked until the user completes it — advise users to complete PPA preemptively; there is no API to detect it.
- **Friction [V]:** Meta cURLs the `video_url` at publish time → needs a public, stable, short-lived signed URL (PulseCut must host or generate one). **100 API-published posts per 24h moving window** per account (carousels 50/24h), enforced on `media_publish`, and it is *your* duty to enforce it when scheduling. Containers expire after 24h. `is_ai_generated=true` is available — set it for AI-generated clips. App review + PPA + token expiry (long-lived user tokens ~60 days [K]).
- **Aggregator easier?** **Yes** — this is the single biggest review/account headache. Use Tier 1/2 for Instagram first, then add direct once approved.

### 1.3 TikTok

- **API:** TikTok Content Posting API — **Direct Post** ([V]).
- **Auth:** OAuth 2.0; app must enable the Content Posting API product **and** Direct Post configuration; scope `video.publish` must be approved for the app **and** authorized by the user. Also typically `user.info.basic`, `video.list` [K].
- **Publish endpoints [V]:**
  - `POST https://open.tiktokapis.com/v2/post/publish/creator_info/query/` → returns `privacy_level_options`, `max_video_post_duration_sec`, comment/duet/stitch flags. Call first to fill your UI.
  - `POST https://open.tiktokapis.com/v2/post/publish/video/init/` with `post_info` (`title`, `privacy_level`, `disable_duet/comment/stitch`, `video_cover_timestamp_ms`) and `source_info`:
    - `source=FILE_UPLOAD` with `video_size`, `chunk_size`, `total_chunk_count` → response has `publish_id` + `upload_url` (e.g. `open-upload.tiktokapis.com`).
    - `source=PULL_FROM_URL` with `video_url` from a **verified domain/URL prefix** → returns `publish_id` only.
  - Chunked upload: `PUT <upload_url>` per chunk with `Content-Range: bytes 0-30567099/30567100` and `Content-Type: video/mp4`.
  - Status: `POST https://open.tiktokapis.com/v2/post/publish/status/fetch/` with `publish_id`.
  - Photos: `POST /v2/post/publish/content/init/` with `post_mode=DIRECT_POST`, `media_type=PHOTO`, `photo_images[]` (verified URLs only).
- **Account requirements:** A TikTok user who authorizes the app; for brand accounts, Business/Creator not strictly required by the API but privacy/privacy-level options depend on the account [U].
- **Friction [V]:** **All content from unaudited clients is restricted to `SELF_ONLY` (private) viewing.** To lift this the API client must pass TikTok's **app audit** (Terms-of-Service compliance). That plus scope approval is the main gating item. Video must be MP4 + H.264; max duration comes from `creator_info`; AI-generated content should carry TikTok's AI-generated label (WoopSocial advertises automatic AI disclosure on TikTok [V] — confirm current requirement in TikTok's developer terms) [U].
- **Aggregator easier?** **Yes, strongly**, at least until your own app passes audit. This is the platform where a third party with an already-approved app saves the most time.

### 1.4 X (Twitter)

- **API:** X API v2 — Media Upload + Create Post ([V]).
- **Auth:** OAuth 2.0 user context (or OAuth 1.0a) with write permission; API tier must include media write/pricing ([U] — X pricing changes often).
- **Publish flow (v2 chunked, [V]):**
  1. `POST https://api.x.com/2/media/upload/initialize` — JSON body `{"media_type":"video/mp4","total_bytes":1048576,"media_category":"tweet_video"}` → `data.id` (media_id), `expires_after_secs: 86400`.
  2. `POST https://api.x.com/2/media/upload/{id}/append` — multipart `segment_index` + `media`; chunks ≤5 MB recommended (server max 8 MB), indexed from 0.
  3. `POST https://api.x.com/2/media/upload/{id}/finalize` → may return `processing_info`.
  4. `GET https://api.x.com/2/media/upload?command=STATUS&media_id={id}` — poll `pending → in_progress → succeeded|failed` honoring `check_after_secs`.
  5. `POST https://api.x.com/2/tweets` with `{"text":"...","media":{"media_ids":["..."]}}`.
  - **Do not** use the legacy `command=INIT/APPEND/FINALIZE` on `POST /2/media/upload` — only `command=STATUS` on the GET is still current [V].
- **Limits [V]:** `tweet_video` 20 min / 8 GB default; Premium/verified 125 min / 16 GB. Subtitle files: `media_category=subtitles`, 1 MB (useful for VTT captions). Attaching an over-length media_id yields `403 Forbidden`.
- **Friction:** paid access tier; transient 429s; per-user post limits [U]. Direct is straightforward.
- **Aggregator easier?** Only if you want it in the same batch as the rest; not needed on its own.

### 1.5 Facebook (Page video / Reels)

- **API:** Meta Graph API — Pages API + Video API ([V] for feed/photos; Reels specifics [K]).
- **Auth:** Page access token; permissions `pages_manage_posts`, `pages_read_engagement`, `pages_read_user_engagement`, and **`publish_video`** for video ([V]). App user must have `CREATE_CONTENT`, `MANAGE`, `MODERATE` tasks on the Page. App review for `publish_video`.
- **Publish endpoints:**
  - Text/link post: `POST https://graph.facebook.com/v27.0/{page_id}/feed` with `message`, `link`, optionally `published=false` + `scheduled_publish_time` (10 min–30 days ahead) ([V]).
  - Video: `POST /{page_id}/videos` with `file_url` (public) or resumable upload via `POST /{page_id}/video_uploads` then `rupload.facebook.com` offset uploads ([V] guide exists; exact offset flow [U]).
  - Reels: `POST /{page_id}/video_reels` with `video_id`, `video_state=PUBLISHED`, `description` [K] — verify against the Video API "Publishing" guide before implementing.
- **Friction:** Page required (personal profiles can't be automated); `publish_video` review; public media URL; async processing; Instagram and Facebook can share an app/token but not account types.
- **Aggregator easier?** Yes, if Meta app review is a bottleneck.

### 1.6 LinkedIn

- **API:** Community Management APIs — UGC Posts API and/or the newer `/rest/posts` ([K] — Microsoft Learn pages 404'd under the URLs tried, so verify).
- **Auth:** OAuth 2.0; `w_member_social` for personal posts, `w_organization_social` + admin rights for Company Pages, `r_liteprofile`/`openid` for identity. Scopes may require LinkedIn's verification process ([K]/[U]).
- **Publish flow [K]:**
  1. `POST https://api.linkedin.com/v2/assets?action=registerUpload` with `registerUploadRequest` (`owner: urn:li:person:<id>`, `recipes: ["urn:li:digitalmediaRecipe:feedshare-video"]`, `serviceRelationships`) → returns `uploadUrl` + asset URN.
  2. `POST <uploadUrl>` with `Content-Type: application/octet-stream` and the MP4 bytes (often chunked via `X-LinkedIn-Chunk-*`/`X-LinkedIn-Total-Chunks` headers [U]).
  3. `POST https://api.linkedin.com/v2/ugcPosts` (or `POST https://api.linkedin.com/rest/posts` with `LinkedIn-Version` and `X-RestLi-Protocol-Version: 2.0.0` headers) referencing the asset URN in `specificContent["com.linkedin.ugc.ShareContent"]`.
- **Friction:** scope verification, required version headers on `/rest/*`, media processing delay, undocumented-feeling quota (~150 posts/day per author historically [U]).
- **Aggregator easier?** Yes for initial launch.

### 1.7 Threads

- **API:** Threads API (Meta), host `https://graph.threads.net` [K] — Meta's docs page was login-walled during research.
- **Auth:** OAuth 2.0 with `threads_basic` + `threads_content_publish` (plus `threads_manage_insights` for analytics); short-lived token exchanged for a long-lived token (~60 days) [K]. App review required for publishing.
- **Publish flow [K]:**
  1. `POST https://graph.threads.net/v1.0/{THREADS_USER_ID}/threads` with `media_type=TEXT|IMAGE|VIDEO`, `text`, and `video_url` (public) or `image_url`.
  2. `POST https://graph.threads.net/v1.0/{THREADS_USER_ID}/threads_publish` with `creation_id` → returns media id.
  3. Status via `GET /{ media_id }?fields=status` [U].
- **Friction:** app review; public media URL; per-user publishing cap (~100 posts/24h [U]); no native scheduling (your queue handles it); replies/threads require extra calls.
- **Aggregator easier?** Yes if you don't already have a Meta app approved.

### 1.8 Pinterest

- **API:** Pinterest REST API v5 (current reference shows 5.31.0) ([V]).
- **Auth:** OAuth 2.0; `pins:write` (and `boards:read`) — write permissions require app review. Business account recommended/required for API access [K].
- **Publish flow [K]:**
  1. `POST https://api.pinterest.com/v5/media` — multipart upload (`media_type=video`, file, board or `media_id`) → `media_id` + status.
  2. Poll `GET /v5/media/{media_id}` until `status: "succeeded"`.
  3. `POST https://api.pinterest.com/v5/pins` with `board_id`, `title`, `description`, `link`, and `media_source: {"source_type": "video_id", "video_id": "<media_id>"}`.
- **Friction:** app review, business account, rate limits ([U] — historically ~1,000 calls/day/app and per-user write caps), vertical video/Idea Pin formatting differences.
- **Aggregator easier?** Yes, unless Pinterest is a priority.

### 1.9 Bluesky

- **API:** AT Protocol XRPC. Video lexicons `app.bsky.video.*`, publishing via `com.atproto.repo.createRecord` with an `app.bsky.feed.post` record embedding `app.bsky.embed.video` ([K] — docs site redirected to a JS-only reference).
- **Auth:** App password (recommended for automation) or OAuth; `POST https://bsky.social/xrpc/com.atproto.server.createSession` with `identifier` + `password` → `accessJwt`, `refreshJwt`, `did`. Authenticated calls go to the **user's PDS**, not the public AppView (`public.api.bsky.app` is for unauthenticated reads) ([V]).
- **Publish flow [K]:**
  1. `POST https://video.bsky.app/xrpc/app.bsky.video.uploadVideo?did=<did>&name=clip.mp4` with raw MP4 body and `Content-Type: video/mp4` → `{ "jobId": "...", "state": "JOB_STATE_STARTING" }` (or a blob directly).
  2. Poll `GET https://video.bsky.app/xrpc/app.bsky.video.getJobStatus?jobId=<jobId>` until `JOB_STATE_COMPLETED`; take `job.blob` (a blob ref).
  3. `POST https://<pds>/xrpc/com.atproto.repo.createRecord` with `collection: "app.bsky.feed.post"`, `repo: <did>`, `record: { "$type": "app.bsky.feed.post", text, createdAt, embed: { "$type": "app.bsky.embed.video", video: <blob>, captions: [...] } }`.
  - Optional: `app.bsky.video.getUploadLimits` before upload; `app.bsky.video.getJobStatus` for progress [U].
- **Friction:** no app review (good), but Lexicon details/limits churn [U]; captions embed format must match current lexicon; you implement scheduling/rate-limits yourself. Capabilities can be discovered via `app.bsky.actor.getPreferences` / server descriptors [V for general routing].
- **Aggregator easier?** Marginal — direct is simple enough, and the Rust `atrium` crate can handle XRPC types [K].

---

## 2. Recommended 3-tier publishing strategy

The tiers are **adapters behind the same `Publisher` trait** (§3), selected per account — not an either/or architecture. Ship Tier 1 first, then Tier 2, then Tier 3 platform-by-platform.

### Tier 1 — Aggregator services (fastest multi-platform) — **default for v1**

| Service | Facts | Fit |
|---|---|---|
| **WoopSocial** | One REST endpoint + MCP on **every plan incl. free**; covers Facebook, Instagram, Threads, LinkedIn, Bluesky, X, Pinterest, TikTok, YouTube ([V]); handles OAuth, tokens, token refresh, platform changes; native scheduling (no polling layer of your own); built-in FFmpeg per-platform transcoding; raw-byte upload with server-side MIME detection; automatic per-platform field mapping; automatic TikTok AI disclosure claimed by a user review ([V]). Free plan: 2 accounts, unlimited posts, full API & MCP. Docs: https://docs.woopsocial.com/api-reference/overview. Exact create-post path/auth header: **[U]** — read docs. | Best "single endpoint" abstraction; its FFmpeg step can replace PulseCut's per-platform re-export for speed. |
| **Upload-Post** | 22 platforms; `POST https://api.upload-post.com/api/upload` with `Authorization: Apikey <key>` and multipart `video`, `title`, `user`, `platform[]=tiktok`, `platform[]=instagram`, … ([V]). Free 10 uploads/mo, Basic $16/mo unlimited uploads (prices [V] as of research, may change). Official APIs + OAuth, no rotating IPs/scraping ([V]). MCP at `mcp.upload-post.com` (open-source server), official n8n node. Docs: https://docs.upload-post.com/. | Cheapest path to 22 networks incl. Reddit, Telegram, Mastodon; multipart API is trivial in `reqwest`. |

**Trade-off:** you trust a third party with platform tokens and content, you inherit their outage/pricing risk, and per-platform metadata control is coarser. Use Tier 1 for the "publish everywhere" default, and keep an escape hatch to Tier 3 per target.

### Tier 2 — Self-hosted aggregators (control) — **recommended for privacy-sensitive / high-volume deployments**

- **Postiz** — AGPL-3.0 ([V]); self-hosted (Next.js + NestJS + Prisma/PostgreSQL + Temporal). Supports Instagram, YouTube, LinkedIn, Reddit, TikTok, Facebook, Pinterest, Threads, X, Slack, Discord, Mastodon, Bluesky ([V]). Public API, webhooks, MCP, n8n/Make/Zapier integrations. **Critical:** self-hosted edition means **you create and get approval for your own developer apps on each platform** (Meta/YouTube/TikTok can take weeks) — Postiz Cloud uses pre-approved apps ([V]). Docs: https://docs.postiz.com. **License discipline (per `TODO.md`):** AGPL-3.0 may be *referenced/learned from*; if any Postiz code is copied/adapted into PulseCut, the derivative must stay AGPL-3.0. Prefer calling its public API over copying code.
- **Mixpost (Lite)** — **MIT** license ([V]), PHP/Laravel, self-hosted; scheduling, analytics, team workspaces, media library, post versions ([V]). Pro/Enterprise is commercial and Lite intentionally differs from Pro. Docs: https://docs.mixpost.app/lite/. Good if you want permissive-licensed control without AGPL obligations, but cross-post feature parity with Postiz is not guaranteed [U].

**Trade-off:** you own OAuth app approval, hosting, Postgres, token storage, and upgrades — but data and credentials stay on your infrastructure and per-platform logic is maintained upstream.

### Tier 3 — Direct official APIs (maximum control)

Implement per §1 for each platform. Recommended rollout order by effort/value:

1. **YouTube** (stable, dedicated 100/day upload bucket) and **X** (clean v2 upload flow).
2. **Bluesky** and **Pinterest** (no/low review friction).
3. **TikTok** — only after app + `video.publish` audit; until then force `SELF_ONLY` or route to Tier 1/2.
4. **Instagram / Facebook / Threads** — after Meta Advanced Access + PPA.
5. **LinkedIn** — after scope verification.

**Decision rule per account:** `config.publishing.backends[target] ∈ {AggregatorWoopSocial, AggregatorUploadPost, Postiz, Mixpost, Direct}` with a `fallback_backend` list, so a quota exhaustion or 429 on direct can fail over to the aggregator for the same render (careful: duplicated posts — use idempotency keys and only fail over if the first attempt definitively failed pre-publish).

---

## 3. Rust implementation plan

### 3.1 Crate boundaries

Keep this inside `pulsecut-publish` (per `TODO.md`), depending on `pulsecut-core` (config, errors, event types):

```
pulsecut-publish/
  src/
    lib.rs            // re-exports, PublisherRegistry
    target.rs         // Target enum, Capabilities
    publisher.rs      // Publisher trait, PublishJob, PublishReceipt, PublishError
    backend/
      mod.rs          // Backend enum + factory
      woop.rs, upload_post.rs, postiz.rs, mixpost.rs
      youtube.rs, instagram.rs, tiktok.rs, x.rs, facebook.rs,
      linkedin.rs, threads.rs, pinterest.rs, bluesky.rs
    upload.rs         // ResumableSession trait + per-platform state machines
    retry.rs          // classify/retry policy, backoff+jitter
    queue.rs          // SQLite-backed scheduling queue + worker
    approval.rs       // human approval gate
    auth.rs           // OAuth token provider, refresh, single-flight
    media_host.rs     // short-lived public URL provider for IG/Threads/FB/Pinterest
    config.rs         // settings + env + keyring
```

### 3.2 Core types (sketch)

```rust
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, time::Duration};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Target {
    YouTubeShorts, InstagramReels, TikTok, X, FacebookReel,
    LinkedInVideo, Threads, PinterestPin, Bluesky,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Capabilities {
    pub video: bool,
    pub captions: bool,          // burned-in or sidecar
    pub subtitles_sidecar: bool,
    pub scheduling: bool,        // native vs our queue
    pub max_duration_secs: Option<u32>,
    pub requires_public_media_url: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PublishJob {
    pub id: uuid::Uuid,
    pub account_id: String,       // per-account isolation key
    pub target: Target,
    pub video_path: PathBuf,
    pub caption: String,          // includes hashtags
    pub title: Option<String>,
    pub srt_path: Option<PathBuf>,
    pub thumb_path: Option<PathBuf>,
    pub privacy: Privacy,         // Public | Friends | Private
    pub not_before: Option<DateTime<Utc>>,
    pub idempotency_key: String,  // stable per render+target
    pub ai_generated: bool,       // -> IG is_ai_generated, TikTok AI label
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PublishReceipt {
    pub platform_post_id: String,
    pub url: Option<String>,
    pub published_at: DateTime<Utc>,
    pub raw: serde_json::Value,   // scrubbed of secrets
}

#[derive(Debug, thiserror::Error)]
pub enum PublishError {
    #[error("validation failed: {0}")] Validation(String),
    #[error("auth/scope error: {0}")] Auth(String),
    #[error("rate limited; retry after {0:?}")] RateLimited(Duration),
    #[error("quota exhausted: {0}")] QuotaExhausted(String),
    #[error("transient upstream error: {0}")] Transient(String),
    #[error("permanent upstream error: {0}")] Permanent(String),
    #[error("needs human approval")] NeedsApproval,
    #[error("storage error: {0}")] Storage(#[from] sqlx::Error),
}

#[async_trait]
pub trait Publisher: Send + Sync {
    fn target(&self) -> Target;
    fn capabilities(&self) -> Capabilities;
    async fn validate(&self, job: &PublishJob) -> Result<(), PublishError>;
    /// Must be idempotent w.r.t. `job.idempotency_key` where the platform supports it.
    async fn publish(&self, job: &PublishJob) -> Result<PublishReceipt, PublishError>;
}
```

`PublisherRegistry` maps `(Backend, Target, account_id) -> Arc<dyn Publisher>` and is built once at startup from config. The queue worker only ever sees `Arc<dyn Publisher>` — platform code never leaks into orchestration.

### 3.3 Retry and idempotency (`retry.rs`)

- Central `retry_with_policy(op, policy)` used by every publisher. Classify from HTTP status + platform error body:
  - **Retry:** 408, 425, 429, 500/502/503/504, TikTok ` throttled`, Meta `(-1)` transient, X 429. Honor `Retry-After` / `check_after_secs` when present.
  - **Never retry blindly:** 400/401/403/404/422 (except after token refresh for 401), YouTube quota `quotaExceeded`, Meta PPA errors — surface as `Auth`/`Permanent`/`QuotaExhausted`.
  - Exponential backoff with full jitter, cap ~5 min, max 6 attempts; persist attempt count in the queue row so restarts don't reset backoff.
- **Idempotency:** store `(idempotency_key, platform_post_id)` in SQLite *before* considering a retry "failed". For platforms with no idempotency support, a retry after a successful-but-lost response can duplicate a post — mitigate by querying platform status (`GET /{IG_CONTAINER_ID}?fields=status_code`, TikTok `status/fetch`, X `STATUS`) before re-uploading, and by making failover to another backend require a definitive pre-publish failure.
- Use `tower::retry` + `backoff` crates, or a small hand-rolled loop; keep one policy so behaviour is testable with `wiremock`.

### 3.4 Resumable uploads (`upload.rs`)

Unified state machine, persisted after every transition:

```rust
#[async_trait]
pub trait ResumableSession: Send + Sync {
    async fn init(&mut self, job: &PublishJob) -> Result<UploadState, PublishError>;
    async fn send_chunk(&mut self, state: &mut UploadState, range: Range<u64>) -> Result<(), PublishError>;
    async fn status(&self, state: &UploadState) -> Result<UploadStatus, PublishError>;
    async fn finalize(&mut self, state: &UploadState) -> Result<PublishReceipt, PublishError>;
}
```

Per-platform mapping:

| Platform | init | chunks | finish |
|---|---|---|---|
| YouTube | `POST .../videos?uploadType=resumable` → `Location` | `PUT` with `Content-Range`; on `308` read `Range` header and resume | `201` + `id`; optional `thumbnails.set` / `captions.insert` |
| TikTok | `/v2/post/publish/video/init/` (`FILE_UPLOAD`) | `PUT upload_url` with `Content-Range` | `/status/fetch/` poll |
| X | `/2/media/upload/initialize` | `/append` (`segment_index`, ≤5 MB) | `/finalize` + `STATUS` + `/2/tweets` |
| Instagram | `/{IG_ID}/media` + `upload_type=resumable` | `POST rupload.facebook.com/ig-api-upload/...` with `offset`/`file_size` | `/media_publish` |
| Facebook | `/{page_id}/video_uploads` [U] | `rupload.facebook.com` offset writes | `/{page_id}/videos` or `/video_reels` |
| LinkedIn | `/v2/assets?action=registerUpload` | `POST uploadUrl` (chunk headers [U]) | `/v2/ugcPosts` / `/rest/posts` |
| Bluesky | `app.bsky.video.uploadVideo` (single PUT) | n/a | `getJobStatus` → `createRecord` |
| WoopSocial/Upload-Post/Postiz/Mixpost | single multipart POST with the whole file | n/a (their problem) | response id |

Persist `UploadState { job_id, session_url, next_offset, upload_id/media_id, expires_at, status }` in SQLite (`upload_sessions` table). On startup, resume any session whose `expires_at` is still valid; otherwise restart from init. Stream file chunks with `tokio::io::AsyncReadExt` into `reqwest::Body::wrap_stream` / `multipart` to avoid loading whole shorts into RAM.

### 3.5 Scheduling queue (`queue.rs`)

SQLite schema (via `sqlx`, migrations checked in):

```sql
CREATE TABLE publish_jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  target TEXT NOT NULL,
  backend TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL,              -- pending|approved|uploading|processing|published|failed|canceled
  not_before TIMESTAMP,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP,
  idempotency_key TEXT NOT NULL,
  platform_post_id TEXT,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE (account_id, idempotency_key, target)
);
CREATE INDEX idx_jobs_due ON publish_jobs(state, not_before, next_attempt_at);
CREATE TABLE upload_sessions (...);
CREATE TABLE approvals (job_id TEXT PRIMARY KEY, approved_by TEXT, approved_at TIMESTAMP, auto_approved INTEGER);
CREATE TABLE rate_budget (account_id TEXT, target TEXT, window_start TIMESTAMP, used INTEGER, PRIMARY KEY(account_id,target,window_start));
```

Worker design:

- One `tokio` task: `loop { select_next_due(); spawn publish; sleep(interval) }`; use `tokio::time::interval` with a 5–15 s tick and `SELECT ... LIMIT N` ordered by `not_before`.
- Per-account concurrency `tokio::sync::Semaphore` (e.g. 2) and per-target `governor::RateLimiter` to respect platform caps; explicit daily budget rows enforce YouTube's 100 uploads/day and Instagram's 100 posts/24h moving window (query `content_publishing_limit` when available).
- Claim jobs with `BEGIN IMMEDIATE` / conditional `UPDATE ... WHERE state='approved' AND ...` so multiple workers can't double-publish; release on panic via a `watchdog` that resets stale `uploading` rows after a timeout.
- Native scheduling where offered (FB `scheduled_publish_time`, WoopSocial/Upload-Post/Postiz scheduling) reduces how long a job sits locally, but keep the local queue as the source of truth for audit.
- `dry_run` mode in config: validate + render + log the would-be request (with secrets redacted) but never call publish — essential for tests.

### 3.6 Approval gate (`approval.rs`)

- A clip is **never** published until `approvals.approved_at` is set: `pending → approved → uploading`. `PublishError::NeedsApproval` is returned by a guard in the worker (not by each publisher).
- UI surfaces: CLI `pulsecut approve <job-id>` / `reject`, and an endpoint on the local editor HTTP API (`POST /api/jobs/:id/approve`) with a preview of the rendered clip + generated caption/hashtags.
- `policy.auto_approve` can be enabled only for explicitly allow-listed `(account_id, target)` pairs, with a recorded reason; default is manual. Log every decision to an append-only audit table (actor, job id, decision, timestamp) — no credentials.
- Because post-approval edits can change the video, store a hash of the render in the approval row and revoke approval if the file changes.

### 3.7 Configuration (`config.rs`)

- `settings.toml` (non-secret) layered with **env overrides** via `figment` + `serde`:

```toml
[publishing]
default_backend = "woopsocial"
dry_run = false
approval_mode = "manual"          # manual | auto_allowlisted

[publishing.backends.youtube.main]
enabled = true
account_id = "yt-main"
client_id_env = "YOUTUBE_CLIENT_ID"   # name of env var, not the value
token_keyring_key = "pulsecut:yt-main"

[publishing.targets.tiktok]
backend = "direct"                # direct | woop | upload_post | postiz | mixpost
fallback = ["woop"]
force_private_until_audit = true

[limits]
youtube_uploads_per_day = 95      # headroom under the 100/day bucket
instagram_posts_per_24h = 95
```

- Env vars: `PULSECUT__PUBLISHING__DRY_RUN=true` style overrides (figment `Env::prefixed("PULSECUT__").split("__")`), plus `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `X_CLIENT_ID`, `X_CLIENT_SECRET`, `OPENROUTER_API_KEY`, `OLLAMA_API_KEY`, `WOOP_API_KEY`, `UPLOAD_POST_API_KEY`, etc.
- **Secrets never in `settings.toml`** — store only env-var *names* or OS keyring keys. Use `keyring` crate (Windows Credential Manager / macOS Keychain / Linux Secret Service). Restrict file permissions to owner-only (0600 equivalent on Windows via ACLs).
- Per-account isolation: `TokenProvider` keyed by `account_id`; each publisher gets its own `reqwest::Client` with its own default `Authorization` header; never a shared mutable global token.

### 3.8 Concrete crate recommendations & feature-flag cautions

| Crate | Purpose | Feature flags / cautions |
|---|---|---|
| `reqwest` | All HTTP | Use `default-features = false, features = ["json","multipart","stream","rustls-tls","gzip","brotli"]`. **Avoid `native-tls`/`default-tls`** (OpenSSL pain on cross-platform builds); `cookies` only if a platform needs it. `multipart` pulls extra deps; enable only in the publish crate. `stream` needed for chunked uploads. |
| `tokio` | Async runtime / subprocess | `features = ["rt-multi-thread","macros","time","fs","sync","process","io-util","net"]` (`process` for whisper/ffmpeg subprocesses). `full` is convenient but bloats builds. |
| `serde` + `serde_json` | Platform JSON | `serde = { features = ["derive"] }`. Keep `preserve_order` off unless needed. |
| `figment` + `toml` (or `config`) | Layered settings | `figment` with `env` + `toml` features; validate with `serde` at startup, fail fast on missing env var *names*. |
| `thiserror` / `anyhow` | Error typing | `thiserror` for library errors, `anyhow` only in the binary. |
| `tracing` + `tracing-subscriber` | Structured logs | `env-filter`; add a redaction `MakeWriter`/layer that scrubs `Authorization`, `access_token`, `client_secret`, `api_key`, and `Set-Cookie`. |
| `oauth2` | Google/Meta/TikTok/LinkedIn/X flows | Feature `pkce` for installed apps; `reqwest` backend. Some providers deviate enough that a thin manual implementation is cleaner — keep `auth.rs` swappable. |
| `sqlx` | Queue / upload sessions | `features = ["runtime-tokio-rustls","sqlite","macros","migrate","chrono","uuid"]`; use `sqlx::query` (runtime-checked) or enable offline mode with `.sqlx/` prepared for CI. |
| `governor` | Per-target rate limiting | `quanta` clock feature for accurate windows; combine with DB-backed daily budgets. |
| `backoff` + `tower` / `tower-retry` | Retry | `backoff` with jitter; `tower` only if you adopt a Service abstraction. |
| `keyring` | OS keystore | Platform backends are feature-gated (`windows-native`, `macos-keychain`, `linux-secret-service`, `linux-keyutils`) — enable only for targets you ship; Linux needs a running keyring daemon. |
| `secrets` | `SecretString` | Wrap all tokens; prevents accidental `Debug` printing. |
| `uuid`, `chrono`/`time`, `base64`, `sha2`, `url`, `mime_guess` | IDs, timestamps, encoding | `chrono = { features = ["serde"] }`; `url` for signed media URLs; `sha2` for render hashes. |
| `async-trait` | Trait methods | Use if supporting older Rust; native `async fn` in traits works on 1.75+ — prefer native to avoid boxed futures. |
| `wiremock` / `httpmock` | Tests | Dev-dependency; assert exact paths/headers with fake tokens. |
| `atrium` (AT Protocol SDK) [K] | Bluesky types | Optional; verify API surface — hand-rolled XRPC with `reqwest` is fine for 3 calls. |
| `whisper-cpp-rs` [K] | Local STT bindings | Needs C++ toolchain/CMake and `bindgen`; consider `clang-sys` system deps. Subprocess is the low-risk default. |

---

## 4. Local vs API AI (for captions, titles, hashtags, subtitles)

### 4.1 Local by default

- **Ollama** ([V], docs updated Nov 2026):
  - Local server base: `http://localhost:11434/api` (OpenAI-compatible: `http://localhost:11434/v1`). Cloud: `https://ollama.com/api` with `Authorization: Bearer $OLLAMA_API_KEY` ([V] — Ollama now offers a hosted API).
  - Chat: `POST /api/chat` with `{"model":"<name>","messages":[…],"stream":false,"format":"json"}` → `message.content` ([V]). Also `POST /api/generate`, `GET /api/tags` (list models), `GET /api/ps` (running models), `POST /api/pull`.
  - Use it for: title/hashtag generation, caption rewriting, hype-event summarization. Force JSON via `format: "json"` or the OpenAI-compatible `response_format: {"type":"json_object"}` and deserialize into a typed struct with `serde` (retry/repair on failure).
  - Pick a small instruct model (e.g. `llama3.2:3b`, `qwen2.5:7b`, `gemma3:4b` [K]) — these are enough for short marketing copy and keep latency seconds. Keep prompts tiny (you're calling after every clip).
  - **Security:** local server has no auth — bind Ollama to `127.0.0.1`, never `0.0.0.0`, and keep it off the LAN.

- **whisper.cpp** (subtitle generation) [K]:
  - Preferred first implementation: build `whisper.cpp` and call the CLI via `tokio::process::Command`: `whisper-cli -m models/ggml-small.en.bin -f audio.wav -osrt -otxt -of out/clip`. Stream stdin/stdout, set a timeout, and capture stderr for errors. Ship the model as a separate download (`PULSECUT_WHISPER_MODEL` path) — never commit binaries.
  - Alternative: `whisper-cpp-rs` bindings for in-process inference — faster calls but C++ toolchain, CMake, and feature-flag risk (see §3.8).
  - **faster-whisper** (CTranslate2) via a pinned Python venv + subprocess: good CPU throughput with `int8`/`int8_float16` quantization; models `small`/`medium` for English streams. Use `--model`, `--language`, `--output_format srt`, `--vad_filter true`. Keep the venv in a known path managed by PulseCut, not the user's global Python.
  - Feed the resulting SRT/VTT into the existing `pulsecut-render` ASS/karaoke caption step (burn-in), and attach sidecar subtitles only where the platform supports it (X `media_category=subtitles` 1 MB [V]; YouTube `captions.insert` 400 units [V]).

### 4.2 Cloud APIs

- **OpenRouter** ([V], docs updated 2026-11-18):
  - `POST https://openrouter.ai/api/v1/chat/completions` (OpenAI-compatible) or `POST https://openrouter.ai/api/v1/responses`; `Authorization: Bearer $OPENROUTER_API_KEY`; optional `HTTP-Referer` and `X-OpenRouter-Title` headers.
  - Structured output: `response_format: {"type":"json_schema","json_schema":{name, strict, schema}}` ([V]) — use for `{title, caption, hashtags[]}`.
  - Resilience: `models: ["provider/model-a","provider/model-b"]` + `route: "fallback"`; `provider` preferences; `user` identifier for abuse detection ([V]).
  - Cost control: every response includes `usage.cost` and token breakdowns ([V]); accumulate per-account monthly spend in SQLite and **hard-stop** at a configured budget; `GET https://openrouter.ai/api/v1/generation?id=<id>` for audited usage. Set `max_tokens`, prefer cheap models for bulk work, and treat `:free` models as best-effort.
  - OAuth: OpenRouter documents an OAuth API (relevant for "Login with OpenRouter"/multi-tenant key-less flows) [U — exact endpoints not fetched]. For PulseCut v1, a single server-side API key in the keyring is simpler; add OAuth only for multi-user deployments.
  - The same adapter can target OpenAI directly by swapping `base_url` — keep one `LlmClient` interface.

### 4.3 Selection policy & privacy

```
transcription:  ALWAYS local (whisper.cpp / faster-whisper) unless user opts in to a cloud STT
metadata:       local Ollama first -> if confidence < threshold or local unavailable AND
                privacy.local_only == false -> OpenRouter (budget-permitting) -> cached template fallback
```

- `privacy.local_only = true` must **hard-disable** all cloud LLM/STT calls (compile-time feature `cloud-ai` can also remove them entirely for air-gapped builds). Never send raw chat logs or full stream audio to a cloud provider without explicit consent.
- Log only token counts and cost — never prompt bodies containing user chat/stream content by default (opt-in debug with redaction).
- Model ids and pricing drift quickly; pin model ids in config and re-check `GET /api/v1/models` / pricing page periodically.

---

## 5. Security

1. **Never log credentials.** Add a `tracing` redaction layer that masks `Authorization`, `access_token`, `refresh_token`, `client_secret`, `api_key`, `code`, `Set-Cookie`, and signed URL query params. Use `secrets::SecretString` so `Debug` prints `***`. Do not log full request/response bodies by default; when debugging, scrub first. `PublishReceipt.raw` must be sanitized before storage.
2. **Store secrets in env vars or the OS keyring**, never in `settings.toml`, never in the repo, never in SQLite plaintext. Keep only env-var *names* in config. Restrict config/token-store file permissions. Add `.env.example` with blank values and `.gitignore` for `.env*`.
3. **Token refresh:** central `TokenProvider` per account with a single-flight `tokio::sync::Mutex`/`OnceCell`; refresh proactively (e.g. 5 min before `expires_at`), refresh once on 401 and replay the request exactly once, then fail. Keep refresh tokens rotating (Google/Meta/TikTok rotate them) and persist the new token atomically to keyring.
4. **Per-account isolation:** every `(platform, account_id)` gets its own token provider, its own `reqwest::Client`, its own rate budget and its own queue rows. Least-privilege scopes (don't request `youtube` if only `youtube.upload` is needed). Never share one platform developer app credential across unrelated tenants if you can avoid it; if you must, isolate tokens and audit per account. Include an `account_id` in every log/audit record (hashed if multi-tenant).
5. **Public media URLs:** Instagram/Threads/Facebook/Pinterest pull the video by URL. Generate **short-lived signed URLs** scoped to one object, with a short TTL and no listing; validate any user-supplied `video_url` against an allow-list of hosts to prevent SSRF. Delete/host-expire the object after publish or container expiry.
6. **Webhooks / callbacks:** verify signatures (Meta `X-Hub-Signature-256`, TikTok/Postiz as documented) before acting; use constant-time comparison. Never trust a callback's payload as authority over local queue state without validation.
7. **Timeouts, size limits, backpressure:** set `reqwest::Client::timeout` and connect timeouts; cap upload/render sizes; bound the queue's in-flight count to avoid exhausting memory or triggering platform anti-bot heuristics.
8. **Supply chain / ops:** `cargo audit` + `cargo deny` in CI; pin dependencies; keep a separate restricted credential for posting (not your personal account admin) where possible. Respect each platform's ToS, AI-content disclosure rules, music/copyright, and FTC sponsor/disclosure requirements — record `ai_generated` on every job and set the platform flag where available (`is_ai_generated` on Instagram [V], TikTok AI label [U]).

---

## 6. Open items to verify before implementation

- [ ] YouTube quota in **your** Cloud Console — confirm whether the 100 `videos.insert`/day bucket applies and whether you need a quota extension.
- [ ] Exact WoopSocial create-post endpoint, auth header, and media-upload contract from https://docs.woopsocial.com/api-reference/overview.
- [ ] TikTok app audit timeline and current AI-generated-content labelling requirement in the developer terms.
- [ ] Meta app review for `instagram_content_publish` / `publish_video`, and whether each target Page needs PPA.
- [ ] Facebook Reels endpoint (`/video_reels`) details; LinkedIn upload headers; Threads video publish; Pinterest `/v5/media` status values — all marked [K]/[U] above.
- [ ] Bluesky `app.bsky.embed.video` caption format and current video size/duration limits.
- [ ] Current X API tier pricing for `POST /2/tweets` + media upload.
- [ ] Confirm `atrium`/`whisper-cpp-rs` crate versions and MSRV before pinning.

---

## 7. Sources (fetched 2026-11-18 via r.jina.ai)

- YouTube Data API overview: https://developers.google.com/youtube/data/getting-started
- YouTube quota costs: https://developers.google.com/youtube/data/determine_quota_cost
- TikTok Direct Post: https://developers.tiktok.com/docs/en/content-posting-api-get-started
- X chunked media upload: https://docs.x.com/x-api/media/quickstart/media-upload-chunked
- Meta Instagram content publishing: https://developers.facebook.com/documentation/instagram-platform/content-publishing
- Meta Pages posts: https://developers.facebook.com/documentation/pages-api/posts
- WoopSocial: https://woopsocial.com/ · docs https://docs.woopsocial.com/api-reference/overview
- Upload-Post: https://www.upload-post.com/ · docs https://docs.upload-post.com/
- Postiz: https://github.com/gitroomhq/postiz-app · https://docs.postiz.com
- Mixpost: https://github.com/inovector/mixpost · https://docs.mixpost.app/lite/
- Ollama API: https://docs.ollama.com/api/introduction
- OpenRouter API: https://openrouter.ai/docs/api_reference/overview · OpenAPI https://openrouter.ai/openapi.json
- Bluesky API reference: https://docs.bsky.app/docs/api/app-bsky-video-upload-video (redirects to https://endpoints.bsky.app)
- Pinterest API: https://developers.pinterest.com/docs/api/v5/introduction/
- LinkedIn & Threads official pages were 404/login-walled during research — those sections are marked [K]/[U] and need manual verification.
