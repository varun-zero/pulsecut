//! Runtime configuration.
//!
//! Every field has a sane default so a fresh install works without a config
//! file. Users can override individual fields with environment variables
//! prefixed `PULSECUT_` (see `Config::from_env`), which is important for
//! credentials — secrets are never written to the on-disk settings file.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub capture: CaptureConfig,
    pub detection: DetectionConfig,
    pub render: RenderConfig,
    pub ai: AiConfig,
    pub publishing: PublishingConfig,
    pub log_level: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            capture: CaptureConfig::default(),
            detection: DetectionConfig::default(),
            render: RenderConfig::default(),
            ai: AiConfig::default(),
            publishing: PublishingConfig::default(),
            log_level: "info".into(),
        }
    }
}

impl Config {
    /// Load from a JSON file, falling back to defaults, then apply the small
    /// set of environment overrides that are safe to express as scalars.
    pub fn load(path: &std::path::Path) -> crate::Result<Self> {
        let mut cfg = if path.exists() {
            let text = std::fs::read_to_string(path)?;
            serde_json::from_str(&text).unwrap_or_default()
        } else {
            Self::default()
        };
        cfg.apply_env();
        Ok(cfg)
    }

    pub fn apply_env(&mut self) {
        if let Ok(v) = std::env::var("PULSECUT_FFMPEG") {
            self.capture.ffmpeg_path = v;
        }
        if let Ok(v) = std::env::var("PULSECUT_OUT_DIR") {
            self.capture.output_dir = v;
        }
        if let Ok(v) = std::env::var("PULSECUT_OLLAMA_URL") {
            self.ai.ollama_url = v;
        }
        if let Ok(v) = std::env::var("PULSECUT_OLLAMA_MODEL") {
            self.ai.ollama_model = v;
        }
        if let Ok(v) = std::env::var("PULSECUT_AUTO_APPROVE") {
            self.publishing.auto_approve = matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes");
        }
        if let Ok(v) = std::env::var("PULSECUT_LOG") {
            self.log_level = v;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct CaptureConfig {
    /// Empty means: resolve from PATH, then from imageio-ffmpeg, then from
    /// the usual Windows user install locations.
    pub ffmpeg_path: String,
    pub streamlink_path: String,
    /// HLS segment length. Short segments = tighter cuts but more files.
    pub segment_seconds: u32,
    /// How much live video to keep on disk. Must exceed lookback + postroll.
    pub buffer_seconds: u32,
    pub output_dir: String,
    /// Milliseconds of context captured BEFORE the hype spike.
    pub lookback_ms: u32,
    /// Milliseconds captured AFTER the spike so the punchline lands.
    pub postroll_ms: u32,
    /// Poll interval for the capture supervisor.
    pub poll_ms: u32,
}

impl Default for CaptureConfig {
    fn default() -> Self {
        Self {
            ffmpeg_path: String::new(),
            streamlink_path: String::new(),
            segment_seconds: 4,
            buffer_seconds: 150,
            output_dir: "out".into(),
            lookback_ms: 40_000,
            postroll_ms: 15_000,
            poll_ms: 500,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DetectionConfig {
    /// Baseline lookback used for rolling statistics.
    pub baseline_window_secs: u32,
    /// Exponential moving average smoothing factor for message velocity.
    pub ewma_alpha: f64,
    /// Robust z-score threshold (median + k * MAD) for velocity.
    pub zscore_threshold: f64,
    /// Fallback threshold when MAD is zero (quiet channels).
    pub mad_floor: f64,
    /// Ignore windows with fewer messages than this (noise floor).
    pub min_messages: u32,
    /// Fraction of unique authors required to avoid a single-user spam raid.
    pub min_unique_ratio: f64,
    /// How often the same token/emote must repeat to count as a burst.
    pub emote_repeat_threshold: u32,
    /// Extra weight per hype keyword occurrence.
    pub keyword_weight: f64,
    pub hype_keywords: Vec<String>,
    /// Minimum seconds between two accepted clips on the same channel.
    pub cooldown_secs: u32,
    /// Context captured before the spike (the user's "go back 40 seconds").
    pub lookback_ms: u32,
    /// Tail captured after the spike so the punchline is included.
    pub postroll_ms: u32,
    pub clip_min_secs: u32,
    pub clip_max_secs: u32,
    /// Score in 0..1 above which a candidate is emitted.
    pub confidence_threshold: f64,
    /// Relative contribution of audio energy to the final score.
    pub audio_weight: f64,
    /// Relative contribution of chat signals to the final score.
    pub chat_weight: f64,
}

impl Default for DetectionConfig {
    fn default() -> Self {
        Self {
            baseline_window_secs: 300,
            ewma_alpha: 0.12,
            zscore_threshold: 3.0,
            mad_floor: 2.0,
            min_messages: 8,
            min_unique_ratio: 0.30,
            emote_repeat_threshold: 4,
            keyword_weight: 0.12,
            hype_keywords: [
                "lol", "lmao", "pog", "poggers", "clap", "hype", "omg", "w", "goat",
                "insane", "lets go", "let's go", "crazy", "wild", "fire", "actual",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect(),
            cooldown_secs: 45,
            lookback_ms: 40_000,
            postroll_ms: 15_000,
            clip_min_secs: 15,
            clip_max_secs: 60,
            confidence_threshold: 0.62,
            audio_weight: 0.20,
            chat_weight: 0.80,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct RenderConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// auto | nvenc | amf | qsv | x264
    pub encoder: String,
    pub burn_captions: bool,
    pub caption_style: String,
    pub subtitle_font: String,
    /// Empty = let ffmpeg pick a system font. On Windows we fall back to arial.ttf.
    pub font_file: String,
    /// static | face | active_speaker | podcast_split.
    /// "active_speaker" detects all faces and cuts to whoever is talking (ideal for 2-person podcasts).
    /// "podcast_split" stacks Speaker 1 (top) and Speaker 2 (bottom) simultaneously.
    pub framing: String,
    /// Path to the SeetaFace model shipped in models/.
    pub face_model: String,
    /// Built-in template id: default | kick-stream | insta-short | yt-short | podcast_split | reaction-pip | ...
    pub template: String,
    /// Optional handle shown by templates that support a watermark.
    pub watermark: String,
    pub subtitle_size: u32,
    pub safe_zone_top: u32,
    pub safe_zone_bottom: u32,
    pub max_duration_secs: u32,
    pub crf: u32,
}

impl Default for RenderConfig {
    fn default() -> Self {
        Self {
            width: 1080,
            height: 1920,
            fps: 30,
            encoder: "auto".into(),
            burn_captions: true,
            caption_style: "karaoke".into(),
            subtitle_font: "Inter".into(),
            font_file: String::new(),
            framing: "active_speaker".into(),
            face_model: "models/seeta_fd_frontal_v1.0.bin".into(),
            template: "default".into(),
            watermark: String::new(),
            subtitle_size: 64,
            safe_zone_top: 180,
            safe_zone_bottom: 320,
            max_duration_secs: 60,
            crf: 16,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AiConfig {
    /// ollama | openrouter | openai | none
    pub backend: String,
    pub ollama_url: String,
    pub ollama_model: String,
    pub openrouter_url: String,
    pub openrouter_model: String,
    /// Name of the environment variable holding the API key, never the key itself.
    pub api_key_env: String,
    /// Empty means resolve whisper.cpp / imageio-whisper from PATH.
    pub whisper_binary: String,
    pub whisper_model: String,
    pub temperature: f64,
    pub max_tokens: u32,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            backend: "ollama".into(),
            ollama_url: "http://127.0.0.1:11434".into(),
            ollama_model: "gemma3:4b".into(),
            openrouter_url: "https://openrouter.ai/api/v1/chat/completions".into(),
            openrouter_model: "google/gemma-3-27b-it:free".into(),
            api_key_env: "OPENROUTER_API_KEY".into(),
            whisper_binary: String::new(),
            whisper_model: "large-v3-turbo".into(),
            temperature: 0.3,
            max_tokens: 512,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PublishingConfig {
    /// If false, clips wait for explicit approval in the editor.
    pub auto_approve: bool,
    pub publish_on_ready: bool,
    /// Seconds between two publishes, to avoid platform rate limits.
    pub spacing_secs: u32,
    pub targets: Vec<PlatformTarget>,
    pub woopsocial_base_url: String,
    pub uploadpost_base_url: String,
    pub postiz_base_url: String,
}

impl Default for PublishingConfig {
    fn default() -> Self {
        Self {
            auto_approve: false,
            publish_on_ready: true,
            spacing_secs: 300,
            targets: vec![PlatformTarget::youtube(), PlatformTarget::tiktok(), PlatformTarget::instagram()],
            woopsocial_base_url: "https://api.woopsocial.com/v1".into(),
            uploadpost_base_url: "https://api.upload-post.com/api".into(),
            postiz_base_url: "http://127.0.0.1:3000".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct PlatformTarget {
    /// youtube_shorts | instagram_reels | tiktok | x | facebook | linkedin | threads | pinterest | bluesky
    pub id: String,
    /// aggregator | postiz | direct
    pub via: String,
    /// Name of the env var holding this account's token.
    pub token_env: String,
    pub enabled: bool,
}

impl PlatformTarget {
    pub fn new(id: &str, via: &str, token_env: &str) -> Self {
        Self { id: id.into(), via: via.into(), token_env: token_env.into(), enabled: true }
    }
    pub fn youtube() -> Self { Self::new("youtube_shorts", "aggregator", "PULSECUT_WOOPSOCIAL_TOKEN") }
    pub fn tiktok() -> Self { Self::new("tiktok", "aggregator", "PULSECUT_WOOPSOCIAL_TOKEN") }
    pub fn instagram() -> Self { Self::new("instagram_reels", "aggregator", "PULSECUT_WOOPSOCIAL_TOKEN") }
}
