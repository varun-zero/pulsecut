//! Kick chat adapter.
//!
//! Kick exposes live chat over Pusher WebSockets with an app key that is not
//! part of a stable public API. Rather than hard-code someone else's key (and
//! break the moment it rotates), PulseCut expects a tiny local bridge that
//! subscribes to the channel and exposes newline-delimited JSON over HTTP:
//!
//!   {"username":"alice","content":"POG","emotes":["Kappa"],"ts_ms":1764354000000,"is_mod":false}
//!
//! A 30-line Node/Python bridge using the public Pusher client is enough. This
//! keeps the Rust core free of a websocket dependency and makes the bridge
//! replaceable. The URL is configured via `PULSECUT_KICK_CHAT_RELAY`.

use crate::{ChatSource, now_ms};
use pulsecut_core::error::{PulseError, Result};
use pulsecut_core::model::{ChatMessage, Platform};
use reqwest::Client;
use serde_json::Value;

pub struct KickChat {
    channel: String,
    relay_url: String,
    client: Client,
    cursor: usize,
}

impl KickChat {
    pub fn new(channel: &str, relay_url: &str) -> Self {
        Self { channel: channel.to_string(), relay_url: relay_url.to_string(), client: Client::new(), cursor: 0 }
    }

    /// Parse one NDJSON frame. Public for tests and bridge debugging.
    pub fn parse_frame(&self, line: &str) -> Option<ChatMessage> {
        let v: Value = serde_json::from_str(line).ok()?;
        let text = v["content"].as_str()?;
        let author = v["username"].as_str().unwrap_or("unknown").to_string();
        let emotes = v["emotes"]
            .as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        Some(ChatMessage {
            id: format!("kick-{author}-{}", now_ms()),
            platform: Platform::Kick,
            channel: self.channel.clone(),
            author,
            text: text.to_string(),
            ts_ms: v["ts_ms"].as_i64().unwrap_or_else(now_ms),
            emotes,
            is_mod: v["is_mod"].as_bool().unwrap_or(false),
            is_subscriber: v["is_subscriber"].as_bool().unwrap_or(false),
        })
    }
}

impl ChatSource for KickChat {
    fn platform(&self) -> Platform { Platform::Kick }
    fn channel(&self) -> &str { &self.channel }

    async fn next_messages(&mut self) -> Result<Vec<ChatMessage>> {
        let text = self
            .client
            .get(&self.relay_url)
            .send()
            .await
            .map_err(|e| PulseError::Chat(format!("kick chat relay unreachable: {e}")))?
            .text()
            .await
            .map_err(|e| PulseError::Chat(e.to_string()))?;
        let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
        // The bridge keeps only a bounded tail; reset the cursor when it wraps.
        if self.cursor > lines.len() {
            self.cursor = 0;
        }
        let fresh = &lines[self.cursor..];
        self.cursor = lines.len();
        Ok(fresh.iter().filter_map(|l| self.parse_frame(l)).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bridge_frame() {
        let c = KickChat::new("chan", "http://127.0.0.1:8765/chat");
        let m = c
            .parse_frame(r#"{"username":"alice","content":"POG","emotes":["Kappa"],"ts_ms":123,"is_mod":true}"#)
            .unwrap();
        assert_eq!(m.platform, Platform::Kick);
        assert_eq!(m.emotes, vec!["Kappa"]);
        assert!(m.is_mod);
    }
}
