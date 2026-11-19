//! ASS subtitle generation with word-by-word karaoke highlights.
//!
//! ASS is the right format here: it is the only common subtitle format that
//! supports per-syllable `\k` timing, so word-synced captions burn directly
//! with libass inside ffmpeg without a second rendering pass.

use pulsecut_core::config::RenderConfig;
use pulsecut_core::model::Word;

/// ASS time: H:MM:SS.cc (centiseconds).
fn ass_time(ms: i64) -> String {
    let ms = ms.max(0);
    let cs = ms / 10;
    let h = cs / 360_000;
    let m = (cs / 6_000) % 60;
    let s = (cs / 100) % 60;
    let c = cs % 100;
    format!("{h}:{m:02}:{s:02}.{c:02}")
}

fn sanitize(text: &str) -> String {
    text.chars()
        .filter(|c| *c != '{' && *c != '}' && *c != '\n' && *c != '\r')
        .map(|c| if c == ',' { ' ' } else { c })
        .collect()
}

/// Build a complete ASS file for the given words, offset so the first word
/// starts at 0 (ASS timestamps are relative to the clip file).
pub fn build_ass(words: &[Word], cfg: &RenderConfig, clip_start_ms: i64) -> String {
    let color = match cfg.caption_style.as_str() {
        "karaoke_bold" => "&H00FFFFFF,&H0000FFFF",
        "clean" => "&H00FFFFFF,&H00FFFFFF",
        _ => "&H00FFFFFF,&H0000FFFF",
    };
    let mut primary = color.split(',');
    let p = primary.next().unwrap_or("&H00FFFFFF");
    let s = primary.next().unwrap_or("&H0000FFFF");
    let bold = if cfg.caption_style == "karaoke_bold" { -1 } else { -1 };
    let mut out = format!(
        "[Script Info]\n\
         ScriptType: v4.00+\n\
         PlayResX: {}\n\
         PlayResY: {}\n\
         WrapStyle: 2\n\
         ScaledBorderAndShadow: yes\n\n\
         [V4+ Styles]\n\
         Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n\
         Style: Default,{},{},{},{},&H00000000,&H90000000,{bold},0,0,0,100,100,0,0,1,3,2,2,40,40,{},1\n\n\
         [Events]\n\
         Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",
        cfg.width, cfg.height, cfg.subtitle_font, cfg.subtitle_size, p, s, cfg.safe_zone_bottom
    );

    // Group words into cues of at most ~7 words / 3.5 seconds so captions stay
    // readable and never collide with the platform UI.
    let mut cues: Vec<(i64, i64, Vec<&Word>)> = Vec::new();
    for w in words {
        let start = w.start_ms - clip_start_ms;
        let end = w.end_ms - clip_start_ms;
        if start < 0 {
            continue;
        }
        let can_join = cues.last().map_or(false, |(cs, ce, group)| {
            end - *cs < 3_500 && group.len() < 7 && start <= *ce + 250
        });
        if can_join {
            let cue = cues.last_mut().unwrap();
            cue.1 = end;
            cue.2.push(w);
        } else {
            cues.push((start, end, vec![w]));
        }
    }

    for (start, end, group) in cues {
        let mut line = String::new();
        for w in &group {
            let dur = (w.end_ms - w.start_ms).max(40) / 10;
            line.push_str(&format!("{{\\k{}}}{} ", dur, sanitize(&w.text)));
        }
        out.push_str(&format!(
            "Dialogue: 0,{},{},Default,,0,0,0,,{}\n",
            ass_time(start),
            ass_time(end.max(start + 400)),
            line.trim_end()
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ass_has_header_and_cue() {
        let cfg = RenderConfig::default();
        let words = vec![
            Word { text: "hello".into(), start_ms: 1000, end_ms: 1300, confidence: 0.9 },
            Word { text: "world".into(), start_ms: 1350, end_ms: 1700, confidence: 0.9 },
        ];
        let ass = build_ass(&words, &cfg, 1000);
        assert!(ass.contains("[V4+ Styles]"));
        assert!(ass.contains("Dialogue:"));
        assert!(ass.contains("{\\k30}hello"));
        assert!(ass.contains("0:00:00.00"));
    }

    #[test]
    fn sanitize_removes_override_braces() {
        assert_eq!(sanitize("a{b}c,d"), "abc d");
    }
}
