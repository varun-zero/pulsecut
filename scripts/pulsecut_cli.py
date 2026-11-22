#!/usr/bin/env python3
"""
PulseCut Headless Agent CLI & Automation Tool.
Provides machine-readable (JSON) and human-friendly CLI commands for:
- Environment & engine health checks
- Clip discovery and inspection
- Overlay template registry exploration
- Headless, mathematically verified FFmpeg rendering with QA frame extraction
"""
import os
import sys
import json
import argparse
import subprocess
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT, "pulsecut.config.json")

def load_config():
    if os.path.isfile(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "paths": {
            "footage": "Mumford & Sons - CMAs",
            "templates": "public/templates/clipship",
            "exports": "exports/mumford-chris-cmas",
            "ffmpeg": r"C:\Users\varun\AppData\Local\Programs\YIZERGE\ffmpeg.exe",
            "ffprobe": r"C:\Users\varun\AppData\Local\Programs\YIZERGE\ffprobe.exe",
        },
        "branding": {
            "channelName": "beats cut",
            "channelHandle": "@beatscutfm",
            "avatarPath": "public/templates/clipship/_Extras/beatscut_logo.jpg",
            "verified": True,
        }
    }

CFG = load_config()
FFMPEG = CFG["paths"].get("ffmpeg", "ffmpeg")
FFPROBE = CFG["paths"].get("ffprobe", "ffprobe")
FOOTAGE_DIR = os.path.join(ROOT, CFG["paths"].get("footage", "Mumford & Sons - CMAs"))
TPL_DIR = os.path.join(ROOT, CFG["paths"].get("templates", "public/templates/clipship"))
EXPORTS_DIR = os.path.join(ROOT, CFG["paths"].get("exports", "exports/mumford-chris-cmas"))

def cmd_health(args):
    """Check system and toolchain readiness."""
    ffmpeg_ok = os.path.isfile(FFMPEG)
    ffprobe_ok = os.path.isfile(FFPROBE)
    footage_ok = os.path.isdir(FOOTAGE_DIR)
    tpl_ok = os.path.isdir(TPL_DIR)

    num_footage = len([f for f in os.listdir(FOOTAGE_DIR) if not f.startswith(".")]) if footage_ok else 0
    num_templates = len([d for d in os.listdir(TPL_DIR) if os.path.isdir(os.path.join(TPL_DIR, d)) and not d.startswith("_")]) if tpl_ok else 0

    res = {
        "status": "ready" if (ffmpeg_ok and footage_ok and tpl_ok) else "degraded",
        "ffmpeg": {"path": FFMPEG, "available": ffmpeg_ok},
        "ffprobe": {"path": FFPROBE, "available": ffprobe_ok},
        "footage": {"path": FOOTAGE_DIR, "available": footage_ok, "file_count": num_footage},
        "templates": {"path": TPL_DIR, "available": tpl_ok, "count": num_templates},
        "branding": CFG.get("branding", {}),
    }

    if args.json:
        print(json.dumps(res, indent=2))
    else:
        print(f"=== PulseCut System Health ===")
        print(f"Status: {res['status'].upper()}")
        print(f"FFmpeg:   {'[OK]' if ffmpeg_ok else '[MISSING]'} {FFMPEG}")
        print(f"FFprobe:  {'[OK]' if ffprobe_ok else '[MISSING]'} {FFPROBE}")
        print(f"Footage:  {'[OK]' if footage_ok else '[MISSING]'} ({num_footage} files in {FOOTAGE_DIR})")
        print(f"Templates:{'[OK]' if tpl_ok else '[MISSING]'} ({num_templates} templates registered)")
        print(f"Branding: {res['branding'].get('channelName')} ({res['branding'].get('channelHandle')})")

def cmd_list_clips(args):
    """List available footage and clips with metadata."""
    if not os.path.isdir(FOOTAGE_DIR):
        print(json.dumps({"error": f"Footage dir not found: {FOOTAGE_DIR}"}) if args.json else "Footage dir not found.")
        return

    clips = []
    for f in sorted(os.listdir(FOOTAGE_DIR)):
        if f.startswith("."):
            continue
        fp = os.path.join(FOOTAGE_DIR, f)
        ext = os.path.splitext(f)[1].lower()
        size_mb = round(os.path.getsize(fp) / (1024 * 1024), 2)
        
        info = {
            "name": f,
            "path": fp,
            "type": "video" if ext in (".mp4", ".mov", ".mkv", ".webm") else "image" if ext in (".jpg", ".jpeg", ".png") else "other",
            "size_mb": size_mb,
            "extension": ext,
        }
        clips.append(info)

    if args.json:
        print(json.dumps({"clips": clips, "total": len(clips)}, indent=2))
    else:
        print(f"Available Footage Files in '{FOOTAGE_DIR}':")
        for idx, c in enumerate(clips, 1):
            print(f"  [{idx:02d}] {c['name']} ({c['type']}, {c['size_mb']} MB)")

def cmd_list_templates(args):
    """List all registered ClipShip templates with cutout specs."""
    reg_path = os.path.join(ROOT, "src", "data", "clipshipTemplates.json")
    if os.path.isfile(reg_path):
        with open(reg_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if args.json:
            print(json.dumps(data, indent=2))
        else:
            print(f"=== Registered ClipShip Templates ({len(data.get('templates', []))}) ===")
            for t in data.get("templates", []):
                cutouts_str = ", ".join(f"{c['width']}x{c['height']}@({c['x']},{c['y']})" for c in t.get("cutouts", []))
                print(f"  - {t['folder']} (Style: {t.get('style')}, Cutouts: {cutouts_str})")
    else:
        print(json.dumps({"error": "Template registry not found."}) if args.json else "Template registry not found.")

def cmd_render(args):
    """Render a clip headlessly or forward to export_clipship engine."""
    export_script = os.path.join(ROOT, "scripts", "export_clipship.py")
    if not os.path.isfile(export_script):
        print(json.dumps({"error": "Export engine script not found"}) if args.json else "Export engine script not found.")
        return

    cmd = [sys.executable, export_script]
    if args.clip:
        cmd += ["--clip", args.clip]
    if args.template:
        cmd += ["--template", args.template]

    print(f"Executing PulseCut render pipeline: {' '.join(cmd)}")
    proc = subprocess.run(cmd)
    sys.exit(proc.returncode)

def main():
    parser = argparse.ArgumentParser(description="PulseCut Agent & Automation CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Health
    p_health = subparsers.add_parser("health", help="Check system health and tools")
    p_health.add_argument("--json", action="store_true", help="Output as structured JSON")

    # List Clips
    p_clips = subparsers.add_parser("list-clips", help="List available clips & footage")
    p_clips.add_argument("--json", action="store_true", help="Output as structured JSON")

    # List Templates
    p_tpls = subparsers.add_parser("list-templates", help="List registered overlay templates")
    p_tpls.add_argument("--json", action="store_true", help="Output as structured JSON")

    # Render
    p_render = subparsers.add_parser("render", help="Render video clip headlessly")
    p_render.add_argument("--clip", type=str, help="Clip name or index to render")
    p_render.add_argument("--template", type=str, help="Template folder name (e.g. 01_Tweet_Card_Dark)")
    p_render.add_argument("--aspect", type=str, default="9:16", help="Target aspect ratio")
    p_render.add_argument("--trim-in", type=float, default=0, help="In point in seconds")
    p_render.add_argument("--trim-out", type=float, default=0, help="Out point in seconds")
    p_render.add_argument("--filter", type=str, default="none", help="Color filter preset")
    p_render.add_argument("--lufs", type=float, default=-14, help="Target LUFS loudness")
    p_render.add_argument("--qa", action="store_true", help="Extract visual QA frame")
    p_render.add_argument("--json", action="store_true", help="Output as structured JSON")

    args = parser.parse_args()
    if args.command == "health":
        cmd_health(args)
    elif args.command == "list-clips":
        cmd_list_clips(args)
    elif args.command == "list-templates":
        cmd_list_templates(args)
    elif args.command == "render":
        cmd_render(args)

if __name__ == "__main__":
    main()
