from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import config
from app.areas import create_area, meta_bounds, utm_epsg
from app.slopewind import fallback_wind, met_to_uv
from app.windninja import collect_outputs, parse_asc, resample_to_grid, speed_dir_to_uv_grid

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture()
def tmp_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    return tmp_path


def test_utm_epsg():
    assert utm_epsg(42.16, -74.2) == 32618
    assert utm_epsg(-33.9, 18.4) == 32734


def test_grid_metadata_consistency(tmp_cache):
    a = create_area(42.1589, -74.2047, "America/New_York")
    for meta, size, cell in ((a.overview, 12000, 30), (a.detail, 3000, 10)):
        assert meta["cols"] * meta["cellSize"] == size
        assert meta["rows"] * meta["cellSize"] == size
        assert meta["cellSize"] == cell
        assert meta["crs"] == "EPSG:32618"
    # detail nests inside overview and is aligned to the overview lattice
    ox0, oy0, ox1, oy1 = meta_bounds(a.overview)
    dx0, dy0, dx1, dy1 = meta_bounds(a.detail)
    assert ox0 <= dx0 < dx1 <= ox1 and oy0 <= dy0 < dy1 <= oy1
    assert (dx0 - ox0) % 30 == 0 and (oy1 - dy1) % 30 == 0


def test_area_cache_hit(tmp_cache):
    a = create_area(42.1589, -74.2047, "America/New_York")
    files = sorted(p.name for p in (tmp_cache / a.area_id).iterdir())
    b = create_area(42.1589, -74.2047, "America/New_York")
    assert a.area_id == b.area_id and a.detail == b.detail
    assert sorted(p.name for p in (tmp_cache / a.area_id).iterdir()) == files


def test_met_to_uv():
    # wind FROM the west (270) blows toward the east: u > 0
    u, v = met_to_uv(np.array([10.0]), np.array([270.0]))
    assert u[0] == pytest.approx(10.0) and v[0] == pytest.approx(0.0, abs=1e-9)
    # wind FROM the north (0) blows south: v < 0
    u, v = met_to_uv(np.array([4.0]), np.array([0.0]))
    assert u[0] == pytest.approx(0.0, abs=1e-9) and v[0] == pytest.approx(-4.0)


def test_parse_asc_fixture():
    vel, hdr = parse_asc(FIX / "sample_vel.asc")
    assert vel.shape == (3, 4)
    assert hdr["cellsize"] == 100 and hdr["xllcorner"] == 1000
    assert np.isnan(vel[1, 2]) and vel[0, 0] == 5
    ang, _ = parse_asc(FIX / "sample_ang.asc")
    u, v = speed_dir_to_uv_grid(vel, ang)
    assert u[0, 0] == pytest.approx(5.0)       # from west -> east
    assert v[1, 0] == pytest.approx(-4.0)      # from north -> south
    assert u[2, 0] == pytest.approx(-3.0)      # from east -> west


def test_resample_asc_to_grid():
    vel, hdr = parse_asc(FIX / "sample_vel.asc")
    # target grid: one cell exactly at the centre of the top-left asc cell
    meta = {"originX": 1045.0, "originY": 2300.0 - 45.0, "cellSize": 10, "cols": 1, "rows": 1}
    out = resample_to_grid(vel, hdr, meta)
    assert out[0, 0] == pytest.approx(5.0)


def test_collect_outputs(tmp_path):
    for name in ("dem_10-02-2026_1600_60m_vel.asc", "dem_10-02-2026_1600_60m_ang.asc"):
        (tmp_path / name).write_text("")
    out = collect_outputs(tmp_path)
    assert ("2026-10-02", 16) in out


def test_fallback_wind_night_downslope():
    # plane rising to the east: at night wind should blow west (downhill), u < 0
    x = np.arange(50) * 10.0
    elev = np.tile(x * 0.2, (50, 1)).astype(np.float32)
    u, v = fallback_wind(elev, 10.0, 0.0, 0.0, sun_elev=-5.0, sun_az=270.0)
    assert u[25, 25] < -0.5 and abs(v[25, 25]) < 1e-3


def test_health():
    c = TestClient(__import__("app.main", fromlist=["app"]).app)
    r = c.get("/api/health")
    assert r.status_code == 200 and r.json()["ok"] is True
