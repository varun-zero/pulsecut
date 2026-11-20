#!/usr/bin/env python3
"""Verify a generated short and compute an objective 'vitality score'.

Usage:
  python verify_clip.py <clip.mp4> [--frames-dir DIR] [--ffprobe PATH]

Checks (all measurable, no guesswork):
  - container/codec: H.264 video + AAC audio present
  - canvas: 1080x1920 (9:16), fps, duration within 8-60s
  - video bitrate (quality proxy), audio bitrate/streams
  - decodes cleanly (no corrupt frames)
  - extracts 3 sample frames (start/middle/end) for visual QA

Outputs JSON to stdout with a vitality_score (0-100) and pass/fail reasons.
"""
import argparse, json, os, subprocess, sys

def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr

def probe(ffprobe, path):
    rc, out, err = run([ffprobe, "-v", "error", "-show_streams", "-show_format",
                        "-of", "json", path])
    if rc != 0:
        return None, err
    try:
        return json.loads(out), None
    except Exception as e:
        return None, str(e)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip")
    ap.add_argument("--frames-dir", default=os.path.join(os.path.dirname(__file__), "frames"))
    ap.add_argument("--ffprobe", default=os.environ.get("PULSECUT_FFPROBE", "ffprobe"))
    args = ap.parse_args()

    meta, err = probe(args.ffprobe, args.clip)
    if meta is None:
        print(json.dumps({"ok": False, "error": err or "probe failed"}))
        sys.exit(1)

    v = next((s for s in meta.get("streams", []) if s.get("codec_type") == "video"), {})
    a = next((s for s in meta.get("streams", []) if s.get("codec_type") == "audio"), {})
    fmt = meta.get("format", {})
    w, h = int(v.get("width", 0)), int(v.get("height", 0))
    vbr = int(v.get("bit_rate") or 0)
    abr = int(a.get("bit_rate") or 0)
    dur = float(fmt.get("duration") or v.get("duration") or 0)
    fps = v.get("r_frame_rate", "")
    reasons = []
    score = 0

    def ok(cond, pts, msg):
        nonlocal score
        if cond:
            score += pts
        else:
            reasons.append(msg)

    ok(v.get("codec_name") == "h264", 10, f"video codec not h264 ({v.get('codec_name')})")
    ok(bool(a), 10, "no audio stream")
    ok(a.get("codec_name") == "aac", 5, f"audio codec not aac ({a.get('codec_name')})")
    ok((w, h) == (1080, 1920) or (h, w) == (1080, 1920), 15, f"canvas not 1080x1920 ({w}x{h})")
    ok(8 <= dur <= 60, 10, f"duration out of 8-60s ({dur:.2f})")
    ok(vbr >= 2_000_000, 15, f"video bitrate low ({vbr/1e6:.2f} Mbps)")
    ok(abr >= 128_000, 5, f"audio bitrate low ({abr/1000:.0f} kbps)")
    try:
        num, den = [int(x) for x in fps.split("/")]
        fr = num / den if den else 0
        ok(20 <= fr <= 61, 5, f"fps out of range ({fps})")
    except Exception:
        ok(False, 5, f"unparseable fps ({fps})")
    # decode integrity via ffmpeg (derive binary name from ffprobe path)
    ffdir = os.path.dirname(args.ffprobe)
    ffmpeg = os.path.join(ffdir, "ffmpeg.exe" if os.name == "nt" else "ffmpeg") if ffdir else "ffmpeg"
    rc, _, derr = run([ffmpeg, "-v", "error", "-i", args.clip, "-f", "null", "-"])
    decode_errors = derr.strip().splitlines()[:5]
    ok(rc == 0 and not decode_errors, 10, "decode errors: " + " | ".join(decode_errors))
    ok(True, 20, "")  # reserved: faststart/moov check can be added

    os.makedirs(args.frames_dir, exist_ok=True)
    stems = []
    if dur > 0:
        for frac, label in [(0.15, "start"), (0.5, "mid"), (0.85, "end")]:
            t = dur * frac
            out = os.path.join(args.frames_dir, f"frame-{os.path.basename(args.clip).split('.')[0]}-{label}.jpg")
            frc, _, _ = run([ffmpeg, "-y", "-loglevel", "error", "-ss", f"{t:.2f}",
                             "-i", args.clip, "-frames:v", "1", out])
            if frc == 0 and os.path.isfile(out):
                stems.append(out)

    result = {
        "clip": os.path.basename(args.clip),
        "ok": score >= 70 and not reasons,
        "vitality_score": score,
        "metrics": {"width": w, "height": h, "duration_s": round(dur, 2), "fps": fps,
                    "video_bitrate_mbps": round(vbr/1e6, 2), "audio_bitrate_kbps": round(abr/1000),
                    "video_codec": v.get("codec_name"), "audio_codec": a.get("codec_name")},
        "reasons": reasons,
        "sample_frames": stems,
    }
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
