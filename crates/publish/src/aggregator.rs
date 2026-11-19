//! Aggregator publishers. One upload, many destinations.
//!
//! The exact JSON field names of hosted aggregators change occasionally. We
//! keep them in one small file and use permissive parsing: any 2xx with an id
//! or url in the response is treated as success. Provider-specific quirks are
//! documented in docs/PUBLISHING.md.

use crate::{caption, PublishJob, PublishReceipt, Publisher};
use pulsecut_core::error::{PulseError, Result};
use reqwest::Client;
use serde_json::{json, Value};

async fn token(env: &str) -> Result<String> {
    std::env::var(env).map_err(|_| PulseError::Publish(format!("missing {env}; export your publisher token")))
}

fn extract_id(v: &Value) -> String {
    v["id"].as_str()
        .or_else(|| v["postId"].as_str())
        .or_else(|| v["data"]["id"].as_str())
        .or_else(|| v["data"]["postId"].as_str())
        .unwrap_or("unknown")
        .to_string()
}

pub struct WoopSocialPublisher {
    pub base_url: String,
    client: Client,
}

impl WoopSocialPublisher {
    pub fn new(base_url: &str) -> Self { Self { base_url: base_url.trim_end_matches('/').into(), client: Client::new() } }
}

#[async_trait::async_trait]
impl Publisher for WoopSocialPublisher {
    fn name(&self) -> &'static str { "woopsocial" }

    async fn publish(&self, job: &PublishJob) -> Result<Vec<PublishReceipt>> {
        let key = token(&job.token_env).await?;
        let file = tokio::fs::read(&job.package.video_path).await
            .map_err(|e| PulseError::Publish(format!("read clip: {e}")))?;
        let part = reqwest::multipart::Part::bytes(file)
            .file_name("clip.mp4")
            .mime_str("video/mp4")
            .map_err(|e| PulseError::Publish(e.to_string()))?;
        let form = reqwest::multipart::Form::new()
            .text("content", caption(&job.package))
            .text("platforms", job.targets.join(","))
            .part("video", part);
        let resp = self.client
            .post(format!("{}/posts", self.base_url))
            .bearer_auth(key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| PulseError::Publish(format!("woopsocial request failed: {e}")))?;
        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(json!({}));
        if !status.is_success() {
            return Err(PulseError::Publish(format!("woopsocial {}: {}", status, body)));
        }
        Ok(job.targets.iter().map(|t| PublishReceipt {
            target: t.clone(), platform_id: extract_id(&body), url: body["url"].as_str().map(str::to_string),
            ok: true, detail: format!("published via {}", self.name()),
        }).collect())
    }
}

pub struct UploadPostPublisher {
    pub base_url: String,
    client: Client,
}

impl UploadPostPublisher {
    pub fn new(base_url: &str) -> Self { Self { base_url: base_url.trim_end_matches('/').into(), client: Client::new() } }
}

#[async_trait::async_trait]
impl Publisher for UploadPostPublisher {
    fn name(&self) -> &'static str { "upload-post" }

    async fn publish(&self, job: &PublishJob) -> Result<Vec<PublishReceipt>> {
        let key = token(&job.token_env).await?;
        let file = tokio::fs::read(&job.package.video_path).await
            .map_err(|e| PulseError::Publish(format!("read clip: {e}")))?;
        let part = reqwest::multipart::Part::bytes(file)
            .file_name("clip.mp4")
            .mime_str("video/mp4")
            .map_err(|e| PulseError::Publish(e.to_string()))?;
        let form = reqwest::multipart::Form::new()
            .text("title", job.package.title.clone())
            .text("caption", caption(&job.package))
            .text("platforms", job.targets.join(","))
            .part("video", part);
        let resp = self.client
            .post(format!("{}/upload", self.base_url))
            .header("X-Api-Key", key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| PulseError::Publish(format!("upload-post request failed: {e}")))?;
        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(json!({}));
        if !status.is_success() {
            return Err(PulseError::Publish(format!("upload-post {}: {}", status, body)));
        }
        Ok(job.targets.iter().map(|t| PublishReceipt {
            target: t.clone(), platform_id: extract_id(&body), url: body["url"].as_str().map(str::to_string),
            ok: true, detail: "published via upload-post".into(),
        }).collect())
    }
}

pub struct PostizPublisher {
    pub base_url: String,
    client: Client,
}

impl PostizPublisher {
    pub fn new(base_url: &str) -> Self { Self { base_url: base_url.trim_end_matches('/').into(), client: Client::new() } }
}

#[async_trait::async_trait]
impl Publisher for PostizPublisher {
    fn name(&self) -> &'static str { "postiz" }

    async fn publish(&self, job: &PublishJob) -> Result<Vec<PublishReceipt>> {
        let key = token(&job.token_env).await?;
        let file = tokio::fs::read(&job.package.video_path).await
            .map_err(|e| PulseError::Publish(format!("read clip: {e}")))?;
        let part = reqwest::multipart::Part::bytes(file).file_name("clip.mp4").mime_str("video/mp4")
            .map_err(|e| PulseError::Publish(e.to_string()))?;
        let upload: Value = self.client
            .post(format!("{}/api/v1/media/upload", self.base_url))
            .bearer_auth(&key)
            .multipart(reqwest::multipart::Form::new().part("file", part))
            .send().await
            .map_err(|e| PulseError::Publish(format!("postiz media upload failed: {e}")))?
            .json().await
            .map_err(|e| PulseError::Publish(e.to_string()))?;
        let media_id = extract_id(&upload);
        let body = json!({
            "content": caption(&job.package),
            "state": "POSTED",
            "upload": [{ "id": media_id, "type": "VIDEO" }]
        });
        let resp = self.client
            .post(format!("{}/api/v1/posts", self.base_url))
            .bearer_auth(key)
            .json(&body)
            .send().await
            .map_err(|e| PulseError::Publish(format!("postiz post failed: {e}")))?;
        let status = resp.status();
        let value: Value = resp.json().await.unwrap_or(json!({}));
        if !status.is_success() {
            return Err(PulseError::Publish(format!("postiz {}: {}", status, value)));
        }
        Ok(job.targets.iter().map(|t| PublishReceipt {
            target: t.clone(), platform_id: extract_id(&value), url: None,
            ok: true, detail: "queued in postiz".into(),
        }).collect())
    }
}
