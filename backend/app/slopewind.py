"""Fallback wind: uniform forecast wind (scaled to 2 m) + heuristic slope wind.

Mirrored in frontend/src/models/wind.ts (computeFallbackWind). Keep the two in sync.
"""
from __future__ import annotations

import datetime as dt
import math

import numpy as np

from .config import SHADOW, SLOPE_WIND


def sun_position(lat: float, lon: float, when_utc: dt.datetime) -> tuple[float, float]:
    """(elevation_deg, azimuth_deg clockwise from north). NOAA approximation."""
    doy = when_utc.timetuple().tm_yday
    hr = when_utc.hour + when_utc.minute / 60 + when_utc.second / 3600
    g = 2 * math.pi / 365 * (doy - 1 + (hr - 12) / 24)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                    - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
            + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    tst = hr * 60 + eqt + 4 * lon
    ha = math.radians(tst / 4 - 180)
    la = math.radians(lat)
    cosz = math.sin(la) * math.sin(decl) + math.cos(la) * math.cos(decl) * math.cos(ha)
    zen = math.acos(max(-1.0, min(1.0, cosz)))
    elev = 90 - math.degrees(zen)
    az = math.degrees(math.atan2(math.sin(ha), math.cos(ha) * math.sin(la) - math.tan(decl) * math.cos(la))) + 180
    return elev, az % 360


def local_to_utc(date: str, hour: float, utc_offset_s: int) -> dt.datetime:
    d = dt.datetime.fromisoformat(date) + dt.timedelta(hours=hour)
    return d - dt.timedelta(seconds=utc_offset_s)


def box_blur(z: np.ndarray, radius: int) -> np.ndarray:
    k = 2 * radius + 1
    p = np.pad(z, radius, mode="edge").astype(np.float64)
    c = p.cumsum(0)
    c = np.vstack([np.zeros((1, c.shape[1])), c])
    rows = (c[k:] - c[:-k])
    c2 = rows.cumsum(1)
    c2 = np.hstack([np.zeros((c2.shape[0], 1)), c2])
    return ((c2[:, k:] - c2[:, :-k]) / (k * k)).astype(np.float32)


def terrain_gradients(elev: np.ndarray, cell: float):
    """(dz/dx east, dz/dy north) of the smoothed DEM. Row 0 is north."""
    z = elev.astype(np.float32)
    for _ in range(SLOPE_WIND["smoothPasses"]):
        z = box_blur(z, SLOPE_WIND["smoothRadius"])
    d_row, d_col = np.gradient(z, cell)
    return d_col.astype(np.float32), (-d_row).astype(np.float32)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def met_to_uv(speed, direction_deg):
    """Meteorological 'from' direction (deg clockwise from north) -> (u east, v north)."""
    r = np.radians(direction_deg)
    return -speed * np.sin(r), -speed * np.cos(r)


def shadow_mask(elev: np.ndarray, meta: dict, sun_elev: float, sun_az: float,
                horizon: tuple[np.ndarray, dict] | None = None) -> np.ndarray:
    """True where a ridge blocks the sun: march from each cell toward the sun over the
    detail DEM, then the coarser surrounding DEM. Computed every `stride` cells."""
    rows, cols = elev.shape
    if sun_elev <= 0:
        return np.ones((rows, cols), dtype=bool)
    st = SHADOW["stride"]
    cs = meta["cellSize"]
    r_idx = np.arange(0, rows, st)
    c_idx = np.arange(0, cols, st)
    R, C = np.meshgrid(r_idx, c_idx, indexing="ij")
    X = meta["originX"] + (C + 0.5) * cs
    Y = meta["originY"] - (R + 0.5) * cs
    z0 = elev[R, C] + SHADOW["eye_m"]
    a, e = math.radians(sun_az), math.radians(sun_elev)
    dx, dy, rise = math.sin(a), math.cos(a), math.tan(e)
    zmax = float(elev.max())
    if horizon is not None:
        zmax = max(zmax, float(horizon[0].max()))
    shaded = np.zeros(R.shape, dtype=bool)
    d = SHADOW["step_m"]
    while d <= SHADOW["max_m"]:
        ray = z0 + d * rise
        active = ~shaded & (ray <= zmax)
        if not active.any():
            break
        px, py = X + dx * d, Y + dy * d
        cc = np.round((px - meta["originX"]) / cs - 0.5).astype(int)
        rr = np.round((meta["originY"] - py) / cs - 0.5).astype(int)
        inside = (cc >= 0) & (rr >= 0) & (cc < cols) & (rr < rows)
        z = np.full(R.shape, -np.inf)
        z[inside] = elev[rr[inside], cc[inside]]
        if horizon is not None:
            he, hm = horizon
            hcs = hm["cellSize"]
            hc = np.round((px - hm["originX"]) / hcs - 0.5).astype(int)
            hr = np.round((hm["originY"] - py) / hcs - 0.5).astype(int)
            hin = ~inside & (hc >= 0) & (hr >= 0) & (hc < hm["cols"]) & (hr < hm["rows"])
            z[hin] = he[hr[hin], hc[hin]]
        shaded |= active & (z > ray)
        d += SHADOW["step_m"]
    full = np.repeat(np.repeat(shaded, st, axis=0), st, axis=1)
    return full[:rows, :cols]


def fallback_wind(elev: np.ndarray, cell: float, forecast_speed: float, forecast_dir: float,
                  sun_elev: float, sun_az: float, grads=None, shaded: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """`shaded`: optional ridge-shadow mask; shaded slopes get no daytime upslope flow."""
    p = SLOPE_WIND
    gx, gy = grads if grads is not None else terrain_gradients(elev, cell)
    slope = np.sqrt(gx * gx + gy * gy)
    inv = 1.0 / np.maximum(slope, 1e-6)
    upx, upy = gx * inv, gy * inv  # uphill unit vector
    # surface normal (unnormalised (-gx, -gy, 1)) . sun direction
    se, sa = math.radians(sun_elev), math.radians(sun_az)
    sx, sy, sz = math.cos(se) * math.sin(sa), math.cos(se) * math.cos(sa), math.sin(se)
    ndot = (-gx * sx - gy * sy + sz) / np.sqrt(gx * gx + gy * gy + 1)
    day = float(smoothstep(p["nightSunElev"], p["daySunElev"], sun_elev))
    sunfacing = smoothstep(p["sunFacingDot"] - 0.1, p["sunFacingDot"] + 0.1, ndot)
    if shaded is not None:
        sunfacing = np.where(shaded, 0.0, sunfacing)
    # night: downslope everywhere; day: upslope on sun-facing slopes, weak/neutral elsewhere
    dirx = (1 - day) * (-upx) + day * sunfacing * upx
    diry = (1 - day) * (-upy) + day * sunfacing * upy
    mag = np.minimum(p["k"] * slope, p["cap"])
    weight = 1.0 if forecast_speed < p["calmForecast"] else max(p["minSlopeWeight"], p["calmForecast"] / forecast_speed)
    fu, fv = met_to_uv(forecast_speed * p["forecastTo2m"], forecast_dir)
    u = fu + weight * mag * dirx
    v = fv + weight * mag * diry
    return u.astype(np.float32), v.astype(np.float32)
