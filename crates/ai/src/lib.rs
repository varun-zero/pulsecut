//! AI backends: local-first, cloud-optional.
//!
//! Metadata generation and transcription are separate concerns. A user with
//! no GPU can run generation through OpenRouter while still transcribing
//! locally with whisper.cpp, or vice versa. Every backend is behind a trait so
//! the pipeline can be tested with a deterministic mock.

pub mod metadata;
pub mod transcribe;

pub use metadata::{
    AiBackend, GeneratedMetadata, MockAi, Ollama, OpenRouter, ViralMomentProposal,
    build_clip_discovery_prompt, build_prompt, parse_clip_proposals, parse_json_object,
};
pub use transcribe::{
    Transcriber, WhisperCli, format_timestamped_transcript, parse_vtt_words,
    parse_youtube_json3_words, transcribe_whisper_api,
};

use pulsecut_core::config::{AiConfig, Config};
use pulsecut_core::error::{PulseError, Result};

/// Select a backend according to config. Local is always preferred; cloud is
/// used only when it is explicitly configured or the local one is unreachable.
pub fn backend_from_config(cfg: &AiConfig) -> Box<dyn AiBackend> {
    match cfg.backend.as_str() {
        "openrouter" | "openai" => Box::new(OpenRouter::new(cfg)),
        "none" => Box::new(MockAi::default()),
        _ => Box::new(Ollama::new(cfg)),
    }
}

/// Probe the configured local backend. If it is down and a cloud API key is
/// present, transparently fail over to OpenRouter.
pub fn resilient_backend(cfg: &Config) -> Box<dyn AiBackend> {
    let local = backend_from_config(&cfg.ai);
    if local.is_available() {
        return local;
    }
    if cfg.ai.backend != "openrouter" && std::env::var(&cfg.ai.api_key_env).is_ok() {
        tracing::warn!("local AI unavailable; falling back to {}", cfg.ai.backend);
        return Box::new(OpenRouter::new(&cfg.ai));
    }
    local
}

pub fn require_key(env_name: &str) -> Result<String> {
    std::env::var(env_name)
        .map_err(|_| PulseError::Ai(format!("missing API key in environment variable {env_name}")))
}
