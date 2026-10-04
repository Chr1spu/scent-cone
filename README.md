# Scentline

The repository is private. The website is on Vercel and the server runs on a desktop PC behind a Cloudflare tunnel; see [docs/HOSTING.md](docs/HOSTING.md).

**Where and when to deploy air-scent dogs.** Scentline shows a search area as interactive 3D terrain, computes terrain-adjusted wind with the US Forest Service's **WindNinja**, simulates how human scent drifts from where a missing person might be, and recommends dog-team deployment points. When dogs alert, or search a sector and find nothing, it updates where the person probably is.

> Core idea: convert a map of **where the person might be** into a map of **where a dog could detect them**.

This is a hackathon build. Every model is a tunable heuristic that is *plausible and explainable*, not research-grade, and the UI says so.

## The website

| Page | What it is |
| --- | --- |
| `/` | Home: a scroll-driven 3D story on a low-poly diorama (the search from 16:00 to dusk: wind, scent draining downhill, team deployment, alert back-trace), then the engine and missions |
| `/new` | **Plan a search**: pick the last known point on a topographic map (place search, coordinates, your location, or click), the time window (now, or a date and start hour), the subject and the number of teams |
| `/planner` | The planner. `?demo` loads the bundled Catskills scenario; `?lat=&lon=&now=1&profile=&teams=` (or `&date=&start=`) loads a live area; with `now=1`, `&back=N` starts the window N hours ago ("missing since") |
| `/how-it-works` | The method, every parameter, diagrams and limitations |
| `/guide` | Demo walkthrough, controls, keyboard, running the server |
| `/about` | The project: an interactive 3D "meet the team" stage (the rescue dog's real animation clips), the stack, disclaimer, data sources and credits |

When the home server is running (`scripts/start-server.ps1`), the public site uses it automatically for real areas; otherwise it runs the offline demo. You can also run `docker compose up` locally and enter `http://localhost:8000` as the server on **Plan a search** (the address is saved in your browser).

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

On phones the planning panel and legend open as sheets from the buttons under the top bar.

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

Live mode fetches USGS 3DEP terrain, NLCD land cover, OpenStreetMap features and Open-Meteo weather, then runs WindNinja for every hour of an 8-hour window as a background job (about a minute for a new area, instant when cached).

* **Search area (live):** type any latitude/longitude (it becomes the last known point), a date and a start hour, or tick **Today, from the current hour** for a real-time run. For today, WindNinja is initialised from NOAA's live **HRRR 3 km forecast**; past dates use Open-Meteo hourly wind (domain-average initialisation). Time zones are looked up from the coordinates. A window can run past midnight (for example 20:00 to 04:00); each hour uses its own calendar date.
* **Move focus → Compute detail:** drag the 3 km square somewhere else in the 12 km area and recompute it.

### Spoken team briefings (Grok Voice)

After **Deploy**, the Plan tab has **Read briefing**: a radio-style briefing for every team (start point relative to the last known point, heading into the wind, wind speed, best hour, coverage), built only from the deployment results. With an xAI key on the server it is spoken by Grok Voice (`POST /api/tts` on the backend, which calls `https://api.x.ai/v1/tts` and caches each briefing); without one, or offline, the browser's own voice reads it.

To enable Grok Voice, create `.env` next to `docker-compose.yml` (it is git-ignored) and restart the server:

```
XAI_API_KEY=your-xai-key
# optional: XAI_TTS_VOICE=eve   (any built-in Grok voice, e.g. Ara, Rex, Sal, Leo)
```

`/api/health` then reports `"tts": true`. The key never reaches the website; `/api/tts` is rate-limited (30 requests per 10 minutes per client).

### Rebuild the demo bundle

```bash
docker compose run --rm backend python scripts/build_demo.py --out /demo \
  --lat 42.1589 --lon -74.2047 --date 2026-09-24 --start 14 --end 22
```

Without Docker (fallback wind only): `cd backend && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt && .venv/Scripts/python scripts/build_demo.py`.

### Tests

```bash
cd frontend && npm test            # vitest: wind conversion, bilinear, probability, advection, decay, backtrace, deployment,
                                   #   nose-height wind, continuous plumes, ridge shadows, neutral reference
cd backend && pytest -q            # grid metadata, WindNinja .asc parsing, cache hits, fallback wind, shadows, midnight
docker compose run --rm backend pytest -q   # the same inside the image, plus a real WindNinja run
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
* **Wind** (`models/wind.ts`, `backend/app/windninja.py`): WindNinja mass-conserving solver with diurnal winds at 2 m. It uses HRRR initialisation when the forecast exists, and otherwise domain-average initialisation from Open-Meteo for each hour. The direction convention was checked against real WindNinja output. A slope-wind fallback (forecast ×0.7, downslope at night, upslope on slopes that face the sun and are not in a ridge's shadow) is implemented in both Python and TypeScript.
* **Scent** (`models/scent.ts`): scent is released **continuously** from every likely location (births spread over a 40-minute particle lifetime), so the heatmap is a steady plume, not one drifting puff. Particles move with the wind **at dog-nose height (0.6 m)**: the 2 m model wind scaled by a log wind profile over open ground (≈0.71×) or a sub-canopy factor in forest (0.3×). Each step adds a random walk (K = 0.5 + 0.3·U), pools particles in calm hollows, decays them with humidity/temperature/sun, and lofts some off sunlit slopes. Sunlight accounts for slope aspect **and ridge shadows** (ray-marched over the terrain). Six perturbed-wind ensemble members (±20°, ×0.7–1.3) build the 60-minute heatmap; each member runs as its own task on a pool of helper workers, so a heatmap takes about 0.7 s (identical to a sequential run, which a test checks). The 15k on-screen particles run in their own worker.
* **Trailheads**: trail ends that meet a road inside the focus square are marked with stone cairns, as likely entry points.
* **Detectability** is absolute: θ1/θ2 are the 70th/95th percentiles of a reference run with the same wind but neutral scent conditions, so heat, sun and lofting really lower it. The time slider's "Scent" rating shows scent present as a share of that reference.
* **Deployment** (`models/hotspots.ts`): source (100 m) → receiver (50 m) contribution tracking, detectability against the reference thresholds, greedy picks with dog POD 0.7, 300 m spacing, slope ≤ 35°, no water, and at least 20 m from cliffs. Best time window comes from hourly snapshots.
* **Alerts and negative updates** (`models/triangulation.ts`, `models/searchUpdate.ts`): a 60-minute backward particle trace gives each alert's zone, and the posterior is prior · Π(ε + zone). A searched sector (circle or drawn polygon, 30–120 minute window) with no alert lowers each source by POD = 0.7 × the share of its scent that reached the sector, and flags sectors searched in poor scent conditions for a recheck.

All tunable numbers are in `frontend/src/config/modelParams.ts` and `backend/app/config.py`.

## Repository layout

```
frontend/   Vite + React 18 + TypeScript + three / R3F / drei + zustand + Tailwind
  src/models/   pure TS models (no React/three), unit-tested with vitest
  src/workers/  compute worker (probability, ensembles, deployment, back-tracing)
  src/scene/    terrain shader (contours, hillshade, draped overlays), wind, scent, teams, markers
  public/demo/  offline demo bundle (generated)
  public/models/ low-poly .glb models (generated by scripts/make_models.mjs; replace freely, they are
                 rescaled to real-world size on load; primitives are used if a file is missing)
backend/    FastAPI + WindNinja CLI (Docker), terrain/landcover/OSM/weather pipeline, build_demo.py
```

## Deploying

Step-by-step free hosting: [docs/HOSTING.md](docs/HOSTING.md) (website on Vercel, server on this PC: `scripts/start-server.ps1` / `scripts/stop-server.ps1`). `.github/workflows/deploy-backend.yml` can still push the server to a Hugging Face Space if you have PRO.


* **Frontend (static):** the repository is private, and GitHub Pages needs a public repository on the free plan (or GitHub Pro). `.github/workflows/pages.yml` still works if Pages is available: set the repository variable `PAGES_ENABLED=true`. Netlify, Vercel and Cloudflare Pages all deploy from private repositories for free; `netlify.toml` and `frontend/vercel.json` are ready. Set `VITE_API_BASE` to a hosted backend URL to enable live mode.
* **CI:** every push runs the frontend checks, the backend tests, and a Docker build of the server with the tests run inside it (including a real WindNinja run).
* **Backend (Docker):** `backend/fly.toml` (Fly.io) or `render.yaml` (Render). It needs about 2 GB RAM for WindNinja. Alternatively, run `docker compose up` on a laptop and expose it with a Cloudflare Tunnel.

## Known limitations

* Live mode on the public site works only while the home server is running (see Deploying); otherwise it runs the offline demo.
* A modelled window is 8 hours; the WindNinja forecast (HRRR) is only available for roughly the next two days.
* A new heatmap takes about 0.7 s after the slider moves (it runs in background workers, so the UI stays responsive).
* Lost-person distances for children 7–12 and dementia in wilderness are placeholders to tune.

## Data sources and credits

* **WindNinja**, US Forest Service, Missoula Fire Sciences Lab (github.com/firelab/windninja)
* **USGS 3D Elevation Program** (3DEP) bare-earth DEM, via py3dep
* **Copernicus GLO-30 DEM**, ESA/Airbus (outside the US)
* **NLCD 2021**, USGS/MRLC; **ESA WorldCover 2021** (outside the US / fallback)
* **OpenStreetMap** contributors (ODbL), via the Overpass API
* **Open-Meteo** weather API
* Lost-person distance medians after R. Koester, *Lost Person Behavior*
* **3D models**: Synty Studios POLYGON packs (Dog, Police Station, Adventure, Kids), used under the Synty licence. Converted to glTF by `frontend/scripts/synty/` (Blender 5 for meshes and posing, three.js FBXLoader for the dog's ASCII animation clips). The source packs are not in this repository.

### Rebuilding the 3D models

`frontend/public/models/` holds the converted models: `kit.glb` (every prop and posed character for the landing diorama), `dog.glb` + `dog_clips.json` (skinned rescue dog and its clips), and single-mesh `tree_*.glb`, `shrub.glb`, `tent.glb`, `handler.glb`, `child_marker.glb` for the planner. To rebuild them from your own Synty packs:

```bash
cd frontend/scripts/synty
python index.py <pack>.unitypackage                       # GUID -> asset path index
python extract.py <pack>.unitypackage <src>/<adv|kids|dog|police> <asset names...>
blender -b --factory-startup -P build.py -- <src> <out>   # GLBs
node dog_clips.mjs <src>/dog <out>/dog_clips.json         # run from frontend/ (needs three)
npx @gltf-transform/cli meshopt <out>/kit.glb public/models/kit.glb   # compress (repeat per GLB)
```

The GLBs are meshopt-compressed (about a third of their raw size); the loaders register three.js's `MeshoptDecoder`.

**Not for operational use.** Scent physics here are simplified heuristics meant to support discussion, not replace trained K9 handlers' judgement.
