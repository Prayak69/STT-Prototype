# -*- coding: utf-8 -*-
"""Load the heavy ASR and diarization models in the background at startup.

Streamlit reruns the script on every interaction, so the module-level flag keeps
the warmup thread from being started more than once per process.
"""
from __future__ import annotations

import threading

_started = False
_lock = threading.Lock()


def start_warmup() -> None:
    global _started
    with _lock:
        if _started:
            return
        _started = True

    def _run() -> None:
        try:
            from conformer_engine import get_engine

            get_engine().warmup("hi", "rnnt")
        except Exception:
            pass
        try:
            from diarization import get_diarizer, is_diarization_configured

            if is_diarization_configured():
                get_diarizer().preload()
        except Exception:
            pass

    threading.Thread(target=_run, name="model-warmup", daemon=True).start()
