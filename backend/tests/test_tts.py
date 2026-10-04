"""Spoken team briefings (/api/tts): key handling, response decoding and caching. No network."""
import base64

import pytest
from fastapi.testclient import TestClient

from app import config, tts


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    import app.main as main
    main.tts_limit.reset()
    yield TestClient(main.app)
    main.tts_limit.reset()


class _Resp:
    def __init__(self, status=200, json_body=None, content=b"", ctype="application/json"):
        self.status_code = status
        self._json = json_body
        self.content = content
        self.text = str(json_body)
        self.headers = {"content-type": ctype}

    def json(self):
        return self._json


def test_health_reports_tts(client, monkeypatch):
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    assert client.get("/api/health").json()["tts"] is False
    monkeypatch.setenv("XAI_API_KEY", "test-key")
    assert client.get("/api/health").json()["tts"] is True


def test_no_key_is_503(client, monkeypatch):
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    r = client.post("/api/tts", json={"text": "Team 1, start at the creek."})
    assert r.status_code == 503


def test_speaks_and_caches(client, monkeypatch):
    monkeypatch.setenv("XAI_API_KEY", "test-key")
    calls = []

    def fake_post(url, headers, json, timeout):
        calls.append(json)
        assert url == tts.TTS_URL
        assert headers["Authorization"] == "Bearer test-key"
        assert json["output_format"]["codec"] == "mp3" and json["language"] == "en"
        return _Resp(json_body={"audio": base64.b64encode(b"ID3fake-mp3").decode(), "content_type": "audio/mpeg"})

    monkeypatch.setattr(tts.requests, "post", fake_post)
    body = {"text": "Team 1,   start at the creek."}
    r1 = client.post("/api/tts", json=body)
    assert r1.status_code == 200 and r1.headers["content-type"] == "audio/mpeg"
    assert r1.content == b"ID3fake-mp3"
    # whitespace-normalised text is the cache key: the second call never reaches xAI
    r2 = client.post("/api/tts", json={"text": "Team 1, start at the creek."})
    assert r2.content == b"ID3fake-mp3"
    assert len(calls) == 1
    assert calls[0]["text"] == "Team 1, start at the creek."


def test_raw_audio_response_and_upstream_error(client, monkeypatch):
    monkeypatch.setenv("XAI_API_KEY", "test-key")
    monkeypatch.setattr(tts.requests, "post", lambda *a, **k: _Resp(content=b"RAWMP3", ctype="audio/mpeg"))
    assert client.post("/api/tts", json={"text": "raw"}).content == b"RAWMP3"
    monkeypatch.setattr(tts.requests, "post", lambda *a, **k: _Resp(status=401, json_body={"error": "bad key"}))
    assert client.post("/api/tts", json={"text": "fails"}).status_code == 502


def test_text_length_limit(client, monkeypatch):
    monkeypatch.setenv("XAI_API_KEY", "test-key")
    assert client.post("/api/tts", json={"text": "x" * (tts.MAX_CHARS + 1)}).status_code == 422
