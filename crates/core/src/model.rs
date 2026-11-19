//! Domain model shared by every stage of the pipeline.
//!
//! The flow is:
//! `ChatMessage` -> `HypeEvent` -> `ClipWindow` -> `ClipPackage` -> publisher.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    Twitch,
    Kick,
    Youtube,
}

impl Platform {
    pub fn as_str(&self) -> &'static str {
        match self {
            Platform::Twitch => "twitch",
            Platform::Kick => "kick",
            Platform::Youtube => "youtube",
        }
    }
}

/// A single normalized chat line. Connectors are responsible for producing
/// this shape so the detector never has to know about platform protocols.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub platform: Platform,
    pub channel: String,
    pub author: String,
    pub text: String,
    /// Unix epoch milliseconds, taken from the platform when available.
    pub ts_ms: i64,
    /// Emote codes extracted by the connector (Twitch tags, Kick emotes, etc.).
    pub emotes: Vec<String>,
    pub is_mod: bool,
    pub is_subscriber: bool,
}

impl ChatMessage {
    pub fn words(&self) -> impl Iterator<Item = &str> {
        self.text
            .split(|c: char| !c.is_alphanumeric() && c != '\'')
            .filter(|w| !w.is_empty())
    }
}

/// The exact source-time window a clip should cover.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClipWindow {
    pub start_ms: i64,
    pub end_ms: i64,
    /// Human-readable reason for the chosen boundaries, e.g. "silence at T-38.2s".
    pub snap_reason: String,
}

impl ClipWindow {
    pub fn duration_ms(&self) -> i64 { self.end_ms - self.start_ms }
}

/// A moment the detector considers worth clipping.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HypeEvent {
    pub id: String,
    pub channel: String,
    pub platform: Platform,
    /// The instant the chat spike was detected (not the clip start).
    pub event_ts_ms: i64,
    /// Final 0..1 confidence used by the approval gate.
    pub confidence: f64,
    /// Raw fused signal score before normalization.
    pub score: f64,
    /// Why this fired: e.g. "velocity z=4.2", "unique chatters 0.61", "emote burst POG".
    pub reasons: Vec<String>,
    pub clip: ClipWindow,
}

/// A word with timings, used for karaoke subtitles and sentence-boundary snapping.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Word {
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub confidence: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClipStatus {
    Detected,
    Rendering,
    Ready,
    Approved,
    Published,
    Rejected,
    Failed,
}

/// Output of the packaging stage: a finished vertical video plus all metadata
/// needed by every publishing target.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipPackage {
    pub id: String,
    pub channel: String,
    pub platform: Platform,
    pub source_window: ClipWindow,
    /// Final rendered 9:16 file.
    pub video_path: String,
    /// Original uncropped clip, kept so style/template changes can re-render
    /// without losing quality or double-cropping.
    pub raw_video_path: String,
    pub words: Vec<Word>,
    pub title: String,
    pub description: String,
    pub hashtags: Vec<String>,
    pub caption_style: String,
    pub template: String,
    pub profiles: Vec<PlatformProfile>,
    pub status: ClipStatus,
    pub created_at_ms: i64,
    /// Detector confidence carried through so the editor can sort by it.
    pub confidence: f64,
}

/// Per-platform delivery spec. Safe zones account for TikTok/Reels UI chrome.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlatformProfile {
    pub id: String,
    pub width: u32,
    pub height: u32,
    pub max_duration_secs: u32,
    pub safe_top: u32,
    pub safe_bottom: u32,
    pub caption_style: String,
}

impl PlatformProfile {
    pub fn shorts() -> Self {
        Self { id: "youtube_shorts".into(), width: 1080, height: 1920, max_duration_secs: 180, safe_top: 180, safe_bottom: 320, caption_style: "karaoke".into() }
    }
    pub fn reels() -> Self {
        Self { id: "instagram_reels".into(), width: 1080, height: 1920, max_duration_secs: 90, safe_top: 250, safe_bottom: 420, caption_style: "karaoke".into() }
    }
    pub fn tiktok() -> Self {
        Self { id: "tiktok".into(), width: 1080, height: 1920, max_duration_secs: 60, safe_top: 220, safe_bottom: 380, caption_style: "karaoke_bold".into() }
    }
    pub fn x() -> Self {
        Self { id: "x".into(), width: 1080, height: 1920, max_duration_secs: 140, safe_top: 80, safe_bottom: 160, caption_style: "clean".into() }
    }
}

pub fn default_profiles() -> Vec<PlatformProfile> {
    vec![PlatformProfile::shorts(), PlatformProfile::reels(), PlatformProfile::tiktok(), PlatformProfile::x()]
}
