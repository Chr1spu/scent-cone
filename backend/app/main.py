"""Scent Cone backend: terrain, land cover, features, weather and wind for a search area."""
from __future__ import annotations

import logging
import os

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import jobs, windninja
from .areas import Area, create_area, load_area
from .encode import grid_response
from .features import fetch_features
from .landcover import fetch_landcover
from .terrain import fetch_dem
from .weather import fetch_weather, local_now, resolve_timezone

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Scent Cone API", version="0.1.0")
origins = os.environ.get("CORS_ORIGINS", "*").split(",")
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"],
                   expose_headers=["X-Grid-Meta", "X-Wind-Source", "X-Data-Info"],
                   # lets the public HTTPS site call a server on localhost (Private Network Access)
                   allow_private_network=True)


class AreaRequest(BaseModel):
    lat: float
    lon: float
    overviewSizeM: float | None = None
    detailSizeM: float | None = None
    detailCenter: tuple[float, float] | None = None  # (lat, lon)
    # IANA zone, or "auto" to look it up from the coordinates
    timezone: str = "auto"


class WindRequest(BaseModel):
    date: str
    startHour: int = 14
    endHour: int = 22
    stepHours: int = 1


def _area(area_id: str) -> Area:
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
    return {"ok": True, "windninja": windninja.available()}


@app.post("/api/areas")
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
    import json
    return grid_response(dem, a.meta(level), np.float32, {"X-Data-Info": json.dumps(info)})


@app.get("/api/areas/{area_id}/landcover")
def get_landcover(area_id: str, level: str = Query("detail")):
    a = _area(area_id)
    lc, info = fetch_landcover(a, _level(level))
    import json
    return grid_response(lc, a.meta(level), np.uint8, {"X-Data-Info": json.dumps(info)})


@app.get("/api/areas/{area_id}/features")
def get_features(area_id: str):
    return fetch_features(_area(area_id))


@app.get("/api/areas/{area_id}/weather")
def get_weather(area_id: str, date: str):
    return fetch_weather(_area(area_id), date)


@app.post("/api/areas/{area_id}/wind")
def post_wind(area_id: str, req: WindRequest):
    a = _area(area_id)
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

    return {"jobId": jobs.submit(work).id}


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
    a = _area(area_id)
    r = _wind_response(a, date, hour, "windninja")
    return r if r is not None else _wind_response(a, date, hour, "fallback")


@app.get("/api/areas/{area_id}/wind/fallback")
def get_wind_fallback(area_id: str, date: str, hour: int):
    return _wind_response(_area(area_id), date, hour, "fallback")
