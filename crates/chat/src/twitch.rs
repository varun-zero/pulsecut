//! Twitch chat over the public IRC interface.
//!
//! Read-only anonymous connections need no token: `justinfan######` + JOIN.
//! Moderator/subscriber badges still arrive via IRCv3 tags, which is all the
//! detector needs. Uses bounded non-blocking drain timeouts so quiet streams
//! never stall the capture/audio loop and hype bursts drain in full.

use crate::{now_ms, parse_twitch_privmsg, ChatSource};
use pulsecut_core::error::{PulseError, Result};
use pulsecut_core::model::{ChatMessage, Platform};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;

pub struct TwitchChat {
    channel: String,
    reader: BufReader<tokio::net::tcp::OwnedReadHalf>,
    writer: tokio::net::tcp::OwnedWriteHalf,
    line_buf: String,
}

impl TwitchChat {
    pub async fn connect(channel: &str) -> Result<Self> {
        let normalized = channel.trim().trim_start_matches('#').to_lowercase();
        let stream = TcpStream::connect("irc.chat.twitch.tv:6667")
            .await
            .map_err(|e| PulseError::Chat(format!("twitch IRC connect failed: {e}")))?;
        let (read_half, mut write_half) = stream.into_split();
        write_half
            .write_all(b"CAP REQ :twitch.tv/tags twitch.tv/commands\r\n")
            .await
            .map_err(|e| PulseError::Chat(e.to_string()))?;
        write_half
            .write_all(b"PASS anonymous\r\n")
            .await
            .map_err(|e| PulseError::Chat(e.to_string()))?;
        write_half
            .write_all(format!("NICK justinfan{}\r\n", now_ms().rem_euclid(100_000)).as_bytes())
            .await
            .map_err(|e| PulseError::Chat(e.to_string()))?;
        write_half
            .write_all(format!("JOIN #{normalized}\r\n").as_bytes())
            .await
            .map_err(|e| PulseError::Chat(e.to_string()))?;
        Ok(Self {
            channel: normalized,
            reader: BufReader::new(read_half),
            writer: write_half,
            line_buf: String::new(),
        })
    }

    async fn reply_pong(&mut self, payload: &str) {
        let token = payload.split_whitespace().last().unwrap_or("").trim_end_matches('\r');
        let _ = self.writer.write_all(format!("PONG :{token}\r\n").as_bytes()).await;
    }
}

impl ChatSource for TwitchChat {
    fn platform(&self) -> Platform { Platform::Twitch }
    fn channel(&self) -> &str { &self.channel }

    async fn next_messages(&mut self) -> Result<Vec<ChatMessage>> {
        let mut out = Vec::new();
        // Drain up to 100 buffered IRC lines without stalling the outer watch loop on quiet streams.
        for _ in 0..100 {
            self.line_buf.clear();
            let timeout_ms = if out.is_empty() { 80 } else { 15 };
            let read_res = tokio::time::timeout(
                Duration::from_millis(timeout_ms),
                self.reader.read_line(&mut self.line_buf),
            )
            .await;

            let n = match read_res {
                Ok(Ok(n)) => n,
                Ok(Err(e)) => return Err(PulseError::Chat(e.to_string())),
                Err(_) => break, // No more lines immediately available this tick
            };
            if n == 0 {
                return Err(PulseError::Chat("twitch IRC connection closed".into()));
            }
            if self.line_buf.starts_with("PING") {
                let ping = self.line_buf.clone();
                self.reply_pong(&ping).await;
                continue;
            }
            if let Some(m) = parse_twitch_privmsg(&self.line_buf, &self.channel) {
                out.push(m);
            }
        }
        Ok(out)
    }
}
