//! ClipShip overlay compositing for the Rust render pipeline.
//!
//! Each `clipship-NN` template maps to a bundled 1080x1920 PNG frame under
//! `public/templates/clipship/`. The renderer builds a filtergraph that keeps
//! the full 16:9 stage frame (never a centre-crop), fills uncovered areas with
//! a blurred darkened copy of the same video, overlays the transparent frame,
//! and burns the lowercase hook + synced lyric subtitles.
//!
//! No Clip Ship branding layers are ever added — the page header is a plain
//! lowercase drawtext placeholder so the clip can be posted from any page.

use std::path::{Path, PathBuf};

use pulsecut_core::config::RenderConfig;

/// Folder name for each clipship id (index = NN - 1).
const FOLDERS: [&str; 13] = [
    "01_Tweet_Card_Dark",
    "02_Tweet_Card_Light",
    "03_Tweet_Plus_Reply",
    "04_Big_Meme_Caption",
    "05_White_Meme",
    "06_Stacked_Comparison",
    "07_Comment_Reply",
    "08_News_Card",
    "09_Fullscreen_Text_Box",
    "10_Reddit_Thread",
    "11_Condensed_Headline",
    "12_Collage_Pill",
    "13_Reaction_Split_Pill",
];

/// Whether a template id is one of the bundled ClipShip overlays.
pub fn is_clipship(id: &str) -> bool {
    id.starts_with("clipship-")
}

fn index_of(id: &str) -> Option<usize> {
    let n: usize = id.strip_prefix("clipship-")?.parse().ok()?;
    if (1..=13).contains(&n) {
        Some(n - 1)
    } else {
        None
    }
}

/// (y, height) of the transparent cutout at 1080x1920, measured from the PNG alpha.
fn cutout_y_h(idx: usize) -> (i32, i32) {
    match idx {
        0 | 1 => (900, 608),
        2 => (640, 608),
        3 => (500, 1280),
        4 => (840, 608),
        5 => (460, 1228), // two stacked 608px videos
        7 => (800, 608),
        9 => (780, 608),
        10 => (0, 1114),
        11 => (0, 1050),
        12 => (0, 1090),
        // 07 comment reply and 09 fullscreen: no frame cutout, centre the 16:9 video.
        _ => (656, 608),
    }
}

fn text_y(idx: usize) -> i32 {
    match idx {
        0 | 1 => 750,
        2 => 460,
        3 => 130,
        4 => 660,
        5 => 280,
        6 => 400,
        7 => 660,
        8 => 400,
        9 => 620,
        10 => 1150,
        11 => 1060,
        12 => 1100,
        _ => 1500,
    }
}

fn escape_filter(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/").replace(':', "\\:");
    s
}

fn escape_text(s: &str) -> String {
    s.to_lowercase()
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace(':', "\\:")
        .replace('%', "\\%")
}

/// Result of building a ClipShip render: the filtergraph and the extra looped
/// image inputs the caller must pass to ffmpeg before `-i <video>`.
pub struct ClipshipGraph {
    pub filtergraph: String,
    pub extra_inputs: Vec<PathBuf>,
    pub assets_root: PathBuf,
}

/// Build the compositing filtergraph for a ClipShip template.
///
/// `ass_path` is the burned subtitle file. `hook` is the (lowercase) hook line.
pub fn build(id: &str, cfg: &RenderConfig, hook: Option<&str>, ass_path: &Path) -> Option<ClipshipGraph> {
    let idx = index_of(id)?;
    let assets_root = PathBuf::from("public/templates/clipship");
    let folder = FOLDERS[idx];
    let frame = assets_root.join(folder).join("1_frame.png");

    let (cy, ch) = cutout_y_h(idx);
    let sharp_y = cy + ((ch - 608) / 2).max(0);
    let ty = text_y(idx);

    let mut extra_inputs = Vec::new();
    let mut chains: Vec<String> = Vec::new();

    // Layer 0+1: blurred dark fill and sharp full-width 16:9 foreground.
    chains.push("[0:v]split=2[bg][fg]".into());
    chains.push(format!(
        "[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5,eq=brightness=-0.12[bgf]"
    ));
    chains.push(format!(
        "[fg]scale=1080:608:force_original_aspect_ratio=decrease[main]"
    ));
    chains.push(format!("[bgf][main]overlay=0:{sharp_y}[v0]"));

    // Layer 2: transparent frame PNG (when the template has one).
    let mut cur = if frame.exists() {
        extra_inputs.push(frame);
        chains.push("[v0][1:v]overlay=0:0[v1]".into());
        "v1".to_string()
    } else {
        chains.push("[v0]null[v1]".into());
        "v1".to_string()
    };

    // Layer 5: lowercase hook caption (one idea per line).
    if let Some(h) = hook {
        let text = escape_text(h);
        chains.push(format!(
            concat!(
                "[{cur}]drawtext=fontfile=arial.ttf:text='{text}':fontcolor=white:fontsize=48:",
                "x=(w-text_w)/2:y={ty}:line_spacing=10:box=1:boxcolor=black@0.55:boxborderw=14[{cur}h]"
            ),
            cur = cur, text = text, ty = ty
        ));
        cur = format!("{cur}h");
    }

    // Layer 6: synced live lyric subtitles from the generated ASS file.
    if cfg.burn_captions {
        chains.push(format!(
            "[{cur}]subtitles=filename='{}':fontsdir='.'[vout]",
            escape_filter(ass_path)
        ));
        cur = "vout".into();
    }
    if cur != "vout" {
        chains.push(format!("[{cur}]null[vout]"));
    }

    Some(ClipshipGraph {
        filtergraph: chains.join(";"),
        extra_inputs,
        assets_root,
    })
}
