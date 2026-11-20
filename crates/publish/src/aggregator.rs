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

    /// Map a PulseCut target id to a WoopSocial platform enum + platform fields.
    fn platform_for(target: &str) -> (String, Option<Value>) {
        let platform = match target.to_ascii_lowercase().as_str() {
            "youtube" | "youtube_shorts" | "yt" => "YOUTUBE",
            "tiktok" => "TIKTOK",
            "instagram" | "instagram_reels" | "ig" => "INSTAGRAM",
            "facebook" | "facebook_reels" => "FACEBOOK",
            "threads" => "THREADS",
            "x" | "twitter" => "X",
            "linkedin" => "LINKEDIN",
            "pinterest" => "PINTEREST",
            other => other,
        }.to_string();
        let fields = match platform.as_str() {
            "YOUTUBE" => Some(json!({"title": "placeholder"})), // title filled at call site
            "TIKTOK" => Some(json!({
                "postType": "VIDEO", "postMode": "DIRECT_POST",
                "privacyLevel": "PUBLIC_TO_EVERYONE", "allowComment": true,
                "allowDuet": true, "allowStitch": true,
                "isYourBrand": false, "isBrandedContent": false, "autoAddMusic": true
            })),
            "INSTAGRAM" => Some(json!({"postType": "REEL"})),
            "FACEBOOK" => Some(json!({"postType": "REEL"})),
            _ => None,
        };
        (platform, fields)
    }

    /// Extract a JSON array whether the API returns `[...]` directly or wraps it
    /// under `data`, `projects`, `socialAccounts`, or `items`.
    fn extract_array<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a Vec<Value>> {
        if let Some(arr) = v.as_array() {
            return Some(arr);
        }
        for key in keys {
            if let Some(arr) = v.get(*key).and_then(|x| x.as_array()) {
                return Some(arr);
            }
        }
        None
    }
}

#[async_trait::async_trait]
impl Publisher for WoopSocialPublisher {
    fn name(&self) -> &'static str { "woopsocial" }

    async fn publish(&self, job: &PublishJob) -> Result<Vec<PublishReceipt>> {
        // Verified against the official WoopSocial v1 API (docs.woopsocial.com):
        // 1) pick a project, 2) upload the video to the media library,
        // 3) resolve connected social accounts, 4) create a publish-now post.
        let key = token(&job.token_env).await?;
        let auth = format!("Bearer {key}");
        let base = &self.base_url;

        // 1) Project (optional override; otherwise first available).
        let project_id = match std::env::var("PULSECUT_WOOPSOCIAL_PROJECT").ok().filter(|s| !s.is_empty()) {
            Some(p) => p,
            None => {
                let resp = self.client.get(format!("{base}/projects")).header("Authorization", &auth)
                    .send().await.map_err(|e| PulseError::Publish(format!("woopsocial projects: {e}")))?;
                let status = resp.status();
                let v: Value = resp.json().await.unwrap_or(json!({}));
                if !status.is_success() {
                    return Err(PulseError::Publish(format!("woopsocial projects {status}: {v}")));
                }
                Self::extract_array(&v, &["data", "projects", "items"])
                    .and_then(|arr| arr.first())
                    .and_then(|p| p.get("id").or_else(|| p.get("projectId")))
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| PulseError::Publish("woopsocial: no project found (connect a social account in the WoopSocial dashboard)".into()))?
                    .to_string()
            }
        };

        // 2) Upload media.
        let file = tokio::fs::read(&job.package.video_path).await
            .map_err(|e| PulseError::Publish(format!("read clip: {e}")))?;
        let part = reqwest::multipart::Part::bytes(file)
            .file_name("clip.mp4").mime_str("video/mp4")
            .map_err(|e| PulseError::Publish(e.to_string()))?;
        let form = reqwest::multipart::Form::new().part("file", part);
        let resp = self.client.post(format!("{base}/media?projectId={project_id}"))
            .header("Authorization", &auth).multipart(form).send().await
            .map_err(|e| PulseError::Publish(format!("woopsocial media upload: {e}")))?;
        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(json!({}));
        if !status.is_success() {
            return Err(PulseError::Publish(format!("woopsocial media upload {status}: {body}")));
        }
        let media_id = body.get("mediaId")
            .or_else(|| body.get("id"))
            .or_else(|| body.get("data").and_then(|d| d.get("mediaId").or_else(|| d.get("id"))))
            .and_then(|x| x.as_str())
            .ok_or_else(|| PulseError::Publish(format!("woopsocial: upload returned no mediaId ({body})")))?
            .to_string();

        // 3) Connected social accounts -> map platform to account id.
        let resp = self.client.get(format!("{base}/social-accounts?projectId={project_id}"))
            .header("Authorization", &auth).send().await
            .map_err(|e| PulseError::Publish(format!("woopsocial social-accounts: {e}")))?;
        let status = resp.status();
        let accounts: Value = resp.json().await.unwrap_or(json!({}));
        if !status.is_success() {
            return Err(PulseError::Publish(format!("woopsocial social-accounts {status}: {accounts}")));
        }
        let account_list = Self::extract_array(&accounts, &["data", "socialAccounts", "accounts", "items"]);
        let find_account = |platform: &str| -> Option<String> {
            account_list?.iter().find(|a| {
                a.get("platform").and_then(|x| x.as_str())
                    .map(|p| p.eq_ignore_ascii_case(platform)).unwrap_or(false)
                    && a.get("status").and_then(|x| x.as_str())
                        .map(|s| s.eq_ignore_ascii_case("CONNECTED"))
                        .unwrap_or(true)
            }).and_then(|a| a.get("id").or_else(|| a.get("socialAccountId")))
              .and_then(|x| x.as_str())
              .map(String::from)
        };

        let text = caption(&job.package);
        let mut social_accounts = Vec::new();
        let mut receipts = Vec::new();
        let mut connected_receipt_indices = Vec::new();
        for target in &job.targets {
            let (platform, mut fields) = Self::platform_for(target);
            if let Some(obj) = fields.as_mut() {
                if platform == "YOUTUBE" { obj["title"] = json!(job.package.title); }
            }
            let account_id = match find_account(&platform) {
                Some(id) => id,
                None => {
                    receipts.push(PublishReceipt {
                        target: target.clone(), platform_id: String::new(), url: None, ok: false,
                        detail: format!("no connected WoopSocial account for {platform} (connect it in the WoopSocial dashboard)"),
                    });
                    continue;
                }
            };
            let mut sa = json!({"platform": platform, "socialAccountId": account_id});
            if let Some(obj) = fields { sa.as_object_mut().unwrap().extend(obj.as_object().unwrap().clone()); }
            social_accounts.push(sa);
            connected_receipt_indices.push(receipts.len());
            receipts.push(PublishReceipt {
                target: target.clone(),
                platform_id: String::new(),
                url: None,
                ok: false,
                detail: "pending publish".into(),
            });
        }
        if social_accounts.is_empty() {
            return Ok(receipts);
        }

        // 4) Create a publish-now post.
        let payload = json!({
            "content": [{"text": text, "media": [{"type": "MEDIA_LIBRARY", "mediaId": media_id}]}],
            "schedule": {"type": "PUBLISH_NOW"},
            "socialAccounts": social_accounts,
            "autoDeleteMediaAfterPublish": false
        });
        let resp = self.client.post(format!("{base}/posts")).header("Authorization", &auth)
            .json(&payload).send().await
            .map_err(|e| PulseError::Publish(format!("woopsocial post create: {e}")))?;
        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(json!({}));
        if !status.is_success() {
            return Err(PulseError::Publish(format!("woopsocial post {status}: {body}")));
        }
        let post_id = extract_id(&body);
        let post_url = body["url"].as_str()
            .or_else(|| body["data"]["url"].as_str())
            .map(str::to_string);
        for idx in connected_receipt_indices {
            if let Some(r) = receipts.get_mut(idx) {
                r.platform_id = post_id.clone();
                r.url = post_url.clone();
                r.ok = true;
                r.detail = format!("published via {} post {post_id}", self.name());
            }
        }
        Ok(receipts)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn woopsocial_maps_platform_aliases_and_fields() {
        let (plat, fields) = WoopSocialPublisher::platform_for("youtube_shorts");
        assert_eq!(plat, "YOUTUBE");
        assert!(fields.is_some());

        let (ig, ig_fields) = WoopSocialPublisher::platform_for("instagram_reels");
        assert_eq!(ig, "INSTAGRAM");
        assert_eq!(ig_fields.unwrap()["postType"], "REEL");

        let (tt, tt_fields) = WoopSocialPublisher::platform_for("tiktok");
        assert_eq!(tt, "TIKTOK");
        assert_eq!(tt_fields.unwrap()["postMode"], "DIRECT_POST");
    }

    #[test]
    fn woopsocial_extracts_both_raw_and_wrapped_arrays() {
        let raw = json!([{"id": "p1"}]);
        assert_eq!(WoopSocialPublisher::extract_array(&raw, &["data"]).unwrap().len(), 1);

        let wrapped = json!({"data": [{"id": "p2"}, {"id": "p3"}]});
        assert_eq!(WoopSocialPublisher::extract_array(&wrapped, &["data"]).unwrap().len(), 2);

        let named = json!({"socialAccounts": [{"id": "a1"}]});
        assert_eq!(WoopSocialPublisher::extract_array(&named, &["data", "socialAccounts"]).unwrap().len(), 1);
    }

    #[test]
    fn extracts_post_id_variants() {
        assert_eq!(extract_id(&json!({"postId": "abc"})), "abc");
        assert_eq!(extract_id(&json!({"data": {"id": "xyz"}})), "xyz");
    }
}

