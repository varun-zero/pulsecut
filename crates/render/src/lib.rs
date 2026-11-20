//! Turn a raw clipped MP4 into a platform-ready vertical short.
//!
//! The raw clip from the rolling buffer is a stream copy at native resolution.
//! This crate applies the non-destructive edit decision list, reframes to 9:16,
//! burns word-synced ASS captions, and encodes with the best available GPU
//! encoder (falling back to x264).

pub mod ass;
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
        ("pip", _) => format!(
            "[0:v]{base_crop},scale={w}:{h},setsar=1[base];\
             [0:v]crop=iw/3:ih/3:iw*0.58:ih*0.04,scale={iw}:{ih},setsar=1[inset];\
             [base][inset]overlay=x={ox}:y={oy}:format=auto",
            w = cfg.width, h = cfg.height,
            iw = cfg.width / 3, ih = cfg.height / 4,
            ox = cfg.width - cfg.width / 3 - 24,
            oy = cfg.height - cfg.height / 4 - 140,
        ),
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
        let color = if style == "verified" { "0x1D9BF0" } else { "0xFFFFFF" };
        f.push_str(&format!(
            ",drawbox=x=40:y={}:w=460:h=110:color={color}@0.85:t=fill",
            cfg.height as i64 - 420
        ));
        f.push_str(&format!(
            ",drawtext={font}text='{}':fontcolor=white:fontsize=42:x=70:y={}",
            templates::escape_drawtext(&handle),
            cfg.height as i64 - 395
        ));
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
        let crf = self.cfg.crf.to_string();
        // Max-quality encode: slow preset for better compression/quality at a
        // given CRF, higher-quality hardware presets, and 256k AAC audio.
        let (codec, extra) = match self.cfg.encoder.as_str() {
            "nvenc" => ("h264_nvenc", vec!["-preset", "p7", "-cq", "17", "-b:v", "0"]),
            "amf" => ("h264_amf", vec!["-quality", "quality"]),
            "qsv" => ("h264_qsv", vec!["-preset", "slow", "-global_quality", crf.as_str()]),
            _ => ("libx264", vec!["-preset", "slow", "-crf", crf.as_str()]),
        };
        let mut args = vec![
            "-y".into(), "-loglevel".into(), "error".into(),
            "-i".into(), input.to_string_lossy().into_owned(),
            "-vf".into(), vf,
            "-c:v".into(), codec.into(),
        ];
        for e in extra {
            args.push(e.into());
        }
        args.extend([
            "-pix_fmt".into(), "yuv420p".into(),
            "-c:a".into(), "aac".into(),
            "-b:a".into(), "256k".into(),
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

        if needs_complex_filter(edl) {
            let mut chain = complex_filter(&cfg, edl);
            if let Some(fp) = &framing_path {
                chain = chain.replacen("[0:v]", &format!("[0:v]sendcmd=f='{}',", filter_path(fp)), 1);
            }
            let template = templates::resolve(&cfg, edl);
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
        cmd.args(["-c:v", match cfg.encoder.as_str() {
            "nvenc" => "h264_nvenc", "amf" => "h264_amf", "qsv" => "h264_qsv", _ => "libx264",
        }]);
        let crf = cfg.crf.to_string();
        // Max-quality encode (kept in sync with Renderer::args above).
        let (_codec, extra): (&str, Vec<&str>) = match self.cfg.encoder.as_str() {
            "nvenc" => ("h264_nvenc", vec!["-preset", "p7", "-cq", "17", "-b:v", "0"]),
            "amf" => ("h264_amf", vec!["-quality", "quality"]),
            "qsv" => ("h264_qsv", vec!["-preset", "slow", "-global_quality", crf.as_str()]),
            _ => ("libx264", vec!["-preset", "slow", "-crf", crf.as_str()]),
        };
        cmd.args(&extra);
        cmd.args(["-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k",
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
