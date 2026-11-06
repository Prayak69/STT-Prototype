# -*- coding: utf-8 -*-
"""Rolling speaker-diarization sidecar for Gnani realtime sessions.

pyannote/speaker-diarization-3.1 is an offline, whole-file model. It cannot be
fed one 32 ms frame at a time, so this sidecar keeps a rolling buffer of the
exact PCM audio the Node proxy sends to Gnani and re-diarizes the trailing
window every few seconds. The output is a speaker timeline with *absolute*
times (seconds since the start of the stream), which the Node proxy uses to
label Gnani transcript segments.

Protocol (WebSocket, default ws://127.0.0.1:8790)
------------------------------------------------
Node proxy -> sidecar:
  binary frames of 16 kHz mono little-endian signed 16-bit PCM (1024 bytes).
  The frames must be the same frames sent to Gnani, in order.
  {"type":"sync","audio_ms":0} on (re)connect: absolute time of the first
  frame that follows, used to keep timestamps aligned after a reconnect.
  {"type":"flush"} when the stream ends: answer with the latest known timeline
  and `final: true`, without starting another pyannote pass (on CPU a single
  window can take tens of seconds).

Sidecar -> Node proxy (JSON):
  {"type":"ready","sample_rate":16000,"num_speakers":2}
  {"type":"timeline","turns":[{"start":0.0,"end":1.4,"speaker":1}, ...]}
  {"type":"timeline","turns":[...],"final":true}   # answer to "flush"
  {"type":"error","message":"..."}

`speaker` is a stable integer id per connection (1, 2, ...), so the caller can
render "Speaker 1" / "Speaker 2".

Run (self-contained, everything inside this folder):
    cd Gnani-Hackathon
    python -m venv .venv
    .\\.venv\\Scripts\\python.exe -m pip install -r requirements.txt
    .\\.venv\\Scripts\\python.exe diarizer_server.py
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urlparse

import numpy as np
from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parent

if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

# Everything this sidecar needs (HF_TOKEN, DIARIZER_*) lives in this folder's
# .env; it never reads the repository root.
load_dotenv(APP_DIR / ".env")

from diarization import (  # noqa: E402
    SpeakerDiarizer,
    diarization_status,
)

try:
    from websockets.asyncio.server import serve
    from websockets.exceptions import ConnectionClosed
except ImportError as exc:  # pragma: no cover - dependency guard
    raise SystemExit(
        "websockets is not installed. Run: pip install -r requirements.txt"
    ) from exc

SAMPLE_RATE = 16000
BYTES_PER_SAMPLE = 2
BYTES_PER_SECOND = SAMPLE_RATE * BYTES_PER_SAMPLE
FRAME_BYTES = 1024
FRAME_SECONDS = FRAME_BYTES / BYTES_PER_SECOND  # 0.032 s

# Never grow the buffer past ~25 minutes. Gnani realtime disconnects at 15.
MAX_AUDIO_SECONDS = 25 * 60

# A window needs at least this much audio before the first run.
MIN_START_SECONDS = 8.0

# Two local labels are treated as the same speaker when at least this share of
# their speech overlaps a speaker already seen in the timeline.
SAME_SPEAKER_OVERLAP = 0.2

# Very short unrecognised bursts (coughs, noise, one-word interjections) reuse
# the closest known speaker instead of creating a new Speaker N.
MIN_NEW_SPEAKER_SECONDS = 1.0

# Voice fingerprints (pyannote centroids) are compared with cosine similarity.
# Rolling windows re-cluster from scratch, so a window that starts after a pause
# may label the same voice with a new SPEAKER_XX and share no audio with the
# previous timeline. Comparing voice fingerprints keeps one voice on one
# global speaker id. Same-speaker cosine is usually > 0.7; different speakers
# are usually < 0.35. Override with DIARIZER_VOICE_MATCH.
try:
    VOICE_MATCH_MIN_SIMILARITY = float(
        os.environ.get("DIARIZER_VOICE_MATCH", "0.55")
    )
except ValueError:
    VOICE_MATCH_MIN_SIMILARITY = 0.55

# Fingerprints from < 1.2 s of speech are too noisy to identify a voice.
VOICE_MIN_SPEECH_SECONDS = 1.2

# How quickly a speaker fingerprint adapts to new audio (0 = never).
VOICE_UPDATE_RATE = 0.3

RUN_LOCK = asyncio.Lock()


def log(message: str) -> None:
    print(f"[diarizer] {message}", flush=True)


@dataclass
class Turn:
    start: float
    end: float
    speaker: int

    def as_dict(self, offset: float = 0.0) -> dict:
        return {
            "start": round(self.start + offset, 3),
            "end": round(self.end + offset, 3),
            "speaker": self.speaker,
        }


class LiveSession:
    """One browser realtime session: rolling audio + stable speaker timeline."""

    def __init__(
        self,
        diarizer: SpeakerDiarizer,
        num_speakers: Optional[int],
        window_sec: float,
        hop_sec: float,
    ) -> None:
        self.diarizer = diarizer
        self.num_speakers = num_speakers
        self.window_sec = max(6.0, window_sec)
        self.hop_sec = max(1.0, hop_sec)
        self.min_start = min(MIN_START_SECONDS, self.window_sec)

        self._audio = bytearray()
        self._timeline: list[Turn] = []
        self._next_speaker = 1
        # L2-normalised voice fingerprint per global speaker id.
        self._centroids: dict[int, np.ndarray] = {}
        self._next_run_at = 0.0
        self._busy = False
        self._failed = False
        # Absolute stream time of the first byte in this buffer. The proxy
        # resends `sync` after a reconnect so labels stay aligned with it.
        self._offset = 0.0

    # -- audio -----------------------------------------------------------

    @property
    def duration(self) -> float:
        return len(self._audio) / BYTES_PER_SECOND

    def append(self, pcm: bytes) -> None:
        if not pcm or self._failed:
            return
        if self.duration >= MAX_AUDIO_SECONDS:
            return
        self._audio.extend(pcm)

    def wants_run(self) -> bool:
        if self._failed or self._busy:
            return False
        duration = self.duration
        if duration < self.min_start:
            return False
        return duration >= self._next_run_at

    # -- diarization -----------------------------------------------------

    def run(self) -> Optional[list[dict]]:
        if self._failed:
            return None

        duration = self.duration
        if duration <= 0:
            return None

        window_start = max(0.0, duration - self.window_sec)
        start_byte = int(window_start * BYTES_PER_SECOND)
        start_byte -= start_byte % BYTES_PER_SAMPLE
        window_start = start_byte / BYTES_PER_SECOND

        raw = bytes(self._audio[start_byte:])
        if len(raw) < BYTES_PER_SAMPLE * SAMPLE_RATE:
            return None  # less than one second of new audio

        wav = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0

        self._busy = True
        try:
            result = self.diarizer.diarize(
                wav,
                SAMPLE_RATE,
                num_speakers=self.num_speakers or None,
            )
            segments = [
                {
                    "start": window_start + float(seg["start"]),
                    "end": window_start + float(seg["end"]),
                    "speaker": str(seg["speaker"]),
                }
                for seg in result.segments
            ]
            self._merge(window_start, segments, result.speaker_embeddings)
        finally:
            self._busy = False
            # Schedule the next pass a full hop after this one *finished*, so a
            # slow CPU cannot build an ever-growing backlog of windows.
            self._next_run_at = self.duration + self.hop_sec

        return self.snapshot()

    def fail(self) -> None:
        self._failed = True

    def set_offset(self, audio_ms) -> None:
        """Absolute time (ms) of the first audio frame this buffer will hold."""
        try:
            offset = float(audio_ms) / 1000.0
        except (TypeError, ValueError):
            return
        if offset >= 0:
            self._offset = offset

    def snapshot(self) -> list[dict]:
        return [turn.as_dict(self._offset) for turn in self._timeline]

    def _clip(self, window_start: float) -> list[Turn]:
        """Keep past turns, trimming one that crosses into the new window."""
        kept: list[Turn] = []
        for turn in self._timeline:
            if turn.end <= window_start + 1e-6:
                kept.append(turn)
            elif turn.start < window_start - 1e-6:
                kept.append(Turn(turn.start, window_start, turn.speaker))
        return kept

    # -- label mapping ---------------------------------------------------

    def _remember_voice(
        self,
        speaker: int,
        vector: Optional[np.ndarray],
        speech: float,
    ) -> None:
        """Keep a running voice fingerprint for a global speaker id."""
        if vector is None or speech < VOICE_MIN_SPEECH_SECONDS:
            return

        current = self._centroids.get(speaker)
        if current is None:
            self._centroids[speaker] = vector.copy()
            return

        blended = current * (1.0 - VOICE_UPDATE_RATE) + vector * VOICE_UPDATE_RATE
        norm = float(np.linalg.norm(blended))
        if np.isfinite(norm) and norm > 1e-6:
            self._centroids[speaker] = blended / norm

    def _best_voice_match(
        self,
        vector: Optional[np.ndarray],
        start: float,
        end: float,
        taken: dict[int, list[tuple[float, float]]],
    ) -> tuple[Optional[int], float]:
        """Closest known voice, ignoring speakers talking at the same time."""
        if vector is None:
            return None, 0.0

        best_speaker: Optional[int] = None
        best_score = 0.0
        for speaker, centroid in self._centroids.items():
            simultaneous = any(
                min(turn_end, end) - max(turn_start, start) > 0.2
                for turn_start, turn_end in taken.get(speaker, ())
            )
            if simultaneous:
                continue
            score = float(np.dot(vector, centroid))
            if np.isfinite(score) and score > best_score:
                best_score = score
                best_speaker = speaker
        return best_speaker, best_score

    def _merge(
        self,
        window_start: float,
        segments: list[dict],
        embeddings: Optional[dict[str, np.ndarray]] = None,
    ) -> None:
        """Map window-local SPEAKER_XX labels onto stable global ids."""
        if not segments:
            self._timeline = self._clip(window_start)
            return

        embeddings = embeddings or {}
        by_label: dict[str, list[dict]] = {}
        for seg in segments:
            by_label.setdefault(seg["speaker"], []).append(seg)

        mapping: dict[str, int] = {}
        max_speakers = self.num_speakers or 0
        recent_speaker = self._timeline[-1].speaker if self._timeline else None
        # Spans already assigned in this pass, per global speaker, so two
        # simultaneous labels are never merged by voice similarity.
        taken: dict[int, list[tuple[float, float]]] = {}

        for label, label_segments in by_label.items():
            start = min(float(seg["start"]) for seg in label_segments)
            end = max(float(seg["end"]) for seg in label_segments)
            speech = sum(
                max(0.0, seg["end"] - seg["start"]) for seg in label_segments
            ) or 1e-6
            vector = embeddings.get(label)

            # Compare against the full timeline: the overlapping part of the
            # previous window is what links this label to a global speaker.
            overlap: dict[int, float] = {}
            for seg in label_segments:
                for turn in self._timeline:
                    shared = min(turn.end, seg["end"]) - max(turn.start, seg["start"])
                    if shared > 0:
                        overlap[turn.speaker] = overlap.get(turn.speaker, 0.0) + shared

            best = max(overlap, key=overlap.get) if overlap else None
            overlap_ratio = overlap[best] / speech if best is not None else 0.0
            voice_speaker, voice_score = self._best_voice_match(
                vector, start, end, taken
            )

            if best is not None and overlap_ratio >= 0.5:
                # Direct temporal evidence from the audio both windows share.
                mapping[label] = best
            elif (
                voice_speaker is not None
                and voice_score >= VOICE_MATCH_MIN_SIMILARITY
            ):
                # Same voice as an earlier window, even with a silence gap.
                mapping[label] = voice_speaker
            elif best is not None and overlap_ratio >= SAME_SPEAKER_OVERLAP:
                mapping[label] = best
            elif speech < MIN_NEW_SPEAKER_SECONDS and (
                best is not None or recent_speaker is not None
            ):
                mapping[label] = best if best is not None else recent_speaker
            elif max_speakers and self._next_speaker > max_speakers:
                # Speaker budget exhausted (e.g. 2-person call): never invent
                # "Speaker 3". Reuse the best match or the last active speaker.
                mapping[label] = (
                    best if best is not None else (recent_speaker or 1)
                )
            else:
                mapping[label] = self._next_speaker
                self._next_speaker += 1

            speaker = mapping[label]
            self._remember_voice(speaker, vector, speech)
            taken.setdefault(speaker, []).append((start, end))
            recent_speaker = speaker

        # Everything at or after the window is recomputed; keep the past.
        kept = self._clip(window_start)
        for seg in segments:
            start = max(float(seg["start"]), window_start)
            end = float(seg["end"])
            if end - start <= 0.05:
                continue

            speaker = mapping[seg["speaker"]]
            if kept and kept[-1].speaker == speaker and start - kept[-1].end <= 0.3:
                kept[-1] = Turn(kept[-1].start, max(kept[-1].end, end), speaker)
            else:
                kept.append(Turn(start, end, speaker))

        self._timeline = kept


async def handle_connection(connection, settings: argparse.Namespace) -> None:
    params = parse_qs(urlparse(connection.request.path).query)
    session_id = (params.get("session_id") or ["?"])[0]

    raw_speakers = (params.get("num_speakers") or [""])[0]
    try:
        num_speakers = int(raw_speakers) if raw_speakers else settings.num_speakers
    except ValueError:
        num_speakers = settings.num_speakers
    if num_speakers is not None and num_speakers <= 0:
        num_speakers = None

    session = LiveSession(
        diarizer=settings.diarizer,
        num_speakers=num_speakers,
        window_sec=settings.window,
        hop_sec=settings.hop,
    )
    log(f"{session_id}: connected (num_speakers={num_speakers or 'auto'})")

    await connection.send(
        json.dumps(
            {
                "type": "ready",
                "sample_rate": SAMPLE_RATE,
                "num_speakers": num_speakers,
            }
        )
    )

    wake = asyncio.Event()
    failures = 0

    async def worker() -> None:
        nonlocal failures
        while True:
            await wake.wait()
            wake.clear()
            if not session.wants_run():
                continue
            try:
                async with RUN_LOCK:
                    timeline = await asyncio.to_thread(session.run)
            except Exception as exc:  # noqa: BLE001 - report and retry next pass
                # A single bad window (OOM, a pyannote hiccup) must not disable
                # speaker labels for the rest of the session. Keep trying.
                failures += 1
                if failures == 1 or failures % 5 == 0:
                    log(
                        f"{session_id}: diarization failed "
                        f"({failures}x), retrying: {exc}"
                    )
                try:
                    await connection.send(
                        json.dumps({"type": "error", "message": str(exc)})
                    )
                except ConnectionClosed:
                    return
                continue

            if timeline is None:
                continue
            failures = 0
            try:
                await connection.send(
                    json.dumps({"type": "timeline", "turns": timeline})
                )
            except ConnectionClosed:
                return
            log(
                f"{session_id}: timeline {round(session.duration, 1)}s "
                f"turns={len(timeline)}"
            )

    task = asyncio.create_task(worker())

    try:
        async for message in connection:
            if isinstance(message, str):
                try:
                    control = json.loads(message)
                except ValueError:
                    continue
                if not isinstance(control, dict):
                    continue
                if control.get("type") == "sync":
                    session.set_offset(control.get("audio_ms"))
                elif control.get("type") == "flush":
                    # The caller only needs the latest known timeline so it can
                    # close the labels. Do not start another expensive pyannote
                    # pass here: on CPU a full window can take tens of seconds.
                    await connection.send(
                        json.dumps(
                            {
                                "type": "timeline",
                                "turns": session.snapshot(),
                                "final": True,
                            }
                        )
                    )
                continue
            session.append(bytes(message))
            if session.wants_run():
                wake.set()
    except ConnectionClosed:
        pass
    finally:
        task.cancel()
        log(f"{session_id}: closed after {round(session.duration, 1)}s")


async def serve_forever(settings: argparse.Namespace) -> None:
    async with serve(
        partial(handle_connection, settings=settings),
        settings.host,
        settings.port,
        max_size=FRAME_BYTES * 4,
        ping_interval=20,
        ping_timeout=20,
    ):
        log(
            f"listening on ws://{settings.host}:{settings.port} "
            f"(window={settings.window}s hop={settings.hop}s, "
            f"num_speakers={settings.num_speakers or 'auto'})"
        )
        await asyncio.Future()


def _env_int(name: str, fallback: int) -> int:
    try:
        return int(os.environ.get(name, fallback))
    except (TypeError, ValueError):
        return fallback


def _env_float(name: str, fallback: float) -> float:
    try:
        return float(os.environ.get(name, fallback))
    except (TypeError, ValueError):
        return fallback


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--host", default=os.environ.get("DIARIZER_HOST", "127.0.0.1")
    )
    parser.add_argument(
        "--port", type=int, default=_env_int("DIARIZER_PORT", 8790)
    )
    parser.add_argument(
        "--num-speakers",
        type=int,
        default=_env_int("DIARIZER_NUM_SPEAKERS", 0),
        help="0 = let pyannote decide (default: 0)",
    )
    parser.add_argument(
        "--window",
        type=float,
        default=_env_float("DIARIZER_WINDOW_SEC", 18.0),
        help="seconds of trailing audio per pass (default: 18)",
    )
    parser.add_argument(
        "--hop",
        type=float,
        default=_env_float("DIARIZER_HOP_SEC", 4.0),
        help="seconds of new audio between passes (default: 4)",
    )
    return parser.parse_args()


def main() -> None:
    settings = parse_args()
    status = diarization_status()
    if not status["installed"]:
        raise SystemExit(
            "pyannote.audio is not installed. Run: pip install -r requirements.txt"
        )
    if not status["token_configured"]:
        raise SystemExit(
            "HF_TOKEN is missing. Add it to .env and accept the model conditions "
            "for pyannote/speaker-diarization-3.1 and pyannote/segmentation-3.0."
        )

    settings.diarizer = SpeakerDiarizer()
    log(f"loading {status['model']} (first run downloads the weights) ...")
    try:
        settings.diarizer.preload()
    except Exception as exc:  # noqa: BLE001 - startup failure is fatal
        raise SystemExit(f"Could not load the diarization model: {exc}") from exc
    log("model ready")

    try:
        asyncio.run(serve_forever(settings))
    except KeyboardInterrupt:
        log("stopped")


if __name__ == "__main__":
    main()
