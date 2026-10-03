"""Build the offline demo bundle (frontend/public/demo/).

Example:
  python scripts/build_demo.py --lat 42.1589 --lon -74.2047 --date 2026-09-24 --start 14 --end 22

Writes area.json, terrain_{overview,detail}.bin (Float32), landcover_{overview,detail}.bin (Uint8),
features.geojson, weather.json, wind_HH.bin (WindNinja, packed u then v; only if WindNinja ran)
and wind_fallback_HH.bin for every hour.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import windninja  # noqa: E402
from app.areas import create_area  # noqa: E402
from app.encode import write_bin  # noqa: E402
from app.features import fetch_features  # noqa: E402
from app.landcover import fetch_landcover  # noqa: E402
from app.terrain import fetch_dem  # noqa: E402
from app.weather import fetch_weather  # noqa: E402

DEFAULT_OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo"


def clip_features(gj: dict, meta: dict, margin: float = 200.0) -> dict:
    """Keep features that touch the overview bounds (drops far-away roads)."""
    x0, y1 = meta["originX"], meta["originY"]
    x1, y0 = x0 + meta["cols"] * meta["cellSize"], y1 - meta["rows"] * meta["cellSize"]
    feats = []
    for f in gj["features"]:
        g = f["geometry"]
        pts = g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"]
        if any(x0 - margin <= p[0] <= x1 + margin and y0 - margin <= p[1] <= y1 + margin for p in pts):
            feats.append(f)
    return dict(gj, features=feats)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, default=42.1589)
    ap.add_argument("--lon", type=float, default=-74.2047)
    ap.add_argument("--timezone", default="America/New_York")
    ap.add_argument("--date", default="2026-09-24")
    ap.add_argument("--start", type=int, default=14)
    ap.add_argument("--end", type=int, default=22)
    ap.add_argument("--truth-dx", type=float, default=530.0, help="hidden subject, metres east of LKP")
    ap.add_argument("--truth-dy", type=float, default=-190.0, help="hidden subject, metres north of LKP")
    ap.add_argument("--name", default="Devil's Tombstone Campground, Catskills NY")
    ap.add_argument("--no-windninja", action="store_true")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)

    area = create_area(args.lat, args.lon, args.timezone)
    print(f"area {area.area_id}  detail origin {area.detail['originX']},{area.detail['originY']}")
    sources, warnings = {}, []
    for level in ("overview", "detail"):
        dem, info = fetch_dem(area, level)
        write_bin(out / f"terrain_{level}.bin", dem, np.float32)
        sources[f"terrain_{level}"] = info["source"]
        warnings += info["warnings"]
        lc, linfo = fetch_landcover(area, level)
        write_bin(out / f"landcover_{level}.bin", lc, np.uint8)
        sources[f"landcover_{level}"] = linfo["source"]
        warnings += linfo["warnings"]
        print(f"  {level}: dem {info['source']}, landcover {linfo['source']}")

    gj = clip_features(fetch_features(area), area.overview)
    (out / "features.geojson").write_text(json.dumps(gj, separators=(",", ":")))
    print(f"  features: {len(gj['features'])}")

    weather = fetch_weather(area, args.date)
    (out / "weather.json").write_text(json.dumps(weather, indent=1))
    sources["weather"] = weather.get("source", "?")

    hours = list(range(args.start, args.end + 1))
    windninja.compute_fallback(area, args.date, hours, weather)
    for h in hours:
        uv = windninja.load_wind(area, args.date, h, "fallback")
        write_bin(out / f"wind_fallback_{h:02d}.bin", uv, np.float32)

    wind_source, wind_method, wn_hours = "fallback", "slope-wind heuristic", []
    if not args.no_windninja and windninja.available():
        try:
            res = windninja.run_windninja(area, args.date, hours,
                                          lambda f, m: print(f"  [{f:4.0%}] {m}"))
            wn_hours = res["hours"]
            wind_method = res.get("method", "")
            for h in wn_hours:
                write_bin(out / f"wind_{h:02d}.bin", windninja.load_wind(area, args.date, h, "windninja"), np.float32)
            if set(wn_hours) >= set(hours):
                wind_source = "windninja"
        except Exception as e:  # noqa: BLE001
            warnings.append(f"WindNinja failed: {e}")
            print("  WindNinja failed:", e)
    else:
        print("  WindNinja not available -> fallback wind only")
    # stale WindNinja files from earlier builds would be misleading
    if wind_source != "windninja":
        for p in out.glob("wind_[0-9][0-9].bin"):
            p.unlink()

    lx, ly = area.lkp_xy
    dc = area.detail_center_xy
    area_json = {
        "name": args.name,
        "scenario": ("At 4:00 PM a 9-year-old wandered away from a campsite. Sunset is ~7:00 PM. "
                     "Three dog teams are available. Where do we send them?"),
        "areaId": area.area_id,
        "lat": area.lat, "lon": area.lon, "epsg": area.epsg,
        "timezone": area.timezone, "utcOffsetSeconds": weather["utcOffsetSeconds"],
        "date": args.date, "startHour": args.start, "endHour": args.end, "missingAt": 16.0,
        "overviewMeta": area.overview, "detailMeta": area.detail,
        "lkp": {"x": lx, "y": ly, "lat": area.lat, "lon": area.lon, "label": "Campsite (LKP)"},
        "truth": {"x": lx + args.truth_dx, "y": ly + args.truth_dy},
        "focus": {"x": dc[0], "y": dc[1], "size": area.detail["cols"] * area.detail["cellSize"]},
        "profile": "child712", "teams": 3,
        "windSource": wind_source, "windMethod": wind_method, "windHours": hours,
        "windNinjaHours": wn_hours,
        "sources": sources, "warnings": warnings,
    }
    (out / "area.json").write_text(json.dumps(area_json, indent=2))
    print(f"wrote bundle to {out} (wind: {wind_source})")


if __name__ == "__main__":
    main()
