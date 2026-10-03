"""Area creation, grid metadata, caching."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from pyproj import Transformer

from . import config


def utm_epsg(lat: float, lon: float) -> int:
    zone = int((lon + 180) // 6) + 1
    zone = min(max(zone, 1), 60)
    return (32600 if lat >= 0 else 32700) + zone


def make_meta(epsg: int, cx: float, cy: float, size_m: float, cell: float) -> dict:
    n = int(round(size_m / cell))
    return {
        "crs": f"EPSG:{epsg}",
        "originX": cx - n * cell / 2,
        "originY": cy + n * cell / 2,
        "cellSize": cell,
        "cols": n,
        "rows": n,
        "noData": config.NODATA,
    }


def meta_bounds(meta: dict) -> tuple[float, float, float, float]:
    """(minx, miny, maxx, maxy) in the area CRS."""
    x0, y1 = meta["originX"], meta["originY"]
    return x0, y1 - meta["rows"] * meta["cellSize"], x0 + meta["cols"] * meta["cellSize"], y1


def cell_centers(meta: dict):
    import numpy as np
    cs = meta["cellSize"]
    xs = meta["originX"] + (np.arange(meta["cols"]) + 0.5) * cs
    ys = meta["originY"] - (np.arange(meta["rows"]) + 0.5) * cs
    return xs, ys


@dataclass
class Area:
    area_id: str
    lat: float
    lon: float
    timezone: str
    epsg: int
    overview: dict
    detail: dict
    lkp_xy: tuple[float, float]
    detail_center_xy: tuple[float, float]

    @property
    def dir(self) -> Path:
        d = config.CACHE_DIR / self.area_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def meta(self, level: str) -> dict:
        if level not in ("overview", "detail"):
            raise ValueError("level must be overview or detail")
        return self.overview if level == "overview" else self.detail

    def to_json(self) -> dict:
        return {
            "areaId": self.area_id, "lat": self.lat, "lon": self.lon, "timezone": self.timezone,
            "epsg": self.epsg, "overviewMeta": self.overview, "detailMeta": self.detail,
            "lkp": {"x": self.lkp_xy[0], "y": self.lkp_xy[1], "lat": self.lat, "lon": self.lon},
            "detailCenter": {"x": self.detail_center_xy[0], "y": self.detail_center_xy[1]},
        }


def area_id_for(lat, lon, overview_size, detail_size, detail_center) -> str:
    key = json.dumps([round(lat, 6), round(lon, 6), overview_size, detail_size,
                      None if detail_center is None else [round(v, 6) for v in detail_center]])
    return hashlib.sha1(key.encode()).hexdigest()[:10]


def create_area(lat: float, lon: float, timezone: str = "America/New_York",
                overview_size_m: float = config.OVERVIEW_SIZE_M,
                detail_size_m: float = config.DETAIL_SIZE_M,
                detail_center: tuple[float, float] | None = None) -> Area:
    """detail_center is (lat, lon) or None (= centered on LKP)."""
    aid = area_id_for(lat, lon, overview_size_m, detail_size_m, detail_center)
    existing = load_area(aid)
    if existing:
        return existing
    epsg = utm_epsg(lat, lon)
    to_utm = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
    lx, ly = to_utm.transform(lon, lat)
    oc = config.OVERVIEW_CELL_M
    cx, cy = round(lx / oc) * oc, round(ly / oc) * oc
    overview = make_meta(epsg, cx, cy, overview_size_m, oc)
    if detail_center is not None:
        dx, dy = to_utm.transform(detail_center[1], detail_center[0])
    else:
        dx, dy = lx, ly
    # snap detail center to the overview lattice so cells nest, and clamp inside the overview
    half_o, half_d = overview_size_m / 2, detail_size_m / 2
    dx = min(max(dx, cx - half_o + half_d), cx + half_o - half_d)
    dy = min(max(dy, cy - half_o + half_d), cy + half_o - half_d)
    dx, dy = round(dx / oc) * oc, round(dy / oc) * oc
    detail = make_meta(epsg, dx, dy, detail_size_m, config.DETAIL_CELL_M)
    area = Area(aid, lat, lon, timezone, epsg, overview, detail, (lx, ly), (dx, dy))
    (area.dir / "area.json").write_text(json.dumps(area.to_json(), indent=2))
    return area


def load_area(area_id: str) -> Area | None:
    p = config.CACHE_DIR / area_id / "area.json"
    if not p.exists():
        return None
    j = json.loads(p.read_text())
    return Area(j["areaId"], j["lat"], j["lon"], j["timezone"], j["epsg"], j["overviewMeta"],
                j["detailMeta"], (j["lkp"]["x"], j["lkp"]["y"]),
                (j["detailCenter"]["x"], j["detailCenter"]["y"]))
