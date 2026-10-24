# -*- coding: utf-8 -*-
"""
Placeholder transcription service for VoxNote.

This module provides a mock implementation that returns realistic dummy clinical data.
Replace the body of `transcribe()` with real API calls (e.g., Google Speech-to-Text,
Whisper, or Deepgram) when ready to connect to a production backend.
"""
from __future__ import annotations
import time
from typing import Any, Callable, Optional
from mock_data import SAMPLE_TRANSCRIPT, SAMPLE_DETAILS, TRANSCRIPTION_HISTORY


def transcribe(
    file_name: str,
    file_bytes: bytes,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> dict[str, Any]:
    """
    Simulate a transcription request with multi-stage progress feedback.

    Parameters
    ----------
    file_name : str
        Original uploaded audio file name.
    file_bytes : bytes
        Raw audio bytes (used for length heuristics in this mock).
    progress_callback : callable, optional
        Callback invoked with (progress_float, stage_label).

    Returns
    -------
    dict with keys 'transcript' (list of dialogue turns) and 'details' (metadata dict).
    """
    stages = [
        (0.20, "Uploading audio buffer to secure enclave..."),
        (0.45, "Running acoustic model & voice activity detection..."),
        (0.70, "Performing 2-speaker diarization (Doctor / Patient)..."),
        (0.90, "Applying clinical vocabulary & medical entity formatting..."),
        (1.00, "Finalizing transcript..."),
    ]

    for p, label in stages:
        if progress_callback:
            progress_callback(p, label)
        time.sleep(0.4)

    # Pick an appropriate mock transcript based on file name or default
    lower = file_name.lower()
    selected_hist = None
    for h in TRANSCRIPTION_HISTORY:
        if any(keyword in lower for keyword in h["file_name"].lower().split("_")):
            selected_hist = h
            break

    if selected_hist is not None:
        transcript = selected_hist["transcript"]
        details = {**selected_hist["details"], "file_name": file_name}
    else:
        transcript = SAMPLE_TRANSCRIPT
        # Estimate duration based on file size if possible
        size_kb = len(file_bytes) / 1024 if file_bytes else 1500
        approx_sec = max(30, int(size_kb / 18))
        mins, secs = divmod(approx_sec, 60)
        dur_str = f"{mins} min {secs} sec" if mins > 0 else f"{secs} sec"

        details = {
            **SAMPLE_DETAILS,
            "file_name": file_name,
            "audio_duration": dur_str,
            "word_count": sum(len(turn["text"].split()) for turn in transcript),
        }

    return {
        "transcript": transcript,
        "details": details,
    }
