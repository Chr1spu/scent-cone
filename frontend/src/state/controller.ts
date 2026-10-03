/**
 * Orchestration: loading, worker calls and derived state. UI components call these actions;
 * the store holds the results.
 */
import { backendHealthy, loadLive, loadOffline } from '../api/loader';
import type { AreaBundle } from '../api/types';
import { DEMO_ALERT_TIMES, VERT_EXAG } from '../config/constants';
import { PROFILES, SEARCH, TIME, type ProfileId } from '../config/modelParams';
import { toLocal, toWorld } from '../geo/grid';
import { groundY } from '../geo/heights';
import { sunAt, weatherAt } from '../models/env';
import { computeFallbackWind, smoothedGradients, type TerrainGradients, type WindField } from '../models/wind';
import { ComputeClient } from '../workers/client';
import type { AlertResult, DeploymentOut, HeatResult, ProbResult, SearchResult } from '../workers/protocol';
import { useStore, type State } from './store';

let client: ComputeClient | null = null;
let grads: TerrainGradients | null = null;
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

export async function boot() {
  const params = new URLSearchParams(location.search);
  const forceOffline = params.get('offline') === '1';
  set({ status: 'loading', loadFrac: 0.01, loadLabel: 'Checking backend' });
  const health = forceOffline ? { ok: false, windninja: false } : await backendHealthy(3000);
  set({ backend: health });
  await loadMode(health.ok ? 'live' : 'offline');
}

export async function loadMode(mode: 'offline' | 'live', detailCenter?: [number, number]) {
  const onProgress = (f: number, l: string) => set({ loadFrac: f, loadLabel: l });
  set({ status: 'loading', loadFrac: 0.02, loadLabel: mode === 'live' ? 'Loading from backend' : 'Loading offline demo bundle' });
  let bundle: AreaBundle;
  try {
    bundle = mode === 'live' ? await loadLive(onProgress, detailCenter) : await loadOffline(onProgress);
  } catch (e) {
    if (mode === 'live') {
      get().toast(`Live mode failed (${e instanceof Error ? e.message : e}); switched to offline demo.`, 'warn');
      return loadMode('offline');
    }
    set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    return;
  }
  await applyBundle(bundle);
}

async function applyBundle(b: AreaBundle) {
  const c = b.config;
  grads = smoothedGradients(b.detail.elev, b.detail.meta.cols, b.detail.meta.rows, b.detail.meta.cellSize);
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
  const p = await withBusy('Probability map', () => worker().call<ProbResult>({ type: 'probability', profile, lkp }));
  if (p) applyProb(p);
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
    const hourGrid = computeFallbackWind(grads, onsite.speed, onsite.dir, sun.elevation, sun.azimuth);
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
    if (deps.length < teams) get().toast(`Only ${deps.length} useful deployment points found.`, 'warn');
    else get().toast(`${deps.length} teams deployed downwind of high-probability terrain`, 'success');
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
  if (alerts.length >= 2 && !get().revealed) {
    setTimeout(() => {
      set({ revealed: true, tool: 'none' });
      get().toast('Subject located inside the overlap of the back-traced zones', 'success');
      flyTo(7);
    }, 900);
  } else {
    get().toast(`Alert ${alerts.length} added at ${fmtTime(t)} — back-traced 60 min`, 'info');
  }
}

let searchId = 1;

export async function markSearched(lx: number, ly: number, radius = SEARCH.defaultRadiusM) {
  const t = get().time;
  const r = await withBusy('Search update', () => worker().call<SearchResult>({ type: 'searched', x: lx, y: ly, radius, t }, progress('Search update')));
  if (!r) return;
  set({ searched: [...get().searched, { id: searchId++, x: lx, y: ly, radius, t, meanDet: r.meanDet, recheck: r.recheck }] });
  applyProb(r.prob);
  get().toast(r.recheck ? 'Sector searched in poor scent conditions — flagged for recheck' : 'Sector searched, no alert: probability shifted elsewhere', r.recheck ? 'warn' : 'info');
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
  const truth = toLocal(b.frame, b.config.truth.x, b.config.truth.y);
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
  await loadMode('live', [lat, lon]);
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

export function fmtTime(t: number): string {
  const h = Math.floor(t + 1e-6);
  const m = Math.round((t - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m === 60 ? 0 : m).padStart(2, '0')}`;
}
