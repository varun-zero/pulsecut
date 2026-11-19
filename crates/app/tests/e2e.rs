//! Offline end-to-end test with a synthetic stream.
//!
//! Set PULSECUT_FFMPEG to run (skips otherwise). This exercises the real
//! ffmpeg pipeline: video generation -> HLS-style segmentation -> rolling
//! buffer -> audio metering -> detector -> stream-copy cut -> 9:16 render
//! with burned karaoke captions and a visual template.

use pulsecut_capture::{AudioMeter, RollingBuffer};
use pulsecut_core::config::{DetectionConfig, RenderConfig};
use pulsecut_core::edl::{EditDecisionList, EditOp};
use pulsecut_core::model::{ChatMessage, ClipWindow, Platform, Word};
use pulsecut_detect::HypeDetector;
use pulsecut_render::Renderer;
use std::path::PathBuf;
use std::process::Command;

fn ffmpeg() -> Option<PathBuf> {
    let p = std::env::var("PULSECUT_FFMPEG").ok()?;
    let p = PathBuf::from(p);
    p.is_file().then_some(p)
}

fn temp_dir(tag: &str) -> PathBuf {
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("pulsecut-e2e-{tag}-{n}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn run(cmd: &mut Command, label: &str) {
    let out = cmd.output().unwrap_or_else(|e| panic!("{label} failed to start: {e}"));
    assert!(out.status.success(), "{label} failed: {}", String::from_utf8_lossy(&out.stderr));
}

fn chat(author: &str, text: &str, sec: i64) -> ChatMessage {
    ChatMessage {
        id: format!("{author}-{sec}"),
        platform: Platform::Twitch,
        channel: "test".into(),
        author: author.into(),
        text: text.into(),
        ts_ms: sec * 1000,
        emotes: vec![],
        is_mod: false,
        is_subscriber: false,
    }
}

#[tokio::test]
async fn synthetic_video_end_to_end() {
    let Some(ff) = ffmpeg() else {
        eprintln!("SKIP e2e: set PULSECUT_FFMPEG to a working ffmpeg binary");
        return;
    };

    let dir = temp_dir("full");
    let src = dir.join("source.mp4");

    // 1. 12 seconds of 16:9 video with a loud sine audio track.
    run(
        Command::new(&ff).args([
            "-y", "-v", "error",
            "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25:duration=12",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=12",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest",
        ]).arg(&src),
        "generate synthetic video",
    );
    assert!(src.is_file() && std::fs::metadata(&src).unwrap().len() > 1000);

    // 2. Segment exactly like the live capture path does.
    let pattern = dir.join("seg_%06d.ts");
    run(
        Command::new(&ff).args([
            "-y", "-v", "error", "-i",
        ]).arg(&src).args([
            "-c", "copy", "-f", "segment", "-segment_time", "4",
            "-segment_start_number", "0", "-reset_timestamps", "1",
            "-segment_format", "mpegts",
        ]).arg(&pattern),
        "segment video",
    );

    let mut buffer = RollingBuffer::new(&dir, 4, 60, 0).unwrap();
    buffer.refresh().unwrap();
    assert!(buffer.segments.len() >= 2, "expected at least two 4s segments, got {}", buffer.segments.len());
    let coverage = buffer.coverage().unwrap();
    assert!(coverage.1 >= 8_000, "unexpected coverage {coverage:?}");
    println!("segments={} coverage={:?}", buffer.segments.len(), coverage);

    // 3. Real audio energy from the segment file (not a hard-coded zero).
    let audio = AudioMeter::new().measure_latest(&buffer.segments, &ff).unwrap();
    assert!(audio > 0.0, "audio meter returned {audio} for a sine wave");
    println!("measured audio energy: {audio:.3}");

    // 4. Detector fires on a genuine chat spike.
    let cfg = DetectionConfig {
        baseline_window_secs: 60, min_messages: 4, min_unique_ratio: 0.25,
        confidence_threshold: 0.45, ..DetectionConfig::default()
    };
    let mut detector = HypeDetector::new(cfg);
    for s in 0..20 {
        detector.ingest(&chat(&format!("u{s}"), "hello", s));
    }
    for i in 0..16 {
        detector.ingest(&chat(&format!("h{i}"), "POG POG lets go", 21));
    }
    let events = detector.tick(21_500, audio, None);
    assert_eq!(events.len(), 1, "detector should emit exactly one event");
    println!("event confidence={:.3} reasons={:?}", events[0].confidence, events[0].reasons);

    // 5. Clip window aligned to the synthetic source; extract with stream copy.
    let window = ClipWindow {
        start_ms: coverage.0 + 1_000,
        end_ms: coverage.1,
        snap_reason: "e2e".into(),
    };
    let raw = dir.join("raw.mp4");
    assert!(buffer.extract(&window, &raw, &ff).await.unwrap(), "buffer could not cover window");
    assert!(std::fs::metadata(&raw).unwrap().len() > 1000);
    let raw_info = Command::new(&ff).args(["-hide_banner", "-i"]).arg(&raw).output().unwrap();
    println!("RAW STREAMS:\n{}", String::from_utf8_lossy(&raw_info.stderr));

    // 6. Word-timed captions + template -> real 1080x1920 MP4.
    let words: Vec<Word> = (0..10)
        .map(|i| Word {
            text: format!("word{i}"),
            start_ms: 2_100 + i * 900,
            end_ms: 2_700 + i * 900,
            confidence: 0.9,
        })
        .collect();
    let mut render_cfg = RenderConfig::default();
    render_cfg.max_duration_secs = 60;
    render_cfg.template = "x_light".into();
    render_cfg.watermark = "@testchannel".into();
    let renderer = Renderer::new(render_cfg).unwrap();
    let mut edl = EditDecisionList::new("e2e");
    edl.push(EditOp::Hook { text: "wait for it".into(), duration_ms: 1500 });
    let ass = dir.join("subs.ass");
    let final_path = dir.join("final.mp4");
    let lead_ms = buffer.lead_ms(&window);
    renderer.render(&raw, &words, &edl, &ass, &final_path, lead_ms).await.unwrap();
    assert!(std::fs::metadata(&final_path).unwrap().len() > 5000, "final clip too small");

    // 7. Verify dimensions by asking ffmpeg to report stream info.
    let info = Command::new(&ff).args(["-hide_banner", "-i"]).arg(&final_path).output().unwrap();
    let text = String::from_utf8_lossy(&info.stderr);
    assert!(text.contains("1080x1920"), "unexpected output video:\n{text}");
    assert!(text.contains("Video:"), "no video stream in output");
    println!("final clip: {} bytes, 1080x1920 confirmed", std::fs::metadata(&final_path).unwrap().len());

    std::fs::remove_dir_all(&dir).unwrap();
}

#[tokio::test]
async fn yizerge_style_features_render_with_real_ffmpeg() {
    let Some(ff) = ffmpeg() else { eprintln!("SKIP: PULSECUT_FFMPEG not set"); return; };
    let dir = temp_dir("yizerge");
    let src = dir.join("in.mp4");
    run(Command::new(&ff).args([
        "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25:duration=6",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest",
    ]).arg(&src), "generate");
    let mut cfg = pulsecut_core::config::RenderConfig::default();
    cfg.max_duration_secs = 5;
    cfg.burn_captions = false;
    cfg.template = "tiktok_hook".into();
    let renderer = Renderer::new(cfg).unwrap();
    let mut edl = EditDecisionList::new("yizerge");
    edl.push(EditOp::Layout { preset: "pip".into() });
    edl.push(EditOp::Outro { text: "Follow for more".into(), duration_ms: 2000 });
    edl.push(EditOp::SocialCard { handle: "@test".into(), style: "verified".into() });
    edl.push(EditOp::AudioPeak { rise_ms: 2000, peak: 0.8 });
    let out = dir.join("out.mp4");
    renderer.render(&src, &[], &edl, &dir.join("s.ass"), &out, 0).await.unwrap();
    let info = Command::new(&ff).args(["-hide_banner", "-i"]).arg(&out).output().unwrap();
    let text = String::from_utf8_lossy(&info.stderr);
    assert!(text.contains("1080x1920"), "unexpected output:\n{text}");
    assert!(text.contains("Audio:"), "audio lost in complex filter:\n{text}");
    println!("pip + outro + social card + audio peak: {} bytes, 1080x1920 with audio", std::fs::metadata(&out).unwrap().len());
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn template_metadata_is_ready_to_post() {
    use pulsecut_render::{apply_metadata, template_library};
    let t = template_library().into_iter().find(|x| x.id == "breaking_news").unwrap();
    let m = apply_metadata(&t, "Clutch play", "desc", "unbelievable", &["clips".into()], "chan");
    assert!(m.title.starts_with("BREAKING:"));
    assert!(m.hashtags.contains(&"news".into()));
    assert!(!m.description.is_empty());

    // Test new editorial template
    let ed = template_library().into_iter().find(|x| x.id == "editorial").unwrap();
    let med = apply_metadata(&ed, "In Depth Insight", "desc", "Hook", &["shorts".into()], "chan");
    assert_eq!(med.title, "“In Depth Insight”");
    assert!(med.hashtags.contains(&"culture".into()));

    // Test new street template
    let st = template_library().into_iter().find(|x| x.id == "street").unwrap();
    let mst = apply_metadata(&st, "Wild Moment", "desc", "WATCH THIS", &["shorts".into()], "chan");
    assert_eq!(mst.title, "WATCH THIS // Wild Moment");
    assert!(mst.hashtags.contains(&"street".into()));
}
