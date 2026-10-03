"""Hourly weather from Open-Meteo (no key). Forecast API for recent/future dates,
archive API for older dates, synthetic early-autumn day if both fail."""
from __future__ import annotations

import datetime as dt
import json
import logging
import math

import requests

from .areas import Area

log = logging.getLogger(__name__)

HOURLY = "temperature_2m,relative_humidity_2m,cloud_cover,wind_speed_10m,wind_direction_10m"


def _query(url: str, lat: float, lon: float, date: str, tz: str) -> dict:
    r = requests.get(url, params={
        "latitude": lat, "longitude": lon, "hourly": HOURLY, "start_date": date, "end_date": date,
        "timezone": tz, "wind_speed_unit": "ms"}, timeout=30)
    r.raise_for_status()
    return r.json()


def parse_open_meteo(j: dict) -> dict:
    h = j["hourly"]
    hours = []
    for i, t in enumerate(h["time"]):
        hours.append({
            "hour": int(t[11:13]),
            "temperature": h["temperature_2m"][i],
            "humidity": h["relative_humidity_2m"][i],
            "cloudCover": h["cloud_cover"][i],
            "windSpeed": h["wind_speed_10m"][i],
            "windDirection": h["wind_direction_10m"][i],
        })
    return {"utcOffsetSeconds": j.get("utc_offset_seconds", 0), "hours": hours}


def synthetic_weather(utc_offset: int = -4 * 3600) -> dict:
    hours = []
    for hr in range(24):
        diurnal = math.cos((hr - 15) / 24 * 2 * math.pi)
        hours.append({"hour": hr, "temperature": 12 + 7 * diurnal, "humidity": 65 - 20 * diurnal,
                      "cloudCover": 25.0, "windSpeed": 2.5 + 1.5 * max(diurnal, 0),
                      "windDirection": 250.0})
    return {"utcOffsetSeconds": utc_offset, "hours": hours}


def fetch_weather(area: Area, date: str) -> dict:
    out = area.dir / f"weather_{date}.json"
    if out.exists():
        return json.loads(out.read_text())
    d = dt.date.fromisoformat(date)
    age = (dt.date.today() - d).days
    urls = ["https://api.open-meteo.com/v1/forecast"]
    if age > 60:
        urls.insert(0, "https://archive-api.open-meteo.com/v1/archive")
    res = None
    for url in urls:
        try:
            res = parse_open_meteo(_query(url, area.lat, area.lon, date, area.timezone))
            if any(hh["windSpeed"] is None for hh in res["hours"]):
                raise ValueError("incomplete hourly data")
            res["source"] = "Open-Meteo"
            break
        except Exception as e:  # noqa: BLE001
            log.warning("open-meteo %s failed: %s", url, e)
            res = None
    if res is None:
        res = synthetic_weather()
        res["source"] = "synthetic"
        res["date"], res["timezone"] = date, area.timezone
        return res  # do not cache failures
    res["date"], res["timezone"] = date, area.timezone
    out.write_text(json.dumps(res, indent=1))
    return res


def resolve_timezone(lat: float, lon: float) -> str:
    """IANA time zone for a point (Open-Meteo `timezone=auto`); 'UTC' if unreachable."""
    try:
        r = requests.get("https://api.open-meteo.com/v1/forecast",
                         params={"latitude": lat, "longitude": lon, "timezone": "auto",
                                 "current": "temperature_2m"}, timeout=15)
        r.raise_for_status()
        return r.json().get("timezone") or "UTC"
    except Exception as e:  # noqa: BLE001
        log.warning("timezone lookup failed: %s", e)
        return "UTC"


def local_now(tz: str) -> dt.datetime:
    from zoneinfo import ZoneInfo
    try:
        return dt.datetime.now(ZoneInfo(tz))
    except Exception:  # noqa: BLE001 - unknown zone / missing tzdata
        return dt.datetime.now(dt.timezone.utc)


def hour_entry(weather: dict, hour: int) -> dict:
    for h in weather["hours"]:
        if h["hour"] == hour:
            return h
    return weather["hours"][min(hour, len(weather["hours"]) - 1)]
