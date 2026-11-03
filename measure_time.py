# -*- coding: utf-8 -*-
"""Measure end-to-end pipeline time in minutes.

Starts the timer once the audio is loaded (the "upload" step) and processing
begins, then stops after the transcript and English translation are produced.

Usage:
    .venv\\Scripts\\python.exe measure_time.py "C:\\path\\to\\audio.mp3"

    # RNNT (default app mode) or CTC
    .venv\\Scripts\\python.exe measure_time.py "audio.mp3" --decoding rnnt
    .venv\\Scripts\\python.exe measure_time.py "audio.mp3" --decoding ctc

    # Known number of speakers / skip diarization
    .venv\\Scripts\\python.exe measure_time.py "audio.mp3" --speakers 2
    .venv\\Scripts\\python.exe measure_time.py "audio.mp3" --no-diarization

    # Skip translation (transcript only)
    .venv\\Scripts\\python.exe measure_time.py "audio.mp3" --no-translate
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from timing import ProcessTimer


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Time the transcription + translation pipeline."
    )
    parser.add_argument("audio", help="Path to the audio file (mp3/wav/m4a).")
    parser.add_argument(
        "--language",
        default="hi",
        help="ISO language code (default: hi).",
    )
    parser.add_argument(
        "--decoding",
        default="rnnt",
        choices=["ctc", "rnnt"],
        help="Decoding mode (default: rnnt, same as the app).",
    )
    parser.add_argument(
        "--speakers",
        type=int,
        default=None,
        help="Exact number of speakers (omit for auto-detect).",
    )
    parser.add_argument(
        "--no-diarization",
        action="store_true",
        help="Skip speaker diarization.",
    )
    parser.add_argument(
        "--translate",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Run English translation (default: on). Use --no-translate to skip.",
    )
    args = parser.parse_args()

    path = Path(args.audio)
    if not path.is_file():
        print(f"Audio file not found: {path}")
        return 1

    from transcription_service import transcribe
    from translation import is_translation_configured, translate_turns

    translate_enabled = args.translate
    if translate_enabled and not is_translation_configured():
        print("GEMINI_API_KEY is not configured; skipping translation.")
        translate_enabled = False

    # This stands in for the upload step.
    file_bytes = path.read_bytes()

    # Timer starts here, when processing begins.
    timer = ProcessTimer().start()
    result = transcribe(
        path.name,
        file_bytes,
        language=args.language,
        decoding=args.decoding,
        num_speakers=args.speakers,
        enable_diarization=not args.no_diarization,
    )
    if translate_enabled:
        result["transcript_en"] = translate_turns(result["transcript"])
    elapsed = timer.stop()

    print("")
    print(f"File:          {path.name}")
    print(f"Turns:         {len(result.get('transcript', []))}")
    print(f"Elapsed:       {timer.format()}")
    print(f"Elapsed (min): {timer.format_minutes()}")
    print(f"Exact seconds: {elapsed:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
