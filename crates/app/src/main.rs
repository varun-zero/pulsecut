//! PulseCut command line orchestrator.
//!
//! `watch` is the whole pipeline: capture -> chat -> detect -> cut -> package
//! -> editor store -> publish queue. Every stage is a separate crate so it can
//! be tested and replaced independently.

mod monitor;
mod vod;
mod web;

use clap::{Parser, Subcommand};
use pulsecut_ai::{build_prompt, AiBackend, MockAi, Transcriber, WhisperCli};
use pulsecut_capture::{self as capture, ffmpeg, AudioMeter, RollingBuffer};
use pulsecut_chat::{ChatSource, KickChat, TwitchChat, YouTubeChat};
use pulsecut_core::config::Config;
use pulsecut_core::edl::EditDecisionList;
use pulsecut_core::error::{PulseError, Result};
use pulsecut_core::model::{ChatMessage, ClipPackage, ClipStatus, ClipWindow, HypeEvent, Platform, default_profiles};
use pulsecut_detect::HypeDetector;
use pulsecut_editor::Store;
use pulsecut_publish::{publisher, PublishJob, PublishQueue, PublishRequest, Publisher};
use pulsecut_render::Renderer;
use std::path::PathBuf;
use std::process::Command as SysCommand;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(name = "pulsecut", about = "Live-chat-driven clipping, packaging and cross-posting")]
struct Cli {
    #[arg(long, default_value = "pulsecut.json")]
    config: PathBuf,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Write a default config file
    Init,
    /// Watch a live stream, detect hype spikes and produce ready-to-post clips
    Watch {
        /// twitch | kick | youtube
        #[arg(long)] platform: String,
        /// Channel name (YouTube: video ID of the live broadcast)
        #[arg(long)] channel: String,
        /// Stream page URL or direct HLS URL
        #[arg(long)] link: String,
        #[arg(long, env = "PULSECUT_YOUTUBE_KEY")] youtube_key: Option<String>,
    },
    /// Run a full offline demo: synthetic stream + chat -> real clip in the editor
    Demo {
        #[arg(long, default_value_t = 25)] seconds: u32,
    },
    /// Start the local after-clip editor API
    Editor {
        #[arg(long, default_value = "127.0.0.1:8756")] addr: String,
    },
    /// List clips in the editor store
    List,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let _ = tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .try_init();

    match cli.command {
        Commands::Init => {
            let cfg = Config::default();
            std::fs::write(&cli.config, serde_json::to_string_pretty(&cfg)?)?;
            println!("wrote {}", cli.config.display());
            Ok(())
        }
        Commands::List => {
            let store = Store::open(PathBuf::from(&Config::default().capture.output_dir).join("editor"))?;
            for c in store.list() {
                println!("{}  {:?}  conf={:.2}  {}", c.id, c.status, c.confidence, c.title);
            }
            Ok(())
        }
        Commands::Demo { seconds } => demo(cli.config, seconds).await,
        Commands::Editor { addr } => {
            let cfg = Config::load(&cli.config)?;
            web::serve(&addr, cfg).await
        }
        Commands::Watch { platform, channel, link, youtube_key } => {
            watch(cli.config, platform, channel, link, youtube_key).await
        }
    }
}

/// Publisher backend selected by env var; aggregators are the default because
/// they hold the OAuth connections for all nine destinations.
/// Offline demo: generates a synthetic stream, injects synthetic chat, and
/// runs the exact same pipeline as `watch`. Requires ffmpeg (PULSECUT_FFMPEG).
async fn demo(config: PathBuf, seconds: u32) -> Result<()> {
    let cfg = Config::load(&config)?;
    let ffmpeg = ffmpeg(&cfg.capture.ffmpeg_path)?;
    let out = PathBuf::from(&cfg.capture.output_dir);
    let dir = out.join("demo");
    for d in ["raw", "final", "subs", "editor", "whisper"] {
        std::fs::create_dir_all(out.join(d))?;
    }
    std::fs::create_dir_all(&dir)?;

    let src = dir.join("demo-source.mp4");
    let status = SysCommand::new(&ffmpeg)
        .args(["-y", "-v", "error", "-f", "lavfi", "-i"])
        .arg(format!("testsrc2=size=1280x720:rate=25:duration={seconds}"))
        .args(["-f", "lavfi", "-i", &format!("sine=frequency=440:duration={seconds}"),
               "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-shortest"])
        .arg(&src)
        .status()?;
    if !status.success() { return Err(PulseError::Process("demo video generation failed".into())); }

    let pattern = dir.join("seg_%06d.ts");
    let status = SysCommand::new(&ffmpeg)
        .args(["-y", "-v", "error", "-i"]).arg(&src)
        .args(["-c", "copy", "-f", "segment", "-segment_time", "4",
               "-segment_start_number", "0", "-reset_timestamps", "1",
               "-segment_format", "mpegts"])
        .arg(&pattern)
        .status()?;
    if !status.success() { return Err(PulseError::Process("demo segmentation failed".into())); }

    let mut buffer = RollingBuffer::new(&dir, 4, 60, 0)?;
    buffer.refresh()?;
    let coverage = buffer.coverage().ok_or_else(|| PulseError::Other("no demo segments".into()))?;

    // Synthetic chat: quiet baseline, then a genuine hype burst.
    let mut detector = HypeDetector::new(cfg.detection.clone());
    for s in 0..20 {
        detector.ingest(&ChatMessage {
            id: format!("q{s}"), platform: Platform::Twitch, channel: "demo".into(),
            author: format!("viewer{s}"), text: "hello".into(), ts_ms: s * 1000,
            emotes: vec![], is_mod: false, is_subscriber: false,
        });
    }
    for i in 0..16 {
        detector.ingest(&ChatMessage {
            id: format!("h{i}"), platform: Platform::Twitch, channel: "demo".into(),
            author: format!("hype{i}"), text: "POG POG lets go".into(), ts_ms: 21_000,
            emotes: vec![], is_mod: false, is_subscriber: false,
        });
    }
    let events = detector.tick(21_500, 0.4, None);
    let event = events.into_iter().next().ok_or_else(|| PulseError::Other("demo detector did not fire".into()))?;
    println!("detected hype: confidence={:.3} {:?}", event.confidence, event.reasons);

    // Align the cut window to the synthetic source rather than wall-clock chat.
    let window = ClipWindow {
        start_ms: coverage.0 + 1_000,
        end_ms: (coverage.0 + 11_000).min(coverage.1),
        snap_reason: "demo synthetic stream".into(),
    };
    let event = HypeEvent { clip: window, ..event };

    let renderer = Renderer::new(cfg.render.clone())?;
    let mut store = Store::open(out.join("editor"))?;
    let mut queue = PublishQueue::new(true, 0);
    let ai = MockAi::default();
    let pubber = publisher(&cfg);
    process_event(&cfg, &event, &mut buffer, &out, &renderer, &ai, None,
                  &mut store, &mut queue, pubber.as_ref()).await?;

    println!("demo clip ready: {}", out.join("final").join(format!("{}.mp4", event.id)).display());
    println!("open the editor at http://127.0.0.1:8756/ to approve it");
    Ok(())
}

async fn watch(
    config: PathBuf,
    platform: String,
    channel: String,
    link: String,
    youtube_key: Option<String>,
) -> Result<()> {
    let cfg = Config::load(&config)?;
    let platform = match platform.as_str() {
        "twitch" => Platform::Twitch,
        "kick" => Platform::Kick,
        "youtube" | "yt" => Platform::Youtube,
        other => return Err(PulseError::Config(format!("unsupported platform {other}"))),
    };

    let out = PathBuf::from(&cfg.capture.output_dir);
    for d in ["raw", "final", "subs", "editor", "whisper"] {
        std::fs::create_dir_all(out.join(d))?;
    }

    let mut session = capture::start_capture(&link, &cfg.capture, &channel).await?;
    let mut detector = HypeDetector::new(cfg.detection.clone());
    let mut store = Store::open(out.join("editor"))?;
    let mut queue = PublishQueue::new(cfg.publishing.auto_approve, cfg.publishing.spacing_secs);
    let renderer = Renderer::new(cfg.render.clone())?;
    let ai = pulsecut_ai::resilient_backend(&cfg);
    let pubber = publisher(&cfg);
    let cancel = Arc::new(AtomicBool::new(false));
    let ffmpeg_bin = ffmpeg(&cfg.capture.ffmpeg_path)?;
    let mut audio_meter = AudioMeter::new();

    let transcriber = capture::resolve_binary(
        &cfg.ai.whisper_binary,
        "PULSECUT_WHISPER",
        &["whisper", "whisper-cli", "faster-whisper"],
    )
    .map(|bin| WhisperCli::new(bin, cfg.ai.whisper_model.clone(), out.join("whisper")));

    // Chat source selection. Each connector normalizes into ChatMessage.
    let mut twitch: Option<TwitchChat> = None;
    let mut youtube: Option<YouTubeChat> = None;
    let mut kick: Option<KickChat> = None;
    match platform {
        Platform::Twitch => twitch = Some(TwitchChat::connect(&channel).await?),
        Platform::Youtube => {
            let key = youtube_key.ok_or_else(|| PulseError::Config("YouTube needs --youtube-key".into()))?;
            youtube = Some(YouTubeChat::from_video(&channel, &link, &key).await?);
        }
        Platform::Kick => {
            let relay = std::env::var("PULSECUT_KICK_CHAT_RELAY").map_err(|_| {
                PulseError::Config("Kick needs PULSECUT_KICK_CHAT_RELAY (local chat bridge URL)".into())
            })?;
            kick = Some(KickChat::new(&channel, &relay));
        }
    }

    tracing::info!(
        "watching {platform:?}/{channel}; buffer={}s lookback={}ms publisher={}",
        cfg.capture.buffer_seconds, cfg.detection.lookback_ms, pubber.name()
    );

    let mut timer = tokio::time::interval(std::time::Duration::from_millis(cfg.capture.poll_ms as u64));
    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                tracing::info!("shutdown requested");
                break;
            }
            _ = timer.tick() => {
                session.tick().await?;
                // Measured loudness from the newest captured segment, not a
                // hard-coded zero. Falls back to 0 if the meter cannot read it.
                let audio = match audio_meter.measure_latest(&session.buffer.segments, &ffmpeg_bin) {
                    Ok(v) => v,
                    Err(e) => { tracing::debug!("audio meter: {e}"); 0.0 }
                };
                for event in detector.tick(now_ms(), audio, None) {
                    tracing::info!("event {} conf={:.2} {:?}", event.id, event.confidence, event.reasons);
                    match session.wait_for_coverage(&event.clip, &cancel, std::time::Duration::from_secs(20)).await {
                        Ok(()) => {}
                        Err(e) => { tracing::warn!("buffer coverage: {e}"); continue; }
                    }
                    if let Err(e) = process_event(
                        &cfg, &event, &mut session.buffer, &out, &renderer,
                        ai.as_ref(), transcriber.as_ref(), &mut store, &mut queue, pubber.as_ref(),
                    ).await {
                        tracing::error!("event {} failed: {e}", event.id);
                    }
                }
                // Publish anything that became due (approval gate respected).
                if let Some(item) = queue.next_due(now_ms()) {
                    let job = PublishJob {
                        package: store.get(&item.request.package_id).cloned()
                            .ok_or_else(|| PulseError::Other("package missing from store".into()))?,
                        targets: item.request.targets.clone(),
                        token_env: item.request.token_env.clone(),
                    };
                    match pubber.publish(&job).await {
                        Ok(receipts) => {
                            let ok = receipts.iter().all(|r| r.ok);
                            let detail = receipts.iter().map(|r| r.detail.clone()).collect::<Vec<_>>().join("; ");
                            queue.finish(&item.id, ok, if ok { None } else { Some(detail.clone()) })?;
                            store.set_status(&job.package.id, if ok { ClipStatus::Published } else { ClipStatus::Failed })?;
                            tracing::info!("published {}: {}", job.package.id, detail);
                        }
                        Err(e) => {
                            queue.finish(&item.id, false, Some(e.to_string()))?;
                            tracing::warn!("publish failed: {e}");
                        }
                    }
                }
            }
            msgs = async {
                if let Some(c) = twitch.as_mut() { c.next_messages().await }
                else if let Some(c) = youtube.as_mut() { c.next_messages().await }
                else if let Some(c) = kick.as_mut() { c.next_messages().await }
                else { tokio::time::sleep(std::time::Duration::from_secs(3600)).await; Ok(Vec::new()) }
            } => {
                match msgs {
                    Ok(msgs) => for m in msgs { detector.ingest(&m); },
                    Err(e) => tracing::warn!("chat connector: {e}"),
                }
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn process_event(
    cfg: &Config,
    event: &HypeEvent,
    buffer: &mut RollingBuffer,
    out: &PathBuf,
    renderer: &Renderer,
    ai: &dyn AiBackend,
    transcriber: Option<&WhisperCli>,
    store: &mut Store,
    queue: &mut PublishQueue,
    _pubber: &dyn Publisher,
) -> Result<()> {
    let id = &event.id;
    let raw = out.join("raw").join(format!("{id}.mp4"));
    let final_path = out.join("final").join(format!("{id}.mp4"));
    let ass_path = out.join("subs").join(format!("{id}.ass"));
    let ffmpeg = ffmpeg(&cfg.capture.ffmpeg_path)?;

    // 1. Stream-copy the exact window out of the rolling buffer.
    if !buffer.extract(&event.clip, &raw, &ffmpeg).await? {
        return Err(PulseError::Render(format!("buffer cannot cover {:?}", event.clip)));
    }

    // 2. Word-level transcript, used both for subtitle snapping and metadata.
    let words = if let Some(t) = transcriber {
        match t.transcribe(&raw, 0).await {
            Ok(w) => w,
            Err(e) => { tracing::warn!("transcription unavailable: {e}"); Vec::new() }
        }
    } else {
        Vec::new()
    };
    let transcript = words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ");

    // 3. Title, description and hashtags from the local LLM (or cloud fallback).
    let hints = format!("channel={} platform={} confidence={:.2} reasons={}",
        event.channel, event.platform.as_str(), event.confidence, event.reasons.join("; "));
    let raw_meta = ai.generate(&build_prompt(&transcript, &hints)).await?;

    // 3b. Apply the chosen ready-made template: it fills title/hook patterns,
    // merges its hashtag set and controls the visual treatment in the render.
    let template = pulsecut_render::get_template(&cfg.render.template)
        .unwrap_or_else(|| pulsecut_render::template_library().remove(0));
    let meta = pulsecut_render::apply_metadata(
        &template,
        &raw_meta.title,
        &raw_meta.description,
        &raw_meta.hook,
        &raw_meta.hashtags,
        &event.channel,
    );

    // 4. Render vertical short with burned karaoke captions and template.
    //    The extraction kept whole segments; trim the leading pre-roll here.
    let lead_ms = buffer.lead_ms(&event.clip);
    renderer.render(&raw, &words, &EditDecisionList::new(id), &ass_path, &final_path, lead_ms).await?;

    // 5. Persist package and enqueue for publishing.
    let mut description = meta.description.clone();
    if !meta.hook.is_empty() {
        description = format!("{}\n\n{}", meta.hook, description);
    }
    let pkg = ClipPackage {
        id: id.clone(),
        channel: event.channel.clone(),
        platform: event.platform,
        source_window: event.clip.clone(),
        video_path: final_path.to_string_lossy().into_owned(),
        raw_video_path: raw.to_string_lossy().into_owned(),
        words,
        title: meta.title.clone(),
        description,
        hashtags: meta.hashtags.clone(),
        caption_style: if cfg.render.caption_style == "karaoke" { template.caption_preset.to_string() } else { cfg.render.caption_style.clone() },
        template: meta.template_id.clone(),
        profiles: default_profiles(),
        status: ClipStatus::Ready,
        created_at_ms: now_ms(),
        confidence: event.confidence,
    };
    store.upsert(pkg.clone())?;
    queue.enqueue(
        PublishRequest {
            package_id: id.clone(),
            video_path: pkg.video_path.clone(),
            targets: cfg.publishing.targets.iter().filter(|t| t.enabled).map(|t| t.id.clone()).collect(),
            token_env: cfg.publishing.targets.first().map(|t| t.token_env.clone()).unwrap_or_default(),
            title: pkg.title.clone(),
            description: pkg.description.clone(),
            hashtags: pkg.hashtags.clone(),
        },
        now_ms(),
    );
    tracing::info!("clip ready: {} -> {}", id, pkg.video_path);
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
