//! Multi-signal hype detector with robust baselines and cooldown/NMS.

use crate::stats::{clamp01, mad, median};
use pulsecut_core::config::DetectionConfig;
use pulsecut_core::model::{ChatMessage, ClipWindow, HypeEvent, Platform, Word};
use std::collections::{HashMap, HashSet, VecDeque};

/// One second of aggregated activity. Storing aggregates instead of raw chat
/// keeps memory flat even during a 6-figure-message raid.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SignalSample {
    pub sec: i64,
    pub messages: u32,
    pub unique_authors: u32,
    pub top_token: String,
    pub top_token_count: u32,
    pub keyword_hits: u32,
}

/// Mutable state for one channel. Public so tests and the editor can inspect it.
#[derive(Debug)]
pub struct ChannelState {
    pub channel: String,
    pub platform: Platform,
    pub samples: VecDeque<SignalSample>,
    /// Seconds currently being accumulated.
    pub sec: i64,
    pub count: u32,
    pub authors: HashSet<String>,
    pub tokens: HashMap<String, u32>,
    pub keyword_hits: u32,
    /// Smoothed per-second message rate, used as a fallback baseline.
    pub ewma: f64,
    pub last_accept_ms: i64,
    pub recent: Vec<HypeEvent>,
}

impl ChannelState {
    fn new(channel: &str, platform: Platform) -> Self {
        Self {
            channel: channel.into(),
            platform,
            samples: VecDeque::new(),
            sec: -1,
            count: 0,
            authors: HashSet::new(),
            tokens: HashMap::new(),
            keyword_hits: 0,
            ewma: 2.0,
            last_accept_ms: i64::MIN / 4,
            recent: Vec::new(),
        }
    }

    fn flush_second(&mut self) {
        if self.sec < 0 || self.count == 0 {
            self.sec = -1;
            return;
        }
        let (token, token_count) = self
            .tokens
            .iter()
            .max_by_key(|(_, n)| **n)
            .map(|(t, n)| (t.clone(), *n))
            .unwrap_or_default();
        self.samples.push_back(SignalSample {
            sec: self.sec,
            messages: self.count,
            unique_authors: self.authors.len() as u32,
            top_token: token,
            top_token_count: token_count,
            keyword_hits: self.keyword_hits,
        });
        self.count = 0;
        self.authors.clear();
        self.tokens.clear();
        self.keyword_hits = 0;
    }
}

/// The detector. One instance can watch many channels; state is isolated per
/// channel because a 1000-viewer stream and a 10-viewer stream have completely
/// different definitions of "chat going crazy".
#[derive(Debug)]
pub struct HypeDetector {
    pub cfg: DetectionConfig,
    states: HashMap<String, ChannelState>,
}

impl HypeDetector {
    pub fn new(cfg: DetectionConfig) -> Self {
        Self { cfg, states: HashMap::new() }
    }

    fn state_mut(&mut self, channel: &str, platform: Platform) -> &mut ChannelState {
        self.states
            .entry(format!("{}:{}", platform.as_str(), channel))
            .or_insert_with(|| ChannelState::new(channel, platform))
    }

    /// Feed one normalized chat message into the detector.
    pub fn ingest(&mut self, msg: &ChatMessage) {
        let sec = msg.ts_ms.div_euclid(1000);
        // Clone to avoid holding an immutable borrow of `self.cfg` across the
        // mutable borrow of `self.states` below.
        let keywords = self.cfg.hype_keywords.clone();
        let st = self.state_mut(&msg.channel, msg.platform);
        if st.sec != sec {
            st.flush_second();
            st.sec = sec;
        }
        st.count += 1;
        st.authors.insert(msg.author.clone());

        let lower = msg.text.to_ascii_lowercase();
        for kw in keywords {
            if lower.contains(kw.as_str()) {
                st.keyword_hits += 1;
            }
        }
        for word in msg.words() {
            let w = word.to_ascii_lowercase();
            if w.len() >= 3 && w.len() <= 24 {
                *st.tokens.entry(w).or_insert(0) += 1;
            }
        }
        for emote in &msg.emotes {
            let e = emote.to_ascii_lowercase();
            if !e.is_empty() {
                *st.tokens.entry(e).or_insert(0) += 1;
            }
        }
    }

    /// Evaluate all channels. Call once per second with the current audio
    /// energy (0..1) and viewer count if the platform exposes one.
    ///
    /// Returns zero or one event per channel per call, by design.
    pub fn tick(&mut self, now_ms: i64, audio_energy: f64, viewers: Option<u64>) -> Vec<HypeEvent> {
        let cfg = self.cfg.clone();
        let mut out = Vec::new();
        let channels: Vec<String> = self.states.keys().cloned().collect();

        for key in channels {
            let st = match self.states.get_mut(&key) {
                Some(s) => s,
                None => continue,
            };
            st.flush_second();

            let keep = (cfg.baseline_window_secs as usize).saturating_sub(1);
            while st.samples.len() > keep {
                st.samples.pop_front();
            }

            if st.samples.is_empty() {
                continue;
            }

            // Baseline excludes the longest evaluation window so the spike
            // cannot contaminate its own reference distribution.
            let baseline: Vec<f64> = st
                .samples
                .iter()
                .take(st.samples.len().saturating_sub(5))
                .map(|s| s.messages as f64)
                .collect();
            let (center, spread) = if baseline.len() >= 10 {
                (median(&baseline), mad(&baseline))
            } else {
                // Cold start: assume a quiet baseline derived from the noise floor.
                let guess = (cfg.min_messages as f64 / 2.0).max(2.0);
                (guess, cfg.mad_floor)
            };
            let spread = spread.max(cfg.mad_floor);

            // A one-second explosion and a five-second sustained roar are both
            // hype. Evaluate several windows and keep the strongest z-score;
            // this is far more responsive than a single fixed 5s window.
            let mut best: Option<(f64, usize, u32, u32, String, u32, u32)> = None;
            for &n in &[1usize, 2, 3, 5] {
                let window: Vec<SignalSample> = st.samples.iter().rev().take(n).cloned().collect();
                if window.len() != n {
                    continue;
                }
                let messages: u32 = window.iter().map(|s| s.messages).sum();
                let unique: u32 = window.iter().map(|s| s.unique_authors).max().unwrap_or(0);
                let (top_token, top_count) = window
                    .iter()
                    .max_by_key(|s| s.top_token_count)
                    .map(|s| (s.top_token.clone(), s.top_token_count))
                    .unwrap_or_default();
                let keyword_hits: u32 = window.iter().map(|s| s.keyword_hits).sum();
                let z = (messages as f64 / n as f64 - center) / spread;
                if best.as_ref().map_or(true, |(bz, _, _, _, _, _, _)| z > *bz) {
                    best = Some((z, n, messages, unique, top_token, top_count, keyword_hits));
                }
            }
            let (z, n, messages, unique, top_token, top_count, keyword_hits) = match best {
                Some(b) => b,
                None => continue,
            };
            st.ewma = cfg.ewma_alpha * (messages as f64 / n as f64) + (1.0 - cfg.ewma_alpha) * st.ewma;

            let unique_ratio = if messages == 0 { 0.0 } else { unique as f64 / messages as f64 };
            let emote_ratio = if messages == 0 { 0.0 } else { top_count as f64 / messages as f64 };

            // Hard gates. Without these, a single chatter spamming "POG" would
            // be treated as a viral moment.
            if messages < cfg.min_messages || z < cfg.zscore_threshold {
                continue;
            }
            if unique_ratio < cfg.min_unique_ratio {
                continue;
            }
            if now_ms - st.last_accept_ms < (cfg.cooldown_secs as i64) * 1000 {
                continue;
            }

            // Normalized signals: each is 0..1 and comparable across channels.
            let vel_n = clamp01((z - cfg.zscore_threshold) / (cfg.zscore_threshold * 2.0));
            let span = (1.0 - cfg.min_unique_ratio).max(0.01);
            let uniq_n = clamp01((unique_ratio - cfg.min_unique_ratio) / span);
            let emote_gate = clamp01(emote_ratio / 0.25);
            let repeat_gate = clamp01(
                (top_count.saturating_sub(cfg.emote_repeat_threshold) as f64)
                    / cfg.emote_repeat_threshold.max(1) as f64,
            );
            let emote_n = emote_gate * repeat_gate;
            let keyword_intensity = keyword_hits as f64 / messages.max(1) as f64;
            let kw_n = clamp01(keyword_intensity / (cfg.keyword_weight * 4.0).max(0.01));
            let audio_n = clamp01(audio_energy);

            let chat_score = 0.50 * vel_n + 0.20 * uniq_n + 0.20 * emote_n + 0.10 * kw_n;
            let score = cfg.chat_weight * chat_score + cfg.audio_weight * audio_n;
            let confidence = clamp01(0.25 + 0.75 * score);
            if confidence < cfg.confidence_threshold {
                continue;
            }

            // Non-maximum suppression on time: never two clips for one moment.
            if st.recent.iter().any(|e| (e.event_ts_ms - now_ms).abs() < (cfg.cooldown_secs as i64) * 1000) {
                continue;
            }

            let mut reasons = vec![
                format!("velocity z={z:.2} (baseline {center:.1}/s, now {:.1}/s)", messages as f64 / n as f64),
                format!("{} messages from {} unique chatters", messages, unique),
            ];
            if emote_n > 0.1 {
                reasons.push(format!("token burst '{top_token}' x{top_count}"));
            }
            if kw_n > 0.1 {
                reasons.push(format!("hype keywords {keyword_hits}"));
            }
            if viewers.is_some() {
                reasons.push(format!("viewers {:?}", viewers));
            }

            let clip = Self::snap_window(&cfg, now_ms, &[]);
            let event = HypeEvent {
                id: uuid::Uuid::new_v4().to_string(),
                channel: st.channel.clone(),
                platform: st.platform,
                event_ts_ms: now_ms,
                confidence,
                score,
                reasons,
                clip,
            };
            st.recent.push(event.clone());
            if st.recent.len() > 20 {
                st.recent.remove(0);
            }
            st.last_accept_ms = now_ms;
            out.push(event);
            tracing::info!(channel = %st.channel, confidence = %format!("{confidence:.3}"), "hype event detected");
        }
        out
    }

    /// Build the clip window for an event and snap its boundaries to natural
    /// pauses using word timestamps when the ASR service supplied them.
    ///
    /// `words` may be empty; in that case boundaries are rounded to whole
    /// seconds, which is what the ffmpeg wrapper expects for stream copy.
    pub fn snap_window(cfg: &DetectionConfig, event_ms: i64, words: &[Word]) -> ClipWindow {
        let lookback = cfg.lookback_ms as i64;
        let postroll = cfg.postroll_ms as i64;
        let rough_start = event_ms - lookback;
        let rough_end = event_ms + postroll;

        let mut start = rough_start;
        let mut end = rough_end;
        let mut reason = "fixed lookback/postroll".to_string();

        if words.len() >= 2 {
            let mut best_start: Option<(i64, i64)> = None; // (distance, boundary)
            let mut best_end: Option<(i64, i64)> = None;
            for pair in words.windows(2) {
                let gap = pair[1].start_ms - pair[0].end_ms;
                if gap < 180 {
                    continue; // not a real pause
                }
                let boundary = pair[0].end_ms + gap / 2;
                let dc = (boundary - rough_start).abs();
                if dc <= 4000 && best_start.map_or(true, |(d, _)| dc < d) {
                    best_start = Some((dc, boundary));
                }
                let de = (boundary - rough_end).abs();
                if de <= 4000 && best_end.map_or(true, |(d, _)| de < d) {
                    best_end = Some((de, boundary));
                }
            }
            if let Some((_, b)) = best_start {
                start = b;
            }
            if let Some((_, b)) = best_end {
                end = b;
            }
            reason = format!("ASR pause snapping (start {}, end {})", best_start.is_some(), best_end.is_some());
        } else {
            // Align to whole seconds so ffmpeg stream-copy can cut on keyframes.
            start = (start / 1000) * 1000;
            end = (end / 1000) * 1000;
        }

        let min = cfg.clip_min_secs as i64 * 1000;
        let max = cfg.clip_max_secs as i64 * 1000;
        if end - start < min {
            end = start + min;
            reason.push_str("; extended to minimum duration");
        }
        if end - start > max {
            start = end - max;
            reason.push_str("; clamped to maximum duration");
        }
        ClipWindow { start_ms: start, end_ms: end, snap_reason: reason }
    }

    /// Number of channels currently tracked (useful for health endpoints).
    pub fn channel_count(&self) -> usize { self.states.len() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(channel: &str, author: &str, text: &str, sec: i64) -> ChatMessage {
        ChatMessage {
            id: format!("{}-{author}-{sec}", channel),
            platform: Platform::Twitch,
            channel: channel.into(),
            author: author.into(),
            text: text.into(),
            ts_ms: sec * 1000,
            emotes: vec![],
            is_mod: false,
            is_subscriber: false,
        }
    }

    fn cfg() -> DetectionConfig {
        DetectionConfig {
            baseline_window_secs: 60,
            min_messages: 4,
            min_unique_ratio: 0.25,
            cooldown_secs: 45,
            confidence_threshold: 0.45,
            ..DetectionConfig::default()
        }
    }

    #[test]
    fn quiet_chat_does_not_fire() {
        let mut d = HypeDetector::new(cfg());
        for s in 0..30 {
            d.ingest(&msg("c", "alice", "hello", s));
        }
        let events = d.tick(30_000, 0.0, Some(50));
        assert!(events.is_empty(), "quiet chat produced a clip");
    }

    #[test]
    fn spike_with_many_chatters_fires() {
        let mut d = HypeDetector::new(cfg());
        // 20 quiet seconds, 1 message per second.
        for s in 0..20 {
            d.ingest(&msg("c", &format!("u{s}"), "nice", s));
        }
        // Hype burst: 15 different people, repeated emote and keyword.
        for i in 0..15 {
            d.ingest(&msg("c", &format!("hype{i}"), "POG POG lets go", 21));
        }
        let events = d.tick(21_500, 0.7, Some(1000));
        assert_eq!(events.len(), 1, "expected exactly one hype event");
        let e = &events[0];
        assert!(e.confidence >= 0.45);
        assert!(e.reasons.iter().any(|r| r.contains("velocity")));
        assert!(e.clip.duration_ms() >= 15_000);
        assert!(e.clip.start_ms < e.event_ts_ms);
    }

    #[test]
    fn single_user_spam_is_rejected() {
        let mut d = HypeDetector::new(cfg());
        for s in 0..20 {
            d.ingest(&msg("c", "alice", "hi", s));
        }
        for _ in 0..40 {
            d.ingest(&msg("c", "spammer", "POG POG POG", 21));
        }
        assert!(d.tick(21_500, 0.0, Some(50)).is_empty());
    }

    #[test]
    fn cooldown_suppresses_second_event() {
        let mut d = HypeDetector::new(cfg());
        for s in 0..20 {
            d.ingest(&msg("c", &format!("u{s}"), "ok", s));
        }
        for i in 0..20 {
            d.ingest(&msg("c", &format!("a{i}"), "POG hype", 21));
        }
        assert_eq!(d.tick(21_500, 0.5, None).len(), 1);
        for i in 0..20 {
            d.ingest(&msg("c", &format!("b{i}"), "POG hype", 30));
        }
        assert!(d.tick(30_500, 0.5, None).is_empty(), "cooldown failed");
    }

    #[test]
    fn snapping_respects_min_max() {
        let c = cfg();
        let w = HypeDetector::snap_window(&c, 100_000, &[]);
        assert!(w.duration_ms() >= 15_000 && w.duration_ms() <= 60_000);
    }
}
