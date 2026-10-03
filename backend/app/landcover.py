"""Land cover reclassified to Scent Cone classes (Uint8):
0 unknown, 1 water, 2 open, 3 shrub, 4 forest, 5 developed, 6 wetland.
US: NLCD (MRLC WCS). Elsewhere / on failure: ESA WorldCover. Last resort: all open (warning).
"""
from __future__ import annotations

import json
import logging
import tempfile
from pathlib import Path

import numpy as np
import requests
from rasterio.warp import Resampling, transform_bounds

from .areas import Area, meta_bounds
from .rasterutil import read_tiles_into, degree_tiles

log = logging.getLogger(__name__)

NLCD_MAP = {11: 1, 12: 2, 21: 5, 22: 5, 23: 5, 24: 5, 31: 2, 41: 4, 42: 4, 43: 4, 51: 3, 52: 3,
            71: 2, 72: 2, 73: 2, 74: 2, 81: 2, 82: 2, 90: 6, 95: 6}
WORLDCOVER_MAP = {10: 4, 20: 3, 30: 2, 40: 2, 50: 5, 60: 2, 70: 2, 80: 1, 90: 6, 95: 6, 100: 2}

NLCD_WCS = ("https://www.mrlc.gov/geoserver/mrlc_download/NLCD_2021_Land_Cover_L48/wcs"
            "?service=WCS&version=2.0.1&request=GetCoverage&coverageid=NLCD_2021_Land_Cover_L48"
            "&subset=X({x0},{x1})&subset=Y({y0},{y1})&format=image/geotiff")


def reclass(src: np.ndarray, table: dict[int, int]) -> np.ndarray:
    lut = np.zeros(256, dtype=np.uint8)
    for k, v in table.items():
        lut[k] = v
    return lut[np.clip(src, 0, 255).astype(np.uint8)]


def _nlcd(meta: dict):
    minx, miny, maxx, maxy = meta_bounds(meta)
    x0, y0, x1, y1 = transform_bounds(meta["crs"], "EPSG:5070", minx - 200, miny - 200, maxx + 200, maxy + 200)
    r = requests.get(NLCD_WCS.format(x0=x0, x1=x1, y0=y0, y1=y1), timeout=90)
    r.raise_for_status()
    if "tiff" not in r.headers.get("content-type", ""):
        raise RuntimeError("NLCD WCS returned non-tiff")
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "nlcd.tif"
        p.write_bytes(r.content)
        out = read_tiles_into(meta, [str(p)], np.uint8, Resampling.nearest, 0, margin_m=0)
    if out is None or (out == 0).mean() > 0.5:
        return None
    return reclass(out, NLCD_MAP), "NLCD 2021"


def _worldcover(meta: dict):
    urls = []
    for la, lo in degree_tiles(meta, 3):
        ns = f"N{la:02d}" if la >= 0 else f"S{-la:02d}"
        ew = f"E{lo:03d}" if lo >= 0 else f"W{-lo:03d}"
        urls.append("/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
                    f"ESA_WorldCover_10m_2021_v200_{ns}{ew}_Map.tif")
    out = read_tiles_into(meta, urls, np.uint8, Resampling.mode, 0)
    if out is None:
        return None
    return reclass(out, WORLDCOVER_MAP), "ESA WorldCover 2021"


def fetch_landcover(area: Area, level: str, us: bool = True) -> tuple[np.ndarray, dict]:
    meta = area.meta(level)
    npy = area.dir / f"lc_{level}.npy"
    info_p = area.dir / f"lc_{level}.json"
    if npy.exists() and info_p.exists():
        return np.load(npy), json.loads(info_p.read_text())
    result, warnings = None, []
    sources = (_nlcd, _worldcover) if us else (_worldcover,)
    for fn in sources:
        try:
            result = fn(meta)
        except Exception as e:  # noqa: BLE001
            log.warning("landcover %s failed: %s", fn.__name__, e)
        if result is not None:
            break
    if result is None:
        lc, source = np.full((meta["rows"], meta["cols"]), 2, np.uint8), "none"
        warnings.append("Land cover unavailable; assuming open ground everywhere.")
    else:
        lc, source = result
        lc[lc == 0] = 2
    info = {"source": source, "warnings": warnings,
            "fractions": {str(c): float((lc == c).mean()) for c in range(7)}}
    np.save(npy, lc)
    info_p.write_text(json.dumps(info))
    return lc, info


def dominant_vegetation(lc: np.ndarray) -> str:
    """WindNinja `vegetation` value (grass, brush, trees) from the dominant class."""
    counts = {"trees": int((lc == 4).sum()), "brush": int((lc == 3).sum()),
              "grass": int(np.isin(lc, [1, 2, 5, 6]).sum())}
    return max(counts, key=counts.get)
