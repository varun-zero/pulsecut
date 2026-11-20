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
    /// Extracts the 11-character YouTube video ID from a full URL (`watch?v=`, `/live/`,
    /// `/shorts/`, `youtu.be/`) or returns the trimmed ID if already bare.
    pub fn extract_video_id(input: &str) -> String {
        let trimmed = input.trim();
        if let Some(pos) = trimmed.find("v=") {
            let rest = &trimmed[pos + 2..];
            let id = rest.split(['&', '#', '/']).next().unwrap_or("");
            if !id.is_empty() {
                return id.to_string();
            }
        }
        for marker in ["/live/", "/shorts/", "youtu.be/"] {
            if let Some(pos) = trimmed.find(marker) {
                let rest = &trimmed[pos + marker.len()..];
                let id = rest.split(['?', '&', '#', '/']).next().unwrap_or("");
                if !id.is_empty() {
                    return id.to_string();
                }
            }
        }
        trimmed.to_string()
    }

    pub async fn from_video(channel: &str, video_id_or_url: &str, api_key: &str) -> Result<Self> {
        let video_id = Self::extract_video_id(video_id_or_url);
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
        if let Some(err) = body["error"]["message"].as_str() {
            return Err(PulseError::Chat(format!("youtube videos.list API error: {err}")));
        }
        let id = body["items"][0]["liveStreamingDetails"]["activeLiveChatId"]
            .as_str()
            .ok_or_else(|| PulseError::Chat(format!("video '{video_id}' has no active live chat")))?
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

/// Zero-API-key YouTube Live Chat connector using YouTube's public Innertube
/// `get_live_chat` continuation endpoint. Works on any public `/live/<id>` or
/// `/watch?v=<id>` broadcast without requiring a Google Cloud API key.
pub struct YouTubeInnertubeChat {
    channel: String,
    video_id: String,
    api_key: String,
    continuation: Option<String>,
    viewer_count: Option<u64>,
    client: Client,
    min_interval_ms: u64,
    last_poll_ms: i64,
    seen_initial: bool,
}

impl YouTubeInnertubeChat {
    pub async fn connect(channel_hint: &str, video_id_or_url: &str) -> Result<Self> {
        let video_id = YouTubeChat::extract_video_id(video_id_or_url);
        if video_id.is_empty() {
            return Err(PulseError::Chat("invalid YouTube video ID or URL".into()));
        }
        let client = Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36")
            .build()
            .map_err(|e| PulseError::Chat(format!("http client init failed: {e}")))?;

        let watch_url = format!("https://www.youtube.com/watch?v={video_id}");
        let html = client
            .get(&watch_url)
            .header("Accept-Language", "en-US,en;q=0.9")
            .send()
            .await
            .map_err(|e| PulseError::Chat(format!("youtube watch page fetch failed: {e}")))?
            .text()
            .await
            .map_err(|e| PulseError::Chat(e.to_string()))?;

        let api_key = extract_json_string_field(&html, "INNERTUBE_API_KEY")
            .ok_or_else(|| PulseError::Chat("could not find YouTube INNERTUBE_API_KEY on watch page".into()))?;

        let continuation = extract_live_chat_continuation(&html).ok_or_else(|| {
            PulseError::Chat(format!(
                "YouTube video '{video_id}' does not appear to have an active live chat"
            ))
        })?;

        let viewer_count = extract_json_string_field(&html, "concurrentViewers")
            .and_then(|s| s.parse::<u64>().ok());

        let resolved_channel = extract_json_string_field(&html, "ownerChannelName")
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| {
                if channel_hint.trim().is_empty() {
                    video_id.clone()
                } else {
                    channel_hint.to_string()
                }
            });

        Ok(Self {
            channel: resolved_channel,
            video_id,
            api_key,
            continuation: Some(continuation),
            viewer_count,
            client,
            min_interval_ms: 1500,
            last_poll_ms: 0,
            seen_initial: false,
        })
    }

    pub fn viewer_count(&self) -> Option<u64> {
        self.viewer_count
    }

    pub fn video_id(&self) -> &str {
        &self.video_id
    }

    /// Parse an Innertube `get_live_chat` JSON response. Public for offline tests.
    pub fn parse_innertube_response(&mut self, body: &Value) -> Vec<ChatMessage> {
        let cont = &body["continuationContents"]["liveChatContinuation"];
        // Advance continuation token & poll cadence
        if let Some(conts) = cont["continuations"].as_array() {
            for item in conts {
                for key in [
                    "invalidationContinuationData",
                    "timedContinuationData",
                    "reloadContinuationData",
                ] {
                    if let Some(obj) = item.get(key) {
                        if let Some(tok) = obj["continuation"].as_str() {
                            self.continuation = Some(tok.to_string());
                        }
                        if let Some(ms) = obj["timeoutMs"].as_u64() {
                            self.min_interval_ms = ms.clamp(800, 5000);
                        }
                        break;
                    }
                }
            }
        }

        let mut out = Vec::new();
        let Some(actions) = cont["actions"].as_array() else {
            return out;
        };

        // First page from Innertube contains historical backlog messages; skip emitting
        // them as a fake live burst and advance continuation cleanly.
        if !self.seen_initial {
            self.seen_initial = true;
            return out;
        }

        for action in actions {
            let item = &action["addChatItemAction"]["item"];
            let renderer = if item["liveChatTextMessageRenderer"].is_object() {
                &item["liveChatTextMessageRenderer"]
            } else if item["liveChatPaidMessageRenderer"].is_object() {
                &item["liveChatPaidMessageRenderer"]
            } else {
                continue;
            };

            let mut text_parts: Vec<String> = Vec::new();
            let mut emotes: Vec<String> = Vec::new();
            if let Some(runs) = renderer["message"]["runs"].as_array() {
                for run in runs {
                    if let Some(t) = run["text"].as_str() {
                        text_parts.push(t.to_string());
                    } else if let Some(emoji) = run.get("emoji") {
                        let label = emoji["shortcuts"]
                            .as_array()
                            .and_then(|a| a.first())
                            .and_then(|v| v.as_str())
                            .or_else(|| emoji["emojiId"].as_str())
                            .unwrap_or(":emoji:");
                        emotes.push(label.to_string());
                        text_parts.push(label.to_string());
                    }
                }
            }
            let text = text_parts.join("").trim().to_string();
            if text.is_empty() {
                continue;
            }

            let author = renderer["authorName"]["simpleText"]
                .as_str()
                .unwrap_or("unknown")
                .to_string();
            let id = renderer["id"]
                .as_str()
                .map(String::from)
                .unwrap_or_else(|| format!("yt-{author}-{}", now_ms()));
            let ts_ms = renderer["timestampUsec"]
                .as_str()
                .and_then(|s| s.parse::<i64>().ok())
                .map(|us| us / 1000)
                .unwrap_or_else(now_ms);

            let mut is_mod = false;
            let mut is_sub = false;
            if let Some(badges) = renderer["authorBadges"].as_array() {
                for b in badges {
                    let tip = b["liveChatAuthorBadgeRenderer"]["tooltip"]
                        .as_str()
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    if tip.contains("moderator") || tip.contains("owner") {
                        is_mod = true;
                    }
                    if tip.contains("member") {
                        is_sub = true;
                    }
                }
            }

            out.push(ChatMessage {
                id,
                platform: Platform::Youtube,
                channel: self.channel.clone(),
                author,
                text,
                ts_ms,
                emotes,
                is_mod,
                is_subscriber: is_sub,
            });
        }
        out
    }
}

fn extract_json_string_field(html: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\":\"");
    let start = html.find(&needle)? + needle.len();
    let rest = &html[start..];
    let mut out = String::new();
    let mut escaped = false;
    for ch in rest.chars() {
        if escaped {
            out.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '"' {
            return Some(out);
        }
        out.push(ch);
    }
    None
}

fn extract_live_chat_continuation(html: &str) -> Option<String> {
    // Scope search around liveChatRenderer so we don't grab a video recommendations continuation.
    let anchor = html.find("liveChatRenderer")?;
    let window = &html[anchor..(anchor + 16_000).min(html.len())];
    extract_json_string_field(window, "continuation")
}

impl ChatSource for YouTubeInnertubeChat {
    fn platform(&self) -> Platform { Platform::Youtube }
    fn channel(&self) -> &str { &self.channel }

    async fn next_messages(&mut self) -> Result<Vec<ChatMessage>> {
        let wait = self.min_interval_ms as i64 - (now_ms() - self.last_poll_ms);
        if wait > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(wait as u64)).await;
        }
        let Some(token) = self.continuation.clone() else {
            return Err(PulseError::Chat("YouTube live chat ended (no continuation token)".into()));
        };
        let url = format!(
            "https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key={}",
            self.api_key
        );
        let payload = serde_json::json!({
            "context": {
                "client": {
                    "clientName": "WEB",
                    "clientVersion": "2.20250101.00.00"
                }
            },
            "continuation": token
        });
        let body: Value = self
            .client
            .post(&url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| PulseError::Chat(format!("youtube innertube live chat failed: {e}")))?
            .json()
            .await
            .map_err(|e| PulseError::Chat(e.to_string()))?;

        self.last_poll_ms = now_ms();
        Ok(self.parse_innertube_response(&body))
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

    #[test]
    fn parses_innertube_chat_runs_and_skips_initial_backlog() {
        let mut c = YouTubeInnertubeChat {
            channel: "streamer".into(),
            video_id: "YNp4gpjgNH4".into(),
            api_key: "testkey".into(),
            continuation: Some("TOK0".into()),
            viewer_count: Some(1200),
            client: Client::new(),
            min_interval_ms: 1500,
            last_poll_ms: 0,
            seen_initial: false,
        };
        let body = serde_json::json!({
            "continuationContents": {
                "liveChatContinuation": {
                    "continuations": [{
                        "invalidationContinuationData": {
                            "continuation": "TOK1",
                            "timeoutMs": 1200
                        }
                    }],
                    "actions": [{
                        "addChatItemAction": {
                            "item": {
                                "liveChatTextMessageRenderer": {
                                    "id": "yt1",
                                    "authorName": { "simpleText": "alice" },
                                    "message": {
                                        "runs": [
                                            { "text": "NO WAY " },
                                            { "emoji": { "shortcuts": [":fire:"] } }
                                        ]
                                    },
                                    "timestampUsec": "1795003200000000"
                                }
                            }
                        }
                    }]
                }
            }
        });
        // First poll drains initial backlog without firing a fake spike
        let first = c.parse_innertube_response(&body);
        assert!(first.is_empty());
        assert_eq!(c.continuation.as_deref(), Some("TOK1"));
        assert_eq!(c.min_interval_ms, 1200);

        // Second poll emits live messages cleanly
        let second = c.parse_innertube_response(&body);
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].author, "alice");
        assert_eq!(second[0].text, "NO WAY :fire:");
        assert_eq!(second[0].emotes, vec![":fire:"]);
    }
}
