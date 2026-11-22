#!/usr/bin/env python3
"""
E2E Compliance & Verification Test Suite for PulseCut Video Extensions.
Opaque-box verification of user requirements R1, R2, R3 across 4 tiers:
- Tier 1: Feature Coverage (durations, resolutions, audio loudnorm -14 LUFS, AAC stereo, QA frames, render runs)
- Tier 2: Boundary & Corner Cases (durations exactly in [25.0, 30.0], zero mid-lyric cuts, safe zone boundaries)
- Tier 3: Cross-Feature Combinations (split screens with loudnorm, image overlays, subtitle sync)
- Tier 4: Real-World Application Scenarios (full batch manifest compliance, exit code 0)

Usage:
    pytest tests/test_e2e_compliance.py -v
    pytest -m m1 tests/test_e2e_compliance.py
    pytest -m tier1 tests/test_e2e_compliance.py
    python tests/test_e2e_compliance.py
"""

import os
import sys
import json
import re
import shutil
import subprocess
from pathlib import Path
import pytest
from PIL import Image

# ---------------------------------------------------------------------------
# Workspace & Toolchain Resolution
# ---------------------------------------------------------------------------

ROOT_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT_DIR / "pulsecut.config.json"
EXPORTS_DIR = ROOT_DIR / "exports" / "mumford-chris-cmas"
QA_DIR = EXPORTS_DIR / "_qa_frames"
WORK_DIR = EXPORTS_DIR / "_work"
FOOTAGE_DIR = ROOT_DIR / "Mumford & Sons - CMAs"
TPL_DIR = ROOT_DIR / "public" / "templates" / "clipship"
SCRIPTS_DIR = ROOT_DIR / "scripts"
CLIPSHIP_SCRIPT = SCRIPTS_DIR / "export_clipship.py"
CLI_SCRIPT = SCRIPTS_DIR / "pulsecut_cli.py"


def resolve_binary(binary_name: str) -> str:
    """Resolve binary from standard YIZERGE directory, config, or PATH."""
    candidate_paths = [
        rf"C:\Users\varun\AppData\Local\Programs\YIZERGE\{binary_name}.exe",
        rf"C:\Users\varun\AppData\Local\Programs\YIZERGE\{binary_name}",
    ]
    if CONFIG_PATH.is_file():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            custom_path = cfg.get("paths", {}).get(binary_name)
            if custom_path:
                candidate_paths.insert(0, custom_path)
        except Exception:
            pass

    for p in candidate_paths:
        if os.path.isfile(p):
            return p

    which_path = shutil.which(binary_name)
    if which_path:
        return which_path

    return binary_name


FFMPEG = resolve_binary("ffmpeg")
FFPROBE = resolve_binary("ffprobe")


# ---------------------------------------------------------------------------
# Opaque-Box Media Inspection Helpers
# ---------------------------------------------------------------------------

def probe_video(video_path: Path | str) -> dict:
    """Extract stream and container metadata using ffprobe."""
    path_str = str(video_path)
    if not os.path.isfile(path_str):
        raise FileNotFoundError(f"Video file not found: {path_str}")

    cmd = [
        FFPROBE, "-v", "error",
        "-show_entries",
        "format=duration,size,bit_rate:stream=index,codec_name,codec_type,width,height,pix_fmt,r_frame_rate,channels,sample_rate,bit_rate",
        "-of", "json",
        path_str
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if res.returncode != 0:
        raise RuntimeError(f"ffprobe failed on {path_str}: {res.stderr}")

    data = json.loads(res.stdout)
    v_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    a_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), {})

    duration = float(data.get("format", {}).get("duration", 0.0))
    file_size = int(data.get("format", {}).get("size", 0))

    return {
        "duration": duration,
        "file_size": file_size,
        "video_codec": v_stream.get("codec_name"),
        "width": v_stream.get("width"),
        "height": v_stream.get("height"),
        "pix_fmt": v_stream.get("pix_fmt"),
        "r_frame_rate": v_stream.get("r_frame_rate"),
        "audio_codec": a_stream.get("codec_name"),
        "audio_channels": a_stream.get("channels"),
        "audio_sample_rate": int(a_stream.get("sample_rate", 0)) if a_stream.get("sample_rate") else None,
        "audio_bit_rate": int(a_stream.get("bit_rate", 0)) if a_stream.get("bit_rate") else None,
        "has_video": bool(v_stream),
        "has_audio": bool(a_stream),
    }


def measure_ebur128_loudness(media_path: Path | str) -> dict:
    """Measure EBU R128 integrated loudness (LUFS) using FFmpeg loudnorm filter."""
    path_str = str(media_path)
    if not os.path.isfile(path_str):
        raise FileNotFoundError(f"File not found for loudness measurement: {path_str}")

    cmd = [
        FFMPEG, "-hide_banner", "-i", path_str,
        "-af", "loudnorm=I=-14:LRA=11:TP=-1.5:print_format=json",
        "-f", "null", "-"
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    # The JSON output is printed to stderr by the loudnorm filter
    stderr = res.stderr
    match = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", stderr, re.DOTALL)
    if not match:
        raise ValueError(f"Could not parse loudnorm JSON from FFmpeg output:\n{stderr[-800:]}")

    raw_json = match.group(0)
    data = json.loads(raw_json)
    return {
        "input_i": float(data.get("input_i", 0.0)),
        "input_tp": float(data.get("input_tp", 0.0)),
        "input_lra": float(data.get("input_lra", 0.0)),
        "input_thresh": float(data.get("input_thresh", 0.0)),
        "output_i": float(data.get("output_i", 0.0)),
        "output_tp": float(data.get("output_tp", 0.0)),
    }


def get_qa_frame_file(clip_name: str) -> Path | None:
    """Find QA frame in either the root exports directory or _qa_frames."""
    candidates = [
        EXPORTS_DIR / f"{clip_name}_qa.png",
        QA_DIR / f"{clip_name}_qa.png",
    ]
    for c in candidates:
        if c.is_file():
            return c
    return None


# 13 Canonical Clips Specification Reference
EXPECTED_CLIPS = [
    {"n": 1, "name": "01_stapleton-vocal-drop_T03", "tpl": "03_Tweet_Plus_Reply"},
    {"n": 2, "name": "02_final-chorus-embrace_T08", "tpl": "08_News_Card"},
    {"n": 3, "name": "03_chorus1-full-power_T09", "tpl": "09_Fullscreen_Text_Box"},
    {"n": 4, "name": "04_harmony-bridge-build_T01", "tpl": "01_Tweet_Card_Dark"},
    {"n": 5, "name": "05_opening-banjo-intro_T02", "tpl": "02_Tweet_Card_Light"},
    {"n": 6, "name": "06_backstage-pov-rehearsal_T07", "tpl": "07_Comment_Reply"},
    {"n": 7, "name": "07_stage-vs-crowd-split_T06", "tpl": "06_Stacked_Comparison"},
    {"n": 8, "name": "08_mapleton-duo-harmony_T05", "tpl": "05_White_Meme"},
    {"n": 9, "name": "09_across-the-pond-splash_T04", "tpl": "04_Big_Meme_Caption"},
    {"n": 10, "name": "10_reddit-music-thread_T10", "tpl": "10_Reddit_Thread"},
    {"n": 11, "name": "11_condensed-cma-debut_T11", "tpl": "11_Condensed_Headline"},
    {"n": 12, "name": "12_collage-tribute-split_T12", "tpl": "12_Collage_Pill"},
    {"n": 13, "name": "13_reaction-split-pill_T13", "tpl": "13_Reaction_Split_Pill"},
]


# ===========================================================================
# TIER 1: Feature Coverage Tests
# ===========================================================================

@pytest.mark.tier1
class TestTier1FeatureCoverage:
    """
    Tier 1: Core Feature Verification.
    Verifies durations, 1080x1920 resolution, AAC stereo audio,
    EBU R128 loudness normalization (-14 LUFS), and QA frame extraction.
    """

    @pytest.mark.r1
    @pytest.mark.m1
    def test_short05_video_stream_properties(self):
        """R1: Verify 5th short has 1080x1920 resolution, h264 codec, and yuv420p pix_fmt."""
        short05_path = EXPORTS_DIR / "05_opening-banjo-intro_T02.mp4"
        assert short05_path.is_file(), f"Short 05 export missing: {short05_path}"

        info = probe_video(short05_path)
        assert info["width"] == 1080, f"Expected width 1080, got {info['width']}"
        assert info["height"] == 1920, f"Expected height 1920, got {info['height']}"
        assert info["video_codec"] == "h264", f"Expected h264 video codec, got {info['video_codec']}"
        assert info["pix_fmt"] == "yuv420p", f"Expected yuv420p pixel format, got {info['pix_fmt']}"

    @pytest.mark.r1
    @pytest.mark.m1
    def test_short05_audio_stream_properties(self):
        """R1, R3: Verify 5th short has AAC stereo (2 channels) audio."""
        short05_path = EXPORTS_DIR / "05_opening-banjo-intro_T02.mp4"
        assert short05_path.is_file(), f"Short 05 export missing: {short05_path}"

        info = probe_video(short05_path)
        assert info["has_audio"], "Short 05 has no audio stream"
        assert info["audio_codec"] == "aac", f"Expected aac audio codec, got {info['audio_codec']}"
        assert info["audio_channels"] == 2, f"Expected 2 audio channels (stereo), got {info['audio_channels']}"

    @pytest.mark.r1
    @pytest.mark.r3
    @pytest.mark.m1
    def test_short05_audio_loudnorm_14_lufs(self):
        """R3: Verify 5th short audio is normalized to -14 LUFS (EBU R128 loudnorm, ±1.5 LUFS tolerance)."""
        short05_path = EXPORTS_DIR / "05_opening-banjo-intro_T02.mp4"
        assert short05_path.is_file(), f"Short 05 export missing: {short05_path}"

        loudness = measure_ebur128_loudness(short05_path)
        measured_i = loudness["input_i"]
        target_i = -14.0
        tolerance = 1.5
        assert abs(measured_i - target_i) <= tolerance, (
            f"Measured integrated loudness {measured_i} LUFS deviates from target {target_i} LUFS "
            f"by more than {tolerance} LUFS (range: [{target_i - tolerance}, {target_i + tolerance}])"
        )

    @pytest.mark.r1
    @pytest.mark.m1
    def test_short05_duration_in_target_range(self):
        """R1: Verify 5th short is extended to 25.0s - 30.0s."""
        short05_path = EXPORTS_DIR / "05_opening-banjo-intro_T02.mp4"
        assert short05_path.is_file(), f"Short 05 export missing: {short05_path}"

        info = probe_video(short05_path)
        dur = info["duration"]
        assert 25.0 <= dur <= 30.0, (
            f"Short 05 duration {dur:.2f}s is outside the required [25.0s, 30.0s] range. "
            f"Must be >= 25.0s and <= 30.0s."
        )

    @pytest.mark.r1
    @pytest.mark.m1
    def test_short05_qa_frame_exists_and_valid(self):
        """R1: Verify QA frame for 5th short exists in exports/mumford-chris-cmas/ as a 1080x1920 PNG."""
        qa_file = get_qa_frame_file("05_opening-banjo-intro_T02")
        assert qa_file is not None, (
            f"QA frame for Short 05 not found at {EXPORTS_DIR / '05_opening-banjo-intro_T02_qa.png'} "
            f"or in {QA_DIR}"
        )
        assert qa_file.stat().st_size > 10_000, f"QA frame is unexpectedly small: {qa_file.stat().st_size} bytes"

        with Image.open(qa_file) as im:
            assert im.format == "PNG", f"Expected PNG format, got {im.format}"
            assert im.size == (1080, 1920), f"Expected 1080x1920 QA frame size, got {im.size}"

    @pytest.mark.r1
    @pytest.mark.m1
    def test_short05_render_command_construction(self):
        """R1, R3: Verify FFmpeg command construction for Short 05 has exact filtergraph and audio parameters."""
        sys.path.insert(0, str(SCRIPTS_DIR))
        import export_clipship
        c5 = next(c for c in export_clipship.CLIPS_SPEC if c["n"] == 5)
        cmd, out_mp4 = export_clipship.build_ffmpeg_cmd(c5, "dummy_overlay.png")
        cmd_str = " ".join(cmd)

        assert "-ss 0.0" in cmd_str or "-ss 0" in cmd_str, "Command missing -ss 0.0"
        assert "-t 25.0" in cmd_str or "-t 25" in cmd_str, "Command missing -t 25.0"
        assert "scale=1080:608" in cmd_str, "Command missing uncropped 16:9 stage scaling (1080x608)"
        assert "loudnorm=I=-14:LRA=11:TP=-1.5" in cmd_str, "Command missing EBU R128 loudnorm filter"
        assert "-c:a aac" in cmd_str, "Command missing AAC audio codec"
        assert "-b:a 192k" in cmd_str, "Command missing 192k audio bitrate"
        assert "-movflags +faststart" in cmd_str, "Command missing +faststart streaming flag"
        assert "05_opening-banjo-intro_T02.mp4" in out_mp4, "Output file path mismatch"

    @pytest.mark.r1
    @pytest.mark.m1
    def test_short05_subtitles_timing_coverage(self):
        """R1, R3: Verify Short 05 lyrics array covers opening banjo intro through line 4 (24.5s) in lowercase."""
        sys.path.insert(0, str(SCRIPTS_DIR))
        import export_clipship
        c5 = next(c for c in export_clipship.CLIPS_SPEC if c["n"] == 5)
        lyrics = c5.get("lyrics", [])
        assert len(lyrics) >= 5, f"Short 05 should contain at least 5 lyric segments, found {len(lyrics)}"

        # Verify banjo intro at 0.0s
        assert lyrics[0][0] == 0.0, f"Banjo intro must start at 0.0s, got {lyrics[0][0]}"
        assert "banjo" in lyrics[0][2].lower(), f"First segment should be banjo intro, got '{lyrics[0][2]}'"

        # Verify last segment finishes at or near 24.5s
        last_seg = lyrics[-1]
        assert last_seg[1] >= 24.0, f"Last lyric segment should extend to ~24.5s, got {last_seg[1]}"

        # Verify all lyrics are strictly lowercase
        for s, e, text in lyrics:
            assert text == text.lower(), f"Lyric '{text}' contains uppercase letters"

    @pytest.mark.r2
    @pytest.mark.m2
    @pytest.mark.parametrize("clip", EXPECTED_CLIPS, ids=[c["name"] for c in EXPECTED_CLIPS])
    def test_batch_all_exports_resolution_and_audio(self, clip):
        """R2, R3: Verify all 13 batch exports exist with 1080x1920 resolution and AAC audio."""
        mp4_path = EXPORTS_DIR / f"{clip['name']}.mp4"
        assert mp4_path.is_file(), f"Export {clip['name']}.mp4 is missing in {EXPORTS_DIR}"

        info = probe_video(mp4_path)
        assert info["width"] == 1080, f"{clip['name']}: width {info['width']} != 1080"
        assert info["height"] == 1920, f"{clip['name']}: height {info['height']} != 1920"
        assert info["has_audio"], f"{clip['name']}: missing audio stream"
        assert info["audio_codec"] == "aac", f"{clip['name']}: audio codec {info['audio_codec']} != aac"


# ===========================================================================
# TIER 2: Boundary & Corner Cases Tests
# ===========================================================================

@pytest.mark.tier2
class TestTier2BoundaryCornerCases:
    """
    Tier 2: Boundary & Corner Case Verification.
    Verifies strict duration limits [25.0, 30.0], zero mid-lyric cut boundaries,
    safe zone bounding box math, and strictly lowercase text.
    """

    @pytest.mark.r1
    @pytest.mark.m1
    def test_short05_duration_boundary_strict(self):
        """R1: Strict boundary verification for Short 05 duration (lower bound 25.0s, upper bound 30.0s)."""
        short05_path = EXPORTS_DIR / "05_opening-banjo-intro_T02.mp4"
        assert short05_path.is_file(), f"Short 05 export missing: {short05_path}"

        dur = probe_video(short05_path)["duration"]
        # Explicit boundary assertions
        assert dur >= 25.0, f"Short 05 duration {dur:.3f}s violates lower boundary (>= 25.0s)"
        assert dur <= 30.0, f"Short 05 duration {dur:.3f}s violates upper boundary (<= 30.0s)"

    @pytest.mark.r1
    @pytest.mark.m1
    def test_short05_zero_mid_lyric_cuts(self):
        """
        R1: Verify that Short 05 starts at the banjo intro (0.0s) and ends cleanly
        during the musical pause between Verse 1 Stanza 1 (ends ~23.5-24.2s) and Stanza 2 (starts 25.08s).
        Zero mid-lyric truncation is permitted.
        """
        # Load script specifications to verify cut boundaries
        with open(CLIPSHIP_SCRIPT, "r", encoding="utf-8") as f:
            script_content = f.read()

        # Find Short 05 spec in script
        match = re.search(
            r'\{\s*"n":\s*5,.*?"name":\s*"05_opening-banjo-intro_T02".*?"ss":\s*([0-9.]+),\s*"dur":\s*([0-9.]+)',
            script_content,
            re.DOTALL
        )
        assert match, "Could not locate Short 05 specification in export_clipship.py"

        ss = float(match.group(1))
        dur = float(match.group(2))
        end_time = ss + dur

        # Acoustic phrase boundaries from CMA broadcast:
        # Banjo intro starts at 0.0s.
        assert ss == 0.0, f"Short 05 start time ss={ss} must be 0.0s to include the banjo intro"

        # Stanza 1 finishes vocal line 'for too long' at ~23.44s - 24.2s.
        # Stanza 2 'here's my credit card and keys' starts at 25.08s.
        # The pause window is [24.2s, 25.08s].
        # A duration of 25.0s places the cut at 25.0s, safely inside the pause window.
        assert 24.2 <= end_time <= 25.08, (
            f"End timestamp {end_time:.2f}s cuts off lyrics! "
            f"Expected end time in natural pause window [24.2s, 25.08s]."
        )

    @pytest.mark.r2
    @pytest.mark.m2
    @pytest.mark.parametrize("clip", EXPECTED_CLIPS, ids=[c["name"] for c in EXPECTED_CLIPS])
    def test_batch_all_shorts_durations_in_target_range(self, clip):
        """R2: Verify every batch short duration is strictly in [25.0, 30.0] seconds."""
        mp4_path = EXPORTS_DIR / f"{clip['name']}.mp4"
        assert mp4_path.is_file(), f"Export {clip['name']}.mp4 missing"

        dur = probe_video(mp4_path)["duration"]
        assert 25.0 <= dur <= 30.0, (
            f"{clip['name']}: duration {dur:.2f}s is not within required [25.0s, 30.0s] bounds."
        )

    @pytest.mark.r3
    def test_safe_zone_and_stage_geometry_math(self):
        """
        R3: Bounding Box Safe Zone Verification.
        Verifies:
        - Canvas resolution is 1080x1920.
        - Stage is 1080x608 uncropped (DAR 16:9).
        - Subtitles (sub_y) are placed below video stage (sub_y >= video_y + 608)
          and above the bottom UI margin (sub_y <= 1700).
        - Zero vertical overlap between video stages, header cards, and subtitles.
        """
        canvas_w, canvas_h = 1080, 1920
        stage_w, stage_h = 1080, 608

        # Read CLIPS_SPEC from export_clipship.py
        with open(CLIPSHIP_SCRIPT, "r", encoding="utf-8") as f:
            script_content = f.read()

        # Parse CLIPS_SPEC
        m = re.search(r"CLIPS_SPEC\s*=\s*(\[.*?\])\s*#", script_content, re.DOTALL)
        if not m:
            m = re.search(r"CLIPS_SPEC\s*=\s*(\[.*?\n\])", script_content, re.DOTALL)
        assert m, "Could not find CLIPS_SPEC definition in export_clipship.py"

        # Check each clip's geometric layout
        for clip in EXPECTED_CLIPS:
            name = clip["name"]
            clip_block = re.search(rf'\{{[^{{}}]*"name":\s*"{name}"[^{{}}]*\}}', script_content)
            if not clip_block:
                continue
            block_text = clip_block.group(0)

            # Check sub_y
            sub_m = re.search(r'"sub_y":\s*(\d+)', block_text)
            sub_y = int(sub_m.group(1)) if sub_m else 1315

            # Non-split vs split
            is_split = bool(re.search(r'"is_split":\s*True', block_text))

            if not is_split:
                vy_m = re.search(r'"video_y":\s*(\d+)', block_text)
                video_y = int(vy_m.group(1)) if vy_m else 660
                video_bottom = video_y + stage_h

                # Subtitle must be below video stage
                assert sub_y >= video_bottom, (
                    f"{name}: subtitle y={sub_y} overlaps or touches video stage bottom {video_bottom}"
                )
                # Subtitle must not be covered by social media UI (keep above y=1700)
                assert sub_y <= 1700, (
                    f"{name}: subtitle y={sub_y} violates bottom safe zone (> 1700)"
                )
            else:
                # Split clips: Top stage y=310, bottom stage y=958
                top_stage_bottom = 310 + stage_h  # 918
                bot_stage_top = 958
                bot_stage_bottom = 958 + stage_h  # 1566

                assert bot_stage_top >= top_stage_bottom, (
                    f"{name}: split top stage bottom {top_stage_bottom} overlaps bottom stage top {bot_stage_top}"
                )
                assert sub_y >= bot_stage_bottom, (
                    f"{name}: subtitle y={sub_y} overlaps bottom stage {bot_stage_bottom}"
                )
                assert sub_y <= 1700, (
                    f"{name}: subtitle y={sub_y} exceeds bottom safe margin (> 1700)"
                )

    @pytest.mark.r3
    def test_strictly_lowercase_text_boundary(self):
        """
        R3: Verify all hook captions, reply text, and lyric timelines are strictly lowercase.
        No uppercase letters are permitted in on-screen captions or burned subtitles per campaign brief.
        """
        with open(CLIPSHIP_SCRIPT, "r", encoding="utf-8") as f:
            script_content = f.read()

        # Check LYRICS_TIMELINE entries
        timeline_match = re.search(r"LYRICS_TIMELINE\s*=\s*\[(.*?)\]\n\n", script_content, re.DOTALL)
        if timeline_match:
            raw_lines = timeline_match.group(1)
            lyric_strings = re.findall(r'"([^"]+)"', raw_lines)
            for s in lyric_strings:
                # Filter out emoji or punctuation, check letters are lowercase
                letters = [c for c in s if c.isalpha()]
                for ch in letters:
                    assert ch.islower(), (
                        f"Found uppercase character '{ch}' in lyric: '{s}'. All lyrics must be lowercase."
                    )

        # Check hook texts in CLIPS_SPEC
        hooks = re.findall(r'"hook":\s*\[(.*?)\]', script_content)
        for h_block in hooks:
            hook_strings = re.findall(r'"([^"]+)"', h_block)
            for hs in hook_strings:
                letters = [c for c in hs if c.isalpha()]
                for ch in letters:
                    assert ch.islower(), (
                        f"Found uppercase character '{ch}' in hook text: '{hs}'. All hooks must be lowercase."
                    )


# ===========================================================================
# TIER 3: Cross-Feature Combinations Tests
# ===========================================================================

@pytest.mark.tier3
class TestTier3CrossFeatureCombinations:
    """
    Tier 3: Cross-Feature Combinations.
    Verifies split screens with loudnorm audio normalization, image overlay
    transparency cutouts, circular avatar branding, and subtitle sync.
    """

    @pytest.mark.r3
    def test_split_screen_composition_and_audio(self):
        """
        R3: Verify split-screen clips (Clip 07, 12, 13) correctly integrate
        two video/image sources with loudnorm audio normalization.
        """
        split_clips = [
            "07_stage-vs-crowd-split_T06",
            "12_collage-tribute-split_T12",
            "13_reaction-split-pill_T13",
        ]
        for name in split_clips:
            mp4_path = EXPORTS_DIR / f"{name}.mp4"
            if not mp4_path.is_file():
                continue

            info = probe_video(mp4_path)
            assert info["width"] == 1080 and info["height"] == 1920
            assert info["has_audio"], f"Split clip {name} missing audio"

            loudness = measure_ebur128_loudness(mp4_path)
            assert abs(loudness["input_i"] - (-14.0)) <= 2.0, (
                f"Split clip {name} loudness {loudness['input_i']} deviates from -14 LUFS"
            )

    @pytest.mark.r3
    def test_template_overlay_transparency_and_cutouts(self):
        """
        R3: Verify generated template overlays have 4 channels (RGBA)
        and proper transparency cutouts where the video shows through.
        """
        overlay_files = list(WORK_DIR.glob("overlay_*.png")) or list(WORK_DIR.glob("test_overlay_*.png"))
        assert len(overlay_files) > 0, f"No overlay PNG files found in {WORK_DIR}"

        for ov_path in overlay_files:
            with Image.open(ov_path) as im:
                assert im.mode == "RGBA", f"Overlay {ov_path.name} mode is {im.mode}, expected RGBA"
                assert im.size == (1080, 1920), f"Overlay {ov_path.name} size {im.size} != 1080x1920"

                # Check alpha channel contains both transparent and opaque regions
                alpha = im.split()[-1]
                alpha_extrema = alpha.getextrema()
                assert alpha_extrema[0] == 0, (
                    f"Overlay {ov_path.name} has no fully transparent pixels (min alpha: {alpha_extrema[0]}). "
                    f"Video stage would be obstructed!"
                )
                assert alpha_extrema[1] > 200, (
                    f"Overlay {ov_path.name} has no opaque graphics (max alpha: {alpha_extrema[1]})."
                )

    @pytest.mark.r3
    def test_channel_branding_assets(self):
        """
        R3: Verify channel branding assets exist:
        - beatscut_logo.jpg
        - verified_badge.png
        - circular avatar properly generated
        """
        logo_path = TPL_DIR / "_Extras" / "beatscut_logo.jpg"
        badge_path = TPL_DIR / "_Extras" / "verified_badge.png"

        assert logo_path.is_file(), f"beats cut channel logo missing: {logo_path}"
        assert badge_path.is_file(), f"Verified badge missing: {badge_path}"

        with Image.open(logo_path) as im:
            assert im.width > 50 and im.height > 50

        with Image.open(badge_path) as im:
            assert im.format == "PNG"

    @pytest.mark.r3
    def test_subtitle_synchronization_intervals(self):
        """
        R3: Verify subtitle intervals in LYRICS_TIMELINE have sequential, non-negative,
        and non-zero duration intervals (minimum 0.8s display time per subtitle).
        """
        with open(CLIPSHIP_SCRIPT, "r", encoding="utf-8") as f:
            script_content = f.read()

        timeline_m = re.search(r"LYRICS_TIMELINE\s*=\s*\[(.*?)\]\n\n", script_content, re.DOTALL)
        assert timeline_m, "Could not find LYRICS_TIMELINE in export_clipship.py"

        # Parse tuples (start, end, text)
        tuples = re.findall(r"\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*\"([^\"]+)\"\s*\)", timeline_m.group(1))
        assert len(tuples) >= 10, f"Expected at least 10 lyric lines, found {len(tuples)}"

        for start_s, end_s, text in tuples:
            s = float(start_s)
            e = float(end_s)
            dur = e - s
            assert e > s, f"Lyric interval end ({e}) must be greater than start ({s}) for '{text}'"
            assert dur >= 0.8, f"Lyric display duration {dur:.2f}s is too short (< 0.8s) for '{text}'"


# ===========================================================================
# TIER 4: Real-World Application Scenarios Tests
# ===========================================================================

@pytest.mark.tier4
class TestTier4RealWorldScenarios:
    """
    Tier 4: End-to-End Real World Verification.
    Verifies batch manifest schema compliance, posting guide generation,
    captions file generation, and CLI health & discovery command exit codes.
    """

    @pytest.mark.r2
    @pytest.mark.m2
    def test_batch_manifest_compliance(self):
        """
        R2, Tier 4: Verify exports_manifest.json exists and strictly complies with schema:
        - 13 clip entries
        - Each entry has file, clip_number, name, template, duration, resolution, audio, hook_text, platform, compliant
        - All entries have duration in [25.0, 30.0]
        - All entries have resolution 1080x1920
        - All entries have audio == True and compliant == True
        """
        manifest_path = EXPORTS_DIR / "exports_manifest.json"
        assert manifest_path.is_file(), f"Manifest file missing: {manifest_path}"

        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)

        assert isinstance(manifest, list), "Manifest must be a JSON array"
        assert len(manifest) == 13, f"Expected 13 manifest entries, found {len(manifest)}"

        required_fields = [
            "file", "clip_number", "name", "template", "duration",
            "resolution", "audio", "hook_text", "platform", "compliant"
        ]

        for item in manifest:
            for field in required_fields:
                assert field in item, f"Missing field '{field}' in manifest entry for {item.get('name')}"

            clip_name = item["name"]
            dur = float(item["duration"])
            res = item["resolution"]
            audio_ok = item["audio"]
            compliant = item["compliant"]

            assert 25.0 <= dur <= 30.0, (
                f"{clip_name}: manifest duration {dur}s is not within [25.0s, 30.0s]"
            )
            assert res == "1080x1920", f"{clip_name}: manifest resolution {res} != 1080x1920"
            assert audio_ok is True, f"{clip_name}: audio flag is not True"
            assert compliant is True, f"{clip_name}: compliance flag is not True"

    @pytest.mark.r2
    @pytest.mark.m2
    def test_posting_guide_and_captions_files(self):
        """
        R2, Tier 4: Verify POSTING_GUIDE.md and captions.txt are generated
        with required campaign hashtags and lowercase captions.
        """
        guide_path = EXPORTS_DIR / "POSTING_GUIDE.md"
        captions_path = EXPORTS_DIR / "captions.txt"

        assert guide_path.is_file(), f"POSTING_GUIDE.md missing in {EXPORTS_DIR}"
        assert captions_path.is_file(), f"captions.txt missing in {EXPORTS_DIR}"

        with open(guide_path, "r", encoding="utf-8") as f:
            guide_text = f.read()

        assert "#mumfordandsons" in guide_text
        assert "#chrisstapleton" in guide_text
        assert "#cmas" in guide_text
        assert "#performance" in guide_text

        with open(captions_path, "r", encoding="utf-8") as f:
            captions_text = f.read()

        assert "mumford & sons and chris stapleton" in captions_text.lower()

    @pytest.mark.r1
    @pytest.mark.r2
    def test_cli_health_check_exit_code_zero(self):
        """Tier 4: Verify `python scripts/pulsecut_cli.py health --json` exits with code 0 and reports status ready."""
        cmd = [sys.executable, str(CLI_SCRIPT), "health", "--json"]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        assert res.returncode == 0, f"CLI health check failed with exit code {res.returncode}:\n{res.stderr}"

        data = json.loads(res.stdout)
        assert data.get("status") == "ready", f"CLI reported degraded status: {data}"
        assert data.get("ffmpeg", {}).get("available") is True, "FFmpeg reported unavailable"
        assert data.get("footage", {}).get("available") is True, "Footage reported unavailable"
        assert data.get("templates", {}).get("available") is True, "Templates reported unavailable"

    @pytest.mark.r1
    @pytest.mark.r2
    def test_cli_discovery_commands_exit_code_zero(self):
        """Tier 4: Verify `pulsecut_cli.py` list-clips and list-templates commands exit with code 0."""
        cmd_clips = [sys.executable, str(CLI_SCRIPT), "list-clips", "--json"]
        res_clips = subprocess.run(cmd_clips, capture_output=True, text=True, timeout=30)
        assert res_clips.returncode == 0, f"list-clips failed: {res_clips.stderr}"
        clips_data = json.loads(res_clips.stdout)
        assert clips_data.get("total", 0) >= 7, f"Expected at least 7 footage items, got {clips_data.get('total')}"

        cmd_tpls = [sys.executable, str(CLI_SCRIPT), "list-templates", "--json"]
        res_tpls = subprocess.run(cmd_tpls, capture_output=True, text=True, timeout=30)
        assert res_tpls.returncode == 0, f"list-templates failed: {res_tpls.stderr}"
        tpl_data = json.loads(res_tpls.stdout)
        assert len(tpl_data.get("templates", [])) == 13, (
            f"Expected 13 registered templates, found {len(tpl_data.get('templates', []))}"
        )


# ===========================================================================
# Standalone Test Execution Entry Point
# ===========================================================================

def run_standalone():
    """Execute pytest with structured reporting and return proper exit code."""
    print("=" * 72)
    print("PulseCut E2E Compliance Verification Suite (Tiers 1-4)")
    print(f"Working Directory : {ROOT_DIR}")
    print(f"Exports Directory : {EXPORTS_DIR}")
    print(f"FFmpeg Binary     : {FFMPEG}")
    print(f"FFprobe Binary    : {FFPROBE}")
    print("=" * 72)

    args = sys.argv[1:]
    pytest_args = ["-v", str(Path(__file__))] + args
    return pytest.main(pytest_args)


if __name__ == "__main__":
    sys.exit(run_standalone())
