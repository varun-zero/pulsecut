//! Chat connectors. Each source normalizes platform-specific chat into
//! `ChatMessage`; the detector never sees protocol details.

pub mod kick;
pub mod twitch;
pub mod youtube;

pub use kick::KickChat;
pub use twitch::TwitchChat;
pub use youtube::YouTubeChat;

use pulsecut_core::error::Result;
use pulsecut_core::model::{ChatMessage, Platform};

/// A poll-based chat source. Async fn in trait is stable since Rust 1.75; we
/// use static dispatch only, so no `async_trait` dependency is needed.
#[allow(async_fn_in_trait)]
pub trait ChatSource: Send {
    fn platform(&self) -> Platform;
    fn channel(&self) -> &str;
    /// Return messages received since the last call. Implementations should
    /// block at most ~1-2 seconds so the supervision loop stays responsive.
    async fn next_messages(&mut self) -> Result<Vec<ChatMessage>>;
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Parse a Twitch IRC line. Kept public so it can be unit-tested without a
/// network connection.
pub fn parse_twitch_privmsg(line: &str, channel: &str) -> Option<ChatMessage> {
    let rest = line.strip_prefix('@').unwrap_or(line);
    let (tags, after_tags) = if line.starts_with('@') {
        let pos = rest.find(' ')?;
        (&rest[..pos], &rest[pos + 1..])
    } else {
        ("", rest)
    };

    let marker = format!("PRIVMSG #{channel} :");
    let idx = after_tags.find(&marker)?;
    let prefix = &after_tags[..idx];
    let text = &after_tags[idx + marker.len()..];
    let author = prefix
        .split_whitespace()
        .last()
        .and_then(|p| p.split('!').next())
        .unwrap_or("unknown")
        .trim_start_matches(':')
        .to_string();

    let mut is_mod = false;
    let mut is_sub = false;
    let mut emotes = Vec::new();
    for tag in tags.split(';') {
        if let Some(v) = tag.strip_prefix("badges=") {
            is_mod = v.split(',').any(|b| b.starts_with("moderator/") || b.starts_with("vip/"));
            is_sub = v.split(',').any(|b| b.starts_with("subscriber/") || b.starts_with("founder/"));
        }
        if let Some(v) = tag.strip_prefix("emotes=") {
            for e in v.split('/') {
                let id = e.split(':').next().unwrap_or("");
                if !id.is_empty() {
                    emotes.push(id.to_string());
                }
            }
        }
    }

    Some(ChatMessage {
        id: format!("twitch-{author}-{}-{}", text.len(), now_ms()),
        platform: Platform::Twitch,
        channel: channel.to_string(),
        author,
        text: text.trim_end().to_string(),
        ts_ms: now_ms(),
        emotes,
        is_mod,
        is_subscriber: is_sub,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_irc_privmsg_with_tags() {
        let line = "@badges=moderator/1,subscriber/3;emotes=25:0-4 :alice!alice@alice.tmi.twitch.tv PRIVMSG #streamer :POG lets go\r\n";
        let m = parse_twitch_privmsg(line, "streamer").unwrap();
        assert_eq!(m.author, "alice");
        assert_eq!(m.text, "POG lets go");
        assert!(m.is_mod);
        assert!(m.is_subscriber);
        assert_eq!(m.emotes, vec!["25"]);
    }

    #[test]
    fn ignore_other_irc_lines() {
        assert!(parse_twitch_privmsg(":twitch.tv PING :tmi.twitch.tv\r\n", "x").is_none());
    }
}
