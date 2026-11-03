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

# The summary prompt lives in code and is sent with every request so the model
# is always grounded in the transcript and never invents its own content.
SUMMARY_PROMPT = """You are a careful clinical conversation summarizer.

You will receive a diarized transcript. Produce a detailed, nuanced, and
well-structured summary.

STRICT RULES:
- Use ONLY information explicitly stated in the transcript.
- Do NOT invent, infer, diagnose, or add medical advice.
- Do NOT use outside knowledge.
- If a section has no relevant information, write "Not discussed."
- Preserve names, IDs, numbers, amounts, dates, medicines, and policy details
  exactly as stated.
- Keep speaker labels (Speaker 1, Speaker 2, ...) as given.
- Write the summary in English regardless of the transcript language.

Return valid Markdown using exactly these sections:

## Overview
A 2-4 sentence summary of the conversation's purpose and outcome.

## Participants
List each speaker and what the transcript reveals about their role. Do not
guess beyond what is said.

## Key Topics Discussed
Bullet points of the main topics.

## Details and Facts Mentioned
Bullet points of concrete facts: names, IDs, policy numbers, dates, amounts,
medicines, symptoms, locations, etc.

## Decisions and Agreements
What was decided or agreed, if anything.

## Action Items and Next Steps
Who needs to do what, if stated.

## Open Questions and Unresolved Points
Anything left unclear or pending.

## Important Quotes
Up to 3 short verbatim quotes, each with speaker and timestamp.

TRANSCRIPT:
"""


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


def summarize_turns(turns: list[dict]) -> str:
    """Summarize ``turns`` into structured Markdown, grounded in the transcript."""
    if not turns:
        return ""

    lines = [
        f"[{turn.get('timestamp', '')}] {turn.get('speaker', '')}: {turn.get('text', '')}"
        for turn in turns
    ]
    transcript_text = "\n".join(lines)

    client = _client()
    response = client.models.generate_content(
        model=os.environ.get("GEMINI_MODEL", DEFAULT_MODEL),
        contents=SUMMARY_PROMPT + transcript_text,
    )
    return (response.text or "").strip()
