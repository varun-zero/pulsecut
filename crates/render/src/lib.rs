//! Turn a raw clipped MP4 into a platform-ready vertical short.
//!
//! The raw clip from the rolling buffer is a stream copy at native resolution.
//! This crate applies the non-destructive edit decision list, reframes to 9:16,
//! burns word-synced ASS captions, and encodes with the best available GPU
//! encoder (falling back to x264).

pub mod ass;
pub mod clipship;
pub mod framing;
pub mod templates;

pub use ass::build_ass;
pub use templates::{
    apply_metadata, apply_visual, get as get_template, layout_for as template_layout,
    library as template_library, resolve as resolve_template,
    ShortTemplate, TemplateMetadata, TemplateOverlays,
};

use pulsecut_core::config::RenderConfig;
use pulsecut_core::edl::{EditDecisionList, EditOp};
use pulsecut_core::error::{PulseError, Result};
use pulsecut_core::model::Word;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static DETECTED_HW_ENCODER: OnceLock<&'static str> = OnceLock::new();

/// Probe once per process whether a real GPU H.264 hardware encoder works on
/// this machine (NVENC -> QSV -> AMF), falling back safely to software `x264`.
fn detect_best_encoder(ffmpeg: &Path) -> &'static str {
    *DETECTED_HW_ENCODER.get_or_init(|| {
        let Ok(list_out) = std::process::Command::new(ffmpeg)
            .args(["-hide_banner", "-encoders"])
            .output()
        else {
            return "x264";
        };
        let list = String::from_utf8_lossy(&list_out.stdout);
        for (key, codec) in [
            ("nvenc", "h264_nvenc"),
            ("qsv", "h264_qsv"),
            ("amf", "h264_amf"),
        ] {
            if !list.contains(codec) {
                continue;
            }
            // Verify the GPU driver is actually present with a 1-frame smoke test.
            let ok = std::process::Command::new(ffmpeg)
                .args([
                    "-y", "-loglevel", "error",
                    "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.04",
                    "-frames:v", "1",
                    "-c:v", codec,
                    "-f", "null", "-",
                ])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            if ok {
                tracing::info!("auto-detected working GPU encoder: {codec}");
                return key;
            }
        }
        "x264"
    })
}

fn x264_preset() -> String {
    std::env::var("PULSECUT_X264_PRESET")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "veryfast".to_string())
}

fn encoder_codec_and_args(encoder: &str, crf: u32) -> (&'static str, Vec<String>) {
    let crf_s = crf.to_string();
    match encoder {
        "nvenc" => (
            "h264_nvenc",
            vec!["-preset".into(), "p4".into(), "-cq".into(), crf_s, "-b:v".into(), "0".into()],
        ),
        "amf" => (
            "h264_amf",
            vec!["-quality".into(), "speed".into(), "-qp_i".into(), crf_s.clone(), "-qp_p".into(), crf_s],
        ),
        "qsv" => (
            "h264_qsv",
            vec!["-preset".into(), "faster".into(), "-global_quality".into(), crf_s],
        ),
        _ => (
            "libx264",
            vec![
                "-preset".into(), x264_preset(),
                "-crf".into(), crf_s,
                "-threads".into(), "0".into(),
            ],
        ),
    }
}

/// Escape a path for use in an ffmpeg filter option.
/// The filtergraph parser splits on ':' even inside single quotes, so Windows
/// drive letters need a backslash escape.
fn filter_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .replace(':', "\\:")
        .replace('\'', "\\'")
}

/// Build the ffmpeg video filter chain. Kept pure so it can be unit tested
/// without ffmpeg installed.
pub fn video_filter(cfg: &RenderConfig, edl: &EditDecisionList, subs: Option<&Path>) -> String {
    video_filter_with(cfg, edl, subs, None)
}

/// Same as `video_filter`, with an optional sendcmd file driving a moving crop.
pub fn video_filter_with(
    cfg: &RenderConfig,
    edl: &EditDecisionList,
    subs: Option<&Path>,
    framing: Option<&Path>,
) -> String {
    let crop = if let Some(path) = framing {
        // sendcmd updates x/y over time; start centred with even dimensions.
        format!(
            "sendcmd=f='{}',crop=trunc(min(iw\\,ih*9/16)/2)*2:trunc(min(ih\\,iw*16/9)/2)*2:0:0",
            filter_path(path)
        )
    } else {
        edl.ops.iter().rev().find_map(|op| match op {
            EditOp::Crop { x, y, w, h } => Some(format!(
                "crop=iw*{w}:ih*{h}:iw*{x}:ih*{y}"
            )),
            _ => None,
        }).unwrap_or_else(|| "crop=ih*9/16:ih:(iw-ih*9/16)/2:0".to_string())
    };

    let template = templates::resolve(cfg, edl);
    let headline = edl.hook().map(|(text, _)| text);
    let overlays = TemplateOverlays {
        headline,
        watermark: if cfg.watermark.is_empty() { None } else { Some(cfg.watermark.clone()) },
    };
    let mut f = format!(
        "{crop},scale={}:{}:force_original_aspect_ratio=decrease,\
         pad={}:{}:(ow-iw)/2:(oh-ih)/2:color={},setsar=1",
        cfg.width, cfg.height, cfg.width, cfg.height, templates::hex(template.background)
    );
    templates::apply_visual(&mut f, &template, cfg, &overlays);
    if cfg.burn_captions {
        if let Some(p) = subs {
            f.push_str(&format!(",subtitles=filename='{}':fontsdir='.'", filter_path(p)));
        }
    }
    f
}

/// True when the edit needs multiple ffmpeg streams (overlay/vstack/blur).
pub fn needs_complex_filter(edl: &EditDecisionList) -> bool {
    matches!(edl.layout().as_deref(), Some("pip") | Some("split"))
        || edl.canvas().as_deref() == Some("blur")
}

/// Build a base `filter_complex` chain for layouts/canvas modes. The caller
/// appends template overlays and the final `[vout]` label.
pub fn complex_filter(cfg: &RenderConfig, edl: &EditDecisionList) -> String {
    let layout = edl.layout().unwrap_or_else(|| "solo".into());
    let canvas = edl.canvas().unwrap_or_else(|| "solid".into());
    let base_crop = "crop=trunc(min(iw\\,ih*9/16)/2)*2:trunc(min(ih\\,iw*16/9)/2)*2:0:0";

    match (layout.as_str(), canvas.as_str()) {
        ("pip", _) => {
            let iw = ((cfg.width * 44 / 100) / 2) * 2;
            let ih = ((iw * 9 / 16) / 2) * 2;
            let ox = cfg.width.saturating_sub(iw + 28);
            let oy = cfg.height.saturating_sub(ih + 240);
            format!(
                "[0:v]{base_crop},scale={w}:{h},setsar=1[base];\
                 [0:v]crop=iw*0.28:ih*0.28:iw*0.02:ih*0.03,scale={iw}:{ih},setsar=1[inset];\
                 [base][inset]overlay=x={ox}:y={oy}:format=auto",
                w = cfg.width, h = cfg.height,
            )
        }
        ("split", _) => format!(
            "[0:v]crop=iw/2:ih:0:0,scale={w}:{half},setsar=1[top];\
             [0:v]crop=iw/2:ih:iw/2:0,scale={w}:{half},setsar=1[bottom];\
             [top][bottom]vstack=inputs=2,scale={w}:{h},setsar=1",
            w = cfg.width, half = cfg.height / 2, h = cfg.height
        ),
        (_, "blur") => format!(
            "[0:v]{base_crop},scale={w}:{h},gblur=sigma=24[bg];\
             [0:v]{base_crop},scale={w}:{h}:force_original_aspect_ratio=decrease[fg];\
             [bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto",
            w = cfg.width, h = cfg.height
        ),
        _ => format!("[0:v]{base_crop},scale={}:{},setsar=1", cfg.width, cfg.height),
    }
}

/// Outro card and social handle overlays, appended after templates so they
/// stay on top of the picture and below the karaoke captions.
fn apply_extra_overlays(f: &mut String, cfg: &RenderConfig, edl: &EditDecisionList) {
    let font = templates::font_prefix(cfg);
    if let Some((text, duration_ms)) = edl.outro() {
        let start = (cfg.max_duration_secs as i64 * 1000 - duration_ms).max(0) as f64 / 1000.0;
        f.push_str(&format!(
            ",drawtext={font}text='{}':fontcolor=white:fontsize={}:x=(w-text_w)/2:y=h-260:box=1:boxcolor=black@0.65:boxborderw=18:enable='gte(t\\,{start:.2})'",
            templates::escape_drawtext(&text),
            templates::fit_font_size(&text, cfg.subtitle_size as i64, cfg.width as i64)
        ));
    }
    if let Some((handle, style)) = edl.social_card() {
        let card_y = cfg.height as i64 - 420;
        if style == "kick" {
            let clean = handle.trim_start_matches('@').trim().to_ascii_uppercase();
            let card_w = (120 + clean.chars().count() as i64 * 26).clamp(320, cfg.width as i64 - 80);
            f.push_str(&format!(
                ",drawbox=x=40:y={card_y}:w={card_w}:h=92:color=0x0B0E0F@0.82:t=fill"
            ));
            let drawn_w = templates::append_kick_green_logo(f, 64, card_y + 24, 42);
            f.push_str(&format!(
                ",drawtext={font}text='{}':fontcolor=white:fontsize=40:x={}:y={}:borderw=2:bordercolor=black",
                templates::escape_drawtext(&clean),
                64 + drawn_w + 14,
                card_y + 26
            ));
        } else {
            let box_color = if style == "verified" { "0x1D9BF0@0.88" } else { "0x0B0E0F@0.78" };
            f.push_str(&format!(
                ",drawbox=x=40:y={card_y}:w=460:h=100:color={box_color}:t=fill"
            ));
            f.push_str(&format!(
                ",drawtext={font}text='{}':fontcolor=white:fontsize=40:x=70:y={}",
                templates::escape_drawtext(&handle),
                card_y + 28
            ));
        }
    }
}

/// Audio filter that ducks the bed under speech then rises at the end.
pub fn audio_filter(cfg: &RenderConfig, edl: &EditDecisionList) -> Option<String> {
    let (rise_ms, peak) = edl.audio_peak()?;
    let start = (cfg.max_duration_secs as i64 * 1000 - rise_ms).max(0) as f64 / 1000.0;
    Some(format!(
        "volume='if(lt(t\\,{start:.2})\\,0.25\\,{peak:.2})':eval=frame"
    ))
}

pub struct Renderer {
    pub cfg: RenderConfig,
    pub ffmpeg: PathBuf,
}

impl Renderer {
    pub fn new(cfg: RenderConfig) -> Result<Self> {
        let ffmpeg = pulsecut_capture::ffmpeg("")
            .map_err(|e| PulseError::Render(e.to_string()))?;
        Ok(Self { cfg, ffmpeg })
    }

    pub fn with_ffmpeg(cfg: RenderConfig, ffmpeg: PathBuf) -> Self {
        Self { cfg, ffmpeg }
    }

    /// Build the full ffmpeg argument vector for a render.
    pub fn args(&self, input: &Path, subs: Option<&Path>, out: &Path) -> Vec<String> {
        let vf = video_filter(&self.cfg, &EditDecisionList::default(), subs);
        let (codec, extra) = encoder_codec_and_args(self.cfg.encoder.as_str(), self.cfg.crf);
        let mut args = vec![
            "-y".into(), "-loglevel".into(), "error".into(),
            "-i".into(), input.to_string_lossy().into_owned(),
            "-vf".into(), vf,
            "-c:v".into(), codec.into(),
        ];
        args.extend(extra);
        args.extend([
            "-pix_fmt".into(), "yuv420p".into(),
            "-c:a".into(), "aac".into(),
            "-b:a".into(), "192k".into(),
            "-t".into(), self.cfg.max_duration_secs.to_string(),
            "-movflags".into(), "+faststart".into(),
            out.to_string_lossy().into_owned(),
        ]);
        args
    }

    /// Apply per-clip style overrides from the EDL to a copy of the config.
    fn effective_cfg(&self, edl: &EditDecisionList) -> RenderConfig {
        let mut cfg = self.cfg.clone();
        if let Some((w, h)) = edl.aspect() {
            cfg.width = w;
            cfg.height = h;
        }
        if let Some((family, size)) = edl.font() {
            cfg.subtitle_font = family;
            cfg.subtitle_size = size;
        }
        cfg
    }

    /// Build a speaker-locked crop timeline and write the ffmpeg command file.
    fn plan_framing(&self, input: &Path, trim_ms: i64, cmd: &Path) -> Result<Option<framing::FramingPlan>> {
        let (w, h) = framing::probe_dimensions(&self.ffmpeg, input)?;
        let mut tracker = framing::FaceTracker::load(Path::new(&self.cfg.face_model))?;
        let plan = tracker.track(input, &self.ffmpeg, trim_ms)?;
        if plan.points.is_empty() {
            return Ok(None);
        }
        plan.write_sendcmd(cmd, w, h)?;
        tracing::info!(
            "face framing: {}/{} frames had a face, {} keyframes",
            plan.detected_frames, plan.total_frames, plan.points.len()
        );
        Ok(Some(plan))
    }

    /// Render with a specific EDL. `ass_path` is where the generated subtitle
    /// file is written; it is deleted after the encode unless keep_subs is set.
    pub async fn render(
        &self,
        input: &Path,
        words: &[Word],
        edl: &EditDecisionList,
        ass_path: &Path,
        out: &Path,
        trim_start_ms: i64,
    ) -> Result<PathBuf> {
        let cfg = self.effective_cfg(edl);
        // Word timings are relative to the raw (whole-segment) file. Shifting
        // them by the precise trim keeps karaoke cues aligned with the picture.
        let ass = build_ass(words, &cfg, trim_start_ms);
        tokio::fs::write(ass_path, ass).await?;

        // Optional native face tracking. If the model is missing or detection
        // fails we silently fall back to the centred static crop: a clip that
        // renders is better than one that errors out.
        let cmd_path = out.with_extension("framing.sendcmd");
        let mut framing_path: Option<PathBuf> = None;
        if cfg.framing == "face" {
            match self.plan_framing(input, trim_start_ms, &cmd_path) {
                Ok(Some(_)) => framing_path = Some(cmd_path.clone()),
                Ok(None) => tracing::debug!("no faces detected; using static crop"),
                Err(e) => tracing::warn!("face tracking unavailable: {e}; using static crop"),
            }
        }
        let mut cmd = tokio::process::Command::new(&self.ffmpeg);
        cmd.args(["-y", "-loglevel", "error"]);
        if trim_start_ms > 0 {
            cmd.args(["-ss", &format!("{:.3}", trim_start_ms as f64 / 1000.0)]);
        }

        let template = templates::resolve(&cfg, edl);
        let clipship_graph = if clipship::is_clipship(&template.id) {
            clipship::build(&template.id, &cfg, edl.hook().map(|(t, _)| t).as_deref(), ass_path)
        } else {
            None
        };

        if let Some(graph) = &clipship_graph {
            // Loop each transparent frame PNG so it spans the whole clip, then
            // add the source video as input 0. No Clip Ship branding layers are
            // ever added; the hook text is already lowercase in the graph.
            for p in &graph.extra_inputs {
                cmd.args(["-loop", "1", "-framerate", "30", "-i"]).arg(p);
            }
            cmd.arg("-i").arg(input).args([
                "-filter_complex",
                &graph.filtergraph,
                "-map",
                "[vout]",
                "-map",
                "0:a:0",
            ]);
        } else if needs_complex_filter(edl) {
            let mut chain = complex_filter(&cfg, edl);
            if let Some(fp) = &framing_path {
                chain = chain.replacen("[0:v]", &format!("[0:v]sendcmd=f='{}',", filter_path(fp)), 1);
            }
            let overlays = TemplateOverlays {
                headline: edl.hook().map(|(text, _)| text),
                watermark: if cfg.watermark.is_empty() { None } else { Some(cfg.watermark.clone()) },
            };
            templates::apply_visual(&mut chain, &template, &cfg, &overlays);
            apply_extra_overlays(&mut chain, &cfg, edl);
            if cfg.burn_captions {
                chain.push_str(&format!(",subtitles=filename='{}':fontsdir='.'", filter_path(ass_path)));
            }
            chain.push_str("[vout]");
            cmd.arg("-i").arg(input)
                .args(["-filter_complex", &chain, "-map", "[vout]", "-map", "0:a?"]);
        } else {
            let mut vf = video_filter_with(&cfg, edl, Some(ass_path), framing_path.as_deref());
            apply_extra_overlays(&mut vf, &cfg, edl);
            cmd.arg("-i").arg(input).args(["-vf", &vf]);
        }
        if let Some(af) = audio_filter(&cfg, edl) {
            cmd.args(["-af", &af]);
        }
        let resolved_encoder = if cfg.encoder.eq_ignore_ascii_case("auto") {
            detect_best_encoder(&self.ffmpeg)
        } else {
            cfg.encoder.as_str()
        };
        let (codec, extra) = encoder_codec_and_args(resolved_encoder, cfg.crf);
        cmd.args(["-c:v", codec]);
        cmd.args(&extra);
        cmd.args(["-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                  "-t", &cfg.max_duration_secs.to_string(),
                  "-movflags", "+faststart"])
            .arg(out);
        pulsecut_capture::ffmpeg::run(cmd, "ffmpeg render").await?;
        Ok(out.to_path_buf())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_has_9_16_crop_and_pad() {
        let cfg = RenderConfig::default();
        let edl = EditDecisionList::default();
        let f = video_filter(&cfg, &edl, None);
        assert!(f.contains("crop=ih*9/16"));
        assert!(f.contains("scale=1080:1920"));
        assert!(f.contains("pad=1080:1920"));
    }

    #[test]
    fn edl_crop_overrides_default() {
        let cfg = RenderConfig::default();
        let mut edl = EditDecisionList::new("c");
        edl.push(EditOp::Crop { x: 0.1, y: 0.0, w: 0.8, h: 1.0 });
        let f = video_filter(&cfg, &edl, None);
        assert!(f.contains("crop=iw*0.8:ih*1:iw*0.1:ih*0"));
    }

    #[test]
    fn template_op_restyles_the_filter() {
        let cfg = RenderConfig::default();
        let mut edl = EditDecisionList::new("c");
        edl.push(EditOp::Template { id: "x_light".into() });
        edl.push(EditOp::Hook { text: "wait".into(), duration_ms: 1000 });
        let f = video_filter(&cfg, &edl, None);
        assert!(f.contains("color=0xFFFFFF"), "template background missing: {f}");
        assert!(f.contains("drawtext="), "headline missing: {f}");
        assert!(f.contains("wait"), "hook text missing: {f}");
    }

    #[test]
    fn framing_filter_uses_sendcmd_and_escapes_commas() {
        let cfg = RenderConfig::default();
        let f = video_filter_with(&cfg, &EditDecisionList::default(), None, Some(Path::new("cmds.txt")));
        assert!(f.contains("sendcmd=f='cmds.txt'"));
        assert!(f.contains("min(iw\\,ih*9/16)"), "commas must be escaped: {f}");
        assert!(f.contains("crop=trunc("));
    }

    #[test]
    fn pip_and_split_build_complex_chains() {
        let cfg = RenderConfig::default();
        let mut edl = EditDecisionList::new("c");
        edl.push(EditOp::Layout { preset: "pip".into() });
        assert!(needs_complex_filter(&edl));
        let f = complex_filter(&cfg, &edl);
        assert!(f.contains("[base][inset]overlay"));
        assert!(f.contains("scale=474:266"), "PiP inset should be a landscape 16:9 rectangle: {f}");
        edl.push(EditOp::Layout { preset: "split".into() });
        let f = complex_filter(&cfg, &edl);
        assert!(f.contains("vstack=inputs=2"));
    }

    #[test]
    fn blur_canvas_builds_background_chain() {
        let cfg = RenderConfig::default();
        let mut edl = EditDecisionList::new("c");
        edl.push(EditOp::Canvas { mode: "blur".into() });
        assert!(needs_complex_filter(&edl));
        assert!(complex_filter(&cfg, &edl).contains("gblur=sigma=24"));
    }

    #[test]
    fn audio_peak_and_extra_overlays() {
        let cfg = RenderConfig::default();
        let mut edl = EditDecisionList::new("c");
        edl.push(EditOp::AudioPeak { rise_ms: 5000, peak: 0.8 });
        let af = audio_filter(&cfg, &edl).unwrap();
        assert!(af.contains("eval=frame") && af.contains("0.80"));
        edl.push(EditOp::Outro { text: "Follow for more".into(), duration_ms: 3000 });
        edl.push(EditOp::SocialCard { handle: "@chan".into(), style: "verified".into() });
        let mut f = "crop=1:1".to_string();
        apply_extra_overlays(&mut f, &cfg, &edl);
        assert!(f.contains("Follow for more") && f.contains("@chan"));
    }

    #[test]
    fn default_template_has_no_overlays() {
        let cfg = RenderConfig::default();
        let f = video_filter(&cfg, &EditDecisionList::default(), None);
        assert!(!f.contains("drawtext="));
        assert!(f.contains("color=0x000000"));
    }

    #[test]
    fn args_select_x264_by_default() {
        let r = Renderer { cfg: RenderConfig::default(), ffmpeg: PathBuf::from("ffmpeg") };
        let a = r.args(Path::new("in.mp4"), None, Path::new("out.mp4"));
        assert!(a.iter().any(|x| x == "libx264"));
        assert!(a.iter().any(|x| x == "+faststart"));
    }
}
