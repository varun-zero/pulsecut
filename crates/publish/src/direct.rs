//! Direct official API publishers.
//!
//! YouTube is implemented end-to-end. TikTok / Instagram / X are reachable
//! through the aggregators by default; direct adapters require app review
//! (TikTok) or an Instagram Business account (Meta), so they are represented
//! explicitly rather than faked. See docs/PUBLISHING.md.

use crate::{caption, PublishJob, PublishReceipt, Publisher};
use pulsecut_core::error::{PulseError, Result};
use reqwest::Client;
use serde_json::{json, Value};

pub struct YouTubePublisher {
    pub upload_url: String,
    client: Client,
}

impl Default for YouTubePublisher {
    fn default() -> Self {
        Self {
            upload_url: "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status".into(),
            client: Client::new(),
        }
    }
}

#[async_trait::async_trait]
impl Publisher for YouTubePublisher {
    fn name(&self) -> &'static str { "youtube-direct" }

    async fn publish(&self, job: &PublishJob) -> Result<Vec<PublishReceipt>> {
        let key = std::env::var(&job.token_env).map_err(|_| PulseError::Publish(format!("missing {}", job.token_env)))?;
        let metadata = json!({
            "snippet": {
                "title": job.package.title,
                "description": caption(&job.package),
                "tags": job.package.hashtags.iter().map(|h| h.trim_start_matches('#').to_string()).collect::<Vec<_>>(),
                "categoryId": "22"
            },
            "status": { "privacyStatus": "public", "selfDeclaredMadeForKids": false }
        }).to_string();
        let bytes = tokio::fs::read(&job.package.video_path).await
            .map_err(|e| PulseError::Publish(format!("read clip: {e}")))?;
        let form = reqwest::multipart::Form::new()
            .part("metadata", reqwest::multipart::Part::text(metadata).mime_str("application/json")
                .map_err(|e| PulseError::Publish(e.to_string()))?)
            .part("media", reqwest::multipart::Part::bytes(bytes).file_name("clip.mp4")
                .mime_str("video/mp4").map_err(|e| PulseError::Publish(e.to_string()))?);

        let resp = self.client.post(&self.upload_url).bearer_auth(key).multipart(form).send().await
            .map_err(|e| PulseError::Publish(format!("youtube upload failed: {e}")))?;
        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(json!({}));
        if !status.is_success() {
            return Err(PulseError::Publish(format!("youtube {}: {}", status, body["error"]["message"].as_str().unwrap_or("unknown"))));
        }
        let id = body["id"].as_str().unwrap_or("unknown").to_string();
        Ok(vec![PublishReceipt {
            target: "youtube_shorts".into(),
            platform_id: id.clone(),
            url: Some(format!("https://www.youtube.com/shorts/{id}")),
            ok: true,
            detail: "direct videos.insert".into(),
        }])
    }
}

/// TikTok Content Posting API v2. Public posting requires an approved app;
/// until then TikTok returns SELF_ONLY drafts. This adapter is the real
/// three-step flow: initialise -> PUT bytes -> return publish_id.
pub struct TikTokPublisher {
    pub base_url: String,
    client: Client,
}

impl Default for TikTokPublisher {
    fn default() -> Self {
        Self {
            base_url: "https://open.tiktokapis.com".into(),
            client: Client::new(),
        }
    }
}

/// Request body for the upload-initialisation step. Public for tests.
pub fn tiktok_init_body(file_size: u64) -> Value {
    json!({ "video": { "file_size": file_size } })
}

#[async_trait::async_trait]
impl Publisher for TikTokPublisher {
    fn name(&self) -> &'static str { "tiktok-direct" }

    async fn publish(&self, job: &PublishJob) -> Result<Vec<PublishReceipt>> {
        let key = std::env::var(&job.token_env)
            .map_err(|_| PulseError::Publish(format!("missing {}", job.token_env)))?;
        let bytes = tokio::fs::read(&job.package.video_path).await
            .map_err(|e| PulseError::Publish(format!("read clip: {e}")))?;
        let init: Value = self.client
            .post(format!("{}/v2/video/publish/", self.base_url))
            .bearer_auth(&key)
            .header("Content-Type", "application/json; charset=UTF-8")
            .json(&tiktok_init_body(bytes.len() as u64))
            .send().await
            .map_err(|e| PulseError::Publish(format!("tiktok init failed: {e}")))?
            .json().await
            .map_err(|e| PulseError::Publish(e.to_string()))?;
        let error = init["error"]["code"].as_str();
        if let Some(code) = error {
            return Err(PulseError::Publish(format!("tiktok error {code}: {}", init["error"]["message"].as_str().unwrap_or(""))));
        }
        let upload_url = init["data"]["upload_url"].as_str()
            .ok_or_else(|| PulseError::Publish("tiktok returned no upload_url".into()))?;
        let publish_id = init["data"]["publish_id"].as_str().unwrap_or("unknown").to_string();
        self.client.put(upload_url)
            .header("Content-Type", "video/mp4")
            .header("Content-Disposition", "form-data; name=\"video\"; filename=\"video.mp4\"")
            .body(bytes)
            .send().await
            .map_err(|e| PulseError::Publish(format!("tiktok upload failed: {e}")))?;
        Ok(vec![PublishReceipt {
            target: "tiktok".into(), platform_id: publish_id,
            url: None, ok: true, detail: "tiktok Content Posting API v2 (SELF_ONLY until app approved)".into(),
        }])
    }
}

/// Instagram Reels via the Graph API resumable upload. Requires a Meta app,
/// an Instagram Business/Creator account and a public professional account.
pub struct InstagramPublisher {
    pub base_url: String,
    pub user_id_env: String,
    client: Client,
}

impl Default for InstagramPublisher {
    fn default() -> Self {
        Self {
            base_url: "https://graph.facebook.com/v21.0".into(),
            user_id_env: "PULSECUT_IG_USER_ID".into(),
            client: Client::new(),
        }
    }
}

pub fn instagram_init_body(file_size: u64) -> Value {
    json!({
        "media_type": "REELS",
        "upload_type": "RESTART",
        "file_size": file_size
    })
}

#[async_trait::async_trait]
impl Publisher for InstagramPublisher {
    fn name(&self) -> &'static str { "instagram-direct" }

    async fn publish(&self, job: &PublishJob) -> Result<Vec<PublishReceipt>> {
        let key = std::env::var(&job.token_env)
            .map_err(|_| PulseError::Publish(format!("missing {}", job.token_env)))?;
        let user = std::env::var(&self.user_id_env)
            .map_err(|_| PulseError::Publish(format!("missing {}", self.user_id_env)))?;
        let bytes = tokio::fs::read(&job.package.video_path).await
            .map_err(|e| PulseError::Publish(format!("read clip: {e}")))?;
        let mut init_body = instagram_init_body(bytes.len() as u64);
        init_body["access_token"] = json!(key);
        let init: Value = self.client
            .post(format!("{}/{user}/media", self.base_url))
            .json(&init_body)
            .send().await
            .map_err(|e| PulseError::Publish(format!("instagram media init failed: {e}")))?
            .json().await
            .map_err(|e| PulseError::Publish(e.to_string()))?;
        if let Some(msg) = init["error"]["message"].as_str() {
            return Err(PulseError::Publish(format!("instagram error: {msg}")));
        }
        let upload_id = init["id"].as_str()
            .ok_or_else(|| PulseError::Publish("instagram returned no media id".into()))?;
        let uri = init["uri"].as_str()
            .ok_or_else(|| PulseError::Publish("instagram returned no upload uri".into()))?;
        self.client.put(uri)
            .header("file_offset", "0")
            .header("Content-Type", "application/octet-stream")
            .body(bytes)
            .send().await
            .map_err(|e| PulseError::Publish(format!("instagram upload failed: {e}")))?;
        let publish: Value = self.client
            .post(format!("{}/{user}/media_publish", self.base_url))
            .json(&json!({"creation_id": upload_id, "access_token": key}))
            .send().await
            .map_err(|e| PulseError::Publish(format!("instagram publish failed: {e}")))?
            .json().await
            .map_err(|e| PulseError::Publish(e.to_string()))?;
        let id = publish["id"].as_str().unwrap_or(upload_id).to_string();
        Ok(vec![PublishReceipt {
            target: "instagram_reels".into(), platform_id: id,
            url: None, ok: true, detail: "Instagram Graph API Reels publish".into(),
        }])
    }
}

/// Platforms that need a review step before public posting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirectPlatform {
    TikTok,
    InstagramReels,
    FacebookReels,
    X,
    LinkedIn,
    Threads,
    Pinterest,
    Bluesky,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tiktok_init_shape() {
        let b = tiktok_init_body(12345);
        assert_eq!(b["video"]["file_size"], 12345);
    }

    #[test]
    fn instagram_init_shape() {
        let b = instagram_init_body(99);
        assert_eq!(b["media_type"], "REELS");
        assert_eq!(b["upload_type"], "RESTART");
        assert_eq!(b["file_size"], 99);
    }
}

impl DirectPlatform {
    pub fn requirement(&self) -> &'static str {
        match self {
            DirectPlatform::TikTok => "Content Posting API app audit; SELF_ONLY until approved",
            DirectPlatform::InstagramReels | DirectPlatform::FacebookReels => "Meta app + Instagram Business/Creator, public account",
            DirectPlatform::X => "X API v2 elevated access + chunked media upload",
            DirectPlatform::LinkedIn => "LinkedIn Marketing Developer Platform app",
            DirectPlatform::Threads => "Threads API app with threads_content_publish scope",
            DirectPlatform::Pinterest => "Pinterest API app with pins:write scope",
            DirectPlatform::Bluesky => "App password + AT Protocol repo.createRecord",
        }
    }
}
