//! YouTube Live Chat via the Data API v3 (`liveChatMessages.list`).
//!
//! Continuation tokens are the thing most implementations get wrong: you MUST
//! pass `nextPageToken` back or you will re-read the same 200 messages forever
//! and trigger a fake hype spike. We also respect `pollingIntervalMillis`.

use crate::{ChatSource, now_ms};
use pulsecut_core::error::{PulseError, Result};
use pulsecut_core::model::{ChatMessage, Platform};
use reqwest::Client;
use serde_json::Value;

pub struct YouTubeChat {
    channel: String,
    api_key: String,
    live_chat_id: String,
    page_token: Option<String>,
    client: Client,
    min_interval_ms: u64,
    last_poll_ms: i64,
}

impl YouTubeChat {
    pub async fn from_video(channel: &str, video_id: &str, api_key: &str) -> Result<Self> {
        let client = Client::new();
        let url = format!(
            "https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id={video_id}&key={api_key}"
        );
        let body: Value = client
            .get(&url)
            .send()
            .await
            .map_err(|e| PulseError::Chat(format!("youtube videos.list failed: {e}")))?
            .json()
            .await
            .map_err(|e| PulseError::Chat(e.to_string()))?;
        let id = body["items"][0]["liveStreamingDetails"]["activeLiveChatId"]
            .as_str()
            .ok_or_else(|| PulseError::Chat("video has no active live chat".into()))?
            .to_string();
        Ok(Self::new(channel, &id, api_key))
    }

    pub fn new(channel: &str, live_chat_id: &str, api_key: &str) -> Self {
        Self {
            channel: channel.to_string(),
            api_key: api_key.to_string(),
            live_chat_id: live_chat_id.to_string(),
            page_token: None,
            client: Client::new(),
            min_interval_ms: 2000,
            last_poll_ms: 0,
        }
    }

    /// Parse a `liveChatMessages.list` response. Public for offline tests.
    pub fn parse_page(&mut self, body: &Value) -> Vec<ChatMessage> {
        if let Some(interval) = body["pollingIntervalMillis"].as_u64() {
            self.min_interval_ms = interval.max(1000);
        }
        self.page_token = body["nextPageToken"].as_str().map(|s| s.to_string());
        let mut out = Vec::new();
        if let Some(items) = body["items"].as_array() {
            for item in items {
                let text = item["snippet"]["displayMessage"].as_str().unwrap_or("").to_string();
                if text.is_empty() {
                    continue;
                }
                let author = item["authorDetails"]["displayName"].as_str().unwrap_or("unknown").to_string();
                let is_mod = item["authorDetails"]["isChatModerator"].as_bool().unwrap_or(false);
                let is_sub = item["authorDetails"]["isChatMember"].as_bool().unwrap_or(false);
                let id = item["id"].as_str().unwrap_or("").to_string();
                let published = item["snippet"]["publishedAt"].as_str().and_then(parse_rfc3339).unwrap_or_else(now_ms);
                out.push(ChatMessage {
                    id,
                    platform: Platform::Youtube,
                    channel: self.channel.clone(),
                    author,
                    text,
                    ts_ms: published,
                    emotes: vec![],
                    is_mod,
                    is_subscriber: is_sub,
                });
            }
        }
        out
    }
}

fn parse_rfc3339(s: &str) -> Option<i64> {
    // RFC3339 timestamps from the API look like 2026-11-18T12:00:00.123Z.
    // Avoid pulling chrono into the hot path; parse the fixed prefix manually.
    let bytes = s.as_bytes();
    if bytes.len() < 20 {
        return None;
    }
    let num = |a: usize, b: usize| -> Option<i64> {
        std::str::from_utf8(&bytes[a..b]).ok()?.parse().ok()
    };
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (h, mi, se) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    // Days from civil date (Howard Hinnant's algorithm).
    let y2 = y - if mo <= 2 { 1 } else { 0 };
    let era = if y2 >= 0 { y2 } else { y2 - 399 } / 400;
    let yoe = y2 - era * 400;
    let mp = mo + if mo > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(days * 86_400_000 + h * 3_600_000 + mi * 60_000 + se * 1000)
}

impl ChatSource for YouTubeChat {
    fn platform(&self) -> Platform { Platform::Youtube }
    fn channel(&self) -> &str { &self.channel }

    async fn next_messages(&mut self) -> Result<Vec<ChatMessage>> {
        let wait = self.min_interval_ms as i64 - (now_ms() - self.last_poll_ms);
        if wait > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(wait as u64)).await;
        }
        let mut url = format!(
            "https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet,authorDetails&liveChatId={}&maxResults=200&key={}",
            self.live_chat_id, self.api_key
        );
        if let Some(token) = &self.page_token {
            url.push_str(&format!("&pageToken={token}"));
        }
        let body: Value = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| PulseError::Chat(format!("youtube liveChat.messages failed: {e}")))?
            .json()
            .await
            .map_err(|e| PulseError::Chat(e.to_string()))?;
        if let Some(err) = body["error"]["message"].as_str() {
            return Err(PulseError::Chat(format!("youtube API error: {err}")));
        }
        self.last_poll_ms = now_ms();
        Ok(self.parse_page(&body))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_page_and_advances_token() {
        let mut c = YouTubeChat::new("chan", "chatid", "key");
        let body: Value = serde_json::json!({
            "pollingIntervalMillis": 5000,
            "nextPageToken": "NEXT",
            "items": [{
                "id": "m1",
                "snippet": { "displayMessage": "lets go", "publishedAt": "2026-11-18T12:00:00.000Z" },
                "authorDetails": { "displayName": "bob", "isChatModerator": false, "isChatMember": true }
            }]
        });
        let msgs = c.parse_page(&body);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].author, "bob");
        assert_eq!(c.page_token.as_deref(), Some("NEXT"));
        assert_eq!(c.min_interval_ms, 5000);
        assert_eq!(msgs[0].ts_ms, 1_795_003_200_000);
    }
}
