//! Kick chat adapter.
//!
//! Kick exposes live chat over Pusher WebSockets with an app key that rotates.
//! PulseCut connects to the local `tools/kick-chat-bridge/bridge.py` HTTP NDJSON
//! endpoint via `PULSECUT_KICK_CHAT_RELAY`.
//!
//! Uses monotonic `seq` IDs (with `?since=<seq>` query support and timestamp
//! fallback) so the reader never stalls when the bridge's ring buffer wraps.

use crate::{ChatSource, now_ms};
use pulsecut_core::error::{PulseError, Result};
use pulsecut_core::model::{ChatMessage, Platform};
use reqwest::Client;
use serde_json::Value;

pub struct KickChat {
    channel: String,
    relay_url: String,
    client: Client,
    last_seq: u64,
    last_ts_ms: i64,
}

impl KickChat {
    pub fn new(channel: &str, relay_url: &str) -> Self {
        Self {
            channel: channel.to_string(),
            relay_url: relay_url.to_string(),
            client: Client::new(),
            last_seq: 0,
            last_ts_ms: 0,
        }
    }

    /// Parse one NDJSON frame and its optional monotonic sequence ID.
    pub fn parse_frame_with_seq(&self, line: &str) -> Option<(Option<u64>, ChatMessage)> {
        let v: Value = serde_json::from_str(line).ok()?;
        let text = v["content"].as_str()?;
        let author = v["username"].as_str().unwrap_or("unknown").to_string();
        let seq = v["seq"].as_u64();
        let ts_ms = v["ts_ms"].as_i64().unwrap_or_else(now_ms);
        let emotes = v["emotes"]
            .as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        let id = match seq {
            Some(s) => format!("kick-{}-{s}", self.channel),
            None => format!("kick-{author}-{ts_ms}"),
        };
        Some((
            seq,
            ChatMessage {
                id,
                platform: Platform::Kick,
                channel: self.channel.clone(),
                author,
                text: text.to_string(),
                ts_ms,
                emotes,
                is_mod: v["is_mod"].as_bool().unwrap_or(false),
                is_subscriber: v["is_subscriber"].as_bool().unwrap_or(false),
            },
        ))
    }

    /// Parse one NDJSON frame. Public for tests and bridge debugging.
    pub fn parse_frame(&self, line: &str) -> Option<ChatMessage> {
        self.parse_frame_with_seq(line).map(|(_, m)| m)
    }

    fn poll_url(&self) -> String {
        if self.last_seq == 0 {
            return self.relay_url.clone();
        }
        let sep = if self.relay_url.contains('?') { '&' } else { '?' };
        format!("{}{}since={}", self.relay_url, sep, self.last_seq)
    }
}

impl ChatSource for KickChat {
    fn platform(&self) -> Platform { Platform::Kick }
    fn channel(&self) -> &str { &self.channel }

    async fn next_messages(&mut self) -> Result<Vec<ChatMessage>> {
        let url = self.poll_url();
        let text = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| PulseError::Chat(format!("kick chat relay unreachable: {e}")))?
            .text()
            .await
            .map_err(|e| PulseError::Chat(e.to_string()))?;

        let mut fresh = Vec::new();
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            let Some((seq, msg)) = self.parse_frame_with_seq(line) else {
                continue;
            };
            if let Some(s) = seq {
                if s <= self.last_seq {
                    continue;
                }
                self.last_seq = s;
                self.last_ts_ms = self.last_ts_ms.max(msg.ts_ms);
                fresh.push(msg);
            } else if msg.ts_ms > self.last_ts_ms {
                self.last_ts_ms = msg.ts_ms;
                fresh.push(msg);
            }
        }
        Ok(fresh)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bridge_frame() {
        let c = KickChat::new("chan", "http://127.0.0.1:8765/chat");
        let (seq, m) = c
            .parse_frame_with_seq(r#"{"seq":42,"username":"alice","content":"POG","emotes":["Kappa"],"ts_ms":123,"is_mod":true}"#)
            .unwrap();
        assert_eq!(seq, Some(42));
        assert_eq!(m.platform, Platform::Kick);
        assert_eq!(m.emotes, vec!["Kappa"]);
        assert!(m.is_mod);
    }
}
