# -*- coding: utf-8 -*-
"""Wall-clock timing for the end-to-end transcription pipeline."""
from __future__ import annotations

import time


class ProcessTimer:
    """Measure elapsed time from when processing starts until it finishes."""

    def __init__(self) -> None:
        self._start: float | None = None
        self._end: float | None = None

    def start(self) -> "ProcessTimer":
        self._start = time.perf_counter()
        self._end = None
        return self

    def stop(self) -> float:
        if self._start is not None and self._end is None:
            self._end = time.perf_counter()
        return self.elapsed_seconds

    @property
    def elapsed_seconds(self) -> float:
        if self._start is None:
            return 0.0
        end = self._end if self._end is not None else time.perf_counter()
        return end - self._start

    @property
    def elapsed_minutes(self) -> float:
        return self.elapsed_seconds / 60.0

    def format(self) -> str:
        """Readable form, e.g. ``2m 14.3s``."""
        total = self.elapsed_seconds
        minutes = int(total // 60)
        seconds = total - minutes * 60
        return f"{minutes}m {seconds:04.1f}s"

    def format_minutes(self) -> str:
        """Minutes with two decimals, e.g. ``2.24 min``."""
        return f"{self.elapsed_minutes:.2f} min"
