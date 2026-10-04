# CLAUDE.md — Scentline build spec

This file is the single source of truth for building Scentline (originally named Scent Cone). Read it fully before writing code. Build in the milestone order at the bottom, one milestone at a time, and stop at each acceptance check.

---

## 1. What we are building

Scentline is a web app that helps search-and-rescue (SAR) teams decide **where and when to deploy air-scent dogs** to find a missing person.

It shows the search area as interactive 3D terrain, computes terrain-adjusted wind with the US Forest Service's **WindNinja** model, simulates how human scent drifts from the person's likely locations, and recommends dog deployment points. When dogs alert (or find nothing), it updates where the person probably is.

Core idea: convert a map of **where the person might be** into a map of **where a dog could detect them**.

This is a 2-day hackathon project. It must look polished, run smoothly in a browser, and survive demo-day failures (no Wi-Fi, slow server). Accuracy is "plausible and explainable", not research-grade. Every model is a tunable heuristic, labeled as such in the UI.

### Non-goals (do not build)
- User accounts, auth, databases, multi-user features.
- Support for moving/evading targets (fugitives).
- Real fluid dynamics (CFD). Particles + WindNinja wind are enough.
- Mobile-first layout (desktop demo first; must not break on mobile).

---

## 2. Demo scenario (drives every design decision)

"At 4:00 PM a 9-year-old wandered away from a campsite. Sunset is ~7:00 PM. Three dog teams are available. Where do we send them?"

Demo flow the app must support end to end:
1. Load the demo area; camera flies to the campsite (last known point, LKP).
2. Choose profile "child"; probability map appears.
3. Show WindNinja wind field over the terrain.
4. Release scent; particles drift.
5. Drag time slider 16:00 → 19:00; scent visibly drains into valleys; heatmap and hotspots shift.
6. Click "Deploy 3 teams"; dog + handler models appear at recommended points with approach arrows and time windows.
7. Click two alert points; back-traced zones overlap; the hidden child marker is revealed in the overlap.

A pre-chosen "truth" location for the child is stored in the demo config (hidden until reveal) so the demo ends correctly.

---

## 3. Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | Vite + React 18 + TypeScript |
| 3D | three, @react-three/fiber, @react-three/drei |
| State | zustand |
| UI controls | Tailwind CSS panels (custom), optional leva for dev-only tuning |
| Sun position | suncalc |
| Backend | Python 3.11+, FastAPI, uvicorn |
| Rasters | rasterio, numpy, pyproj, (GDAL available in Docker image) |
| Terrain/land data | py3dep (USGS 3DEP), pygeohydro (NLCD) or manual downloads, osmnx or Overpass API |
| Weather | Open-Meteo forecast API (no key) |
| Wind model | WindNinja CLI, run inside Docker |
| Frontend hosting | Vercel or Netlify (static build) |
| Backend hosting | Fly.io / Railway / Render (Docker), or local laptop + Cloudflare Tunnel |

Assets: user-supplied `.glb` models go in `frontend/public/models/`. Expected filenames (use placeholders — simple primitives — if a file is missing, never crash):
`dog.glb, handler.glb, tree_conifer.glb, tree_broadleaf.glb, shrub.glb, tent.glb, lkp_marker.glb, child_marker.glb, landmark.glb`

---

## 4. Repository layout

```
scentline/
  CLAUDE.md
  README.md
  frontend/
    index.html
    package.json
    vite.config.ts
    src/
      main.tsx
      App.tsx
      config/            # demo config, constants, model parameters
      state/             # zustand stores
      api/               # backend client + offline loader
      geo/               # grid types, coordinate transforms, interpolation
      models/            # PURE TS, no React/three imports
        probability.ts
        wind.ts
        scent.ts
        hotspots.ts
        triangulation.ts
        searchUpdate.ts
      scene/             # React Three Fiber components
        Terrain.tsx
        ContourMaterial.ts
        WindLayer.tsx
        ScentParticles.tsx
        Heatmap.tsx
        ProbabilityLayer.tsx
        Vegetation.tsx
        Markers.tsx
        DogTeams.tsx
        AlertZones.tsx
        CameraRig.tsx
      ui/                # panels, slider, legend, toasts
    public/
      models/            # .glb files
      demo/              # offline demo bundle (generated)
  backend/
    Dockerfile           # FastAPI + WindNinja CLI in one image
    requirements.txt
    app/
      main.py            # FastAPI app + routes
      areas.py           # area creation, grids, caching
      terrain.py         # DEM fetch/clip/resample
      landcover.py
      features.py        # trails, streams, roads, water from OSM
      weather.py         # Open-Meteo
      windninja.py       # config writing, CLI run, output parsing
      jobs.py            # background job tracking
      encode.py          # numpy -> binary responses
    scripts/
      build_demo.py      # generates frontend/public/demo bundle
    cache/               # per-area cached outputs (gitignored)
    tests/
```

Rule: everything in `frontend/src/models/` is pure TypeScript operating on typed arrays. It must be unit-testable with vitest and must not import React or three.

---

## 5. Geography and grid conventions (follow exactly)

- **Projected CRS:** the UTM zone containing the area center (compute EPSG from longitude). All grids are in meters in this CRS.
- **Two grids per area:**
  - *Overview grid*: full search area, default 12 km × 12 km, **30 m** cells (400 × 400).
  - *Detail grid*: one focus segment, default 3 km × 3 km, **10 m** cells (300 × 300). The user can move the focus segment; the demo has a preset.
- **Grid metadata** (shared JSON shape for every raster):
  ```json
  { "crs": "EPSG:32618", "originX": 0, "originY": 0, "cellSize": 10,
    "cols": 300, "rows": 300, "noData": -9999 }
  ```
  `originX/originY` = coordinates of the **north-west corner**. Row 0 is the northernmost row. Index = `row * cols + col`.
- **Scene coordinates (three.js):** origin at the detail grid's center. `x = east (m)`, `y = up (m)`, `z = south (m)` (so north is `-z`). Vertical exaggeration constant `VERT_EXAG = 1.5` (configurable), applied only in rendering, never in models.
- **Wind vectors:** stored as `u` (east, m/s) and `v` (north, m/s) Float32 grids. WindNinja outputs speed + direction in the **meteorological convention** (direction the wind blows **from**, degrees clockwise from north). Convert:
  `u = -speed * sin(dirRad)`, `v = -speed * cos(dirRad)`. Write a unit test for this conversion. Verify against a WindNinja output file before trusting it.
- **Binary transport:** rasters are sent as little-endian Float32 arrays (`application/octet-stream`) with metadata in a JSON header endpoint or `X-Grid-Meta` header. Never send large grids as JSON number arrays.
- **Time:** all times are local time of the area with an explicit IANA time zone in the area config. Wind is stored per hour (`HH:00`).

---

## 6. Backend

### 6.1 Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | `{ok, windninja: bool}` (checks CLI is callable) |
| POST | `/api/areas` | body `{lat, lon, overviewSizeM?, detailSizeM?, detailCenter?, timezone}` → `{areaId, overviewMeta, detailMeta}` |
| GET | `/api/areas/{id}/terrain?level=overview\|detail` | Float32 elevation grid |
| GET | `/api/areas/{id}/landcover?level=overview\|detail` | Uint8 class grid (see 6.3) |
| GET | `/api/areas/{id}/features` | GeoJSON (in area CRS) with `kind`: trail, road, stream, river, lake, cliff |
| GET | `/api/areas/{id}/weather?date=YYYY-MM-DD` | hourly temperature, humidity, cloud cover, wind (from Open-Meteo) |
| POST | `/api/areas/{id}/wind` | body `{date, startHour, endHour, stepHours}` → `{jobId}` |
| GET | `/api/jobs/{jobId}` | `{status: queued\|running\|done\|failed, progress, message}` |
| GET | `/api/areas/{id}/wind?date=…&hour=HH` | Float32 `u` and `v` on the detail grid (two endpoints or a packed buffer `[u…, v…]`) |
| GET | `/api/areas/{id}/wind/fallback?date=…&hour=HH` | Fallback wind (6.5), same format |

Enable CORS for the frontend origin. Cache everything to `backend/cache/{areaId}/` keyed by inputs; identical requests return cached files instantly. `areaId` = short hash of `(lat, lon, sizes, detailCenter)`.

### 6.2 Terrain
- US: fetch the USGS 3DEP **bare-earth** DEM (prefer 1 m or 10 m source; py3dep is acceptable) and resample to 10 m (detail) and 30 m (overview) with bilinear interpolation.
- Outside the US: Copernicus GLO-30 (note it is a surface model including canopy). Overview only at 30 m; detail resampled from 30 m with a warning flag in metadata.
- Write the detail DEM as a GeoTIFF with projection for WindNinja.

### 6.3 Land cover
Reclassify any source into these classes (Uint8):
`0 unknown, 1 water, 2 open (grass/crops/bare), 3 shrub, 4 forest, 5 developed, 6 wetland`.
US: NLCD. Elsewhere: ESA WorldCover. If fetching fails, return all `2` with a warning.

### 6.4 Features
From OpenStreetMap: `highway=path|footway|track` → trail, other highways → road, `waterway=stream` → stream, `waterway=river` → river, `natural=water` → lake, `natural=cliff` → cliff. Return as GeoJSON in the area CRS.

### 6.5 Wind
**Primary — WindNinja**
- Run the WindNinja CLI in a subprocess with a generated `.cfg` file, one run per requested time window.
- Settings: weather-model initialization (use a NOAA model available for CONUS; HRRR preferred if offered), **diurnal winds on**, **mass-conserving solver only** (never the momentum solver — too slow), vegetation from dominant land cover (`trees`, `brush`, or `grass`), output wind height 2 m, mesh resolution ~50–100 m, ASCII output on.
- Config key names and accepted values MUST be verified against the example configs shipped with WindNinja (`etc/windninja/example-files/`, e.g. `cli_wxModelInitialization_diurnal.cfg`, `cli_domainAverage_diurnal.cfg`) and `WindNinja_cli --help`. Do not invent keys.
- If weather-model download fails, fall back to **domain-average initialization** using Open-Meteo wind for each hour (diurnal still on, with Open-Meteo temperature and cloud cover).
- Parse the output speed and direction `.asc` grids, convert to `u, v` (section 5), resample onto the 10 m detail grid (bilinear), save as `.npy`.
- Run as a background job; report progress per hour completed. Typical mass-solver run: seconds to under a minute each.

**Fallback — slope-wind approximation (always available, no WindNinja)**
For each cell: `wind = forecastWind + slopeWind`, where
- `forecastWind` = Open-Meteo 10 m wind for that hour (uniform), scaled to 2 m by ×0.7.
- `slopeWind` = `k * slopeMagnitude * dir`, with `dir` = downhill unit vector at night/evening (sun elevation < 5°) and uphill unit vector on sun-facing slopes in daytime (sun elevation > 10° and dot(surfaceNormal, sunDir) > 0.2); blend smoothly between.
- `k` starts at 3 m/s per unit slope, capped at 2.5 m/s total slope wind. Weight slope wind more when forecast wind < 3 m/s.
Implement this in the backend (numpy) AND mirror it in `frontend/src/models/wind.ts` so the frontend works with no backend at all.

### 6.6 Docker
One image: Ubuntu base, build or install WindNinja CLI (use the official repo `github.com/firelab/windninja` and its Docker instructions), Python + requirements, uvicorn on port 8000. Provide `docker compose up` for local use.

### 6.7 Demo bundle script
`backend/scripts/build_demo.py --lat … --lon … --date … --start 14 --end 22` writes to `frontend/public/demo/`:
`area.json` (metas, timezone, LKP, truth location, focus segment, profile, teams), `terrain_overview.bin`, `terrain_detail.bin`, `landcover_overview.bin`, `landcover_detail.bin`, `features.geojson`, `weather.json`, `wind_HH.bin` (packed u then v) for every hour, `wind_fallback_HH.bin`.

---

## 7. Frontend

### 7.1 Data modes
- **Live mode:** uses backend endpoints.
- **Offline demo mode:** loads `/demo/*` only. Toggle in the UI and via `?offline=1`. Offline mode must work with networking disabled. Default to offline mode if `/api/health` fails within 3 s.

### 7.2 Layers (each toggleable)
Terrain (always), contour lines, land-cover tint, vegetation models, trails/streams lines, probability map, wind streaks, scent particles, scent heatmap, hotspots, dog teams, alert zones, searched sectors, child marker (hidden until reveal).

### 7.3 Views
- **Map view:** clean data-first, top-down-ish camera, minimal models.
- **Scene view:** perspective camera, vegetation, tents, dogs, atmosphere.
Toggle animates the camera between them.

### 7.4 Controls panel
- Profile: Child (1–6), Child (7–12), Hiker, Person with dementia.
- LKP: click on terrain to place (demo preset loaded by default).
- Focus segment: drag a square on the overview; "Compute detail" button (live mode).
- Time slider: 14:00–22:00, 15-minute steps, play/pause, shows sun elevation and "scent quality" label.
- Teams: number (1–6), "Deploy teams" button.
- Search mode buttons: "Add alert", "Mark searched (no alert)", "Reset".
- Wind source indicator: "WindNinja" / "Fallback".
- On-site wind entry: direction + speed; when set, it overrides the forecast wind input to the fallback model for the current hour (and is shown as a badge).

### 7.5 Visual design
- Dark, map-like aesthetic. Terrain shaded with a subtle elevation ramp, soft hillshade, and thin contour lines every 10 m (detail) / 50 m (overview) via a custom shader (`ContourMaterial`).
- Scent: additive-blended glowing points, warm amber; heatmap uses a perceptual sequential ramp with transparency at low values.
- Probability map: cool cyan tint draped on terrain.
- Wind: thin animated streaks (short-lived line particles), low opacity.
- Models: low-poly, consistent flat materials; trees placed with `InstancedMesh` from land cover (forest density ~1 tree per 150 m² on detail grid, randomized with a fixed seed).
- Respect `prefers-reduced-motion` for camera animations.
- Legends explain every color. A small "Model assumptions" panel lists that scent physics are simplified heuristics.

### 7.6 Performance targets
- 60 fps on a typical laptop with 15,000 particles. Use typed arrays and `THREE.Points` with a `BufferGeometry` updated in place, or `InstancedMesh`. Never allocate objects per particle per frame.
- Heavy computations (ensembles, hotspot scoring, back-tracing) run in a **Web Worker** with a progress indicator; the UI never freezes for more than 100 ms.
- Terrain mesh: one `PlaneGeometry` per level with displaced vertices; overview at reduced vertex density if needed.

---

## 8. Models (pure TypeScript in `src/models/`)

All parameters live in `src/config/modelParams.ts` with comments. Use a seeded RNG (e.g., mulberry32) so runs are reproducible.

### 8.1 Probability map — `probability.ts`
Input: overview grid, terrain, features, land cover, LKP, profile. Output: Float32 probability per overview cell, summing to 1.

1. **Distance prior:** log-normal density of crow's-flight distance `d` from LKP, parameterized by the profile's median distance `m` and spread `s`:
   | Profile | median `m` | spread `s` | Notes |
   | --- | --- | --- | --- |
   | Child 1–6 | 0.3 km | 0.9 | median from Lost Person Behavior (mountains) |
   | Child 7–12 | 1.0 km | 0.9 | placeholder, tune |
   | Hiker | 3.1 km | 0.8 | median, temperate mountains |
   | Dementia | 1.1 km | 0.9 | median, urban; placeholder for wilderness |
   Convert density along radius to per-cell weight by dividing by `2πd` (avoid singularity: `d = max(d, cellSize)`).
2. **Linear features:** multiply by `1 + A * exp(-dist / L)` where `dist` = distance to nearest trail/road/stream, `A = 3`, `L = 150 m` (hikers), `A = 1` for children.
3. **Barriers:** cells across a river/lake or cliff from the LKP (blocked line of travel) × 0.2. Use a cost-distance pass (Dijkstra over the grid, cost rises with slope and water) instead of crow's-flight if time permits; Euclidean is acceptable for v1.
4. **Slope:** × `exp(-slopeDeg / 25)`.
5. **Water cells:** 0. Normalize.
6. **Manual edits:** a brush that multiplies probability in a radius (×2 or ×0.5), then renormalize.

Provide `resampleToDetail(overviewProb)` for the detail grid (bilinear, renormalized within the segment) and report the segment's total probability (shown in UI as "This segment holds X% of the probability").

### 8.2 Wind access — `wind.ts`
- `sampleWind(x, y, t) → {u, v}`: bilinear in space, linear in time between hourly grids.
- Implements the fallback slope-wind model (6.5) for frontend-only use.
- Ensemble perturbation: rotate by `δθ ~ U(-20°, 20°)` and scale speed by `U(0.7, 1.3)` per ensemble member.

### 8.3 Scent simulation — `scent.ts`
Particle state (struct-of-arrays, Float32/Uint32): `x, y, strength, age, sourceCell`.

- **Release:** emit particles from detail-grid cells with probability ≥ 1e-6, count proportional to probability (total N = 15,000 visible; ensembles use more off-screen). Store `sourceCell`.
- **Step (dt = 2 s simulated; run many steps per frame for playback speed):**
  - advect: `x += u*dt`, `y += v*dt`
  - turbulence: random walk with diffusivity `K = 0.5 + 0.3 * windSpeed` m²/s → displacement `N(0, sqrt(2*K*dt))` per axis
  - forest slow-down: in forest cells, multiply advection by 0.5
  - calm pooling: if wind speed < 0.3 m/s and cell is a local low (lower than ≥ 6 of 8 neighbors), damp motion ×0.3
  - decay: `strength *= exp(-dt / τ)`, `τ = 1800 s * humidityFactor * tempFactor * sunFactor`
    - `humidityFactor = clamp(0.5 + RH/100, 0.6, 1.4)`
    - `tempFactor = clamp(1.4 - (T°C - 10)/40, 0.6, 1.4)`
    - `sunFactor = 0.7` when the cell is sunlit and sun elevation > 20°, else 1
  - daytime lift: when sunlit and wind < 2 m/s, remove a fraction `0.002 * dt` of strength (scent lofting away from dog height)
  - recycle a particle when it leaves the grid or `strength < 0.01`: re-emit from a source cell
- **Concentration grid:** each step, add `strength` of every particle into its cell (Float32 accumulator), with exponential time decay of the accumulator (half-life 10 min) so the heatmap reflects the recent window.
- **Ensembles:** run 6 members with perturbed wind (8.2) in the worker for a 60-minute window ending at the slider time; average into `scentHeat` (detail grid).
- Expose: `createSim(params)`, `step(sim, wind, env, dt)`, `runEnsemble(...) → Float32Array`.

### 8.4 Hotspot scoring and deployment — `hotspots.ts`
- **Detectability per cell:** `det = smoothstep(θ1, θ2, scentHeat)` with θ1, θ2 at the 70th and 95th percentiles of nonzero heat (configurable).
- **Contribution tracking:** during ensemble runs, record for each receiving cell which `sourceCell`s contributed (sparse: keep top 50 sources per receiving cell by strength, or downsample sources to a 50 m grid).
- **Reachability:** cells with slope > 35°, water, or cliff buffer (20 m) are not deployable.
- **Greedy deployment for T teams:**
  1. score(cell) = Σ over contributing sources of `prob(source) * det(cell)`, over deployable cells; smooth with a 30 m kernel.
  2. pick the max cell; record covered sources.
  3. reduce covered sources' probability by ×(1 − 0.7) for subsequent picks (assumed dog POD 0.7), suppress cells within 300 m.
  4. repeat for T teams.
- **For each deployment:** approach direction = upwind (opposite of mean local wind vector), shown as an arrow; best time window = the 1-hour window between 14:00 and 22:00 with the highest score at that cell (compute cheaply by scoring each hourly snapshot); covered probability %.

### 8.5 Alert triangulation — `triangulation.ts`
- On alert at point P and time t: release 3,000 particles at P and integrate **backward**: `x -= u(x, t')*dt` with `t'` decreasing from t to t − 60 min, same turbulence, no decay.
- Accumulate visited density into `backZone` (Float32, detail grid), normalize to max 1.
- Posterior: `post = prior * (ε + backZone₁) * (ε + backZone₂) * …` with `ε = 0.02`, normalize.
- Show each alert's back-zone as a translucent plume and the posterior as a highlighted region with its peak marked. In the demo, after ≥ 2 alerts, reveal the child marker at the truth location with an animation.

### 8.6 Negative updates — `searchUpdate.ts`
- User marks a searched sector (polygon or a deployment point + radius) with a time window and "no alert".
- POD per source cell = `0.7 * fraction of that source's scent that reached the searched area above θ1 during the window` (from contribution tracking).
- `prob *= (1 - POD)`, renormalize; heatmap and hotspots recompute.
- Flag sectors searched in poor scent conditions (mean det < 0.3) with a "recheck" badge.

---

## 9. Testing

- vitest unit tests for: wind direction conversion; bilinear sampling; probability normalization; particle advection in uniform wind (moves `u*dt` within tolerance with K = 0); decay half-life; backward trace returns near source in uniform wind; greedy deployment never picks non-deployable cells.
- pytest for: grid metadata consistency, WindNinja output parsing on a fixture `.asc` file, cache hits.
- A `/debug` overlay (toggle with `D`) showing FPS, particle count, wind source, current hour, worker status.

---

## 10. Coding rules

- Work in small steps; run the app after each change; commit after every working step with a clear message.
- Keep `models/` pure and typed. No `any` in model code.
- Never block the main thread with long loops; use the worker.
- All tunable numbers live in config files, not inline.
- Fail soft: missing model files → placeholder geometry; backend down → offline mode; WindNinja failure → fallback wind with a visible badge. Never show a blank screen.
- Do not add dependencies beyond section 3 without a clear need; prefer small libraries.
- Write the README as features land (what it is, how to run, data sources and credits: WindNinja/USFS, USGS 3DEP, Copernicus, ESA WorldCover, NLCD, OpenStreetMap, Open-Meteo).

---

## 11. Milestones (build in this order)

Each milestone ends with its acceptance check. Do not start the next until it passes. If a milestone overruns badly, take its fallback.

**M0 — Scaffold.** Repo layout, Vite app renders an empty R3F canvas, FastAPI `/api/health`, docker compose, vitest + pytest running.
✔ `npm run dev` shows a canvas; `/api/health` responds.

**M1 — Terrain.** Area creation, DEM fetch/resample, terrain endpoints; frontend renders detail terrain with contour shader, orbit controls, overview terrain at lower detail around it.
✔ Demo area visible in 3D with contours; overview and detail align.
Fallback: load a local GeoTIFF placed in `backend/data/` instead of fetching.

**M2 — Offline bundle (early!).** `build_demo.py` produces terrain + land cover + features for the demo area; frontend offline mode loads them.
✔ App works with backend stopped.

**M3 — Wind.** Fallback wind (backend + frontend mirror), then WindNinja job pipeline; wind streak layer; wind source badge; demo bundle includes hourly winds 14:00–22:00.
✔ Streaks follow terrain; switching hours changes them; WindNinja output visibly differs from fallback around ridges.
Fallback: ship with fallback wind only, label clearly.

**M4 — Probability map.** Profiles, distance prior, features, barriers, slope; layer and segment probability %.
✔ "Child" shows a tight blob around LKP biased along trails; "Hiker" spreads wider.

**M5 — Scent particles.** Particle sim in worker, rendering, release from probability, decay, forest slow-down, pooling.
✔ At 19:00 scent flows downhill into drainages; at 15:00 it follows the prevailing wind/upslope; 60 fps.

**M6 — Time slider + heatmap.** Slider drives wind interpolation, sun position, env factors; ensemble heatmap.
✔ Dragging 16:00 → 19:00 visibly drains the heatmap into the valley.

**M7 — Deployment.** Contribution tracking, detectability, greedy deployment, dog/handler models, arrows, time windows, coverage %.
✔ "Deploy 3 teams" places sensible points downwind of high-probability areas.

**M8 — Search updates.** Alert triangulation with reveal; negative updates; recheck badges.
✔ Two demo alerts reveal the child inside the overlap; marking a sector searched shifts probability elsewhere.

**M9 — Polish & ship.** Map/scene view toggle, vegetation instancing, legends, assumptions panel, on-site wind entry, camera presets for each demo step (keyboard 1–7), loading states, deploy frontend + backend, README.
✔ Full demo flow runs start to finish in offline mode and in live mode on the deployed URL.

Feature freeze after M8 if time is short; M9 polish items are ordered by demo impact: camera presets → legends → view toggle → vegetation → on-site wind.
