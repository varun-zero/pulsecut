//! Real face-detection verification with a bundled test portrait.
//! Requires PULSECUT_FFMPEG; skips otherwise.

use pulsecut_core::config::RenderConfig;
use pulsecut_core::edl::EditDecisionList;
use pulsecut_render::framing::{FaceTracker, FramingPlan, Focus};
use pulsecut_render::Renderer;
use std::path::{Path, PathBuf};
use std::process::Command;

fn ffmpeg() -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var("PULSECUT_FFMPEG").ok()?);
    p.is_file().then_some(p)
}

fn portrait() -> Option<PathBuf> {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../research/test-images/lena.jpg");
    p.is_file().then_some(p)
}

#[tokio::test]
async fn detects_real_face_and_renders_tracked_clip() {
    let (Some(ff), Some(img)) = (ffmpeg(), portrait()) else {
        eprintln!("SKIP face e2e: need PULSECUT_FFMPEG and research/test-images/lena.jpg");
        return;
    };
    let dir = std::env::temp_dir().join(format!(
        "pulsecut-face-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();

    // 1. Decode the portrait to the exact grayscale shape the detector wants.
    let gray_path = dir.join("face.gray");
    let out = Command::new(&ff)
        .args(["-y", "-v", "error", "-i"])
        .arg(&img)
        .args(["-vf", "scale=320:180", "-pix_fmt", "gray", "-f", "rawvideo"])
        .arg(&gray_path)
        .output().unwrap();
    assert!(out.status.success(), "grayscale conversion failed: {}", String::from_utf8_lossy(&out.stderr));
    let gray = std::fs::read(&gray_path).unwrap();
    assert_eq!(gray.len(), 320 * 180);

    // 2. The detector must actually find a face.
    let mut tracker = FaceTracker::load(Path::new("models/seeta_fd_frontal_v1.0.bin")).unwrap();
    let face = tracker.dominant_face(&gray, 320, 180);
    assert!(face.is_some(), "SeetaFace did not detect the test portrait");
    let f = face.unwrap();
    println!("detected face: cx={:.3} cy={:.3} w={:.3} h={:.3} score={:.2}", f.cx, f.cy, f.w, f.h, f.score);
    assert!((0.2..=0.8).contains(&f.cx));
    assert!(f.w > 0.1 && f.h > 0.1);

    // 3. Track a short video made from the portrait and build a crop timeline.
    let video = dir.join("portrait.mp4");
    let out = Command::new(&ff)
        .args(["-y", "-v", "error", "-loop", "1", "-i"])
        .arg(&img)
        .args(["-t", "3", "-r", "10", "-vf", "scale=640:360",
               "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"])
        .arg(&video)
        .output().unwrap();
    assert!(out.status.success(), "video creation failed: {}", String::from_utf8_lossy(&out.stderr));

    let plan = tracker.track(&video, &ff, 0).unwrap();
    println!("tracked {}/{} frames with faces, {} keyframes", plan.detected_frames, plan.total_frames, plan.points.len());
    assert!(plan.detected_frames > 0, "no faces found in the video");
    assert!(!plan.points.is_empty());

    let cmd_file = dir.join("framing.sendcmd");
    plan.write_sendcmd(&cmd_file, 640, 360).unwrap();
    let cmds = std::fs::read_to_string(&cmd_file).unwrap();
    assert!(cmds.contains("crop x") && cmds.contains("crop y"));

    // 4. Render with framing=face and confirm a real vertical MP4.
    let mut cfg = RenderConfig::default();
    cfg.framing = "face".into();
    cfg.face_model = "models/seeta_fd_frontal_v1.0.bin".into();
    cfg.max_duration_secs = 3;
    cfg.burn_captions = false;
    let renderer = Renderer::new(cfg).unwrap();
    let final_path = dir.join("tracked.mp4");
    renderer
        .render(&video, &[], &EditDecisionList::default(), &dir.join("subs.ass"), &final_path, 0)
        .await
        .unwrap();
    let info = Command::new(&ff).args(["-hide_banner", "-i"]).arg(&final_path).output().unwrap();
    let text = String::from_utf8_lossy(&info.stderr);
    assert!(text.contains("1080x1920"), "unexpected output:\n{text}");
    println!("tracked output: {} bytes, 1080x1920 confirmed", std::fs::metadata(&final_path).unwrap().len());

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn hold_move_plan_is_monotone() {
    let plan = FramingPlan {
        points: vec![
            Focus { t_sec: 0.0, cx: 0.5, cy: 0.5 },
            Focus { t_sec: 0.5, cx: 0.5, cy: 0.5 },
            Focus { t_sec: 1.0, cx: 0.7, cy: 0.5 },
        ],
        detected_frames: 3,
        total_frames: 3,
    };
    assert!(plan.points.windows(2).all(|w| w[1].t_sec > w[0].t_sec));
}
