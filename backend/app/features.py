"""Trails, roads, streams, rivers, lakes and cliffs from OpenStreetMap (Overpass API),
returned as GeoJSON in the area CRS."""
from __future__ import annotations

import json
import logging

import requests
from pyproj import Transformer

from .areas import Area
from .rasterutil import geo_bounds

log = logging.getLogger(__name__)

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

TRAIL_HIGHWAYS = {"path", "footway", "track", "bridleway", "steps"}


def classify(tags: dict) -> str | None:
    hw = tags.get("highway")
    if hw:
        return "trail" if hw in TRAIL_HIGHWAYS else "road"
    ww = tags.get("waterway")
    if ww == "stream" or ww == "brook" or ww == "ditch":
        return "stream"
    if ww == "river":
        return "river"
    nat = tags.get("natural")
    if nat == "water" or tags.get("water"):
        return "lake"
    if nat == "cliff":
        return "cliff"
    return None


def overpass_query(s: float, w: float, n: float, e: float) -> str:
    bb = f"({s},{w},{n},{e})"
    return f"""[out:json][timeout:60];
(
  way["highway"]{bb};
  way["waterway"~"^(stream|river|brook)$"]{bb};
  way["natural"="water"]{bb};
  way["natural"="cliff"]{bb};
);
out geom;"""


def osm_to_geojson(osm: dict, crs: str) -> dict:
    tr = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    feats = []
    for el in osm.get("elements", []):
        if el.get("type") != "way" or "geometry" not in el:
            continue
        kind = classify(el.get("tags", {}))
        if kind is None:
            continue
        lons = [p["lon"] for p in el["geometry"]]
        lats = [p["lat"] for p in el["geometry"]]
        xs, ys = tr.transform(lons, lats)
        coords = [[round(x, 1), round(y, 1)] for x, y in zip(xs, ys)]
        closed = len(coords) > 3 and coords[0] == coords[-1]
        if kind == "lake" and closed:
            geom = {"type": "Polygon", "coordinates": [coords]}
        else:
            geom = {"type": "LineString", "coordinates": coords}
        name = el.get("tags", {}).get("name")
        feats.append({"type": "Feature", "geometry": geom,
                      "properties": {"kind": kind, "name": name, "osmId": el.get("id")}})
    return {"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": crs}},
            "features": feats}


def fetch_features(area: Area) -> dict:
    out = area.dir / "features.geojson"
    if out.exists():
        return json.loads(out.read_text())
    w, s, e, n = geo_bounds(area.overview, 0)
    q = overpass_query(s, w, n, e)
    gj = None
    for url in OVERPASS_URLS:
        try:
            r = requests.post(url, data={"data": q}, timeout=90,
                              headers={"User-Agent": "scent-cone/0.1 (SAR planning demo)"})
            r.raise_for_status()
            gj = osm_to_geojson(r.json(), area.overview["crs"])
            break
        except Exception as e:  # noqa: BLE001
            log.warning("overpass %s failed: %s", url, e)
    if gj is None:
        gj = {"type": "FeatureCollection", "features": [], "warning": "OpenStreetMap features unavailable"}
        return gj  # do not cache failures
    out.write_text(json.dumps(gj))
    return gj
