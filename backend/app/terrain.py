"""DEM fetch / clip / resample onto the overview (30 m) and detail (10 m) grids.

Source order: local GeoTIFF in backend/data/ -> USGS 3DEP bare earth (US) ->
Copernicus GLO-30 (global, surface model incl. canopy) -> synthetic (with warning).
"""
from __future__ import annotations

import json
import logging
import math
from pathlib import Path

import numpy as np
from rasterio.warp import Resampling

from . import config
from .areas import Area, meta_bounds
from .rasterutil import read_tiles_into, degree_tiles, write_geotiff, reproject_into

log = logging.getLogger(__name__)


def _fill_nan(a: np.ndarray) -> np.ndarray:
    if not np.isnan(a).any():
        return a
    if np.isnan(a).all():
        return np.zeros_like(a)
    a = a.copy()
    for _ in range(50):  # neighbour-mean fill for small gaps
        m = np.isnan(a)
        if not m.any():
            break
        p = np.pad(a, 1, mode="edge")
        stack = np.stack([p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]])
        with np.errstate(all="ignore"):
            nb = np.nanmean(stack, axis=0)
        a[m] = nb[m]
    a[np.isnan(a)] = np.nanmean(a)
    return a


def _from_local(meta: dict):
    for tif in sorted(config.DATA_DIR.glob("*.tif")):
        out = read_tiles_into(meta, [str(tif)], np.float32, Resampling.bilinear, np.nan, margin_m=100)
        if out is not None and np.isfinite(out).mean() > 0.95:
            return out, f"local:{tif.name}"
    return None


def _from_3dep(meta: dict):
    import py3dep
    minx, miny, maxx, maxy = meta_bounds(meta)
    m = 3 * meta["cellSize"]
    res = 10 if meta["cellSize"] <= 10 else 30
    dem = py3dep.get_dem((minx - m, miny - m, maxx + m, maxy + m), resolution=res, crs=meta["crs"])
    src = dem.values.astype(np.float32)
    nod = dem.rio.nodata
    if nod is not None and not np.isnan(nod):
        src[src == nod] = np.nan
    dst = np.full((meta["rows"], meta["cols"]), np.nan, dtype=np.float32)
    reproject_into(dst, meta, src, dem.rio.transform(), dem.rio.crs, src_nodata=np.nan)
    if np.isfinite(dst).mean() < 0.95 or np.nanmax(dst) < -100:
        return None
    return dst, "USGS 3DEP (bare earth)"


def _from_copernicus(meta: dict):
    urls = []
    for la, lo in degree_tiles(meta, 1):
        ns = f"N{la:02d}" if la >= 0 else f"S{-la:02d}"
        ew = f"E{lo:03d}" if lo >= 0 else f"W{-lo:03d}"
        name = f"Copernicus_DSM_COG_10_{ns}_00_{ew}_00_DEM"
        urls.append(f"/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif")
    out = read_tiles_into(meta, urls, np.float32, Resampling.bilinear, np.nan)
    if out is None or np.isfinite(out).mean() < 0.9:
        return None
    return out, "Copernicus GLO-30 (surface model, includes canopy)"


def synthetic_dem(meta: dict) -> np.ndarray:
    """Ridge-and-valley terrain so the app never shows a blank screen."""
    xs = meta["originX"] + (np.arange(meta["cols"]) + 0.5) * meta["cellSize"]
    ys = meta["originY"] - (np.arange(meta["rows"]) + 0.5) * meta["cellSize"]
    X, Y = np.meshgrid(xs, ys)
    X, Y = X - X.mean(), Y - Y.mean()
    z = 600 + 0.03 * X + 220 * np.sin(X / 900.0) * np.cos(Y / 1300.0) + 120 * np.sin((X + Y) / 650.0)
    return z.astype(np.float32)


def fetch_dem(area: Area, level: str) -> tuple[np.ndarray, dict]:
    """Returns (elevation grid float32, info). Cached in the area dir."""
    meta = area.meta(level)
    npy = area.dir / f"dem_{level}.npy"
    info_p = area.dir / f"dem_{level}.json"
    if npy.exists() and info_p.exists():
        return np.load(npy), json.loads(info_p.read_text())
    warnings: list[str] = []
    result = None
    for fn in (_from_local, _from_3dep, _from_copernicus):
        try:
            result = fn(meta)
        except Exception as e:  # noqa: BLE001
            log.warning("DEM source %s failed: %s", fn.__name__, e)
            result = None
        if result is not None:
            break
    if result is None:
        dem, source = synthetic_dem(meta), "synthetic"
        warnings.append("No DEM source reachable; using synthetic terrain.")
    else:
        dem, source = result
        if source.startswith("Copernicus") and level == "detail":
            warnings.append("Detail terrain resampled from 30 m Copernicus surface model.")
    dem = _fill_nan(dem).astype(np.float32)
    info = {"source": source, "warnings": warnings, "min": float(dem.min()), "max": float(dem.max())}
    np.save(npy, dem)
    info_p.write_text(json.dumps(info))
    if level == "detail":
        write_geotiff(area.dir / "dem_detail.tif", dem, meta, nodata=config.NODATA)
    return dem, info


def windninja_dem(area: Area) -> tuple[Path, dict]:
    """Detail segment + margin cut from the overview DEM (30 m), as GeoTIFF for WindNinja."""
    om, dm = area.overview, area.detail
    cs = om["cellSize"]
    mc = int(math.ceil(config.WINDNINJA_MARGIN_M / cs))
    c0 = int(round((dm["originX"] - om["originX"]) / cs)) - mc
    r0 = int(round((om["originY"] - dm["originY"]) / cs)) - mc
    n = int(round(dm["cols"] * dm["cellSize"] / cs)) + 2 * mc
    c0, r0 = max(c0, 0), max(r0, 0)
    c1, r1 = min(c0 + n, om["cols"]), min(r0 + n, om["rows"])
    meta = dict(om, originX=om["originX"] + c0 * cs, originY=om["originY"] - r0 * cs,
                cols=c1 - c0, rows=r1 - r0)
    out = area.dir / "wn_dem.tif"
    if not out.exists():
        ov, _ = fetch_dem(area, "overview")
        sub = np.ascontiguousarray(ov[r0:r1, c0:c1]).astype(np.float32)
        write_geotiff(out, sub, meta, nodata=config.NODATA)
    return out, meta
