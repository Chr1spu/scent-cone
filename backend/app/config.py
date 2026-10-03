"""Backend constants. All tunable numbers live here."""
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
