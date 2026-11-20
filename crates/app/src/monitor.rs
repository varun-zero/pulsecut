//! Direct-link headless multi-stream chat monitor & adaptive spike detector.
//!
//! Connects directly to Kick (via multi-channel local Pusher bridge), YouTube
//! Live (zero-key Innertube or Data API v3), and Twitch (anonymous IRC) without
//! requiring any browser tab. Learns each stream's true rolling chat baseline
//! (viewer-aware + robust median/MAD), maintains a 120-second per-second rate
//! history for real live spike graphs, and dispatches lookback clips into the
//! PulseCut rendering queue when sustained hype spikes occur.

use pulsecut_chat::{ChatSource, KickChat, TwitchChat, YouTubeChat, YouTubeInnertubeChat};
use pulsecut_core::model::{ChatMessage, Platform};
use reqwest::Client;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const HISTORY_CAPACITY: usize = 120;
const MAX_SPIKE_LOG: usize = 20;
const BASELINE_SAMPLES_CAP: usize = 90;
const WARMUP_SECS: u32 = 12;
const SUSTAINED_TICKS_REQUIRED: u32 = 2;

/// Request passed back to `web.rs` when a monitor triggers an automatic or manual clip.
#[derive(Debug, Clone)]
pub struct MonitorClipRequest {
    pub monitor_id: String,
    pub url: String,
    pub playback_url: Option<String>,
    pub channel: String,
    pub platform: String,
    pub template: String,
    pub lookback_secs: u64,
    pub hype_score: f64,
    pub reasons: Vec<String>,
    pub manual: bool,
}

pub type ClipDispatcher = Arc<dyn Fn(MonitorClipRequest) -> String + Send + Sync>;

#[derive(Debug, Clone)]
pub struct RatePoint {
    pub ts_ms: i64,
    pub rate: f64,
    pub baseline: f64,
    pub z_score: f64,
    pub hype_score: u32,
    pub unique_authors: usize,
    pub triggered: bool,
}

#[derive(Debug, Clone)]
pub struct SpikeRecord {
    pub ts_ms: i64,
    pub hype_score: u32,
    pub z_score: f64,
    pub rate: f64,
    pub baseline: f64,
    pub reasons: Vec<String>,
    pub job_id: String,
    pub manual: bool,
}

#[derive(Debug, Clone)]
pub struct StartMonitorParams {
    pub url: String,
    pub template: String,
    pub lookback_secs: u64,
    pub cooldown_secs: u64,
    pub threshold: u32,
    pub auto_clip: bool,
}

#[derive(Debug, Clone)]
pub struct MonitorConfig {
    pub kick_bridge_url: String,
    pub kick_pusher_key: String,
    pub kick_pusher_cluster: String,
    pub youtube_api_key: String,
}

impl Default for MonitorConfig {
    fn default() -> Self {
        let bridge = std::env::var("PULSECUT_KICK_CHAT_RELAY")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "http://127.0.0.1:8765".to_string());
        // Strip trailing /chat if user passed legacy single-channel relay URL
        let normalized_bridge = bridge
            .trim_end_matches('/')
            .strip_suffix("/chat")
            .unwrap_or(bridge.trim_end_matches('/'))
            .to_string();
        Self {
            kick_bridge_url: normalized_bridge,
            kick_pusher_key: std::env::var("KICK_PUSHER_KEY").unwrap_or_default(),
            kick_pusher_cluster: std::env::var("KICK_PUSHER_CLUSTER")
                .ok()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "us2".to_string()),
            youtube_api_key: std::env::var("PULSECUT_YOUTUBE_KEY").unwrap_or_default(),
        }
    }
}

struct WindowMessage {
    ts_ms: i64,
    author: String,
    is_hype: bool,
    has_emote: bool,
}

struct StreamMonitorState {
    id: String,
    url: String,
    platform: Platform,
    channel: String,
    status: String,
    status_detail: String,
    viewer_count: Option<u64>,
    playback_url: Option<String>,
    template: String,
    lookback_secs: u64,
    cooldown_secs: u64,
    threshold: u32,
    auto_clip: bool,
    paused: bool,
    created_at_ms: i64,
    last_message_ms: i64,
    total_messages: u64,
    clips_triggered: u64,
    last_clip_ms: i64,
    last_clip_job_id: Option<String>,
    // Adaptive detector state
    warmup_ticks: u32,
    sustained_hot_ticks: u32,
    current_rate: f64,
    baseline_rate: f64,
    baseline_sigma: f64,
    z_score: f64,
    hype_score: u32,
    unique_authors: usize,
    baseline_samples: VecDeque<f64>,
    recent_window: VecDeque<WindowMessage>,
    history: VecDeque<RatePoint>,
    spikes: VecDeque<SpikeRecord>,
}

impl StreamMonitorState {
    fn to_json(&self) -> Value {
        let calibrated = self.warmup_ticks >= WARMUP_SECS;
        let calibration_pct = ((self.warmup_ticks as f64 / WARMUP_SECS as f64) * 100.0)
            .clamp(0.0, 100.0)
            .round() as u32;
        let history_json: Vec<Value> = self
            .history
            .iter()
            .map(|p| {
                json!({
                    "ts_ms": p.ts_ms,
                    "rate": round2(p.rate),
                    "baseline": round2(p.baseline),
                    "z_score": round2(p.z_score),
                    "hype_score": p.hype_score,
                    "unique_authors": p.unique_authors,
                    "triggered": p.triggered,
                })
            })
            .collect();
        let spikes_json: Vec<Value> = self
            .spikes
            .iter()
            .map(|s| {
                json!({
                    "ts_ms": s.ts_ms,
                    "hype_score": s.hype_score,
                    "z_score": round2(s.z_score),
                    "rate": round2(s.rate),
                    "baseline": round2(s.baseline),
                    "reasons": s.reasons,
                    "job_id": s.job_id,
                    "manual": s.manual,
                })
            })
            .collect();

        json!({
            "id": self.id,
            "url": self.url,
            "platform": self.platform.as_str(),
            "channel": self.channel,
            "status": if self.paused { "paused" } else { &self.status },
            "status_detail": self.status_detail,
            "viewer_count": self.viewer_count,
            "playback_url": self.playback_url,
            "template": self.template,
            "lookback_secs": self.lookback_secs,
            "cooldown_secs": self.cooldown_secs,
            "threshold": self.threshold,
            "auto_clip": self.auto_clip,
            "paused": self.paused,
            "calibrated": calibrated,
            "calibration_pct": calibration_pct,
            "current_rate": round2(self.current_rate),
            "baseline_rate": round2(self.baseline_rate),
            "z_score": round2(self.z_score),
            "hype_score": self.hype_score,
            "unique_authors": self.unique_authors,
            "total_messages": self.total_messages,
            "clips_triggered": self.clips_triggered,
            "last_clip_job_id": self.last_clip_job_id,
            "last_message_ms": self.last_message_ms,
            "created_at_ms": self.created_at_ms,
            "history": history_json,
            "spikes": spikes_json,
        })
    }

    fn ingest(&mut self, msg: &ChatMessage) {
        let now = now_ms();
        let ts = if msg.ts_ms > 0 && (now - msg.ts_ms).abs() < 60_000 {
            msg.ts_ms
        } else {
            now
        };
        let is_hype = is_hype_text(&msg.text);
        let has_emote = !msg.emotes.is_empty() || has_hype_emoji(&msg.text);
        self.recent_window.push_back(WindowMessage {
            ts_ms: ts,
            author: msg.author.to_ascii_lowercase(),
            is_hype,
            has_emote,
        });
        while self.recent_window.len() > 1200 {
            self.recent_window.pop_front();
        }
        self.total_messages += 1;
        self.last_message_ms = now;
    }

    /// Runs once per second: updates sliding rate, learned baseline, hype score,
    /// history ring buffer, and returns `Some(reasons)` if an auto-clip should fire.
    fn tick_one_second(&mut self, now: i64) -> Option<(u32, f64, Vec<String>)> {
        let window_ms = 6_000_i64;
        while let Some(front) = self.recent_window.front() {
            if now - front.ts_ms > window_ms {
                self.recent_window.pop_front();
            } else {
                break;
            }
        }

        let count = self.recent_window.len();
        let rate = count as f64 / (window_ms as f64 / 1000.0);

        let mut authors: HashSet<&str> = HashSet::new();
        let mut hype_hits = 0usize;
        let mut emote_hits = 0usize;
        for m in &self.recent_window {
            authors.insert(m.author.as_str());
            if m.is_hype {
                hype_hits += 1;
            }
            if m.has_emote {
                emote_hits += 1;
            }
        }
        let unique_authors = authors.len();
        let unique_ratio = if count > 0 {
            unique_authors as f64 / count as f64
        } else {
            1.0
        };
        let hype_ratio = if count > 0 {
            hype_hits as f64 / count as f64
        } else {
            0.0
        };
        let emote_ratio = if count > 0 {
            emote_hits as f64 / count as f64
        } else {
            0.0
        };

        // Compute learned robust baseline (median + MAD) blended with viewer-count prior
        let prior = viewer_prior_rate(self.viewer_count);
        let (learned_med, learned_sigma) = if self.baseline_samples.len() >= 5 {
            robust_median_mad(&self.baseline_samples)
        } else {
            (prior, (prior * 0.45).max(0.35))
        };

        let blend = (self.baseline_samples.len() as f64 / 20.0).clamp(0.0, 1.0);
        let baseline = (prior * (1.0 - blend) + learned_med * blend).max(0.25);
        let sigma = learned_sigma.max(baseline * 0.35).max(0.30);

        let z_score = if rate > baseline {
            (rate - baseline) / sigma
        } else {
            0.0
        };

        // Anti-spam gate: require multiple distinct chatters so one user spamming never triggers
        let min_authors = if self.viewer_count.unwrap_or(0) >= 2000 { 4 } else { 3 };
        let spam_dampener = if unique_authors < min_authors || unique_ratio < 0.32 {
            0.35
        } else {
            1.0
        };

        // Multi-signal hype score (0..100)
        let vel_component = ((z_score / 4.2).clamp(0.0, 1.0)) * 68.0;
        let ratio_mult = (rate / baseline).clamp(0.0, 6.0);
        let ratio_bonus = if ratio_mult >= 1.8 {
            ((ratio_mult - 1.8) / 3.2).clamp(0.0, 1.0) * 14.0
        } else {
            0.0
        };
        let keyword_component = (hype_ratio * 22.0).min(16.0);
        let emote_component = (emote_ratio * 14.0).min(10.0);
        let raw_score = (vel_component + ratio_bonus + keyword_component + emote_component) * spam_dampener;
        let hype_score = raw_score.clamp(0.0, 100.0).round() as u32;

        // Update spike-resistant baseline only during non-spike periods (or during warm-up)
        self.warmup_ticks = self.warmup_ticks.saturating_add(1);
        let is_spiking = z_score >= 2.2 && hype_score >= self.threshold;
        if !is_spiking || self.warmup_ticks <= WARMUP_SECS {
            self.baseline_samples.push_back(rate);
            while self.baseline_samples.len() > BASELINE_SAMPLES_CAP {
                self.baseline_samples.pop_front();
            }
        }

        self.current_rate = rate;
        self.baseline_rate = baseline;
        self.baseline_sigma = sigma;
        self.z_score = z_score;
        self.hype_score = hype_score;
        self.unique_authors = unique_authors;

        let calibrated = self.warmup_ticks >= WARMUP_SECS;
        if hype_score >= self.threshold && unique_authors >= min_authors {
            self.sustained_hot_ticks = self.sustained_hot_ticks.saturating_add(1);
        } else {
            self.sustained_hot_ticks = 0;
        }

        let cooldown_ok = now - self.last_clip_ms >= (self.cooldown_secs as i64) * 1000;
        let should_fire = !self.paused
            && self.auto_clip
            && calibrated
            && cooldown_ok
            && self.sustained_hot_ticks >= SUSTAINED_TICKS_REQUIRED
            && hype_score >= self.threshold
            && z_score >= 1.8;

        if self.status != "error" && self.status != "connecting" {
            self.status = if should_fire || hype_score >= self.threshold {
                "spike".to_string()
            } else if calibrated {
                "watching".to_string()
            } else {
                "calibrating".to_string()
            };
        }

        self.history.push_back(RatePoint {
            ts_ms: now,
            rate,
            baseline,
            z_score,
            hype_score,
            unique_authors,
            triggered: should_fire,
        });
        while self.history.len() > HISTORY_CAPACITY {
            self.history.pop_front();
        }

        if should_fire {
            self.last_clip_ms = now;
            self.sustained_hot_ticks = 0;
            let mut reasons = vec![
                format!("{:.1}x baseline ({:.1} vs {:.1} msg/s)", ratio_mult, rate, baseline),
                format!("z={:.1} · {} chatters", z_score, unique_authors),
            ];
            if hype_hits > 0 {
                reasons.push(format!("{} hype msgs", hype_hits));
            }
            if emote_hits > 0 {
                reasons.push(format!("{} emote bursts", emote_hits));
            }
            return Some((hype_score, z_score, reasons));
        }

        None
    }
}

struct MonitorHandle {
    state: Arc<Mutex<StreamMonitorState>>,
    cancelled: Arc<AtomicBool>,
}

pub struct MonitorManager {
    monitors: Mutex<HashMap<String, MonitorHandle>>,
    config: Mutex<MonitorConfig>,
    dispatcher: ClipDispatcher,
}

impl MonitorManager {
    pub fn new(dispatcher: ClipDispatcher) -> Arc<Self> {
        Arc::new(Self {
            monitors: Mutex::new(HashMap::new()),
            config: Mutex::new(MonitorConfig::default()),
            dispatcher,
        })
    }

    pub fn config_snapshot(&self) -> Value {
        let cfg = self.config.lock().unwrap();
        let key_preview = if cfg.kick_pusher_key.len() >= 10 {
            format!(
                "{}...{}",
                &cfg.kick_pusher_key[..4],
                &cfg.kick_pusher_key[cfg.kick_pusher_key.len() - 4..]
            )
        } else if !cfg.kick_pusher_key.is_empty() {
            "set".to_string()
        } else {
            String::new()
        };
        json!({
            "kick_bridge_url": cfg.kick_bridge_url,
            "kick_pusher_key_set": !cfg.kick_pusher_key.is_empty(),
            "kick_pusher_key_preview": key_preview,
            "kick_pusher_cluster": cfg.kick_pusher_cluster,
            "youtube_api_key_set": !cfg.youtube_api_key.is_empty(),
        })
    }

    pub async fn update_config(
        &self,
        kick_pusher_key: Option<String>,
        kick_pusher_cluster: Option<String>,
        kick_bridge_url: Option<String>,
        youtube_api_key: Option<String>,
    ) -> Value {
        let (bridge_url, key_to_push, cluster_to_push) = {
            let mut cfg = self.config.lock().unwrap();
            if let Some(k) = kick_pusher_key {
                cfg.kick_pusher_key = k.trim().to_string();
            }
            if let Some(c) = kick_pusher_cluster {
                let cleaned = c.trim().to_string();
                if !cleaned.is_empty() {
                    cfg.kick_pusher_cluster = cleaned;
                }
            }
            if let Some(b) = kick_bridge_url {
                let cleaned = b.trim().trim_end_matches('/').to_string();
                if !cleaned.is_empty() {
                    cfg.kick_bridge_url = cleaned
                        .strip_suffix("/chat")
                        .unwrap_or(&cleaned)
                        .to_string();
                }
            }
            if let Some(yt) = youtube_api_key {
                cfg.youtube_api_key = yt.trim().to_string();
            }
            (
                cfg.kick_bridge_url.clone(),
                cfg.kick_pusher_key.clone(),
                cfg.kick_pusher_cluster.clone(),
            )
        };

        // Forward Pusher key/cluster hot-update to running Kick bridge if reachable
        let bridge_sync = if !bridge_url.is_empty() {
            let client = Client::builder()
                .timeout(Duration::from_secs(4))
                .build()
                .ok();
            if let Some(c) = client {
                let res = c
                    .post(format!("{bridge_url}/config"))
                    .json(&json!({
                        "pusher_key": key_to_push,
                        "cluster": cluster_to_push,
                    }))
                    .send()
                    .await;
                match res {
                    Ok(resp) if resp.status().is_success() => resp.json::<Value>().await.ok(),
                    _ => None,
                }
            } else {
                None
            }
        } else {
            None
        };

        json!({
            "ok": true,
            "config": self.config_snapshot(),
            "bridge_synced": bridge_sync.is_some(),
            "bridge_status": bridge_sync,
        })
    }

    pub fn list_json(&self) -> Value {
        let handles: Vec<Arc<Mutex<StreamMonitorState>>> = {
            let map = self.monitors.lock().unwrap();
            map.values().map(|h| Arc::clone(&h.state)).collect()
        };
        let mut items: Vec<(i64, Value)> = handles
            .into_iter()
            .map(|st| {
                let guard = st.lock().unwrap();
                (guard.created_at_ms, guard.to_json())
            })
            .collect();
        items.sort_by_key(|(ts, _)| *ts);
        let monitors: Vec<Value> = items.into_iter().map(|(_, v)| v).collect();
        json!({
            "ok": true,
            "count": monitors.len(),
            "config": self.config_snapshot(),
            "monitors": monitors,
        })
    }

    pub fn start_monitor(self: &Arc<Self>, params: StartMonitorParams) -> Result<Value, String> {
        let (platform, channel, normalized_url) = parse_stream_target(&params.url)?;

        // Check if this exact platform + channel is already being monitored
        {
            let map = self.monitors.lock().unwrap();
            for handle in map.values() {
                let mut st = handle.state.lock().unwrap();
                if st.platform == platform && st.channel.eq_ignore_ascii_case(&channel) {
                    st.lookback_secs = params.lookback_secs.clamp(10, 120);
                    st.cooldown_secs = params.cooldown_secs.clamp(15, 300);
                    st.threshold = params.threshold.clamp(25, 95);
                    st.auto_clip = params.auto_clip;
                    st.template = params.template.clone();
                    st.paused = false;
                    return Ok(st.to_json());
                }
            }
        }

        let id = format!("mon-{}", &Uuid::new_v4().to_string()[..8]);
        let now = now_ms();
        let state = Arc::new(Mutex::new(StreamMonitorState {
            id: id.clone(),
            url: normalized_url.clone(),
            platform,
            channel: channel.clone(),
            status: "connecting".to_string(),
            status_detail: format!("Connecting directly to {} chat…", platform.as_str()),
            viewer_count: None,
            playback_url: None,
            template: if params.template.trim().is_empty() {
                "default".to_string()
            } else {
                params.template
            },
            lookback_secs: params.lookback_secs.clamp(10, 120),
            cooldown_secs: params.cooldown_secs.clamp(15, 300),
            threshold: params.threshold.clamp(25, 95),
            auto_clip: params.auto_clip,
            paused: false,
            created_at_ms: now,
            last_message_ms: 0,
            total_messages: 0,
            clips_triggered: 0,
            last_clip_ms: 0,
            last_clip_job_id: None,
            warmup_ticks: 0,
            sustained_hot_ticks: 0,
            current_rate: 0.0,
            baseline_rate: 0.8,
            baseline_sigma: 0.4,
            z_score: 0.0,
            hype_score: 0,
            unique_authors: 0,
            baseline_samples: VecDeque::with_capacity(BASELINE_SAMPLES_CAP),
            recent_window: VecDeque::with_capacity(256),
            history: VecDeque::with_capacity(HISTORY_CAPACITY),
            spikes: VecDeque::with_capacity(MAX_SPIKE_LOG),
        }));

        let cancelled = Arc::new(AtomicBool::new(false));
        let snapshot = state.lock().unwrap().to_json();

        {
            let mut map = self.monitors.lock().unwrap();
            map.insert(
                id.clone(),
                MonitorHandle {
                    state: Arc::clone(&state),
                    cancelled: Arc::clone(&cancelled),
                },
            );
        }

        let manager = Arc::clone(self);
        let state_for_task = Arc::clone(&state);
        let cancel_for_task = Arc::clone(&cancelled);
        tokio::spawn(async move {
            run_monitor_loop(manager, state_for_task, cancel_for_task).await;
        });

        Ok(snapshot)
    }

    pub fn set_paused(&self, id: &str, paused: bool) -> Option<Value> {
        let map = self.monitors.lock().unwrap();
        let handle = map.get(id)?;
        let mut st = handle.state.lock().unwrap();
        st.paused = paused;
        Some(st.to_json())
    }

    pub fn set_auto_clip(&self, id: &str, auto_clip: bool) -> Option<Value> {
        let map = self.monitors.lock().unwrap();
        let handle = map.get(id)?;
        let mut st = handle.state.lock().unwrap();
        st.auto_clip = auto_clip;
        Some(st.to_json())
    }

    pub fn trigger_manual_clip(&self, id: &str, lookback_override: Option<u64>) -> Option<Value> {
        let req = {
            let map = self.monitors.lock().unwrap();
            let handle = map.get(id)?;
            let st = handle.state.lock().unwrap();
            MonitorClipRequest {
                monitor_id: st.id.clone(),
                url: st.url.clone(),
                playback_url: st.playback_url.clone(),
                channel: st.channel.clone(),
                platform: st.platform.as_str().to_string(),
                template: st.template.clone(),
                lookback_secs: lookback_override.unwrap_or(st.lookback_secs).clamp(10, 120),
                hype_score: (st.hype_score as f64 / 100.0).max(0.95),
                reasons: vec!["Manual direct-monitor clip".to_string()],
                manual: true,
            }
        };

        let job_id = (self.dispatcher)(req.clone());
        let map = self.monitors.lock().unwrap();
        if let Some(handle) = map.get(id) {
            let mut st = handle.state.lock().unwrap();
            let now = now_ms();
            // Snapshot these before mutably borrowing st.spikes below.
            let hype_score = st.hype_score;
            let z_score = st.z_score;
            let current_rate = st.current_rate;
            let baseline_rate = st.baseline_rate;
            st.clips_triggered += 1;
            st.last_clip_job_id = Some(job_id.clone());
            st.spikes.push_front(SpikeRecord {
                ts_ms: now,
                hype_score: hype_score.max(100),
                z_score,
                rate: current_rate,
                baseline: baseline_rate,
                reasons: req.reasons,
                job_id: job_id.clone(),
                manual: true,
            });
            while st.spikes.len() > MAX_SPIKE_LOG {
                st.spikes.pop_back();
            }
            if let Some(last_pt) = st.history.back_mut() {
                last_pt.triggered = true;
            }
            return Some(json!({
                "ok": true,
                "job_id": job_id,
                "monitor": st.to_json(),
            }));
        }
        None
    }

    pub fn stop_monitor(&self, id: &str) -> bool {
        let removed = {
            let mut map = self.monitors.lock().unwrap();
            map.remove(id)
        };
        if let Some(handle) = removed {
            handle.cancelled.store(true, Ordering::Relaxed);
            true
        } else {
            false
        }
    }
}

enum LiveChatClient {
    Kick(KickChat),
    Twitch(TwitchChat),
    YouTubeInnertube(YouTubeInnertubeChat),
    YouTubeApi(YouTubeChat),
}

impl LiveChatClient {
    async fn next_messages(&mut self) -> pulsecut_core::error::Result<Vec<ChatMessage>> {
        match self {
            LiveChatClient::Kick(c) => c.next_messages().await,
            LiveChatClient::Twitch(c) => c.next_messages().await,
            LiveChatClient::YouTubeInnertube(c) => c.next_messages().await,
            LiveChatClient::YouTubeApi(c) => c.next_messages().await,
        }
    }
}

async fn run_monitor_loop(
    manager: Arc<MonitorManager>,
    state: Arc<Mutex<StreamMonitorState>>,
    cancelled: Arc<AtomicBool>,
) {
    let (platform, channel, url) = {
        let st = state.lock().unwrap();
        (st.platform, st.channel.clone(), st.url.clone())
    };
    let http = Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .unwrap_or_else(|_| Client::new());

    let mut client_opt: Option<LiveChatClient> = None;
    let mut tick_interval = tokio::time::interval(Duration::from_secs(1));
    let mut meta_tick_counter: u32 = 0;

    while !cancelled.load(Ordering::Relaxed) {
        // Connect or reconnect chat source if not yet connected
        if client_opt.is_none() {
            let cfg = manager.config.lock().unwrap().clone();
            match connect_chat_source(&http, platform, &channel, &url, &cfg).await {
                Ok((client, viewer_count, playback_url, detail)) => {
                    {
                        let mut st = state.lock().unwrap();
                        if let Some(v) = viewer_count {
                            st.viewer_count = Some(v);
                        }
                        if let Some(pb) = playback_url {
                            st.playback_url = Some(pb);
                        }
                        st.status = if st.warmup_ticks >= WARMUP_SECS {
                            "watching".to_string()
                        } else {
                            "calibrating".to_string()
                        };
                        st.status_detail = detail;
                    }
                    client_opt = Some(client);
                }
                Err(err_msg) => {
                    {
                        let mut st = state.lock().unwrap();
                        st.status = "error".to_string();
                        st.status_detail = err_msg;
                    }
                    // Wait 5 seconds (checking cancellation every 500ms) before retrying
                    for _ in 0..10 {
                        if cancelled.load(Ordering::Relaxed) {
                            return;
                        }
                        tokio::time::sleep(Duration::from_millis(500)).await;
                    }
                    continue;
                }
            }
        }

        tokio::select! {
            _ = tick_interval.tick() => {
                if cancelled.load(Ordering::Relaxed) {
                    break;
                }
                meta_tick_counter = meta_tick_counter.wrapping_add(1);

                // Refresh Kick bridge status + viewer count + playback_url every 20s
                if platform == Platform::Kick && meta_tick_counter % 20 == 0 {
                    let bridge_url = manager.config.lock().unwrap().kick_bridge_url.clone();
                    if let Some((vc, pb, err_opt)) = fetch_kick_bridge_meta(&http, &bridge_url, &channel).await {
                        let mut st = state.lock().unwrap();
                        if let Some(v) = vc { st.viewer_count = Some(v); }
                        if let Some(p) = pb { st.playback_url = Some(p); }
                        if let Some(err) = err_opt {
                            st.status = "error".to_string();
                            st.status_detail = err;
                        } else if st.status == "error" {
                            st.status = if st.warmup_ticks >= WARMUP_SECS {
                                "watching".to_string()
                            } else {
                                "calibrating".to_string()
                            };
                            st.status_detail = "connected to kick chat bridge".to_string();
                        }
                    }
                }

                let trigger_opt = {
                    let mut st = state.lock().unwrap();
                    let now = now_ms();
                    st.tick_one_second(now).map(|(score, z, reasons)| {
                        (
                            MonitorClipRequest {
                                monitor_id: st.id.clone(),
                                url: st.url.clone(),
                                playback_url: st.playback_url.clone(),
                                channel: st.channel.clone(),
                                platform: st.platform.as_str().to_string(),
                                template: st.template.clone(),
                                lookback_secs: st.lookback_secs,
                                hype_score: score as f64 / 100.0,
                                reasons: reasons.clone(),
                                manual: false,
                            },
                            score,
                            z,
                            st.current_rate,
                            st.baseline_rate,
                            reasons,
                            now,
                        )
                    })
                };

                if let Some((req, score, z, rate, baseline, reasons, now)) = trigger_opt {
                    let job_id = (manager.dispatcher)(req);
                    let mut st = state.lock().unwrap();
                    st.clips_triggered += 1;
                    st.last_clip_job_id = Some(job_id.clone());
                    st.spikes.push_front(SpikeRecord {
                        ts_ms: now,
                        hype_score: score,
                        z_score: z,
                        rate,
                        baseline,
                        reasons,
                        job_id,
                        manual: false,
                    });
                    while st.spikes.len() > MAX_SPIKE_LOG {
                        st.spikes.pop_back();
                    }
                }
            }
            res = async {
                if let Some(c) = client_opt.as_mut() {
                    c.next_messages().await
                } else {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    Ok(Vec::new())
                }
            } => {
                match res {
                    Ok(msgs) => {
                        if !msgs.is_empty() {
                            let mut st = state.lock().unwrap();
                            for m in &msgs {
                                st.ingest(m);
                            }
                        }
                        // Poll cadence throttle for HTTP-polled Kick bridge
                        if matches!(client_opt, Some(LiveChatClient::Kick(_))) {
                            tokio::time::sleep(Duration::from_millis(650)).await;
                        }
                    }
                    Err(e) => {
                        tracing::warn!("monitor {channel} chat error: {e}");
                        {
                            let mut st = state.lock().unwrap();
                            st.status = "error".to_string();
                            st.status_detail = format!("Chat feed interrupted: {e} (reconnecting…)");
                        }
                        client_opt = None;
                        tokio::time::sleep(Duration::from_secs(3)).await;
                    }
                }
            }
        }
    }
}

async fn connect_chat_source(
    http: &Client,
    platform: Platform,
    channel: &str,
    url: &str,
    cfg: &MonitorConfig,
) -> Result<(LiveChatClient, Option<u64>, Option<String>, String), String> {
    match platform {
        Platform::Twitch => {
            let client = TwitchChat::connect(channel)
                .await
                .map_err(|e| format!("Twitch IRC connect failed: {e}"))?;
            Ok((
                LiveChatClient::Twitch(client),
                None,
                None,
                format!("Connected directly to Twitch IRC #{channel}"),
            ))
        }
        Platform::Youtube => {
            match YouTubeInnertubeChat::connect(channel, url).await {
                Ok(yt) => {
                    let vc = yt.viewer_count();
                    let ch = yt.channel().to_string();
                    Ok((
                        LiveChatClient::YouTubeInnertube(yt),
                        vc,
                        None,
                        format!("Connected directly to YouTube Live chat ({ch})"),
                    ))
                }
                Err(inner_err) => {
                    if !cfg.youtube_api_key.is_empty() {
                        let yt = YouTubeChat::from_video(channel, url, &cfg.youtube_api_key)
                            .await
                            .map_err(|e| format!("YouTube chat failed ({inner_err}; API v3: {e})"))?;
                        Ok((
                            LiveChatClient::YouTubeApi(yt),
                            None,
                            None,
                            "Connected via YouTube Data API v3 liveChat".to_string(),
                        ))
                    } else {
                        Err(format!("{inner_err}"))
                    }
                }
            }
        }
        Platform::Kick => {
            let bridge = cfg.kick_bridge_url.trim_end_matches('/');
            // Push runtime KICK_PUSHER_KEY if configured in PulseCut
            if !cfg.kick_pusher_key.is_empty() {
                let _ = http
                    .post(format!("{bridge}/config"))
                    .json(&json!({
                        "pusher_key": cfg.kick_pusher_key,
                        "cluster": cfg.kick_pusher_cluster,
                    }))
                    .send()
                    .await;
            }
            // Register channel with multi-channel Kick bridge & verify status
            let reg_res = http
                .post(format!("{bridge}/channels"))
                .json(&json!({ "channel": channel }))
                .send()
                .await
                .map_err(|_| {
                    format!(
                        "Kick bridge offline at {bridge}. Start it with: python tools/kick-chat-bridge/bridge.py --port 8765"
                    )
                })?;

            let reg_json: Value = reg_res.json().await.unwrap_or_else(|_| json!({}));
            if let Some(err) = reg_json["error"].as_str() {
                return Err(format!("Kick bridge error for '{channel}': {err}"));
            }

            let (viewer_count, playback_url, bridge_err) =
                fetch_kick_bridge_meta(http, bridge, channel)
                    .await
                    .unwrap_or((None, None, None));

            if let Some(err) = bridge_err {
                return Err(err);
            }

            let relay_url = format!("{bridge}/chat/{channel}");
            let client = KickChat::new(channel, &relay_url);
            Ok((
                LiveChatClient::Kick(client),
                viewer_count,
                playback_url,
                format!("Connected to Kick chat bridge ({channel})"),
            ))
        }
    }
}

async fn fetch_kick_bridge_meta(
    http: &Client,
    bridge: &str,
    channel: &str,
) -> Option<(Option<u64>, Option<String>, Option<String>)> {
    let status = http
        .get(format!("{bridge}/status"))
        .send()
        .await
        .ok()?
        .json::<Value>()
        .await
        .ok()?;
    let pusher_err = status["pusher_error"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(String::from);
    let ch = &status["channels"][channel];
    let vc = ch["viewer_count"].as_u64();
    let pb = ch["playback_url"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(String::from);
    let ch_err = ch["last_error"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(String::from);
    Some((vc, pb, pusher_err.or(ch_err)))
}

/// Parses a direct stream URL into `(Platform, channel_or_video_id, normalized_url)`.
pub fn parse_stream_target(raw: &str) -> Result<(Platform, String, String), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Stream URL is empty".to_string());
    }
    let lower_raw = trimmed.to_ascii_lowercase();
    let with_scheme = if lower_raw.starts_with("http://") || lower_raw.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let lower = with_scheme.to_ascii_lowercase();

    if let Some(pos) = lower.find("kick.com/") {
        let after = &with_scheme[pos + "kick.com/".len()..];
        let slug = after
            .split(['/', '?', '#'])
            .next()
            .unwrap_or("")
            .trim()
            .trim_start_matches('@')
            .to_ascii_lowercase();
        if slug.is_empty() {
            return Err(format!("Could not extract Kick channel from '{trimmed}'"));
        }
        return Ok((Platform::Kick, slug.clone(), format!("https://kick.com/{slug}")));
    }

    if let Some(pos) = lower.find("twitch.tv/") {
        let after = &with_scheme[pos + "twitch.tv/".len()..];
        let slug = after
            .split(['/', '?', '#'])
            .next()
            .unwrap_or("")
            .trim()
            .trim_start_matches('@')
            .to_ascii_lowercase();
        if slug.is_empty() {
            return Err(format!("Could not extract Twitch channel from '{trimmed}'"));
        }
        return Ok((
            Platform::Twitch,
            slug.clone(),
            format!("https://www.twitch.tv/{slug}"),
        ));
    }

    if lower.contains("youtube.com/") || lower.contains("youtu.be/") {
        let vid = YouTubeChat::extract_video_id(&with_scheme);
        if vid.is_empty() || vid.contains('/') || vid.len() < 6 {
            return Err(format!(
                "Could not extract YouTube Live video ID from '{trimmed}' (use https://youtube.com/live/<id> or watch?v=<id>)"
            ));
        }
        return Ok((
            Platform::Youtube,
            vid.clone(),
            format!("https://www.youtube.com/watch?v={vid}"),
        ));
    }

    Err(format!(
        "Unsupported live stream URL '{trimmed}'. Paste Kick, YouTube Live, or Twitch links."
    ))
}

fn viewer_prior_rate(viewer_count: Option<u64>) -> f64 {
    let Some(v) = viewer_count else {
        return 0.9;
    };
    if v == 0 {
        return 0.6;
    }
    let vf = v as f64;
    if vf < 100.0 {
        0.35 + (vf / 100.0) * 0.35
    } else if vf < 1000.0 {
        0.7 + ((vf - 100.0) / 900.0) * 0.9
    } else if vf < 10_000.0 {
        1.6 + ((vf - 1000.0) / 9000.0) * 3.2
    } else {
        (4.8 + (vf / 10_000.0).ln_1p() * 3.8).min(18.0)
    }
}

fn robust_median_mad(samples: &VecDeque<f64>) -> (f64, f64) {
    if samples.is_empty() {
        return (0.8, 0.4);
    }
    let mut sorted: Vec<f64> = samples.iter().copied().collect();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = sorted.len();
    let median = if n % 2 == 1 {
        sorted[n / 2]
    } else {
        (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
    };
    let mut devs: Vec<f64> = sorted.iter().map(|v| (v - median).abs()).collect();
    devs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mad = if n % 2 == 1 {
        devs[n / 2]
    } else {
        (devs[n / 2 - 1] + devs[n / 2]) / 2.0
    };
    (median, (1.4826 * mad).max(0.30))
}

fn is_hype_text(text: &str) -> bool {
    let up = text.to_ascii_uppercase();
    const WORDS: &[&str] = &[
        "CLIP", "OMG", "NO WAY", "WTF", "CRAZY", "INSANE", "SHEESH", "GOAT", "COOKED",
        "LETS GO", "LFG", "POG", "KEKW", "LMAO", "LMFAO", "CLUTCH", "WILD", "AYO",
        "WHOA", "WAIT WHAT", "BRUH", "DEAD", "CRYING", "WWWW", "LLLL", "NOOO", "YOOO",
    ];
    WORDS.iter().any(|w| up.contains(w))
}

fn has_hype_emoji(text: &str) -> bool {
    text.chars().any(|c| {
        matches!(
            c,
            '🔥' | '💀' | '😭' | '😂' | '🤯' | '😱' | '⚡' | '💯' | '🎉' | '🙌' | '👑' | '🤣' | '👀' | '😳' | '💥' | '👏'
        )
    })
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
