# -*- coding: utf-8 -*-
"""Live IndicConformer + pyannote.audio transcription pipeline."""
from __future__ import annotations

from typing import Any, Callable, Optional

from audio_io import (
    AudioData,
    decode_audio,
    format_duration,
    format_timestamp,
)
from conformer_engine import LANGUAGES, get_engine
from diarization import (
    DiarizationResult,
    get_diarizer,
    is_diarization_configured,
)

ProgressCallback = Optional[Callable[[float, str], None]]

SEGMENT_PADDING_SECONDS = 0.12
MERGE_GAP_SECONDS = 0.80
MIN_SEGMENT_SECONDS = 0.20


def _notify(callback: ProgressCallback, value: float, text: str) -> None:
    if callback is not None:
        callback(float(value), text)


def _prepare_segments(
    segments: list[dict],
    duration: float,
) -> list[dict]:
    cleaned: list[dict] = []
    for item in segments:
        start = max(0.0, min(float(item.get("start", 0.0)), duration))
        end = max(0.0, min(float(item.get("end", 0.0)), duration))
        if end - start < MIN_SEGMENT_SECONDS:
            continue
        cleaned.append(
            {
                "start": start,
                "end": end,
                "speaker": str(item.get("speaker", "SPEAKER_00")),
            }
        )

    cleaned.sort(key=lambda value: (value["start"], value["end"]))

    merged: list[dict] = []
    for segment in cleaned:
        if (
            merged
            and merged[-1]["speaker"] == segment["speaker"]
            and segment["start"] - merged[-1]["end"] <= MERGE_GAP_SECONDS
        ):
            merged[-1]["end"] = max(merged[-1]["end"], segment["end"])
        else:
            merged.append(dict(segment))
    return merged


def _speaker_names(count: int) -> list[str]:
    return [f"Speaker {index}" for index in range(1, max(1, count) + 1)]


def _clean_text(text: str) -> str:
    return " ".join(str(text or "").replace("\n", " ").split()).strip()


def _merge_turns(turns: list[dict]) -> list[dict]:
    merged: list[dict] = []
    for turn in turns:
        if (
            merged
            and merged[-1]["speaker"] == turn["speaker"]
            and turn["start"] - merged[-1]["end"] <= MERGE_GAP_SECONDS
        ):
            merged[-1]["text"] = _clean_text(
                f"{merged[-1]['text']} {turn['text']}"
            )
            merged[-1]["end"] = max(merged[-1]["end"], turn["end"])
        else:
            merged.append(dict(turn))
    return merged


def _transcribe_segments(
    engine,
    audio: AudioData,
    segments: list[dict],
    language: str,
    decoding: str,
    speaker_map: dict[str, str],
    progress_callback: ProgressCallback,
) -> tuple[list[dict], Optional[float]]:
    turns: list[dict] = []
    confidence_values: list[tuple[float, float]] = []
    total = max(1, len(segments))

    for index, segment in enumerate(segments):
        previous_end = (
            segments[index - 1]["end"] if index > 0 else 0.0
        )
        next_start = (
            segments[index + 1]["start"]
            if index + 1 < len(segments)
            else audio.duration
        )
        left_pad = min(
            SEGMENT_PADDING_SECONDS,
            max(0.0, segment["start"] - previous_end),
        )
        right_pad = min(
            SEGMENT_PADDING_SECONDS,
            max(0.0, next_start - segment["end"]),
        )
        start = max(0.0, segment["start"] - left_pad)
        end = min(audio.duration, segment["end"] + right_pad)
        first = int(start * audio.sample_rate)
        last = int(end * audio.sample_rate)
        crop = audio.waveform[first:last]
        if crop.size == 0:
            continue

        result = engine.transcribe(
            crop,
            language,
            decoding,
            with_confidence=(decoding == "ctc"),
        )
        if isinstance(result, tuple):
            text, confidence = result
        else:
            text, confidence = result, None

        text = _clean_text(text)
        if text:
            turns.append(
                {
                    "speaker": speaker_map.get(
                        segment["speaker"], segment["speaker"]
                    ),
                    "timestamp": format_timestamp(segment["start"]),
                    "text": text,
                    "start": segment["start"],
                    "end": segment["end"],
                }
            )
            if confidence is not None:
                confidence_values.append(
                    (
                        float(confidence),
                        max(0.1, segment["end"] - segment["start"]),
                    )
                )

        progress = 0.50 + 0.44 * ((index + 1) / total)
        _notify(
            progress_callback,
            progress,
            f"Transcribing speaker turn {index + 1} of {total}...",
        )

    confidence = None
    if confidence_values:
        weight = sum(item[1] for item in confidence_values)
        if weight > 0:
            confidence = sum(item[0] * item[1] for item in confidence_values) / weight

    return _merge_turns(turns), confidence


def _fallback_transcript(
    engine,
    audio: AudioData,
    language: str,
    decoding: str,
) -> tuple[list[dict], Optional[float]]:
    result = engine.transcribe(
        audio.waveform,
        language,
        decoding,
        with_confidence=(decoding == "ctc"),
    )
    if isinstance(result, tuple):
        text, confidence = result
    else:
        text, confidence = result, None

    text = _clean_text(text)
    turns = []
    if text:
        turns.append(
            {
                "speaker": "Speaker 1",
                "timestamp": "00:00:00",
                "text": text,
            }
        )
    return turns, confidence


def transcribe(
    file_name: str,
    file_bytes: bytes,
    progress_callback: ProgressCallback = None,
    language: str = "hi",
    decoding: str = "rnnt",
    num_speakers: Optional[int] = None,
    enable_diarization: bool = True,
) -> dict[str, Any]:
    """Run IndicConformer ASR with pyannote speaker labeling."""
    decoding = (decoding or "ctc").lower()
    if language not in LANGUAGES:
        raise ValueError(f"Unsupported language code: {language}")
    if decoding not in {"ctc", "rnnt"}:
        raise ValueError("Decoding mode must be 'ctc' or 'rnnt'.")

    _notify(progress_callback, 0.05, "Decoding uploaded audio...")
    audio = decode_audio(file_bytes, filename=file_name)

    warning: Optional[str] = None
    diarization: Optional[DiarizationResult] = None

    if enable_diarization:
        _notify(
            progress_callback,
            0.15,
            "Detecting speakers with pyannote.audio...",
        )
        if is_diarization_configured():
            try:
                diarization = get_diarizer().diarize(
                    audio.waveform,
                    sample_rate=audio.sample_rate,
                    num_speakers=num_speakers,
                )
            except Exception as exc:
                warning = f"Speaker diarization failed: {exc}"
        else:
            warning = (
                "Speaker diarization is not configured. Add HF_TOKEN to .env "
                "and accept the pyannote model conditions on Hugging Face."
            )

    _notify(progress_callback, 0.40, "Loading IndicConformer ONNX models...")
    engine = get_engine()

    turns: list[dict] = []
    confidence: Optional[float] = None
    speakers_detected = 1
    diarization_label = "Not used"

    segments = (
        _prepare_segments(diarization.segments, audio.duration)
        if diarization is not None and diarization.segments
        else []
    )

    if segments:
        speakers = []
        for segment in segments:
            if segment["speaker"] not in speakers:
                speakers.append(segment["speaker"])

        names = _speaker_names(max(1, len(speakers)))
        speaker_map = dict(zip(speakers, names))

        _notify(
            progress_callback,
            0.45,
            f"Transcribing {len(segments)} speaker turn(s) with "
            f"IndicConformer ({decoding.upper()})...",
        )
        turns, confidence = _transcribe_segments(
            engine,
            audio,
            segments,
            language,
            decoding,
            speaker_map,
            progress_callback,
        )
        speakers_detected = max(1, len(speakers))
        diarization_label = f"pyannote.audio ({diarization.model_name})"

    if not turns:
        if warning is None and enable_diarization:
            warning = "No speech turns were detected; using a single transcript."
        _notify(
            progress_callback,
            0.45,
            f"Transcribing full audio with IndicConformer ({decoding.upper()})...",
        )
        turns, confidence = _fallback_transcript(
            engine, audio, language, decoding
        )
        speakers_detected = 1
        diarization_label = (
            "pyannote.audio" if diarization is not None else "Not used"
        )

    if not turns:
        raise RuntimeError(
            "No speech was transcribed. Check that the recording contains "
            "clear audio and that the selected language is correct."
        )

    _notify(progress_callback, 0.98, "Finalizing transcript...")

    word_count = sum(len(turn["text"].split()) for turn in turns)
    clean_turns = [
        {
            "speaker": turn["speaker"],
            "timestamp": turn["timestamp"],
            "text": turn["text"],
        }
        for turn in turns
    ]

    confidence_text = (
        f"{confidence * 100:.1f}%" if confidence is not None else "N/A"
    )
    channels = (
        "Mono"
        if audio.channels == 1
        else "Stereo"
        if audio.channels == 2
        else f"{audio.channels} channels"
    )

    details = {
        "file_name": file_name,
        "audio_duration": format_duration(audio.duration),
        "audio_duration_seconds": round(audio.duration, 2),
        "language": f"{LANGUAGES[language]} ({language})",
        "language_code": language,
        "speakers_detected": speakers_detected,
        "processing_status": "Completed",
        "word_count": word_count,
        "confidence_score": confidence_text,
        "medical_specialty": "General Medicine",
        "sample_rate": f"{audio.original_sample_rate / 1000:.1f} kHz",
        "channels": channels,
        "decoding": decoding.upper(),
        "asr_model": "IndicConformer-600M-Multilingual (ONNX)",
        "diarization": diarization_label,
        "audio_format": audio.format,
        "audio_decoder": audio.decoder,
        "diarization_warning": warning,
        "is_live": True,
    }

    _notify(progress_callback, 1.0, "Transcription complete.")

    return {
        "transcript": clean_turns,
        "details": details,
        "is_live": True,
    }
