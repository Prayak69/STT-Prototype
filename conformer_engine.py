# -*- coding: utf-8 -*-
"""
IndicConformer-600M Multilingual inference through ONNX Runtime.

The model assets live in ``conformer_assets/`` and are the ONNX runtime files
from ai4bharat/indic-conformer-600m-multilingual. Only the Conformer assets are
used here; the Indic-Transcribe model is intentionally not part of this app.
"""
from __future__ import annotations

import json
import math
import os
import threading
from pathlib import Path
from typing import Optional, Sequence

import numpy as np
import onnxruntime as ort
from scipy.signal import resample_poly

TARGET_SR = 16000
N_FFT = 512
WIN_LENGTH = 400
HOP_LENGTH = 160
N_MELS = 80
PREEMPH = 0.97
LOG_GUARD = 2**-24

BLANK_ID = 256
RNNT_MAX_SYMBOLS = 10
PRED_RNN_LAYERS = 2
PRED_RNN_HIDDEN_DIM = 640
SOS = 256

LANGUAGES = {
    "as": "Assamese",
    "bn": "Bengali",
    "brx": "Bodo",
    "doi": "Dogri",
    "gu": "Gujarati",
    "hi": "Hindi",
    "kn": "Kannada",
    "kok": "Konkani",
    "ks": "Kashmiri",
    "mai": "Maithili",
    "ml": "Malayalam",
    "mni": "Manipuri",
    "mr": "Marathi",
    "ne": "Nepali",
    "or": "Odia",
    "pa": "Punjabi",
    "sa": "Sanskrit",
    "sat": "Santali",
    "sd": "Sindhi",
    "ta": "Tamil",
    "te": "Telugu",
    "ur": "Urdu",
}

LANGUAGE_LABELS = {f"{name} ({code})": code for code, name in LANGUAGES.items()}

SUPPORTED_LANGUAGE_CODES = tuple(LANGUAGES)

DEFAULT_ASSETS_DIR = Path(
    os.environ.get(
        "CONFORMER_ASSETS_DIR",
        Path(__file__).resolve().parent / "conformer_assets",
    )
)

REQUIRED_FILES = (
    "vocab.json",
    "language_masks.json",
    "encoder.onnx",
    "ctc_decoder.onnx",
    "rnnt_decoder.onnx",
    "joint_enc.onnx",
    "joint_pred.onnx",
    "joint_pre_net.onnx",
)

_F_SP = 200.0 / 3.0
_MIN_LOG_HZ = 1000.0
_MIN_LOG_MEL = _MIN_LOG_HZ / _F_SP
_LOGSTEP = math.log(6.4) / 27.0


def _hz2mel(f: np.ndarray) -> np.ndarray:
    f = np.asarray(f, dtype=np.float64)
    m = f / _F_SP
    mask = f >= _MIN_LOG_HZ
    m[mask] = _MIN_LOG_MEL + np.log(f[mask] / _MIN_LOG_HZ) / _LOGSTEP
    return m


def _mel2hz(m: np.ndarray) -> np.ndarray:
    m = np.asarray(m, dtype=np.float64)
    f = _F_SP * m
    mask = m >= _MIN_LOG_MEL
    f[mask] = _MIN_LOG_HZ * np.exp(_LOGSTEP * (m[mask] - _MIN_LOG_MEL))
    return f


def _build_mel_filterbank() -> np.ndarray:
    fmax = TARGET_SR / 2.0
    mels = np.linspace(
        _hz2mel(np.array([0.0]))[0],
        _hz2mel(np.array([fmax]))[0],
        N_MELS + 2,
    )
    hz = _mel2hz(mels)
    fft_freqs = np.linspace(0, fmax, N_FFT // 2 + 1)
    diff = np.diff(hz)
    ramps = hz[:, None] - fft_freqs[None, :]
    fb = np.zeros((N_MELS, N_FFT // 2 + 1), dtype=np.float64)
    for i in range(N_MELS):
        lower = -ramps[i] / (diff[i] + 1e-10)
        upper = ramps[i + 2] / (diff[i + 1] + 1e-10)
        fb[i] = np.maximum(0.0, np.minimum(lower, upper))
    return fb.astype(np.float32)


_MEL_FB = _build_mel_filterbank()

_WIN = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(WIN_LENGTH) / WIN_LENGTH)).astype(
    np.float32
)
if WIN_LENGTH < N_FFT:
    _pad = (N_FFT - WIN_LENGTH) // 2
    _w = np.zeros(N_FFT, dtype=np.float32)
    _w[_pad : _pad + WIN_LENGTH] = _WIN
    _WIN = _w


def preprocess(wav_mono: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Convert 16 kHz mono audio to (1, 80, T) log-mel features."""
    wav_mono = np.asarray(wav_mono, dtype=np.float32).reshape(-1)
    if wav_mono.size == 0:
        raise ValueError("Audio buffer is empty.")
    if wav_mono.size < N_FFT:
        wav_mono = np.pad(wav_mono, (0, N_FFT - wav_mono.size))

    x = np.concatenate(
        [wav_mono[:1], wav_mono[1:] - PREEMPH * wav_mono[:-1]]
    ).astype(np.float32)

    pad = N_FFT // 2
    if x.size > pad:
        x = np.pad(x, (pad, pad), mode="reflect")
    else:
        x = np.pad(x, (pad, pad), mode="constant")

    n_frames = 1 + (len(x) - N_FFT) // HOP_LENGTH
    idx = np.arange(N_FFT) + HOP_LENGTH * np.arange(n_frames)[:, None]
    frames = x[idx] * _WIN

    spec = np.fft.rfft(frames, n=N_FFT)
    power = np.abs(spec) ** 2

    mel = power @ _MEL_FB.T
    mel = np.log(mel + LOG_GUARD)

    mu = mel.mean(axis=0, keepdims=True)
    std = mel.std(axis=0, keepdims=True)
    mel = (mel - mu) / np.maximum(std, 1e-5)

    features = mel.T[np.newaxis, :, :].astype(np.float32)
    length = np.array([features.shape[2]], dtype=np.int64)
    return features, length


def _log_softmax(x: np.ndarray, axis: int = -1) -> np.ndarray:
    xm = x - x.max(axis=axis, keepdims=True)
    return xm - np.log(np.sum(np.exp(xm), axis=axis, keepdims=True))


def _unique_consecutive(arr: np.ndarray) -> np.ndarray:
    if len(arr) == 0:
        return arr
    mask = np.empty(len(arr), dtype=bool)
    mask[0] = True
    mask[1:] = arr[1:] != arr[:-1]
    return arr[mask]


def resample_audio(wav_mono: np.ndarray, orig_sr: int, target_sr: int = TARGET_SR) -> np.ndarray:
    wav_mono = np.asarray(wav_mono, dtype=np.float32).reshape(-1)
    if orig_sr == target_sr:
        return wav_mono
    g = math.gcd(int(orig_sr), int(target_sr))
    return resample_poly(
        wav_mono, target_sr // g, int(orig_sr) // g
    ).astype(np.float32)


def assets_available(assets_dir: Optional[Path | str] = None) -> bool:
    root = Path(assets_dir) if assets_dir else DEFAULT_ASSETS_DIR
    if not root.is_dir():
        return False
    return all((root / name).is_file() for name in REQUIRED_FILES)


class IndicConformerASR:
    """Lazy-loading ONNX Runtime wrapper for IndicConformer-600M."""

    LANGUAGES = SUPPORTED_LANGUAGE_CODES

    def __init__(
        self,
        assets_dir: Optional[Path | str] = None,
        providers: Optional[Sequence[str]] = None,
        num_threads: Optional[int] = None,
    ) -> None:
        self.assets_dir = Path(assets_dir) if assets_dir else DEFAULT_ASSETS_DIR
        if providers:
            self.providers = list(providers)
        elif "CUDAExecutionProvider" in ort.get_available_providers():
            self.providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        else:
            self.providers = ["CPUExecutionProvider"]
        self._lock = threading.Lock()

        if not assets_available(self.assets_dir):
            missing = [
                name
                for name in REQUIRED_FILES
                if not (self.assets_dir / name).is_file()
            ]
            raise FileNotFoundError(
                f"IndicConformer assets are missing in '{self.assets_dir}'. "
                f"Missing: {', '.join(missing)}"
            )

        with open(self.assets_dir / "vocab.json", encoding="utf-8") as handle:
            self.vocab = json.load(handle)
        with open(self.assets_dir / "language_masks.json", encoding="utf-8") as handle:
            self.lang_masks = json.load(handle)

        self.session_options = ort.SessionOptions()
        cores = os.cpu_count() or 2
        if num_threads is None:
            num_threads = cores if cores <= 4 else max(1, cores // 2)
        self.session_options.intra_op_num_threads = max(1, int(num_threads))
        self.session_options.inter_op_num_threads = 1
        self.session_options.graph_optimization_level = (
            ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        )
        self.session_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL

        self._encoder: Optional[ort.InferenceSession] = None
        self._ctc_decoder: Optional[ort.InferenceSession] = None
        self._rnnt_decoder: Optional[ort.InferenceSession] = None
        self._joint_enc: Optional[ort.InferenceSession] = None
        self._joint_pred: Optional[ort.InferenceSession] = None
        self._joint_pre_net: Optional[ort.InferenceSession] = None
        self._joint_post_sessions: dict[str, ort.InferenceSession] = {}

    def _session(self, filename: str) -> ort.InferenceSession:
        path = self.assets_dir / filename
        if not path.is_file():
            raise FileNotFoundError(f"Missing ONNX model: {path}")
        return ort.InferenceSession(
            str(path),
            sess_options=self.session_options,
            providers=self.providers,
        )

    @property
    def encoder(self) -> ort.InferenceSession:
        if self._encoder is None:
            self._encoder = self._session("encoder.onnx")
        return self._encoder

    @property
    def ctc_decoder(self) -> ort.InferenceSession:
        if self._ctc_decoder is None:
            self._ctc_decoder = self._session("ctc_decoder.onnx")
        return self._ctc_decoder

    @property
    def rnnt_decoder(self) -> ort.InferenceSession:
        if self._rnnt_decoder is None:
            self._rnnt_decoder = self._session("rnnt_decoder.onnx")
        return self._rnnt_decoder

    @property
    def joint_enc(self) -> ort.InferenceSession:
        if self._joint_enc is None:
            self._joint_enc = self._session("joint_enc.onnx")
        return self._joint_enc

    @property
    def joint_pred(self) -> ort.InferenceSession:
        if self._joint_pred is None:
            self._joint_pred = self._session("joint_pred.onnx")
        return self._joint_pred

    @property
    def joint_pre_net(self) -> ort.InferenceSession:
        if self._joint_pre_net is None:
            self._joint_pre_net = self._session("joint_pre_net.onnx")
        return self._joint_pre_net

    def _joint_post_session(self, lang: str) -> ort.InferenceSession:
        if lang not in self._joint_post_sessions:
            self._joint_post_sessions[lang] = self._session(
                f"joint_post_net_{lang}.onnx"
            )
        return self._joint_post_sessions[lang]

    def encode(self, features: np.ndarray, length: np.ndarray):
        return self.encoder.run(
            ["outputs", "encoded_lengths"],
            {"audio_signal": features, "length": length},
        )

    def ctc_decode(
        self,
        enc_out: np.ndarray,
        lang: str,
        with_confidence: bool = False,
    ):
        logprobs = self.ctc_decoder.run(
            ["logprobs"], {"encoder_output": enc_out}
        )[0]
        mask = np.asarray(self.lang_masks[lang], dtype=bool)
        lp = _log_softmax(logprobs[:, :, mask], axis=-1)

        token_ids = np.argmax(lp[0], axis=-1)
        confidence = None
        if with_confidence and token_ids.size:
            probs = np.exp(lp[0])
            token_conf = probs[np.arange(token_ids.size), token_ids]
            voiced = token_ids != BLANK_ID
            if np.any(voiced):
                confidence = float(token_conf[voiced].mean())

        collapsed = _unique_consecutive(token_ids)
        text = "".join(
            self.vocab[lang][int(token)] for token in collapsed if token != BLANK_ID
        )
        text = text.replace("▁", " ").strip()
        return (text, confidence) if with_confidence else text

    def rnnt_decode(self, enc_out: np.ndarray, lang: str) -> str:
        joint_encoded = self.joint_enc.run(
            ["output"], {"input": enc_out.transpose(0, 2, 1)}
        )[0]

        hyp = [SOS]
        h = np.zeros(
            (PRED_RNN_LAYERS, 1, PRED_RNN_HIDDEN_DIM), dtype=np.float32
        )
        c = np.zeros_like(h)

        post_session = self._joint_post_session(lang)

        for t in range(joint_encoded.shape[1]):
            f = joint_encoded[:, t : t + 1, :]
            not_blank = True
            symbols = 0

            while not_blank and symbols < RNNT_MAX_SYMBOLS:
                g, _, h_new, c_new = self.rnnt_decoder.run(
                    ["outputs", "prednet_lengths", "states", "162"],
                    {
                        "targets": np.array([[hyp[-1]]], dtype=np.int32),
                        "target_length": np.array([1], dtype=np.int32),
                        "states.1": h,
                        "onnx::Slice_3": c,
                    },
                )

                gp = self.joint_pred.run(
                    ["output"], {"input": g.transpose(0, 2, 1)}
                )[0]

                joint = self.joint_pre_net.run(
                    ["output"], {"input": f + gp}
                )[0]

                logits = post_session.run(["output"], {"input": joint})[0]
                lp = _log_softmax(logits, axis=-1)
                token = int(np.argmax(lp))

                if token == BLANK_ID:
                    not_blank = False
                else:
                    hyp.append(token)
                    h, c = h_new, c_new

                symbols += 1

        text = "".join(self.vocab[lang][token] for token in hyp if token != SOS)
        return text.replace("▁", " ").strip()

    def transcribe(
        self,
        wav_mono: np.ndarray,
        lang: str = "hi",
        mode: str = "rnnt",
        with_confidence: bool = False,
    ):
        if lang not in LANGUAGES:
            raise ValueError(
                f"Language '{lang}' is not supported. "
                f"Choose one of: {', '.join(LANGUAGES)}"
            )

        mode = (mode or "ctc").lower()
        if mode not in {"ctc", "rnnt"}:
            raise ValueError("Decoding mode must be 'ctc' or 'rnnt'.")

        features, length = preprocess(wav_mono)
        with self._lock:
            enc_out, _ = self.encode(features, length)
            if mode == "ctc":
                return self.ctc_decode(enc_out, lang, with_confidence=with_confidence)
            return self.rnnt_decode(enc_out, lang)

    def warmup(self, lang: str = "hi", mode: str = "rnnt") -> None:
        _ = self.encoder
        if mode == "ctc":
            _ = self.ctc_decoder
        else:
            _ = self.rnnt_decoder
            _ = self.joint_enc
            _ = self.joint_pred
            _ = self.joint_pre_net
            _ = self._joint_post_session(lang)


_ENGINE: Optional[IndicConformerASR] = None
_ENGINE_LOCK = threading.Lock()


def get_engine(assets_dir: Optional[Path | str] = None) -> IndicConformerASR:
    global _ENGINE
    if _ENGINE is None:
        with _ENGINE_LOCK:
            if _ENGINE is None:
                _ENGINE = IndicConformerASR(assets_dir=assets_dir)
    return _ENGINE
