"""Spoken team briefings: text-to-speech through xAI's Grok Voice API.

The key stays on the server (env XAI_API_KEY); the website only ever sees audio. Results are
cached by voice + text, so replaying a briefing costs nothing and is instant.
"""
from __future__ import annotations

import base64
import hashlib
import os

import requests

from . import config

TTS_URL = "https://api.x.ai/v1/tts"
DEFAULT_VOICE = "eve"
MAX_CHARS = 2000


class TTSError(RuntimeError):
    pass


def available() -> bool:
    return bool(os.environ.get("XAI_API_KEY", "").strip())


def voice() -> str:
    return os.environ.get("XAI_TTS_VOICE", "").strip() or DEFAULT_VOICE


def _cache_path(text: str, voice_id: str):
    key = hashlib.sha256(f"{voice_id}\n{text}".encode()).hexdigest()[:24]
    return config.CACHE_DIR / "tts" / f"{key}.mp3"


def _request(text: str, voice_id: str) -> bytes:
    r = requests.post(
        TTS_URL,
        headers={"Authorization": f"Bearer {os.environ['XAI_API_KEY'].strip()}"},
        json={"text": text, "voice_id": voice_id, "language": "en", "output_format": {"codec": "mp3"}},
        timeout=30,
    )
    if r.status_code != 200:
        raise TTSError(f"xAI TTS returned {r.status_code}: {r.text[:200]}")
    # documented response: JSON with base64 "audio"; accept raw audio too
    if r.headers.get("content-type", "").startswith("application/json"):
        data = r.json()
        audio = data.get("audio")
        if not audio:
            raise TTSError("xAI TTS response had no audio")
        return base64.b64decode(audio)
    return r.content


def synthesize(text: str) -> bytes:
    """MP3 bytes for `text`, from the cache when this exact briefing was spoken before."""
    text = " ".join(text.split())[:MAX_CHARS]
    if not text:
        raise TTSError("nothing to say")
    v = voice()
    path = _cache_path(text, v)
    if path.exists():
        return path.read_bytes()
    audio = _request(text, v)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(audio)
    return audio
