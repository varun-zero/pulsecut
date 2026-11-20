#!/usr/bin/env python3
"""Verify a generated short and compute an objective 0-100 'vitality score'.

Usage:
  python verify_clip.py <clip.mp4> [--frames-dir DIR] [--ffprobe PATH] [--strict]

Exact 100-point rubric (synced 1:1 with crates/app/src/web.rs):
  - H.264 video codec:            10 pts
  - Audio stream present:         10 pts
  - AAC audio codec:               5 pts
  - Standard canvas (1080x1920):  15 pts
  - Duration within 8-60s:        10 pts
  - Video bitrate >= 2 Mbps:      15 pts (falls back to format bit_rate - audio)
  - Audio bitrate >= 128 kbps:     5 pts
  - FPS within 20-61:              5 pts
  - Clean FFmpeg decode:          10 pts
  - MP4 faststart (moov < mdat):  10 pts
  - Audible audio (> -50 dB):      5 pts
  --------------------------------------
  Total:                         100 pts

Also extracts 3 sample frames (start/middle/end) for visual QA.
"""
import argparse
import json
import os
import re
import struct
import subprocess
import sys


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def probe(ffprobe, path):
    rc, out, err = run([
        ffprobe, "-v", "error", "-show_streams", "-show_format",
        "-of", "json", path,
    ])
    if rc != 0:
        return None, err
    try:
        return json.loads(out), None
    except Exception as e:
        return None, str(e)


def has_mp4_faststart(path):
    """Return True iff the MP4 top-level `moov` box precedes `mdat`."""
    try:
        file_len = os.path.getsize(path)
        with open(path, "rb") as f:
            pos = 0
            while pos + 8 <= file_len:
                f.seek(pos)
                header = f.read(8)
                if len(header) < 8:
                    break
                size32, box_type = struct.unpack(">I4s", header)
                if box_type == b"moov":
                    return True
                if box_type == b"mdat":
                    return False
                if size32 == 1:
                    ext = f.read(8)
                    if len(ext) < 8:
                        break
                    box_size = struct.unpack(">Q", ext)[0]
                elif size32 == 0:
                    break
                else:
                    box_size = size32
                if box_size < 8:
                    break
                pos += box_size
    except OSError:
        return False
    return False


def probe_mean_volume_db(ffmpeg, path):
    """Measure mean audio loudness (dB) using FFmpeg volumedetect."""
    rc, _out, err = run([
        ffmpeg, "-hide_banner", "-v", "info", "-i", path,
        "-af", "volumedetect", "-vn", "-sn", "-dn", "-f", "null", "-",
    ])
    m = re.search(r"mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB", err)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            return None
    return None


def resolve_ffmpeg_from_ffprobe(ffprobe):
    if os.environ.get("PULSECUT_FFMPEG") and os.path.isfile(os.environ["PULSECUT_FFMPEG"]):
        return os.environ["PULSECUT_FFMPEG"]
    ffdir = os.path.dirname(ffprobe)
    if ffdir:
        candidate = os.path.join(ffdir, "ffmpeg.exe" if os.name == "nt" else "ffmpeg")
        if os.path.isfile(candidate):
            return candidate
    return "ffmpeg"


def verify_file(clip_path, frames_dir=None, ffprobe=None):
    ffprobe = ffprobe or os.environ.get("PULSECUT_FFPROBE", "ffprobe")
    meta, err = probe(ffprobe, clip_path)
    if meta is None:
        return {"ok": False, "error": err or "probe failed"}

    v = next((s for s in meta.get("streams", []) if s.get("codec_type") == "video"), {})
    a = next((s for s in meta.get("streams", []) if s.get("codec_type") == "audio"), {})
    fmt = meta.get("format", {})
    w, h = int(v.get("width", 0)), int(v.get("height", 0))
    abr = int(a.get("bit_rate") or 0)
    fmt_br = int(fmt.get("bit_rate") or 0)
    stream_vbr = int(v.get("bit_rate") or 0)
    vbr = stream_vbr if stream_vbr > 0 else max(0, fmt_br - abr)
    dur = float(fmt.get("duration") or v.get("duration") or 0)
    fps = v.get("r_frame_rate", "")
    reasons = []
    score = 0
    hard_failed = False

    def check(cond, pts, hard, msg):
        nonlocal score, hard_failed
        if cond:
            score += pts
        else:
            reasons.append(msg)
            if hard:
                hard_failed = True

    check(v.get("codec_name") == "h264", 10, True, f"video codec not h264 ({v.get('codec_name')})")
    check(bool(a), 10, True, "no audio stream")
    check(a.get("codec_name") == "aac", 5, True, f"audio codec not aac ({a.get('codec_name')})")
    check((w, h) in ((1080, 1920), (1920, 1080), (1080, 1080)), 15, True, f"canvas not 1080x1920 ({w}x{h})")
    check(8.0 <= dur <= 60.0, 10, True, f"duration out of 8-60s ({dur:.2f}s)")
    check(vbr >= 2_000_000, 15, False, f"video bitrate low ({vbr/1e6:.2f} Mbps)")
    check(abr >= 96_000, 5, False, f"audio bitrate low ({abr/1000:.0f} kbps)")
    try:
        num, den = [int(x) for x in fps.split("/")]
        fr = num / den if den else 0.0
        check(20.0 <= fr <= 61.0, 5, True, f"fps out of range ({fps})")
    except Exception:
        check(False, 5, True, f"unparseable fps ({fps})")

    ffmpeg = resolve_ffmpeg_from_ffprobe(ffprobe)
    rc, _, derr = run([ffmpeg, "-v", "error", "-i", clip_path, "-f", "null", "-"])
    decode_errors = derr.strip().splitlines()[:5]
    check(rc == 0 and not decode_errors, 10, True, "decode errors: " + " | ".join(decode_errors))

    faststart = has_mp4_faststart(clip_path)
    check(faststart, 10, False, "mp4 missing faststart (moov atom not before mdat)")

    mean_vol = probe_mean_volume_db(ffmpeg, clip_path) if a else None
    check(mean_vol is not None and mean_vol > -50.0, 5, True, f"audio appears silent ({mean_vol} dB)")

    stems = []
    if frames_dir and dur > 0:
        os.makedirs(frames_dir, exist_ok=True)
        base_stem = os.path.splitext(os.path.basename(clip_path))[0]
        for frac, label in [(0.15, "start"), (0.5, "mid"), (0.85, "end")]:
            t = dur * frac
            out = os.path.join(frames_dir, f"frame-{base_stem}-{label}.jpg")
            frc, _, _ = run([
                ffmpeg, "-y", "-loglevel", "error", "-ss", f"{t:.2f}",
                "-i", clip_path, "-frames:v", "1", out,
            ])
            if frc == 0 and os.path.isfile(out):
                stems.append(out)

    return {
        "clip": os.path.basename(clip_path),
        "ok": score >= 75 and not hard_failed,
        "vitality_score": score,
        "metrics": {
            "width": w,
            "height": h,
            "duration_s": round(dur, 2),
            "fps": fps,
            "video_bitrate_mbps": round(vbr / 1e6, 2),
            "audio_bitrate_kbps": round(abr / 1000),
            "video_codec": v.get("codec_name"),
            "audio_codec": a.get("codec_name"),
            "faststart": faststart,
            "mean_volume_db": mean_vol,
        },
        "reasons": reasons,
        "sample_frames": stems,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip")
    ap.add_argument("--frames-dir", default=os.path.join(os.path.dirname(__file__), "frames"))
    ap.add_argument("--ffprobe", default=os.environ.get("PULSECUT_FFPROBE", "ffprobe"))
    ap.add_argument("--strict", action="store_true", help="Exit non-zero when ok is false")
    args = ap.parse_args()

    result = verify_file(args.clip, frames_dir=args.frames_dir, ffprobe=args.ffprobe)
    print(json.dumps(result, indent=2))
    if "error" in result or (args.strict and not result.get("ok")):
        sys.exit(1)


if __name__ == "__main__":
    main()
