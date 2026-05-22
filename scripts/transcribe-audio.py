#!/usr/bin/env python3
"""
Transcribe an audio file with faster-whisper.

Usage:
    python3 scripts/transcribe-audio.py <audio> [--model medium] [--lang pt] [--out <txt>] [--json]

Requires: faster-whisper, ffmpeg available on PATH.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("audio", help="Path to audio file (m4a, mp3, wav, etc.)")
    ap.add_argument("--model", default="medium",
                    choices=["tiny", "base", "small", "medium", "large-v2", "large-v3"],
                    help="Whisper model size (default: medium)")
    ap.add_argument("--lang", default="pt", help="Language code (default: pt)")
    ap.add_argument("--out", help="Output text path (default: <audio>.txt)")
    ap.add_argument("--json", action="store_true", help="Also write segments JSON next to txt")
    ap.add_argument("--compute-type", default="int8",
                    choices=["int8", "int8_float16", "float16", "float32"],
                    help="CTranslate2 compute type (default: int8 — CPU friendly)")
    ap.add_argument("--vad", action="store_true", help="Enable voice activity detection filter")
    args = ap.parse_args()

    audio_path = Path(args.audio).expanduser()
    if not audio_path.exists():
        print(f"ERROR: file not found: {audio_path}", file=sys.stderr)
        return 2

    out_txt = Path(args.out) if args.out else audio_path.with_suffix(".txt")
    out_json = out_txt.with_suffix(".segments.json")

    print(f"[transcribe] file: {audio_path}", file=sys.stderr)
    print(f"[transcribe] model: {args.model}  lang: {args.lang}  compute: {args.compute_type}", file=sys.stderr)

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("ERROR: faster-whisper not installed. Run: pip3 install --user faster-whisper",
              file=sys.stderr)
        return 3

    t0 = time.time()
    model = WhisperModel(args.model, device="cpu", compute_type=args.compute_type)
    load_t = time.time() - t0
    print(f"[transcribe] model loaded in {load_t:.1f}s", file=sys.stderr)

    t0 = time.time()
    segments_iter, info = model.transcribe(
        str(audio_path),
        language=args.lang,
        vad_filter=args.vad,
        beam_size=5,
    )
    print(f"[transcribe] detected lang={info.language} prob={info.language_probability:.2f} "
          f"duration={info.duration:.1f}s", file=sys.stderr)

    segments = []
    full_text_parts = []
    for seg in segments_iter:
        segments.append({"start": seg.start, "end": seg.end, "text": seg.text})
        full_text_parts.append(seg.text)
        # progress to stderr so the txt file stays clean
        print(f"  [{seg.start:7.2f} -> {seg.end:7.2f}] {seg.text.strip()[:90]}", file=sys.stderr)

    full_text = "\n".join(s.strip() for s in full_text_parts)
    out_txt.write_text(full_text, encoding="utf-8")
    print(f"[transcribe] wrote {out_txt} ({len(full_text)} chars, {len(segments)} segments)",
          file=sys.stderr)

    if args.json:
        out_json.write_text(json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[transcribe] wrote {out_json}", file=sys.stderr)

    elapsed = time.time() - t0
    print(f"[transcribe] transcribe time: {elapsed:.1f}s "
          f"(audio {info.duration:.0f}s → {info.duration / elapsed:.2f}x realtime)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
