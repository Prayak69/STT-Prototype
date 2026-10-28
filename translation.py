# -*- coding: utf-8 -*-
"""Translate diarized transcripts to English using the Google Gemini API."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

DEFAULT_MODEL = "gemini-3.5-flash"


def _env_api_key() -> Optional[str]:
    for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
        value = os.environ.get(name)
        if value:
            return value.strip()
    return None


def is_translation_configured() -> bool:
    return bool(_env_api_key())


def translation_status() -> dict:
    return {
        "configured": is_translation_configured(),
        "model": os.environ.get("GEMINI_MODEL", DEFAULT_MODEL),
    }


def _client():
    from google import genai

    api_key = _env_api_key()
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not configured. Add it to .env to enable "
            "English translation."
        )
    return genai.Client(api_key=api_key)


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    return text


def translate_turns(turns: list[dict]) -> list[dict]:
    """Return a copy of ``turns`` with each ``text`` translated to English."""
    if not turns:
        return turns

    payload = [
        {
            "speaker": turn.get("speaker", ""),
            "timestamp": turn.get("timestamp", ""),
            "text": turn.get("text", ""),
        }
        for turn in turns
    ]

    prompt = (
        "Translate each 'text' field into natural English. The source may be "
        "Hindi, Hinglish, or a mix. Keep 'speaker' and 'timestamp' exactly "
        "unchanged. Do not add or drop entries. Return ONLY a JSON array of "
        "objects with the same keys and the same order, with 'text' translated."
        "\n\n"
        + json.dumps(payload, ensure_ascii=False)
    )

    client = _client()
    response = client.models.generate_content(
        model=os.environ.get("GEMINI_MODEL", DEFAULT_MODEL),
        contents=prompt,
    )
    raw = _strip_fences(response.text or "")
    translated = json.loads(raw)

    if not isinstance(translated, list) or len(translated) != len(turns):
        raise RuntimeError("Gemini returned an unexpected translation format.")

    result: list[dict] = []
    for original, item in zip(turns, translated):
        merged = dict(original)
        merged["text"] = str(item.get("text", original.get("text", "")))
        result.append(merged)
    return result
