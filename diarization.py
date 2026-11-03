# -*- coding: utf-8 -*-
"""Speaker diarization through pyannote.audio."""
from __future__ import annotations

import importlib.util
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

# Most accurate general-purpose pyannote diarization model.
# If you still get over-splitting (e.g. 2 speakers heard as 4), try
# "pyannote/speaker-diarization-precision" instead — it favors fewer,
# higher-confidence speaker clusters.
DEFAULT_MODEL = "pyannote/speaker-diarization-3.1"


class DiarizationUnavailable(RuntimeError):
    pass


@dataclass
class DiarizationResult:
    segments: list[dict] = field(default_factory=list)
    speakers: list[str] = field(default_factory=list)
    num_speakers: int = 0
    model_name: str = DEFAULT_MODEL
    engine: str = "pyannote.audio"


def _env_token() -> Optional[str]:
    for name in ("HF_TOKEN", "HUGGINGFACE_TOKEN", "PYANNOTE_AUTH_TOKEN"):
        value = os.environ.get(name)
        if value:
            return value.strip()
    return None


def _env_model() -> str:
    return os.environ.get("PYANNOTE_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL


def pyannote_installed() -> bool:
    return importlib.util.find_spec("pyannote.audio") is not None


def is_diarization_configured() -> bool:
    return pyannote_installed() and bool(_env_token())


def diarization_status() -> dict:
    return {
        "installed": pyannote_installed(),
        "token_configured": bool(_env_token()),
        "model": _env_model(),
    }


class SpeakerDiarizer:
    def __init__(
        self,
        model_name: Optional[str] = None,
        token: Optional[str] = None,
        device: Optional[str] = None,
        cache_dir: Optional[str] = None,
    ) -> None:
        self.model_name = model_name or _env_model()
        self.token = token or _env_token()
        self.device = device
        self.cache_dir = cache_dir
        self._pipeline = None
        self._lock = threading.Lock()

    def _load_pipeline(self):
        if self._pipeline is not None:
            return self._pipeline

        if not pyannote_installed():
            raise DiarizationUnavailable(
                "pyannote.audio is not installed. Run: pip install -r requirements.txt"
            )
        if not self.token:
            raise DiarizationUnavailable(
                "HF_TOKEN is not configured. Add it to .env and accept the pyannote "
                "model conditions on Hugging Face."
            )

        import torch
        from pyannote.audio import Pipeline

        # Let pyannote use every core (torch defaults to fewer threads).
        try:
            torch.set_num_threads(max(1, os.cpu_count() or 1))
        except Exception:
            pass

        pipeline = Pipeline.from_pretrained(
            self.model_name,
            token=self.token,
            cache_dir=self.cache_dir,
        )
        if pipeline is None:
            raise DiarizationUnavailable(
                f"Could not load '{self.model_name}'. Check the Hugging Face token "
                "and accept the model conditions."
            )

        target_device = self.device or ("cuda" if torch.cuda.is_available() else "cpu")
        try:
            pipeline.to(torch.device(target_device))
        except Exception:
            pass

        self._pipeline = pipeline
        return pipeline

    def preload(self) -> None:
        with self._lock:
            self._load_pipeline()

    def diarize(
        self,
        waveform: np.ndarray,
        sample_rate: int = 16000,
        num_speakers: Optional[int] = None,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None,
    ) -> DiarizationResult:
        import torch

        with self._lock:
            pipeline = self._load_pipeline()

        wav = np.asarray(waveform, dtype=np.float32).reshape(-1)
        if wav.size == 0:
            raise DiarizationUnavailable("Cannot diarize an empty audio buffer.")

        audio_in = {
            "waveform": torch.from_numpy(wav).unsqueeze(0),
            "sample_rate": sample_rate,
        }
        kwargs = {}
        if num_speakers:
            kwargs["num_speakers"] = int(num_speakers)
        else:
            if min_speakers:
                kwargs["min_speakers"] = int(min_speakers)
            if max_speakers:
                kwargs["max_speakers"] = int(max_speakers)

        output = pipeline(audio_in, **kwargs)
        segments = _extract_segments(output)

        speakers = []
        for segment in segments:
            label = segment["speaker"]
            if label not in speakers:
                speakers.append(label)

        return DiarizationResult(
            segments=segments,
            speakers=speakers,
            num_speakers=len(speakers),
            model_name=self.model_name,
        )


def _extract_segments(output) -> list[dict]:
    annotation = None
    for attr in ("exclusive_speaker_diarization", "speaker_diarization"):
        candidate = getattr(output, attr, None)
        if candidate is not None:
            annotation = candidate
            break
    if annotation is None:
        annotation = output

    segments: list[dict] = []
    if hasattr(annotation, "itertracks"):
        for turn, _, speaker in annotation.itertracks(yield_label=True):
            segments.append(
                {
                    "start": float(turn.start),
                    "end": float(turn.end),
                    "speaker": str(speaker),
                }
            )
    else:
        try:
            for turn, speaker in annotation:
                segments.append(
                    {
                        "start": float(turn.start),
                        "end": float(turn.end),
                        "speaker": str(speaker),
                    }
                )
        except Exception as exc:
            raise DiarizationUnavailable(
                f"Unsupported pyannote output type: {type(annotation).__name__}"
            ) from exc

    segments.sort(key=lambda item: (item["start"], item["end"]))
    return segments


_DIARIZER: Optional[SpeakerDiarizer] = None
_DIARIZER_LOCK = threading.Lock()


def get_diarizer() -> SpeakerDiarizer:
    global _DIARIZER
    if _DIARIZER is None:
        with _DIARIZER_LOCK:
            if _DIARIZER is None:
                _DIARIZER = SpeakerDiarizer()
    return _DIARIZER
