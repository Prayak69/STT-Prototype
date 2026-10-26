# -*- coding: utf-8 -*-
"""Audio decoding helpers shared by the ASR and diarization stages."""
from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path
from typing import Union

import av
import numpy as np
import soundfile as sf

from conformer_engine import TARGET_SR, resample_audio

AudioSource = Union[str, Path, bytes]


class AudioDecodeError(RuntimeError):
    pass


@dataclass
class AudioData:
    waveform: np.ndarray
    sample_rate: int
    original_sample_rate: int
    channels: int
    duration: float
    format: str
    decoder: str


def _read_with_soundfile(source, filename: str):
    target = io.BytesIO(source) if isinstance(source, bytes) else str(source)
    data, sample_rate = sf.read(target, dtype="float32", always_2d=True)
    if data.size == 0:
        raise AudioDecodeError("Decoded audio is empty.")
    channels = int(data.shape[1])
    mono = data.mean(axis=1).astype(np.float32)
    fmt = (Path(filename).suffix.lstrip(".") or "audio").upper()
    return mono, int(sample_rate), channels, fmt


def _read_with_av(source, filename: str):
    target = io.BytesIO(source) if isinstance(source, bytes) else str(source)
    with av.open(target) as container:
        if not container.streams.audio:
            raise AudioDecodeError("The file does not contain an audio stream.")
        stream = container.streams.audio[0]
        original_sr = int(stream.rate or TARGET_SR)
        channels = int(stream.channels or 1)
        fmt = (container.format.name or Path(filename).suffix.lstrip(".") or "audio").upper()

        resampler = av.AudioResampler(
            format="flt",
            layout="mono",
        )
        chunks: list[np.ndarray] = []

        def _collect(frames):
            if not frames:
                return
            for frame in frames:
                chunks.append(
                    np.asarray(frame.to_ndarray(), dtype=np.float32).reshape(-1)
                )

        for frame in container.decode(stream):
            _collect(resampler.resample(frame))
        _collect(resampler.resample(None))

        if not chunks:
            raise AudioDecodeError("Decoded audio is empty.")
        mono = np.concatenate(chunks).astype(np.float32)
        return mono, original_sr, channels, fmt


def decode_audio(source: AudioSource, filename: str = "") -> AudioData:
    """Decode WAV/MP3/M4A/FLAC audio to mono 16 kHz float32."""
    filename = filename or (str(source) if not isinstance(source, bytes) else "audio")

    sf_error: Exception | None = None
    try:
        mono, original_sr, channels, fmt = _read_with_soundfile(source, filename)
        waveform = resample_audio(mono, original_sr, TARGET_SR)
        decoder = "soundfile"
    except Exception as exc:
        sf_error = exc
        try:
            mono, original_sr, channels, fmt = _read_with_av(source, filename)
            waveform = resample_audio(mono, original_sr, TARGET_SR)
            decoder = "PyAV"
        except Exception as av_exc:
            raise AudioDecodeError(
                f"Could not decode '{filename}' with soundfile ({sf_error}) "
                f"or PyAV ({av_exc})."
            ) from av_exc

    if waveform.size == 0:
        raise AudioDecodeError(f"Decoded audio '{filename}' is empty.")

    return AudioData(
        waveform=waveform.astype(np.float32),
        sample_rate=TARGET_SR,
        original_sample_rate=int(original_sr),
        channels=channels,
        duration=float(waveform.size / TARGET_SR),
        format=str(fmt),
        decoder=decoder,
    )


def format_timestamp(seconds: float) -> str:
    total = max(0, int(round(seconds)))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def format_duration(seconds: float) -> str:
    total = max(0, int(round(seconds)))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours} hr {minutes} min {secs} sec"
    if minutes:
        return f"{minutes} min {secs} sec"
    return f"{secs} sec"
