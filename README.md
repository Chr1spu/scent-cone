# Scent Cone

**Where and when to deploy air-scent dogs.** Scent Cone shows a search area as interactive 3D terrain, computes terrain-adjusted wind with the US Forest Service's **WindNinja**, simulates how human scent drifts from where a missing person might be, and recommends dog-team deployment points. When dogs alert, or search a sector and find nothing, it updates where the person probably is.

> Core idea: convert a map of **where the person might be** into a map of **where a dog could detect them**.

This is a hackathon build. Every model is a tunable heuristic that is *plausible and explainable*, not research-grade, and the UI says so.

## Demo scenario

*At 4:00 PM a 9-year-old wandered away from a campsite (Devil's Tombstone Campground, Stony Clove Notch, Catskills NY). Sunset is about 7:00 PM. Three dog teams are available. Where do we send them?*

| Key | Step |
| --- | --- |
| `1` | Fly to the campsite (last known point) |
| `2` | Probability map ("Child 7–12" profile), north-up overview |
| `3` | WindNinja wind streaks over the notch |
| `4` | Release scent: particles drift at dog-nose height |
| `5` | Scent heatmap and hotspots. Drag the slider 16:00 → 19:00 and watch scent drain into the valley |
| `6` | Deploy teams: dog and handler at each point, upwind approach arrow, best time window, coverage |
| `7` | Alerts: pick **Add alert**, click the two pink radio markers, and the back-traced zones overlap where the child is revealed |

Also: `Space` play/pause, `M` map/scene view, `D` debug overlay (FPS, particles, wind source, hour, worker status), `Esc` cancels a tool.

## Run it

### Offline demo (no backend, no network)

```bash
cd frontend
npm install
npm run dev            # http://localhost:5180  (add ?offline=1 to force offline mode)
```

The app loads the prebuilt bundle in `frontend/public/demo/` (terrain, land cover, OSM features, weather and hourly WindNinja and fallback winds). If `/api/health` does not answer within 3 s, it falls back to offline mode automatically.

### Live mode (backend + WindNinja in Docker)

```bash
docker compose up --build          # backend on :8000 (BACKEND_PORT=8010 to change the host port)
cd frontend && npm run dev         # Vite proxies /api to VITE_BACKEND_URL (default http://localhost:8000)
```

Live mode fetches USGS 3DEP terrain, NLCD land cover, OpenStreetMap features and Open-Meteo weather, then runs WindNinja for every hour from 14:00 to 22:00 as a background job. **Move focus**, then **Compute detail**, recomputes a new 3 km segment (about 75 s cold, instant when cached).

### Rebuild the demo bundle

```bash
docker compose run --rm backend python scripts/build_demo.py --out /demo \
  --lat 42.1589 --lon -74.2047 --date 2026-09-24 --start 14 --end 22
```

Without Docker (fallback wind only): `cd backend && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt && .venv/Scripts/python scripts/build_demo.py`.

### Tests

```bash
cd frontend && npm test            # vitest: wind conversion, bilinear, probability, advection, decay, backtrace, deployment
cd backend && pytest -q            # grid metadata, WindNinja .asc parsing, cache hits, fallback wind
```

## How it works

```
 probability (overview, 30 m) ──resample──▶ detail prior (10 m) × alert/search likelihood
        │                                              │
   LKP, profile, trails,                    scent sources ∝ probability
   barriers, slope                                     │
                                  WindNinja u,v (hourly) ──▶ particle ensembles (Web Worker)
                                                              │            │
                                                     heatmap/hotspots   contribution matrix
                                                                            │
                                         greedy deployment ◀── detectability × source probability
                                         alert back-trace  ──▶ posterior;  searched sector ──▶ POD
```

* **Probability** (`frontend/src/models/probability.ts`): log-normal distance from the LKP by profile (Lost Person Behavior medians), × linear-feature attraction, × 0.2 behind water and cliffs (least-cost detour ratio), × slope penalty, water = 0, plus a ±brush.
* **Wind** (`models/wind.ts`, `backend/app/windninja.py`): WindNinja mass-conserving solver with diurnal winds at 2 m. It uses HRRR initialisation when the forecast exists, and otherwise domain-average initialisation from Open-Meteo for each hour. The direction convention was checked against real WindNinja output. A slope-wind fallback (forecast ×0.7, downslope at night, upslope on sunny slopes) is implemented in both Python and TypeScript.
* **Scent** (`models/scent.ts`): 15k visible particles. Each step advects them with wind, adds a random walk (K = 0.5 + 0.3·U), halves advection in forest, pools them in calm hollows, decays them with humidity/temperature/sun, and lofts some off sunlit slopes. Six perturbed-wind ensemble members (±20°, ×0.7–1.3) run in a Web Worker to build the 60-minute heatmap.
* **Deployment** (`models/hotspots.ts`): source (100 m) → receiver (50 m) contribution tracking, detectability from heat percentiles, greedy picks with dog POD 0.7, 300 m spacing, slope ≤ 35°, no water, and at least 20 m from cliffs. Best time window comes from hourly snapshots.
* **Alerts and negative updates** (`models/triangulation.ts`, `models/searchUpdate.ts`): a 60-minute backward particle trace gives each alert's zone, and the posterior is prior · Π(ε + zone). A searched sector with no alert lowers each source by POD = 0.7 × the share of its scent that reached the sector, and flags sectors searched in poor scent conditions for a recheck.

All tunable numbers are in `frontend/src/config/modelParams.ts` and `backend/app/config.py`.

## Repository layout

```
frontend/   Vite + React 18 + TypeScript + three / R3F / drei + zustand + Tailwind
  src/models/   pure TS models (no React/three), unit-tested with vitest
  src/workers/  compute worker (probability, ensembles, deployment, back-tracing)
  src/scene/    terrain shader (contours, hillshade, draped overlays), wind, scent, teams, markers
  public/demo/  offline demo bundle (generated)
  public/models/ optional .glb models (dog, handler, trees, tent, …); primitives are used if missing
backend/    FastAPI + WindNinja CLI (Docker), terrain/landcover/OSM/weather pipeline, build_demo.py
```

## Deploying

* **Frontend (static):** `.github/workflows/pages.yml` publishes to GitHub Pages. Enable it in Settings → Pages → Source "GitHub Actions"; Pages on a private repo needs a paid plan. `netlify.toml`, `frontend/vercel.json` and `render.yaml` are ready for Netlify, Vercel or Render. Set `VITE_API_BASE` to a hosted backend URL to enable live mode.
* **Backend (Docker):** `backend/fly.toml` (Fly.io) or `render.yaml` (Render). It needs about 2 GB RAM for WindNinja. Alternatively, run `docker compose up` on a laptop and expose it with a Cloudflare Tunnel.

## Data sources and credits

* **WindNinja**, US Forest Service, Missoula Fire Sciences Lab (github.com/firelab/windninja)
* **USGS 3D Elevation Program** (3DEP) bare-earth DEM, via py3dep
* **Copernicus GLO-30 DEM**, ESA/Airbus (outside the US)
* **NLCD 2021**, USGS/MRLC; **ESA WorldCover 2021** (outside the US / fallback)
* **OpenStreetMap** contributors (ODbL), via the Overpass API
* **Open-Meteo** weather API
* Lost-person distance medians after R. Koester, *Lost Person Behavior*

**Not for operational use.** Scent physics here are simplified heuristics meant to support discussion, not replace trained K9 handlers' judgement.
