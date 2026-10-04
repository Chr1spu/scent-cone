/**
 * Orchestration: loading, worker calls and derived state. UI components call these actions;
 * the store holds the results.
 */
import { backendHealthy, loadLive, loadOffline, type LiveRequest } from '../api/loader';
import type { AreaBundle } from '../api/types';
import { DEMO_ALERT_TIMES, VERT_EXAG } from '../config/constants';
import { PROFILES, TIME, type ProfileId } from '../config/modelParams';
import type { SearchedSector as SectorShape } from '../models/searchUpdate';
import { MISSIONS, type HabitatSpec, type MissionId } from '../config/missions';
import { toLocal, toWorld } from '../geo/grid';
import { groundY } from '../geo/heights';
import { sunAt, weatherAt } from '../models/env';
import { buildTerrainInfo, shadowMask, type TerrainInfo } from '../models/terrainInfo';
import { computeFallbackWind, smoothedGradients, type TerrainGradients, type WindField } from '../models/wind';
import { ComputeClient } from '../workers/client';
import type { AlertResult, DeploymentOut, HeatResult, ProbResult, SearchResult, SourceSpec } from '../workers/protocol';
import { useStore, type State } from './store';

let client: ComputeClient | null = null;
let grads: TerrainGradients | null = null;
let terrain: TerrainInfo | null = null;
const get = () => useStore.getState();
const set = (p: Partial<State>) => useStore.getState().set(p);

function worker(): ComputeClient {
  if (!client) {
    client = new ComputeClient();
    client.onBusyChange = (n) => set({ workerBusy: n });
  }
  return client;
}

function progress(label: string) {
  return (frac: number, l: string) => set({ busy: { label: l || label, frac } });
}

async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  set({ busy: { label, frac: 0 } });
  try {
    return await fn();
  } catch (e) {
    get().toast(`${label} failed: ${e instanceof Error ? e.message : e}`, 'error');
    return null;
  } finally {
    set({ busy: null });
  }
}

// ---------------------------------------------------------------- boot / loading

export interface BootOptions {
  /** live area to load; omitted = the bundled demo */
  live?: LiveRequest;
  profile?: ProfileId;
  teams?: number;
  mission?: MissionId;
}

/** Planner entry point, from the URL: the demo, or a live area chosen on "Plan a search". */
export async function boot(opts: BootOptions = {}) {
  // the mission comes from the URL each time the planner opens (applied once the area loads)
  set({ mission: opts.mission ?? 'wilderness', hides: [], area: null });
  set({
    status: 'loading',
    loadFrac: 0.01,
    loadLabel: opts.live ? 'Contacting the server (a sleeping server can take up to a minute to wake)' : 'Checking the server',
    error: null,
    errorKind: null,
  });
  // the demo needs no server, so don't wait long; a live area may have to wake a sleeping host
  const health = await backendHealthy(opts.live ? 75000 : 3000);
  set({ backend: health });
  if (!opts.live) {
    await loadMode('offline');
  } else if (!health.ok) {
    set({ status: 'error', errorKind: 'server', error: 'The Scentline server is not reachable, so this area cannot be computed.' });
    return;
  } else {
    await loadMode('live', opts.live);
  }
  if (get().status !== 'ready') return;
  if (opts.teams) set({ teams: Math.min(6, Math.max(1, opts.teams)) });
  if (opts.profile && opts.profile !== get().profile && PROFILES[opts.profile]) {
    set({ profile: opts.profile });
    await recomputeProbability();
  }
}

let loadGen = 0;

/** Load the offline bundle, or a live area (location/date/focus from `req`, else the last request). */
export async function loadMode(mode: 'offline' | 'live', req?: LiveRequest) {
  const liveReq = req ?? get().liveRequest ?? {};
  const gen = ++loadGen;
  const onProgress = (f: number, l: string) => gen === loadGen && set({ loadFrac: f, loadLabel: l });
  set({ status: 'loading', loadFrac: 0.02, loadLabel: mode === 'live' ? 'Loading from backend' : 'Loading offline demo bundle' });
  let bundle: AreaBundle;
  try {
    bundle = mode === 'live' ? await loadLive(onProgress, liveReq) : await loadOffline(onProgress);
    if (gen !== loadGen) return; // a newer load started (e.g. navigation)
    if (mode === 'live') set({ liveRequest: liveReq });
  } catch (e) {
    if (gen !== loadGen) return;
    set({ status: 'error', errorKind: mode === 'live' ? 'server' : 'data', error: e instanceof Error ? e.message : String(e) });
    return;
  }
  await applyBundle(bundle);
}

async function applyBundle(b: AreaBundle) {
  const c = b.config;
  grads = smoothedGradients(b.detail.elev, b.detail.meta.cols, b.detail.meta.rows, b.detail.meta.cellSize);
  terrain = buildTerrainInfo(b.detail.meta, b.frame, b.detail.elev, b.detail.landcover, b.overview);
  const windSource = b.windninja ? 'windninja' : 'fallback';
  const activeWind = b.windninja ?? b.fallback;
  const lkp = toLocal(b.frame, c.lkp.x, c.lkp.y);
  set({
    bundle: b,
    mode: b.mode,
    windSource,
    activeWind,
    windVersion: get().windVersion + 1,
    onsiteWind: null,
    profile: c.profile,
    teams: c.teams,
    lkp,
    time: c.missingAt ?? 16,
    deployments: [],
    alerts: [],
    searched: [],
    revealed: false,
    heat: null,
    prob: null,
    suggestions: [],
    loadLabel: 'Initialising models',
    loadFrac: 0.97,
  });
  for (const w of b.warnings) get().toast(w, 'warn');
  if (client) {
    client.terminate();
    client = null;
  }
  const place = { date: c.date, lat: c.lat, lon: c.lon, utcOffsetSeconds: c.utcOffsetSeconds };
  await worker().call({
    type: 'init',
    data: { frame: b.frame, overview: b.overview, detail: b.detail, features: b.features, weather: b.weather, place, wind: activeWind },
  });
  await recomputeProbability();
  // re-apply the current mission (its scent tuning, deployment rules and source) to the new area
  if (get().mission !== 'wilderness') await setMission(get().mission, { fly: false });
  set({ status: 'ready' });
  flyTo(1);
  refreshSuggestions();
}

// ---------------------------------------------------------------- probability

function applyProb(p: ProbResult) {
  set({ prob: p, probVersion: get().probVersion + 1, deployments: get().deployments });
  scheduleHeat();
}

export async function recomputeProbability() {
  const { profile, lkp } = get();
  const p = await sourceCall(() => worker().call<ProbResult>({ type: 'probability', profile, lkp }));
  if (p) applyProb(p);
}

/** Probability requests: a source with nowhere to put probability explains itself. */
async function sourceCall(fn: () => Promise<ProbResult>): Promise<ProbResult | null> {
  set({ busy: { label: 'Probability map', frac: 0 } });
  try {
    return await fn();
  } catch (e) {
    get().toast(e instanceof Error ? e.message : String(e), 'warn');
    return null;
  } finally {
    set({ busy: null });
  }
}

// ---------------------------------------------------------------- missions

function sourceSpec(mission: MissionId): SourceSpec {
  const s = get();
  switch (MISSIONS[mission].source) {
    case 'hides':
      return { kind: 'hides', hides: s.hides };
    case 'water':
      return { kind: 'water' };
    case 'habitat':
      return { kind: 'habitat', habitat: s.habitat };
    case 'area':
      return { kind: 'area', area: s.area };
    default:
      return { kind: 'lkp' };
  }
}

/** Sensible starting inputs so every mission shows something straight away. */
function missionDefaults(mission: MissionId) {
  const s = get();
  const b = s.bundle;
  const [lx, ly] = s.lkp;
  const m = MISSIONS[mission];
  const out: Partial<State> = {};
  if (m.profiles && !m.profiles.includes(s.profile)) out.profile = m.defaultProfile ?? m.profiles[0];
  if (m.source === 'hides' && s.hides.length === 0) {
    // demo: hide where the demo subject is; otherwise 300 m east of the staging point
    const t = b?.config.truth ? toLocal(b.frame, b.config.truth.x, b.config.truth.y) : [lx + 300, ly];
    out.hides = [[t[0], t[1]]];
  }
  if (m.source === 'area') {
    out.area = { kind: 'circle', x: lx, y: ly, radius: mission === 'evidence' ? 120 : 300 };
  }
  return out;
}

/** Switch mission: source model, scent tuning and deployment rules change; logs reset. */
export async function setMission(mission: MissionId, opts: { fly?: boolean; keepTeams?: boolean } = {}) {
  const m = MISSIONS[mission];
  set({
    mission,
    ...missionDefaults(mission),
    ...(opts.keepTeams ? {} : { teams: m.teams }),
    deployments: [],
    alerts: [],
    searched: [],
    revealed: false,
    heat: null,
    tool: 'none',
    missionVersion: get().missionVersion + 1,
  });
  // keep the profile in the worker in step before switching source
  if (m.source === 'lkp' || m.source === 'water') {
    const { profile, lkp } = get();
    await worker().call<ProbResult>({ type: 'probability', profile, lkp }).catch(() => null);
  }
  const p = await sourceCall(() => worker().call<ProbResult>({ type: 'mission', mission, source: sourceSpec(mission) }));
  if (p) applyProb(p);
  refreshSuggestions();
  if (opts.fly !== false) flyTo(m.source === 'area' || m.source === 'hides' ? 4 : 2);
}

async function updateSource() {
  const p = await sourceCall(() => worker().call<ProbResult>({ type: 'source', source: sourceSpec(get().mission) }));
  if (p) applyProb(p);
  set({ deployments: [] });
}

export async function addHide(lx: number, ly: number) {
  set({ hides: [...get().hides, [lx, ly]].slice(-3) as [number, number][] });
  await updateSource();
}

export async function clearHides() {
  set({ hides: [] });
  get().toast('Hides cleared. Place a hide to see its scent.', 'info');
}

export async function setArea(area: SectorShape) {
  set({ area, tool: 'none', searchDraft: { ...get().searchDraft, pts: [] } });
  await updateSource();
}

export async function setHabitat(habitat: HabitatSpec) {
  set({ habitat });
  await updateSource();
}

export async function setProfile(profile: ProfileId) {
  set({ profile, deployments: [] });
  await recomputeProbability();
  get().toast(`Profile: ${PROFILES[profile].label} (median ${(PROFILES[profile].medianM / 1000).toFixed(1)} km)`);
}

export async function setLkp(lx: number, ly: number) {
  set({ lkp: [lx, ly], deployments: [], tool: 'none' });
  await recomputeProbability();
}

export async function brush(lx: number, ly: number, up: boolean) {
  const p = await withBusy('Brush edit', () => worker().call<ProbResult>({ type: 'brush', x: lx, y: ly, factor: up ? 2 : 0.5 }));
  if (p) applyProb(p);
}

// ---------------------------------------------------------------- heat (latest wins)

let heatInFlight = false;
let heatPending: number | null = null;
let heatTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleHeat(delay = 250) {
  const { layers } = get();
  if (!layers.heatmap && !layers.hotspots) return;
  if (heatTimer) clearTimeout(heatTimer);
  heatTimer = setTimeout(() => requestHeat(get().time), delay);
}

async function requestHeat(t: number) {
  if (!get().prob) return;
  if (heatInFlight) {
    heatPending = t;
    return;
  }
  heatInFlight = true;
  try {
    const h = await worker().call<HeatResult>({ type: 'heat', t }, (f, l) => set({ busy: { label: l, frac: f } }));
    set({ heat: h });
  } catch (e) {
    get().toast(`Heatmap failed: ${e instanceof Error ? e.message : e}`, 'error');
  } finally {
    heatInFlight = false;
    set({ busy: null });
    if (heatPending !== null) {
      const next = heatPending;
      heatPending = null;
      if (Math.abs(next - (get().heat?.t ?? -1)) > 1e-6) requestHeat(next);
    }
  }
}

export function setTime(t: number) {
  const c = get().bundle?.config;
  const t0 = c?.startHour ?? TIME.start;
  const t1 = c?.endHour ?? TIME.end;
  set({ time: Math.min(Math.max(t, t0), t1) });
  scheduleHeat();
}

// ---------------------------------------------------------------- wind

export async function setWindSource(src: 'windninja' | 'fallback') {
  const b = get().bundle;
  if (!b) return;
  if (src === 'windninja' && !b.windninja) {
    get().toast('No WindNinja output for this area; using fallback wind.', 'warn');
    return;
  }
  await applyWind(src, get().onsiteWind);
}

async function applyWind(src: 'windninja' | 'fallback', onsite: State['onsiteWind']) {
  const b = get().bundle!;
  let field: WindField = src === 'windninja' && b.windninja ? b.windninja : b.fallback;
  if (onsite && grads) {
    // on-site observation overrides the forecast input to the fallback model for that hour
    const c = b.config;
    const sun = sunAt({ date: c.date, lat: c.lat, lon: c.lon, utcOffsetSeconds: c.utcOffsetSeconds }, onsite.hour);
    const shaded = terrain && sun.elevation > 0 ? shadowMask(terrain, sun.dir) : undefined;
    const hourGrid = computeFallbackWind(grads, onsite.speed, onsite.dir, sun.elevation, sun.azimuth, shaded);
    const idx = field.hours.indexOf(onsite.hour);
    if (idx >= 0) {
      field = { hours: field.hours, grids: field.grids.map((g, i) => (i === idx ? hourGrid : g)) };
      src = 'fallback';
    }
  }
  set({ windSource: src, activeWind: field, onsiteWind: onsite, windVersion: get().windVersion + 1 });
  await worker().call({ type: 'setWind', wind: field });
  scheduleHeat(0);
}

export async function setOnsiteWind(dir: number | null, speed: number | null) {
  const b = get().bundle;
  if (!b) return;
  if (dir === null || speed === null) {
    await applyWind(b.windninja ? 'windninja' : 'fallback', null);
    get().toast('On-site wind cleared');
    return;
  }
  const hour = Math.min(Math.max(Math.round(get().time), b.config.windHours[0]), b.config.windHours[b.config.windHours.length - 1]);
  await applyWind(get().windSource, { hour, dir, speed });
  get().toast(`On-site wind ${speed.toFixed(1)} m/s from ${Math.round(dir)}° applied to ${hour}:00 (fallback model)`, 'success');
}

export function forecastAt(t: number) {
  const b = get().bundle;
  return b ? weatherAt(b.weather, t) : null;
}

// ---------------------------------------------------------------- deployment / search

export async function deployTeams() {
  const { teams, time } = get();
  const deps = await withBusy('Deploying teams', () =>
    worker().call<DeploymentOut[]>({ type: 'deploy', t: time, teams }, progress('Deploying teams')),
  );
  if (deps) {
    set({ deployments: deps, layers: { ...get().layers, teams: true } });
    if (deps.length < teams) get().toast(deps.length === 0 ? 'No useful start points: no reachable ground gets this scent at this time.' : `Only ${deps.length} useful start point${deps.length > 1 ? 's' : ''} found; more teams would cover almost nothing.`, 'warn');
    else get().toast(`${deps.length} teams placed. See the Plan tab.`, 'success');
    flyTo(6);
  }
}

let alertId = 1;

export async function addAlert(lx: number, ly: number) {
  // clicking near a reported (radio) alert snaps to it and adopts its time
  const near = get().suggestions.find(([sx, sy]) => Math.hypot(sx - lx, sy - ly) < 120);
  if (near) {
    [lx, ly] = near;
    set({ time: near[2] });
  }
  const t = get().time;
  const r = await withBusy('Alert triangulation', () => worker().call<AlertResult>({ type: 'alert', x: lx, y: ly, t }, progress('Alert triangulation')));
  if (!r) return;
  const alerts = [...get().alerts, { id: alertId++, x: lx, y: ly, t, zone: r.zone }];
  set({ alerts, layers: { ...get().layers, alertZones: true, probability: true } });
  applyProb(r.prob);
  if (alerts.length >= 2 && !get().revealed && get().bundle?.config.truth && get().mission === 'wilderness') {
    setTimeout(() => {
      set({ revealed: true, tool: 'none' });
      get().toast('Found: the child is inside the overlap of the two traced zones.', 'success');
      flyTo(7);
    }, 900);
  } else {
    get().toast(`Alert ${alerts.length} logged at ${fmtTime(t)}. Scent traced back one hour.`, 'info');
  }
}

let searchId = 1;

/** Mark a sector searched with no alert over the window ending at the slider time. */
export async function markSearched(sector: SectorShape) {
  const { time, searchDraft, bundle } = get();
  const t1 = time;
  const t0 = Math.max(bundle?.config.startHour ?? TIME.start, t1 - searchDraft.windowMin / 60);
  if (t1 - t0 < 0.2) {
    get().toast('Move the time slider later: the search window must end after the first modelled hour.', 'warn');
    return;
  }
  const r = await withBusy('Search update', () => worker().call<SearchResult>({ type: 'searched', sector, t0, t1 }, progress('Search update')));
  if (!r) return;
  set({ searched: [...get().searched, { id: searchId++, sector, t0, t1, meanDet: r.meanDet, recheck: r.recheck }], searchDraft: { ...get().searchDraft, pts: [] } });
  applyProb(r.prob);
  get().toast(r.recheck ? 'Searched in poor scent conditions: marked for a recheck.' : 'Searched with no alert. Probability moved elsewhere.', r.recheck ? 'warn' : 'info');
}

/** Searched tool click: circle sectors are immediate, polygons collect vertices. */
export function searchClick(lx: number, ly: number): Promise<void> | void {
  const d = get().searchDraft;
  if (d.shape === 'circle') {
    const c: SectorShape = { kind: 'circle', x: lx, y: ly, radius: d.radius };
    return get().tool === 'area' ? setArea(c) : markSearched(c);
  }
  // clicking near the first vertex closes the polygon
  if (d.pts.length >= 3 && Math.hypot(d.pts[0][0] - lx, d.pts[0][1] - ly) < 40) return finishPolygon();
  set({ searchDraft: { ...d, pts: [...d.pts, [lx, ly]] } });
}

export function finishPolygon(): Promise<void> | void {
  const d = get().searchDraft;
  if (d.pts.length < 3) {
    get().toast('A searched polygon needs at least 3 points.', 'warn');
    return;
  }
  const poly: SectorShape = { kind: 'polygon', xs: d.pts.map((p) => p[0]), ys: d.pts.map((p) => p[1]) };
  return get().tool === 'area' ? setArea(poly) : markSearched(poly);
}

export async function resetSearch() {
  const p = await withBusy('Reset', () => worker().call<ProbResult>({ type: 'resetSearch' }));
  set({ alerts: [], searched: [], revealed: false, deployments: [] });
  if (p) applyProb(p);
  refreshSuggestions();
}

export async function refreshSuggestions() {
  const b = get().bundle;
  if (!b) return;
  if (!b.config.truth || get().mission !== 'wilderness') {
    set({ suggestions: [] });
    return;
  }
  const truth = toLocal(b.frame, b.config.truth.x, b.config.truth.y);
  try {
    const s = await worker().call<[number, number, number][]>({ type: 'suggestAlerts', truth, times: DEMO_ALERT_TIMES });
    set({ suggestions: s });
  } catch {
    /* optional */
  }
}

export function releaseScent() {
  set({ scentRelease: get().scentRelease + 1, layers: { ...get().layers, scent: true } });
}

// ---------------------------------------------------------------- camera presets

export function flyTo(step: number) {
  const b = get().bundle;
  if (!b) return;
  const [lx, ly] = get().lkp;
  // step 7 looks at the hidden subject (demo) or the current posterior peak
  const truth = b.config.truth ? toLocal(b.frame, b.config.truth.x, b.config.truth.y) : (get().prob?.peak ?? [lx, ly]);
  const y0 = groundY(b, lx, ly);
  const shot = (tx: number, ty: number, dist: number, height: number, azDeg: number): State['camera'] => {
    const gy = groundY(b, tx, ty);
    const a = (azDeg * Math.PI) / 180;
    return {
      target: [tx, gy, -ty],
      position: [tx + Math.sin(a) * dist, gy + height * VERT_EXAG, -ty + Math.cos(a) * dist],
      nonce: Date.now(),
    };
  };
  const L = get().layers;
  switch (step) {
    case 1:
      set({ camera: shot(lx, ly, 1500, 700, 200) });
      break;
    case 2:
      set({ camera: shot(lx, ly, 2600, 3600, 0), layers: { ...L, probability: true } });
      break;
    case 3:
      set({ camera: shot(lx + 100, ly, 1900, 900, 160), layers: { ...L, wind: true } });
      break;
    case 4:
      set({ camera: shot(lx + 200, ly - 100, 1500, 700, 210), layers: { ...L, scent: true, wind: false } });
      break;
    case 5:
      set({ camera: shot(lx, ly - 300, 2200, 1300, 170), layers: { ...L, heatmap: true, hotspots: true } });
      scheduleHeat(0);
      break;
    case 6:
      set({ camera: shot(lx, ly - 300, 400, 3200, 0), layers: { ...L, teams: true, heatmap: true, hotspots: false, scent: false } });
      break;
    case 7:
      set({ camera: shot(truth[0], truth[1], 1500, 1100, 200), layers: { ...L, alertZones: true, probability: true, heatmap: false, hotspots: false, scent: false, wind: false } });
      break;
    default:
      set({ camera: { position: [0, y0 + 4000, 4200], target: [0, y0, 0], nonce: Date.now() } });
  }
}

export function setView(view: 'map' | 'scene') {
  const b = get().bundle;
  set({ view, layers: { ...get().layers, vegetation: view === 'scene' } });
  if (!b) return;
  const [lx, ly] = get().lkp;
  const gy = groundY(b, lx, ly);
  set({
    camera:
      view === 'map'
        ? { position: [lx, gy + 5200, -ly + 400], target: [lx, gy, -ly], nonce: Date.now() }
        : { position: [lx + 600, gy + 900, -ly + 1500], target: [lx, gy, -ly], nonce: Date.now() },
  });
}

/** live mode: move the 3 km focus segment and recompute detail data */
export async function computeDetailAt(lx: number, ly: number) {
  const b = get().bundle;
  if (!b) return;
  const [x, y] = toWorld(b.frame, lx, ly);
  const { lat, lon } = utmToLatLon(x, y, b.config.epsg);
  set({ focusPreview: null, tool: 'none' });
  await loadMode('live', { ...(get().liveRequest ?? {}), detailCenter: [lat, lon] });
}

/** Inverse UTM (WGS84) — enough precision for choosing a focus centre. */
export function utmToLatLon(x: number, y: number, epsg: number): { lat: number; lon: number } {
  const zone = epsg % 100;
  const south = Math.floor(epsg / 100) === 327;
  const a = 6378137;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const k0 = 0.9996;
  const ep2 = e2 / (1 - e2);
  const xx = x - 500000;
  const yy = south ? y - 10000000 : y;
  const M = yy / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu);
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const T1 = Math.tan(phi1) ** 2;
  const C1 = ep2 * Math.cos(phi1) ** 2;
  const R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = xx / (N1 * k0);
  const lat =
    phi1 -
    ((N1 * Math.tan(phi1)) / R1) *
      ((D * D) / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / Math.cos(phi1);
  return { lat: (lat * 180) / Math.PI, lon: (zone - 1) * 6 - 180 + 3 + (lon * 180) / Math.PI };
}

/** Local clock time; hours past 23 belong to the next day. */
export function fmtTime(t: number): string {
  let h = Math.floor(t + 1e-6);
  let m = Math.round((t - h) * 60);
  if (m === 60) {
    m = 0;
    h += 1;
  }
  return `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
