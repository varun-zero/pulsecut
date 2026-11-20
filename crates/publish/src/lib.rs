//! Publishing: one package -> many platforms, behind a single trait.
//!
//! Tier 1 aggregators (WoopSocial / Upload-Post) are the default because they
//! hold the OAuth connections for all nine platforms. Tier 2 Postiz is for
//! self-hosters. Tier 3 direct APIs are available for YouTube today and for
//! platforms where you have completed app review.

pub mod aggregator;
pub mod direct;
pub mod queue;

pub use aggregator::{PostizPublisher, UploadPostPublisher, WoopSocialPublisher};
pub use direct::{InstagramPublisher, TikTokPublisher, YouTubePublisher};
pub use queue::{PublishQueue, PublishRequest, QueueItem, QueueStatus};

use pulsecut_core::error::Result;
use pulsecut_core::model::ClipPackage;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishJob {
    pub package: ClipPackage,
    pub targets: Vec<String>,
    pub token_env: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishReceipt {
    pub target: String,
    pub platform_id: String,
    pub url: Option<String>,
    pub ok: bool,
    pub detail: String,
}

#[async_trait::async_trait]
pub trait Publisher: Send + Sync {
    fn name(&self) -> &'static str;
    async fn publish(&self, job: &PublishJob) -> Result<Vec<PublishReceipt>>;
}

/// Build the publisher backend selected by `PULSECUT_PUBLISHER`.
/// Single source of truth shared by the CLI (`main.rs`) and HTTP API (`web.rs`).
pub fn publisher(cfg: &pulsecut_core::config::Config) -> Box<dyn Publisher> {
    match std::env::var("PULSECUT_PUBLISHER").unwrap_or_else(|_| "woopsocial".into()).as_str() {
        "uploadpost" => Box::new(UploadPostPublisher::new(&cfg.publishing.uploadpost_base_url)),
        "postiz" => Box::new(PostizPublisher::new(&cfg.publishing.postiz_base_url)),
        "direct" => Box::new(YouTubePublisher::default()),
        "tiktok_direct" => Box::new(TikTokPublisher::default()),
        "instagram_direct" => Box::new(InstagramPublisher::default()),
        _ => Box::new(WoopSocialPublisher::new(&cfg.publishing.woopsocial_base_url)),
    }
}

/// Build the caption text once; every platform gets the same voice.
pub fn caption(pkg: &ClipPackage) -> String {
    let mut text = pkg.title.clone();
    if !pkg.description.is_empty() {
        text.push_str("\n\n");
        text.push_str(&pkg.description);
    }
    if !pkg.hashtags.is_empty() {
        text.push_str("\n\n");
        text.push_str(&pkg.hashtags.iter().map(|h| format!("#{}", h.trim_start_matches('#'))).collect::<Vec<_>>().join(" "));
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use pulsecut_core::model::{ClipStatus, ClipWindow, Platform};

    fn pkg() -> ClipPackage {
        ClipPackage {
            id: "p1".into(), channel: "c".into(), platform: Platform::Twitch,
            source_window: ClipWindow { start_ms: 0, end_ms: 30_000, snap_reason: "x".into() },
            video_path: "out.mp4".into(), raw_video_path: "raw.mp4".into(), words: vec![],
            title: "Insane clutch".into(), description: "What a moment".into(),
            hashtags: vec!["clips".into(), "#fyp".into()],
            caption_style: "karaoke".into(), template: "default".into(),
            profiles: vec![], status: ClipStatus::Ready, created_at_ms: 0, confidence: 0.9,
        }
    }

    #[test]
    fn caption_dedupes_hash_prefix() {
        let c = caption(&pkg());
        assert!(c.contains("#clips #fyp"));
        assert!(!c.contains("##"));
    }
}
