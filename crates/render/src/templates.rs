//! Ready-made shorts templates.
//!
//! A template is two things at once: a visual treatment (canvas colour, card,
//! headline, watermark) and a metadata preset (title pattern, hook pattern,
//! hashtag set). Keeping both in one place is what makes a template feel like
//! a finished format rather than a collection of toggles.
//!
//! Templates are resolved from the config, then overridden by an EDL
//! `Template` op, so the editor can restyle a clip without re-recording it.

use pulsecut_core::config::RenderConfig;
use pulsecut_core::edl::{EditDecisionList, EditOp};

pub fn hex((r, g, b): (u8, u8, u8)) -> String {
    format!("0x{r:02X}{g:02X}{b:02X}")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShortTemplate {
    pub id: &'static str,
    pub name: &'static str,
    pub background: (u8, u8, u8),
    pub accent: (u8, u8, u8),
    pub card: bool,
    pub headline: bool,
    pub ticker: bool,
    pub watermark: bool,
    pub caption_preset: &'static str,
    pub title_pattern: &'static str,
    pub hook_pattern: &'static str,
    pub hashtags: &'static [&'static str],
}

/// The built-in library. No external assets: every template is pure ffmpeg
/// filter graph, so exports stay fully offline and deterministic.
pub fn library() -> Vec<ShortTemplate> {
    vec![
        ShortTemplate {
            id: "default", name: "Plain", background: (0, 0, 0), accent: (255, 255, 255),
            card: false, headline: false, ticker: false, watermark: false,
            caption_preset: "karaoke", title_pattern: "{title}", hook_pattern: "{hook}",
            hashtags: &[],
        },
        ShortTemplate {
            id: "clean", name: "Clean", background: (10, 12, 16), accent: (255, 255, 255),
            card: false, headline: false, ticker: false, watermark: false,
            caption_preset: "clean", title_pattern: "{title}", hook_pattern: "{hook}",
            hashtags: &["shorts", "clip"],
        },
        ShortTemplate {
            id: "x_light", name: "X · Light", background: (255, 255, 255), accent: (15, 15, 15),
            card: true, headline: true, ticker: false, watermark: true,
            caption_preset: "karaoke", title_pattern: "{title} | {channel}",
            hook_pattern: "{hook}", hashtags: &["clips", "twitter", "viral"],
        },
        ShortTemplate {
            id: "x_dark", name: "X · Dark", background: (12, 14, 18), accent: (235, 240, 245),
            card: true, headline: true, ticker: false, watermark: true,
            caption_preset: "karaoke", title_pattern: "{title} | {channel}",
            hook_pattern: "{hook}", hashtags: &["clips", "twitter", "viral"],
        },
        ShortTemplate {
            id: "tiktok_hook", name: "TikTok Hook", background: (8, 8, 12), accent: (255, 235, 70),
            card: false, headline: true, ticker: false, watermark: false,
            caption_preset: "karaoke_bold", title_pattern: "{hook} — {title}",
            hook_pattern: "{hook}", hashtags: &["fyp", "foryou", "clips", "viral"],
        },
        ShortTemplate {
            id: "breaking_news", name: "Breaking News", background: (18, 6, 6), accent: (230, 45, 40),
            card: true, headline: true, ticker: true, watermark: false,
            caption_preset: "karaoke_bold", title_pattern: "BREAKING: {title}",
            hook_pattern: "{hook}", hashtags: &["news", "breaking", "clips"],
        },
        ShortTemplate {
            id: "gradient_cta", name: "Gradient CTA", background: (28, 16, 48), accent: (150, 110, 255),
            card: true, headline: true, ticker: false, watermark: true,
            caption_preset: "karaoke", title_pattern: "{title} — follow {channel}",
            hook_pattern: "{hook}", hashtags: &["shorts", "follow", "clips"],
        },
        ShortTemplate {
            id: "podcast_split", name: "Podcast Split", background: (14, 16, 20), accent: (90, 200, 160),
            card: false, headline: true, ticker: false, watermark: true,
            caption_preset: "clean", title_pattern: "{title} · {channel}",
            hook_pattern: "{hook}", hashtags: &["podcast", "interview", "clips"],
        },
        ShortTemplate {
            id: "gaming_reaction", name: "Gaming Reaction", background: (10, 12, 18), accent: (255, 120, 60),
            card: false, headline: true, ticker: false, watermark: true,
            caption_preset: "karaoke_bold", title_pattern: "{hook} — {title}",
            hook_pattern: "{hook}", hashtags: &["gaming", "clutch", "fyp"],
        },
        ShortTemplate {
            id: "minimal_gradient", name: "Minimal Gradient", background: (24, 20, 40), accent: (170, 130, 255),
            card: false, headline: false, ticker: false, watermark: false,
            caption_preset: "karaoke", title_pattern: "{title}",
            hook_pattern: "{hook}", hashtags: &["aesthetic", "shorts", "clips"],
        },
        ShortTemplate {
            id: "smartphone", name: "Smartphone Mockup Frame", background: (12, 14, 20), accent: (90, 110, 140),
            card: true, headline: true, ticker: false, watermark: false,
            caption_preset: "clean", title_pattern: "{hook}",
            hook_pattern: "{hook}", hashtags: &["mobile", "mockup", "fyp"],
        },
        ShortTemplate {
            id: "x_terminal", name: "Terminal Snippet", background: (8, 12, 10), accent: (70, 220, 130),
            card: true, headline: false, ticker: false, watermark: false,
            caption_preset: "karaoke_bold", title_pattern: "$ {title}",
            hook_pattern: "{hook}", hashtags: &["code", "terminal", "dev"],
        },
        ShortTemplate {
            id: "youtube_shorts", name: "Shorts Progress Bar", background: (18, 12, 24), accent: (255, 70, 120),
            card: false, headline: true, ticker: false, watermark: true,
            caption_preset: "karaoke_bold", title_pattern: "{hook} — {title}",
            hook_pattern: "{hook}", hashtags: &["shorts", "youtube", "viral"],
        },
        ShortTemplate {
            id: "minimal_cinema", name: "Minimalist Cinema Quote", background: (10, 10, 12), accent: (245, 245, 245),
            card: false, headline: true, ticker: false, watermark: false,
            caption_preset: "clean", title_pattern: "“{title}”",
            hook_pattern: "{hook}", hashtags: &["cinema", "quote", "aesthetic"],
        },
        ShortTemplate {
            id: "shorts_progress", name: "Shorts Progress", background: (20, 14, 28), accent: (255, 80, 130),
            card: false, headline: true, ticker: false, watermark: false,
            caption_preset: "karaoke_bold", title_pattern: "{hook}",
            hook_pattern: "{hook}", hashtags: &["shorts", "retention", "fyp"],
        },
        ShortTemplate {
            id: "post_hook", name: "Post Hook Card", background: (16, 16, 18), accent: (255, 230, 90),
            card: true, headline: true, ticker: false, watermark: true,
            caption_preset: "karaoke", title_pattern: "{hook}",
            hook_pattern: "{hook}", hashtags: &["hook", "viral", "clips"],
        },
        ShortTemplate {
            id: "centered_canvas", name: "Centered 9:16 Canvas", background: (18, 18, 20), accent: (210, 210, 215),
            card: false, headline: false, ticker: false, watermark: false,
            caption_preset: "clean", title_pattern: "{title}",
            hook_pattern: "{hook}", hashtags: &["canvas", "shorts", "clips"],
        },
        ShortTemplate {
            id: "wide_16x9", name: "16:9 Clip", background: (12, 12, 14), accent: (230, 230, 235),
            card: false, headline: false, ticker: false, watermark: false,
            caption_preset: "clean", title_pattern: "{title}",
            hook_pattern: "{hook}", hashtags: &["clip", "wide", "shorts"],
        },
        ShortTemplate {
            id: "editorial", name: "Calm Editorial", background: (246, 245, 243), accent: (26, 26, 25),
            card: true, headline: true, ticker: false, watermark: true,
            caption_preset: "clean", title_pattern: "“{title}”",
            hook_pattern: "{hook}", hashtags: &["culture", "insights", "deepdive"],
        },
        ShortTemplate {
            id: "street", name: "Streetwear Bold", background: (12, 12, 14), accent: (224, 254, 16),
            card: true, headline: true, ticker: false, watermark: true,
            caption_preset: "karaoke_bold", title_pattern: "{hook} // {title}",
            hook_pattern: "{hook}", hashtags: &["street", "fyp", "viral", "trending"],
        },
        ShortTemplate {
            id: "kick-stream", name: "Kick Viral Clip", background: (9, 9, 11), accent: (83, 252, 24),
            card: false, headline: true, ticker: false, watermark: true,
            caption_preset: "karaoke_bold", title_pattern: "{title}",
            hook_pattern: "{hook}", hashtags: &["kick", "clips", "viral"],
        },
        ShortTemplate {
            id: "insta-short", name: "Instagram Reels Clip", background: (9, 9, 11), accent: (225, 48, 108),
            card: false, headline: true, ticker: false, watermark: true,
            caption_preset: "karaoke", title_pattern: "{title}",
            hook_pattern: "{hook}", hashtags: &["reels", "instagram", "clips"],
        },
        ShortTemplate {
            id: "yt-short", name: "YouTube Shorts Clip", background: (9, 9, 11), accent: (255, 0, 0),
            card: false, headline: true, ticker: false, watermark: true,
            caption_preset: "karaoke_bold", title_pattern: "{title}",
            hook_pattern: "{hook}", hashtags: &["shorts", "youtube", "clips"],
        },
        ShortTemplate {
            id: "reaction-pip", name: "Clipper Reaction PiP", background: (9, 9, 11), accent: (255, 120, 60),
            card: false, headline: true, ticker: false, watermark: true,
            caption_preset: "karaoke_bold", title_pattern: "{title}",
            hook_pattern: "{hook}", hashtags: &["reaction", "shorts", "clips"],
        },
        ShortTemplate {
            id: "split-stream", name: "Streamer Split Cam", background: (9, 9, 11), accent: (83, 252, 24),
            card: false, headline: true, ticker: false, watermark: true,
            caption_preset: "karaoke_bold", title_pattern: "{title}",
            hook_pattern: "{hook}", hashtags: &["stream", "clips", "shorts"],
        },
    ]
}

/// Layout preset implied by a ready-made template, if any.
pub fn layout_for(id: &str) -> Option<&'static str> {
    match id {
        "podcast_split" | "split-stream" | "dual_react" => Some("split"),
        "reaction-pip" | "gaming_reaction" | "youtube_shorts" | "shorts_progress" => Some("pip"),
        "kick-stream" | "insta-short" | "yt-short" | "smartphone" | "centered_canvas" | "wide_16x9" | "editorial" | "street" => Some("solo"),
        _ => None,
    }
}

pub fn get(id: &str) -> Option<ShortTemplate> {
    library().into_iter().find(|t| t.id == id)
}

/// EDL template op wins over config, which wins over the plain default.
pub fn resolve(cfg: &RenderConfig, edl: &EditDecisionList) -> ShortTemplate {
    let from_edl = edl.ops.iter().rev().find_map(|op| match op {
        EditOp::Template { id } => Some(id.clone()),
        _ => None,
    });
    let id = from_edl.unwrap_or_else(|| cfg.template.clone());
    get(&id).unwrap_or_else(|| get("default").expect("default template exists"))
}

/// Escape text for an ffmpeg `drawtext` option.
pub fn escape_drawtext(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '\\' => "\\\\".into(),
            ':' => "\\:".into(),
            '\'' => "\\'".into(),
            '%' => "\\%".into(),
            '\n' | '\r' => " ".into(),
            other => other.to_string(),
        })
        .collect()
}

pub fn font_prefix(cfg: &RenderConfig) -> String {
    if !cfg.font_file.is_empty() {
        return format!("fontfile='{}':", super::filter_path(std::path::Path::new(&cfg.font_file)));
    }
    let windows_font = "C:/Windows/Fonts/arial.ttf";
    if cfg!(windows) && std::path::Path::new(windows_font).exists() {
        return format!("fontfile='{}':", super::filter_path(std::path::Path::new(windows_font)));
    }
    String::new()
}

/// Overlay content supplied by the editor/config.
#[derive(Debug, Default, Clone)]
pub struct TemplateOverlays {
    pub headline: Option<String>,
    pub watermark: Option<String>,
}

/// Append template filters to an already-built base chain. Called after the
/// canvas/scale/pad but before subtitles so captions always stay on top.
pub fn apply_visual(
    filter: &mut String,
    t: &ShortTemplate,
    cfg: &RenderConfig,
    overlays: &TemplateOverlays,
) {
    let font = font_prefix(cfg);
    let h = cfg.height as i64;
    let w = cfg.width as i64;
    let top = cfg.safe_zone_top as i64;

    if t.card && overlays.headline.is_some() {
        filter.push_str(&format!(
            ",drawbox=x=40:y={}:w={}:h=130:color={}@0.72:t=fill",
            top - 20, w - 80, hex(t.accent)
        ));
    }
    if t.headline {
        if let Some(text) = &overlays.headline {
            filter.push_str(&format!(
                ",drawtext={}text='{}':fontcolor=white:fontsize={}:x=(w-text_w)/2:y={}:shadowcolor=black:shadowx=2:shadowy=2",
                font,
                escape_drawtext(text),
                (cfg.subtitle_size as f64 * 0.85) as i64,
                top + 10
            ));
        }
    }
    if t.ticker {
        filter.push_str(&format!(
            ",drawbox=x=0:y={}:w={}:h=90:color={}:t=fill",
            h - 110, w, hex(t.accent)
        ));
        filter.push_str(&format!(
            ",drawtext={}text='LIVE':fontcolor=white:fontsize=48:x=60:y={}",
            font,
            h - 95
        ));
    }
    if t.watermark {
        if let Some(handle) = &overlays.watermark {
            filter.push_str(&format!(
                ",drawtext={}text='{}':fontcolor=white:fontsize=40:x=w-text_w-50:y={}:box=1:boxcolor=black@0.5:boxborderw=12",
                font,
                escape_drawtext(handle),
                h - cfg.safe_zone_bottom as i64
            ));
        }
    }
}

/// Final metadata for a chosen template. AI output is the raw material; the
/// template adds its voice, hook pattern and hashtag set.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TemplateMetadata {
    pub title: String,
    pub description: String,
    pub hashtags: Vec<String>,
    pub hook: String,
    pub template_id: String,
}

pub fn apply_metadata(
    t: &ShortTemplate,
    title: &str,
    description: &str,
    hook: &str,
    hashtags: &[String],
    channel: &str,
) -> TemplateMetadata {
    let fill = |pattern: &str| -> String {
        pattern
            .replace("{title}", title)
            .replace("{hook}", hook)
            .replace("{channel}", channel)
    };
    let mut tags: Vec<String> = hashtags
        .iter()
        .cloned()
        .chain(t.hashtags.iter().map(|s| s.to_string()))
        .map(|h| h.trim_start_matches('#').to_ascii_lowercase())
        .filter(|h| !h.is_empty())
        .collect();
    tags.sort();
    tags.dedup();
    tags.truncate(8);

    TemplateMetadata {
        title: fill(t.title_pattern).chars().take(60).collect(),
        description: description.to_string(),
        hashtags: tags,
        hook: fill(t.hook_pattern).chars().take(45).collect(),
        template_id: t.id.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> RenderConfig { RenderConfig::default() }

    #[test]
    fn all_builtins_resolve() {
        for t in library() {
            assert_eq!(get(t.id).unwrap().name, t.name);
        }
        assert_eq!(get("nope").unwrap_or_else(|| get("default").unwrap()).id, "default");
    }

    #[test]
    fn edl_template_overrides_config() {
        let mut c = cfg();
        c.template = "x_dark".into();
        let mut edl = EditDecisionList::new("c");
        assert_eq!(resolve(&c, &edl).id, "x_dark");
        edl.push(EditOp::Template { id: "breaking_news".into() });
        assert_eq!(resolve(&c, &edl).id, "breaking_news");
    }

    #[test]
    fn template_draws_headline_and_watermark() {
        let t = get("x_light").unwrap();
        let mut f = "crop=...,scale=1080:1920".to_string();
        apply_visual(&mut f, &t, &cfg(), &TemplateOverlays {
            headline: Some("wait for it".into()),
            watermark: Some("@streamer".into()),
        });
        assert!(f.contains("drawbox"));
        assert!(f.contains("drawtext=fontfile=") || f.contains("drawtext=text="));
        assert!(f.contains("wait for it"));
        assert!(f.contains("@streamer"));
    }

    #[test]
    fn breaking_news_has_ticker() {
        let t = get("breaking_news").unwrap();
        let mut f = String::new();
        apply_visual(&mut f, &t, &cfg(), &TemplateOverlays { headline: Some("GO".into()), watermark: None });
        assert!(f.contains("LIVE"));
        assert!(f.contains("drawbox"));
    }

    #[test]
    fn metadata_preset_fills_patterns_and_dedupes_tags() {
        let t = get("tiktok_hook").unwrap();
        let m = apply_metadata(&t, "Insane clutch", "desc", "wait for it", &["#fyp".into(), "clips".into()], "chan");
        assert_eq!(m.title, "wait for it — Insane clutch");
        assert!(m.hashtags.contains(&"fyp".into()));
        assert!(m.hashtags.contains(&"clips".into()));
        assert_eq!(m.hashtags.iter().filter(|h| *h == "fyp").count(), 1);
        assert_eq!(m.template_id, "tiktok_hook");
    }

    #[test]
    fn escape_drawtext_handles_colons() {
        assert_eq!(escape_drawtext("a:b'c\\d"), "a\\:b\\'c\\\\d");
    }
}
