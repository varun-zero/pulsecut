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
"""
import argparse, json, os, sys

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

    from faster_whisper import WhisperModel
    model = WhisperModel(
        args.model,
        device=os.environ.get("PULSECUT_WHISPER_DEVICE", "cpu"),
        compute_type=os.environ.get("PULSECUT_WHISPER_COMPUTE", "int8"),
    )
    segments, info = model.transcribe(
        media,
        word_timestamps=True,
        language=os.environ.get("PULSECUT_WHISPER_LANG") or None,
    )

    words, segs = [], []
    for seg in segments:
        ws = []
        for w in (seg.words or []):
            item = {"word": w.word, "start": round(w.start, 3), "end": round(w.end, 3),
                    "probability": round(getattr(w, "probability", 0.9), 3)}
            ws.append(item)
            words.append(item)
        segs.append({"id": seg.id, "text": seg.text,
                     "start": round(seg.start, 3), "end": round(seg.end, 3), "words": ws})

    os.makedirs(args.outdir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(media))[0]
    out_path = os.path.join(args.outdir, stem + ".json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"text": " ".join(s["text"] for s in segs), "words": words,
                   "segments": segs, "language": info.language}, f, ensure_ascii=False)
    print(out_path)
    return 0

if __name__ == "__main__":
    sys.exit(main())
