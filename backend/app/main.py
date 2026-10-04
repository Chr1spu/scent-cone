"""Scentline backend: terrain, land cover, features, weather and wind for a search area."""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import re

import numpy as np
from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

from . import config, jobs, tts, windninja
from .areas import Area, create_area, load_area
from .encode import grid_response
from .features import fetch_features
from .landcover import fetch_landcover
from .ratelimit import RateLimit
from .terrain import fetch_dem
from .weather import fetch_weather, fetch_weather_span, local_now, resolve_timezone

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Scentline API", version="0.1.0")
origins = os.environ.get("CORS_ORIGINS", "*").split(",")
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"],
                   expose_headers=["X-Grid-Meta", "X-Wind-Source", "X-Data-Info"],
                   # lets the public HTTPS site call a server on localhost (Private Network Access)
                   allow_private_network=True)


# per-client limits on the endpoints that download data or start WindNinja
area_limit = RateLimit(*config.RATE_LIMIT_AREAS)
wind_limit = RateLimit(*config.RATE_LIMIT_WIND)
tts_limit = RateLimit(*config.RATE_LIMIT_TTS)

_OV_MIN, _OV_MAX = config.OVERVIEW_SIZE_RANGE_M
_DT_MIN, _DT_MAX = config.DETAIL_SIZE_RANGE_M


class AreaRequest(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    overviewSizeM: float | None = Field(None, ge=_OV_MIN, le=_OV_MAX)
    detailSizeM: float | None = Field(None, ge=_DT_MIN, le=_DT_MAX)
    detailCenter: tuple[float, float] | None = None  # (lat, lon)
    # IANA zone, or "auto" to look it up from the coordinates
    timezone: str = Field("auto", max_length=64)

    @model_validator(mode="after")
    def _detail_fits(self):
        ov = self.overviewSizeM or config.OVERVIEW_SIZE_M
        if (self.detailSizeM or config.DETAIL_SIZE_M) > ov:
            raise ValueError("detailSizeM must not exceed overviewSizeM")
        return self


class WindRequest(BaseModel):
    date: str
    startHour: int = Field(14, ge=0, le=23)
    endHour: int = Field(22, ge=0, le=config.MAX_HOUR)
    stepHours: int = Field(1, ge=1, le=6)


def _date(date: str) -> str:
    """YYYY-MM-DD only: dates end up in cache file names."""
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            dt.date.fromisoformat(date)
            return date
    except ValueError:
        pass
    raise HTTPException(400, "date must be YYYY-MM-DD")


def _hour(hour: int) -> int:
    if not 0 <= hour <= config.MAX_HOUR:
        raise HTTPException(400, f"hour must be 0-{config.MAX_HOUR}")
    return hour


def _area(area_id: str) -> Area:
    if not re.fullmatch(r"[0-9a-f]{1,40}", area_id):
        raise HTTPException(404, f"unknown area {area_id}")
    a = load_area(area_id)
    if a is None:
        raise HTTPException(404, f"unknown area {area_id}")
    return a


def _level(level: str) -> str:
    if level not in ("overview", "detail"):
        raise HTTPException(400, "level must be overview or detail")
    return level


@app.get("/api/health")
def health():
    return {"ok": True, "windninja": windninja.available(), "tts": tts.available()}


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=tts.MAX_CHARS)


@app.post("/api/tts", dependencies=[Depends(tts_limit.dependency)])
def post_tts(req: TTSRequest):
    """Speak a team briefing with Grok Voice (MP3). 503 when no xAI key is configured."""
    if not tts.available():
        raise HTTPException(503, "Text-to-speech is not configured on this server (set XAI_API_KEY).")
    try:
        audio = tts.synthesize(req.text)
    except tts.TTSError as e:
        raise HTTPException(502, str(e)) from e
    except Exception as e:  # network errors and the like
        raise HTTPException(502, f"Text-to-speech failed: {e}") from e
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


@app.post("/api/areas", dependencies=[Depends(area_limit.dependency)])
def post_area(req: AreaRequest):
    kw = {}
    if req.overviewSizeM:
        kw["overview_size_m"] = req.overviewSizeM
    if req.detailSizeM:
        kw["detail_size_m"] = req.detailSizeM
    tz = req.timezone
    if not tz or tz == "auto":
        tz = resolve_timezone(req.lat, req.lon)
    a = create_area(req.lat, req.lon, tz, detail_center=req.detailCenter, **kw)
    return a.to_json()


@app.get("/api/areas/{area_id}")
def get_area(area_id: str):
    return _area(area_id).to_json()


@app.get("/api/areas/{area_id}/now")
def get_now(area_id: str):
    """Current local date and hour in the area's time zone (for real-time runs)."""
    a = _area(area_id)
    now = local_now(a.timezone)
    return {"date": now.date().isoformat(), "hour": now.hour, "minute": now.minute, "timezone": a.timezone}


@app.get("/api/areas/{area_id}/terrain")
def get_terrain(area_id: str, level: str = Query("detail")):
    a = _area(area_id)
    dem, info = fetch_dem(a, _level(level))
    return grid_response(dem, a.meta(level), np.float32, {"X-Data-Info": json.dumps(info)})


@app.get("/api/areas/{area_id}/landcover")
def get_landcover(area_id: str, level: str = Query("detail")):
    a = _area(area_id)
    lc, info = fetch_landcover(a, _level(level))
    return grid_response(lc, a.meta(level), np.uint8, {"X-Data-Info": json.dumps(info)})


@app.get("/api/areas/{area_id}/features")
def get_features(area_id: str):
    return fetch_features(_area(area_id))


@app.get("/api/areas/{area_id}/weather")
def get_weather(area_id: str, date: str, days: int = Query(1, ge=1, le=2)):
    """Hourly weather; with days=2 the hours continue past 23 into the next day."""
    return fetch_weather_span(_area(area_id), _date(date), days)


@app.post("/api/areas/{area_id}/wind", dependencies=[Depends(wind_limit.dependency)])
def post_wind(area_id: str, req: WindRequest):
    a = _area(area_id)
    _date(req.date)
    if not req.startHour <= req.endHour <= req.startHour + config.MAX_WIND_SPAN_H:
        raise HTTPException(400, f"endHour must be within {config.MAX_WIND_SPAN_H} h after startHour")
    hours = list(range(req.startHour, req.endHour + 1, max(req.stepHours, 1)))

    def work(job: jobs.Job):
        job.update(0.02, "Computing fallback wind")
        windninja.compute_fallback(a, req.date, hours)
        if not windninja.available():
            job.update(1.0, "WindNinja unavailable; fallback wind ready")
            return {"source": "fallback", "hours": hours}
        try:
            return windninja.run_windninja(a, req.date, hours, job.update)
        except Exception as e:  # noqa: BLE001
            job.update(1.0, f"WindNinja failed ({e}); fallback wind ready")
            return {"source": "fallback", "hours": hours, "error": str(e)}

    try:
        return {"jobId": jobs.submit(work).id}
    except jobs.QueueFull:
        raise HTTPException(503, "The server is busy with other wind runs; try again in a few minutes.",
                            headers={"Retry-After": "120"}) from None


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    j = jobs.get(job_id)
    if j is None:
        raise HTTPException(404, "unknown job")
    return j.to_json()


def _wind_response(a: Area, date: str, hour: int, kind: str):
    uv = windninja.load_wind(a, date, hour, kind)
    if uv is None:
        if kind == "windninja":
            return None
        windninja.compute_fallback(a, date, [hour])
        uv = windninja.load_wind(a, date, hour, "fallback")
    return grid_response(uv, dict(a.detail, layout="packed u then v"), np.float32, {"X-Wind-Source": kind})


@app.get("/api/areas/{area_id}/wind")
def get_wind(area_id: str, date: str, hour: int):
    a, date, hour = _area(area_id), _date(date), _hour(hour)
    r = _wind_response(a, date, hour, "windninja")
    return r if r is not None else _wind_response(a, date, hour, "fallback")


@app.get("/api/areas/{area_id}/wind/fallback")
def get_wind_fallback(area_id: str, date: str, hour: int):
    return _wind_response(_area(area_id), _date(date), _hour(hour), "fallback")
