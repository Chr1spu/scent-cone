"""Protections for a server reachable from the internet: job queue, rate limits, size caps."""
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app import config, jobs
from app.areas import create_area
from app.ratelimit import RateLimit


@pytest.fixture()
def tmp_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    return tmp_path


@pytest.fixture()
def main():
    import app.main as main
    main.area_limit.reset()
    main.wind_limit.reset()
    yield main
    main.area_limit.reset()
    main.wind_limit.reset()


def _wait(pred, timeout=5.0):
    end = time.monotonic() + timeout
    while not pred():
        if time.monotonic() > end:
            raise AssertionError("timed out")
        time.sleep(0.01)


def test_jobs_run_one_at_a_time_in_order(monkeypatch):
    monkeypatch.setattr(config, "MAX_RUNNING_JOBS", 1)
    monkeypatch.setattr(config, "MAX_QUEUED_JOBS", 5)
    gates = [threading.Event() for _ in range(3)]
    order: list[int] = []
    live, peak = [0], [0]
    lock = threading.Lock()

    def work(i):
        def fn(job):
            with lock:
                live[0] += 1
                peak[0] = max(peak[0], live[0])
                order.append(i)
            gates[i].wait(5)
            with lock:
                live[0] -= 1
        return fn

    js = [jobs.submit(work(i)) for i in range(3)]
    _wait(lambda: js[0].status == "running")
    assert js[1].status == js[2].status == "queued"
    assert "Server busy" in js[2].message and "2 earlier" in js[2].message
    for g in gates:
        g.set()
    _wait(lambda: all(j.status == "done" for j in js))
    assert order == [0, 1, 2] and peak[0] == 1


def test_jobs_queue_full_raises(monkeypatch):
    monkeypatch.setattr(config, "MAX_RUNNING_JOBS", 1)
    monkeypatch.setattr(config, "MAX_QUEUED_JOBS", 1)
    gate = threading.Event()
    first = jobs.submit(lambda job: gate.wait(5))
    _wait(lambda: first.status == "running")
    second = jobs.submit(lambda job: None)
    with pytest.raises(jobs.QueueFull):
        jobs.submit(lambda job: None)
    gate.set()
    _wait(lambda: second.status == "done")


def test_finished_jobs_are_pruned(monkeypatch):
    monkeypatch.setattr(config, "MAX_FINISHED_JOBS", 3)
    done = [jobs.submit(lambda job: None) for _ in range(5)]
    _wait(lambda: all(j.status == "done" for j in done))
    jobs.submit(lambda job: None)
    assert sum(j.id in jobs.JOBS for j in done) == 3
    assert [j.id in jobs.JOBS for j in done] == [False, False, True, True, True]


def test_wind_endpoint_busy_returns_503(tmp_cache, main, monkeypatch):
    monkeypatch.setattr(config, "MAX_RUNNING_JOBS", 1)
    monkeypatch.setattr(config, "MAX_QUEUED_JOBS", 1)
    gate = threading.Event()
    monkeypatch.setattr(main.windninja, "compute_fallback", lambda *a, **k: gate.wait(5))
    monkeypatch.setattr(main.windninja, "available", lambda: False)
    c = TestClient(main.app)
    a = create_area(42.1589, -74.2047, "America/New_York")
    body = {"date": "2026-09-24", "startHour": 14, "endHour": 22}
    j1 = c.post(f"/api/areas/{a.area_id}/wind", json=body).json()["jobId"]
    _wait(lambda: c.get(f"/api/jobs/{j1}").json()["status"] == "running")
    j2 = c.post(f"/api/areas/{a.area_id}/wind", json=body).json()["jobId"]
    s2 = c.get(f"/api/jobs/{j2}").json()
    assert s2["status"] == "queued" and "Server busy" in s2["message"]
    r = c.post(f"/api/areas/{a.area_id}/wind", json=body)
    assert r.status_code == 503 and "busy" in r.json()["detail"] and r.headers["retry-after"]
    gate.set()
    _wait(lambda: c.get(f"/api/jobs/{j2}").json()["status"] == "done")


def test_rate_limit_window():
    now = [0.0]
    rl = RateLimit(2, 60, clock=lambda: now[0])
    assert rl.hit("a") is None and rl.hit("a") is None
    assert rl.hit("a") == pytest.approx(60)
    assert rl.hit("b") is None          # other clients are unaffected
    now[0] = 61
    assert rl.hit("a") is None          # window has passed
    assert set(rl._hits) == {"a"}       # idle clients are forgotten


def test_area_rate_limit_per_client_ip(tmp_cache, main, monkeypatch):
    monkeypatch.setattr(main.area_limit, "limit", 2)
    c = TestClient(main.app)
    body = {"lat": 42.1589, "lon": -74.2047, "timezone": "America/New_York"}
    ip1, ip2 = {"CF-Connecting-IP": "203.0.113.1"}, {"CF-Connecting-IP": "203.0.113.2"}
    assert c.post("/api/areas", json=body, headers=ip1).status_code == 200
    assert c.post("/api/areas", json=body, headers=ip1).status_code == 200
    r = c.post("/api/areas", json=body, headers=ip1)
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 0
    assert "try again" in r.json()["detail"]
    assert c.post("/api/areas", json=body, headers=ip2).status_code == 200


def test_wind_rate_limit(main, monkeypatch):
    monkeypatch.setattr(main.wind_limit, "limit", 3)
    c = TestClient(main.app)
    body = {"date": "2026-09-24", "startHour": 14, "endHour": 22}
    codes = [c.post("/api/areas/abc123/wind", json=body).status_code for _ in range(4)]
    assert codes == [404, 404, 404, 429]


@pytest.mark.parametrize("extra", [
    {"overviewSizeM": 1_000_000},
    {"overviewSizeM": 100},
    {"detailSizeM": 50_000},
    {"overviewSizeM": 4000, "detailSizeM": 5000},
    {"lat": 123.0},
])
def test_area_size_caps(tmp_cache, main, extra):
    c = TestClient(main.app)
    body = {"lat": 42.1589, "lon": -74.2047, "timezone": "America/New_York", **extra}
    assert c.post("/api/areas", json=body).status_code == 422


def test_area_sizes_within_caps_accepted(tmp_cache, main):
    c = TestClient(main.app)
    body = {"lat": 42.1589, "lon": -74.2047, "timezone": "America/New_York",
            "overviewSizeM": 6000, "detailSizeM": 2000}
    r = c.post("/api/areas", json=body)
    assert r.status_code == 200 and r.json()["detailMeta"]["cols"] == 200


@pytest.mark.parametrize("body,code", [
    ({"date": "2026-09-24", "startHour": 14, "endHour": 40}, 400),   # 26 h span
    ({"date": "2026-09-24", "startHour": 14, "endHour": 10}, 400),   # ends before it starts
    ({"date": "2026-09-24", "startHour": 30, "endHour": 32}, 422),
    ({"date": "2026-09-24", "startHour": 14, "endHour": 22, "stepHours": 0}, 422),
    ({"date": "../../etc", "startHour": 14, "endHour": 22}, 400),
])
def test_wind_hour_range_caps(tmp_cache, main, body, code):
    c = TestClient(main.app)
    a = create_area(42.1589, -74.2047, "America/New_York")
    assert c.post(f"/api/areas/{a.area_id}/wind", json=body).status_code == code
    assert not jobs.JOBS or all(j.status != "queued" for j in jobs.JOBS.values())


def test_wind_get_validates_date_and_hour(tmp_cache, main):
    c = TestClient(main.app)
    a = create_area(42.1589, -74.2047, "America/New_York")
    assert c.get(f"/api/areas/{a.area_id}/wind/fallback?date=2026-09-24&hour=500").status_code == 400
    assert c.get(f"/api/areas/{a.area_id}/wind/fallback?date=2026-9-24&hour=14").status_code == 400
    assert c.get("/api/areas/..%2F..%2Fetc/wind/fallback?date=2026-09-24&hour=14").status_code == 404
