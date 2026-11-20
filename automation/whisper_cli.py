#!/usr/bin/env python3
"""whisper.cpp-compatible CLI backed by faster-whisper (CTranslate2).

PulseCut calls a whisper binary as:
    whisper-cli -m MODEL -f json -o OUTDIR --word-timestamps true AUDIO.wav
and reads OUTDIR/<stem>.json expecting OpenAI verbose_json (top-level `words[]`
or `segments[].words[]`). This wrapper accepts those exact flags and emits that
shape, so it is a drop-in for PULSECUT_WHISPER.

faster-whisper is ~4x faster than whisper.cpp on CPU and downloads its model from
HuggingFace on first use (no separate model file needed). Model via -m or
PULSECUT_WHISPER_MODEL (e.g. small.en, base.en, large-v3-turbo).
VAD filtering is enabled by default (disable with PULSECUT_WHISPER_VAD=0) to
prevent hallucinations during silence/music and speed up CPU transcription.
"""
import argparse
import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("-m", "--model", default=os.environ.get("PULSECUT_WHISPER_MODEL", "small.en"))
    ap.add_argument("-f", "--format", default="json")
    ap.add_argument("-o", "--output-dir", "--output", dest="outdir", default=".")
    ap.add_argument("--word-timestamps", default="true")
    ap.add_argument("--word_timestamps", default="true")
    ap.add_argument("media", nargs="?")
    args, _unknown = ap.parse_known_args()  # tolerate other whisper.cpp flags
    media = args.media
    if not media:
        print("whisper_cli: no input media", file=sys.stderr)
        return 2
    if not os.path.isfile(media):
        print(f"whisper_cli: media file not found: {media}", file=sys.stderr)
        return 2

    from faster_whisper import WhisperModel

    cpu_threads = int(os.environ.get("PULSECUT_WHISPER_THREADS", str(min(os.cpu_count() or 4, 8))))
    beam_size = int(os.environ.get("PULSECUT_WHISPER_BEAM", "1"))
    model = WhisperModel(
        args.model,
        device=os.environ.get("PULSECUT_WHISPER_DEVICE", "cpu"),
        compute_type=os.environ.get("PULSECUT_WHISPER_COMPUTE", "int8"),
        cpu_threads=cpu_threads,
    )
    vad_enabled = os.environ.get("PULSECUT_WHISPER_VAD", "1").strip().lower() not in ("0", "false", "no", "off")
    segments, info = model.transcribe(
        media,
        beam_size=beam_size,
        best_of=1,
        condition_on_previous_text=False,
        word_timestamps=True,
        vad_filter=vad_enabled,
        language=os.environ.get("PULSECUT_WHISPER_LANG") or None,
    )

    words, segs = [], []
    for seg in segments:
        ws = []
        for w in (seg.words or []):
            token = (w.word or "").strip()
            if not token:
                continue
            item = {
                "word": token,
                "start": round(float(w.start), 3),
                "end": round(float(w.end), 3),
                "probability": round(float(getattr(w, "probability", 0.9)), 3),
            }
            ws.append(item)
            words.append(item)
        segs.append({
            "id": seg.id,
            "text": (seg.text or "").strip(),
            "start": round(float(seg.start), 3),
            "end": round(float(seg.end), 3),
            "words": ws,
        })

    os.makedirs(args.outdir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(media))[0]
    out_path = os.path.join(args.outdir, stem + ".json")
    tmp_path = out_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "text": " ".join(s["text"] for s in segs if s["text"]),
                "words": words,
                "segments": segs,
                "language": getattr(info, "language", "en"),
            },
            f,
            ensure_ascii=False,
        )
    os.replace(tmp_path, out_path)
    print(out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
