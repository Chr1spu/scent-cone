"""End-to-end WindNinja check. Runs inside the Docker image (CI); skipped where the CLI is absent."""
import os
from pathlib import Path

import numpy as np
import pytest

from app import windninja
from app.windninja import collect_outputs, parse_asc, speed_dir_to_uv_grid, write_cfg

SAMPLE_DEM = Path(os.environ.get("WINDNINJA_DATA", "/opt/windninja/data")) / "big_butte_small.tif"

pytestmark = pytest.mark.skipif(not windninja.available() or not SAMPLE_DEM.exists(), reason="WindNinja CLI or sample DEM not available")


def test_domain_average_run_and_direction_convention(tmp_path):
    out = tmp_path / "run"
    out.mkdir()
    cfg = out / "run.cfg"
    write_cfg(cfg, {
        "num_threads": 2,
        "elevation_file": str(SAMPLE_DEM),
        "initialization_method": "domainAverageInitialization",
        "time_zone": "America/Boise",
        "input_speed": 5.0, "input_speed_units": "mps",
        "input_direction": 270.0,  # wind FROM the west
        "input_wind_height": 10.0, "units_input_wind_height": "m",
        "output_wind_height": 2.0, "units_output_wind_height": "m",
        "output_speed_units": "mps",
        "vegetation": "grass",
        "diurnal_winds": True,
        "uni_air_temp": 20.0, "air_temp_units": "C",
        "uni_cloud_cover": 10.0, "cloud_cover_units": "percent",
        "year": 2026, "month": 7, "day": 15, "hour": 14, "minute": 0,
        "mesh_resolution": 120.0, "units_mesh_resolution": "m",
        "write_ascii_output": True,
        "write_goog_output": False,
        "write_shapefile_output": False,
        "write_farsite_atm": False,
        "output_path": str(out),
    })
    windninja._run(cfg, out)
    outputs = collect_outputs(out)
    assert outputs, "WindNinja wrote no *_vel.asc / *_ang.asc pair"
    vel_path, ang_path = next(iter(outputs.values()))
    vel, _ = parse_asc(vel_path)
    ang, _ = parse_asc(ang_path)
    assert np.isfinite(vel).mean() > 0.9
    assert 1.0 < float(np.nanmean(vel)) < 10.0
    # "from" convention: input from 270 -> output mostly from the west, blowing east (u > 0)
    med = float(np.nanmedian(ang))
    assert 225 < med < 315
    u, _ = speed_dir_to_uv_grid(vel, ang)
    assert float(np.nanmean(u)) > 0.5
