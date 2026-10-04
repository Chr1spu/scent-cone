"""Backend constants. All tunable numbers live here."""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
CACHE_DIR = BACKEND_DIR / "cache"
DATA_DIR = BACKEND_DIR / "data"  # optional local GeoTIFFs (M1 fallback)

OVERVIEW_SIZE_M = 12000
OVERVIEW_CELL_M = 30
DETAIL_SIZE_M = 3000
DETAIL_CELL_M = 10
NODATA = -9999.0

# Fallback slope-wind model (mirrored in frontend/src/config/modelParams.ts -> SLOPE_WIND)
SLOPE_WIND = {
    "k": 3.0,                # m/s per unit slope (rise/run)
    "cap": 2.5,              # max slope-wind magnitude, m/s
    "forecastTo2m": 0.7,     # 10 m -> 2 m wind reduction
    "nightSunElev": 5.0,     # deg; below -> fully downslope
    "daySunElev": 10.0,      # deg; above -> upslope on sun-facing slopes
    "sunFacingDot": 0.2,     # dot(normal, sunDir) threshold for sun-facing
    "calmForecast": 3.0,     # m/s; slope wind weighted fully below this forecast speed
    "minSlopeWeight": 0.35,  # slope-wind weight floor in strong forecast wind
    "smoothPasses": 2,       # box-blur passes over the DEM before slopes (radius 2 cells)
    "smoothRadius": 2,
}

# Ridge shadows (mirrors frontend/src/models/terrainInfo.ts shadowMask)
SHADOW = {"stride": 2, "step_m": 30.0, "max_m": 5000.0, "eye_m": 0.6}

# WindNinja
WINDNINJA_MESH_M = 60.0
WINDNINJA_MARGIN_M = 1500.0   # extra terrain around the detail segment for the WN domain
WINDNINJA_TIMEOUT_S = 600
# solver threads; leave cores for the rest of the PC (env overrides, e.g. to match docker cpus)
WINDNINJA_THREADS = int(float(os.environ.get("WINDNINJA_THREADS", 0))) or max(1, (os.cpu_count() or 2) - 1)

# Limits for a server reachable from the internet (main.py, jobs.py)
MAX_RUNNING_JOBS = int(os.environ.get("MAX_RUNNING_JOBS", 1))   # WindNinja jobs at once
MAX_QUEUED_JOBS = int(os.environ.get("MAX_QUEUED_JOBS", 4))     # waiting jobs before "busy"
MAX_FINISHED_JOBS = 200        # finished jobs kept for polling; oldest dropped first
OVERVIEW_SIZE_RANGE_M = (3000, 20000)
DETAIL_SIZE_RANGE_M = (1000, 5000)
MAX_WIND_SPAN_H = 12           # endHour - startHour (the planner asks for 8)
MAX_HOUR = 47                  # hours count from the start date's midnight
# per client IP: (requests, window seconds)
RATE_LIMIT_AREAS = (20, 600)
RATE_LIMIT_WIND = (10, 600)
