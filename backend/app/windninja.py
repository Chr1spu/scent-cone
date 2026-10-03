"""WindNinja CLI: config writing, subprocess runs, ASCII output parsing, resampling.

Config keys follow WindNinja's shipped examples (data/cli_wxModelInitialization_diurnal.cfg,
data/cli_domainAverage_diurnal.cfg) and src/ninja/cli.cpp option names. Only the
mass-conserving solver is used (momentum_flag is never set).
"""
from __future__ import annotations

import datetime as dt
import functools
import json
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path

import numpy as np

from . import config
from .areas import Area, cell_centers
from .landcover import fetch_landcover, dominant_vegetation
from .slopewind import fallback_wind, local_to_utc, met_to_uv, sun_position, terrain_gradients
from .terrain import fetch_dem, windninja_dem
from .weather import fetch_weather, hour_entry

log = logging.getLogger(__name__)


def find_cli() -> str | None:
    return os.environ.get("WINDNINJA_CLI") or shutil.which("WindNinja_cli")


@functools.lru_cache(maxsize=1)
def cli_help() -> str | None:
    cli = find_cli()
    if not cli:
        return None
    try:
        p = subprocess.run([cli, "--help"], capture_output=True, text=True, timeout=30)
        return (p.stdout or "") + (p.stderr or "")
    except Exception as e:  # noqa: BLE001
        log.warning("WindNinja --help failed: %s", e)
        return None


def available() -> bool:
    h = cli_help()
    return bool(h and "initialization_method" in h)


def choose_wx_model() -> str | None:
    """Pick a CONUS NOAA model from the CLI's advertised list (HRRR preferred)."""
    h = cli_help() or ""
    names = set(re.findall(r"[A-Z0-9]+(?:-[A-Z0-9]+)+", h))
    prefs = ["NOMADS-HRRR-CONUS-3-KM", "NOMADS-NAM-CONUS-12-KM", "UCAR-NAM-CONUS-12-KM", "NOMADS-RAP-CONUS-13-KM"]
    for p in prefs:
        if p in names:
            return p
    for n in sorted(names):
        if "HRRR-CONUS" in n and "PASTCAST" not in n and "SUBHOURLY" not in n:
            return n
    return None


def write_cfg(path: Path, opts: dict) -> None:
    lines = []
    for k, v in opts.items():
        if isinstance(v, bool):
            v = "true" if v else "false"
        lines.append(f"{k:<32}= {v}")
    path.write_text("\n".join(lines) + "\n")


def parse_asc(path: Path) -> tuple[np.ndarray, dict]:
    """ESRI ASCII grid -> (array with NaN nodata, header dict). Row 0 is north."""
    hdr: dict = {}
    with open(path) as f:
        for _ in range(6):
            pos = f.tell()
            line = f.readline()
            parts = line.split()
            if len(parts) == 2 and re.fullmatch(r"[A-Za-z_]+", parts[0]):
                hdr[parts[0].lower()] = float(parts[1])
            else:
                f.seek(pos)
                break
        data = np.loadtxt(f, dtype=np.float64)
    data = data.reshape(int(hdr["nrows"]), int(hdr["ncols"]))
    nod = hdr.get("nodata_value")
    if nod is not None:
        data[data == nod] = np.nan
    if "xllcenter" in hdr:
        hdr["xllcorner"] = hdr["xllcenter"] - hdr["cellsize"] / 2
        hdr["yllcorner"] = hdr["yllcenter"] - hdr["cellsize"] / 2
    return data.astype(np.float32), hdr


def resample_to_grid(src: np.ndarray, hdr: dict, meta: dict) -> np.ndarray:
    """Bilinear sample of an ASCII grid (same CRS) at the target grid's cell centres."""
    xs, ys = cell_centers(meta)
    cs = hdr["cellsize"]
    top = hdr["yllcorner"] + hdr["nrows"] * cs
    fc = (xs - hdr["xllcorner"]) / cs - 0.5
    fr = (top - ys) / cs - 0.5
    nr, nc = src.shape
    fc = np.clip(fc, 0, nc - 1.000001)
    fr = np.clip(fr, 0, nr - 1.000001)
    c0, r0 = np.floor(fc).astype(int), np.floor(fr).astype(int)
    tc, tr = fc - c0, fr - r0
    a = np.where(np.isnan(src), np.nanmean(src), src)
    R0, C0 = np.meshgrid(r0, c0, indexing="ij")
    TR, TC = np.meshgrid(tr, tc, indexing="ij")
    v00, v01 = a[R0, C0], a[R0, C0 + 1]
    v10, v11 = a[R0 + 1, C0], a[R0 + 1, C0 + 1]
    return ((v00 * (1 - TC) + v01 * TC) * (1 - TR) + (v10 * (1 - TC) + v11 * TC) * TR).astype(np.float32)


def speed_dir_to_uv_grid(speed: np.ndarray, direction: np.ndarray):
    u, v = met_to_uv(speed, direction)
    return u.astype(np.float32), v.astype(np.float32)


DATE_RE = re.compile(r"_(\d{2})-(\d{2})-(\d{4})_(\d{2})(\d{2})_")


def collect_outputs(out_dir: Path) -> dict[tuple[str, int], tuple[Path, Path]]:
    """Map (date, hour) -> (vel.asc, ang.asc). Files without a date map to ('', -1)."""
    res = {}
    for vel in out_dir.glob("*_vel.asc"):
        ang = vel.with_name(vel.name[: -len("_vel.asc")] + "_ang.asc")
        if not ang.exists():
            continue
        m = DATE_RE.search(vel.name)
        key = (f"{m.group(3)}-{m.group(1)}-{m.group(2)}", int(m.group(4))) if m else ("", -1)
        res[key] = (vel, ang)
    return res


def wind_path(area: Area, date: str, hour: int, kind: str) -> Path:
    return area.dir / f"wind_{kind}_{date}_{hour:02d}.npy"


def load_wind(area: Area, date: str, hour: int, kind: str) -> np.ndarray | None:
    p = wind_path(area, date, hour, kind)
    return np.load(p) if p.exists() else None


def compute_fallback(area: Area, date: str, hours: list[int], weather: dict | None = None,
                     overrides: dict | None = None) -> None:
    dem, _ = fetch_dem(area, "detail")
    weather = weather or fetch_weather(area, date)
    grads = terrain_gradients(dem, area.detail["cellSize"])
    for hr in hours:
        p = wind_path(area, date, hr, "fallback")
        if p.exists() and not overrides:
            continue
        w = hour_entry(weather, hr)
        spd, dr = w["windSpeed"], w["windDirection"]
        if overrides and hr in overrides:
            spd, dr = overrides[hr]
        el, az = sun_position(area.lat, area.lon, local_to_utc(date, hr, weather["utcOffsetSeconds"]))
        u, v = fallback_wind(dem, area.detail["cellSize"], spd, dr, el, az, grads)
        np.save(p, np.stack([u, v]))


def _run(cfg: Path, cwd: Path) -> None:
    p = subprocess.run([find_cli(), str(cfg)], cwd=str(cwd), capture_output=True, text=True,
                       timeout=config.WINDNINJA_TIMEOUT_S)
    (cwd / "windninja.log").write_text((p.stdout or "") + "\n---stderr---\n" + (p.stderr or ""))
    if p.returncode != 0:
        raise RuntimeError(f"WindNinja exited {p.returncode}: {(p.stderr or p.stdout)[-400:]}")


def _base_opts(area: Area, dem_path: Path, out_dir: Path, veg: str) -> dict:
    return {
        "num_threads": max(1, (os.cpu_count() or 2) - 1),
        "elevation_file": str(dem_path),
        "time_zone": area.timezone,
        "output_wind_height": 2.0,
        "units_output_wind_height": "m",
        "output_speed_units": "mps",
        "vegetation": veg,
        "diurnal_winds": True,
        "mesh_resolution": config.WINDNINJA_MESH_M,
        "units_mesh_resolution": "m",
        "write_ascii_output": True,
        "write_goog_output": False,
        "write_shapefile_output": False,
        "write_farsite_atm": False,
        "output_path": str(out_dir),
    }


def _store_outputs(area: Area, date: str, outputs: dict, wanted: list[int], default_hour: int | None = None) -> list[int]:
    stored = []
    for (d, hr), (vel, ang) in outputs.items():
        if hr == -1 and default_hour is not None:
            d, hr = date, default_hour
        if d != date or hr not in wanted:
            continue
        spd, hs = parse_asc(vel)
        ang_a, _ = parse_asc(ang)
        u, v = speed_dir_to_uv_grid(spd, ang_a)
        uu, vv = resample_to_grid(u, hs, area.detail), resample_to_grid(v, hs, area.detail)
        np.save(wind_path(area, date, hr, "windninja"), np.stack([uu, vv]))
        stored.append(hr)
    return stored


def run_windninja(area: Area, date: str, hours: list[int], progress=lambda f, m: None) -> dict:
    """Run WindNinja for the given local hours. Returns {"source": ..., "hours": [...]}."""
    if not available():
        raise RuntimeError("WindNinja CLI not available")
    dem_path, _ = windninja_dem(area)
    lc, _ = fetch_landcover(area, "detail")
    veg = dominant_vegetation(lc)
    weather = fetch_weather(area, date)
    todo = [h for h in hours if not wind_path(area, date, h, "windninja").exists()]
    done: list[int] = [h for h in hours if h not in todo]
    method = "cached"
    # 1) weather-model initialisation (only possible for current/future dates)
    model = choose_wx_model()
    start_utc = local_to_utc(date, min(hours), weather["utcOffsetSeconds"])
    hours_ahead = (start_utc - dt.datetime.utcnow()).total_seconds() / 3600
    if todo and model and -1 < hours_ahead < 40:
        try:
            progress(0.05, f"WindNinja: downloading {model}")
            out_dir = area.dir / f"wn_wx_{date}"
            out_dir.mkdir(exist_ok=True)
            d0 = dt.date.fromisoformat(date)
            opts = _base_opts(area, dem_path, out_dir, veg)
            opts.update({
                "initialization_method": "wxModelInitialization",
                "wx_model_type": model,
                "forecast_duration": int(max(hours_ahead, 0) + max(hours) - min(hours) + 3),
                "start_year": d0.year, "start_month": d0.month, "start_day": d0.day,
                "start_hour": min(todo), "start_minute": 0,
                "stop_year": d0.year, "stop_month": d0.month, "stop_day": d0.day,
                "stop_hour": max(todo), "stop_minute": 0,
            })
            cfg = out_dir / "run.cfg"
            write_cfg(cfg, opts)
            _run(cfg, out_dir)
            got = _store_outputs(area, date, collect_outputs(out_dir), todo)
            done += got
            todo = [h for h in todo if h not in got]
            method = f"wxModel:{model}"
        except Exception as e:  # noqa: BLE001
            log.warning("wx model init failed, falling back to domain average: %s", e)
    # 2) domain-average initialisation per hour from Open-Meteo
    for i, hr in enumerate(todo):
        progress(0.1 + 0.9 * i / max(len(todo), 1), f"WindNinja domain-average {hr:02d}:00")
        w = hour_entry(weather, hr)
        out_dir = area.dir / f"wn_da_{date}_{hr:02d}"
        out_dir.mkdir(exist_ok=True)
        d0 = dt.date.fromisoformat(date)
        opts = _base_opts(area, dem_path, out_dir, veg)
        opts.update({
            "initialization_method": "domainAverageInitialization",
            "input_speed": round(float(w["windSpeed"]), 2), "input_speed_units": "mps",
            "input_direction": round(float(w["windDirection"]), 1),
            "input_wind_height": 10.0, "units_input_wind_height": "m",
            "uni_air_temp": round(float(w["temperature"]), 1), "air_temp_units": "C",
            "uni_cloud_cover": round(float(w["cloudCover"]), 0), "cloud_cover_units": "percent",
            "year": d0.year, "month": d0.month, "day": d0.day, "hour": hr, "minute": 0,
        })
        cfg = out_dir / "run.cfg"
        write_cfg(cfg, opts)
        _run(cfg, out_dir)
        done += _store_outputs(area, date, collect_outputs(out_dir), [hr], default_hour=hr)
        if method == "cached":
            method = "domainAverage"
        elif "domainAverage" not in method:
            method += "+domainAverage"
    progress(1.0, "WindNinja done")
    # remember how the winds were produced, so later cached requests report it
    method_file = area.dir / f"wind_method_{date}.json"
    if method == "cached" and method_file.exists():
        method = json.loads(method_file.read_text()).get("method", method)
    elif method != "cached":
        method_file.write_text(json.dumps({"method": method}))
    return {"source": "windninja", "method": method, "hours": sorted(set(done))}
