/** Loads an AreaBundle from the offline demo bundle (/demo/*) or the live backend (/api/*). */
import { frameOf, type Frame, type GridMeta } from '../geo/grid';
import type { Weather } from '../models/env';
import type { Feature2D } from '../models/probability';
import type { WindField, WindHour } from '../models/wind';
import type { AreaBundle, AreaConfig, GeoFeature, Progress } from './types';

const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

async function fetchBin(url: string, expectedBytes: number, init?: RequestInit): Promise<{ buf: ArrayBuffer; headers: Headers }> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  // dev servers answer unknown paths with index.html; insist on the exact size
  if (buf.byteLength !== expectedBytes) throw new Error(`${url}: expected ${expectedBytes} bytes, got ${buf.byteLength}`);
  return { buf, headers: r.headers };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const ct = r.headers.get('content-type') ?? '';
  if (ct.includes('text/html')) throw new Error(`${url}: not found`);
  return (await r.json()) as T;
}

const cells = (m: GridMeta) => m.cols * m.rows;

function splitWind(buf: ArrayBuffer, n: number): WindHour {
  const a = new Float32Array(buf);
  return { u: a.slice(0, n), v: a.slice(n, 2 * n) };
}

export function featuresToLocal(fc: { features: GeoFeature[] }, frame: Frame): Feature2D[] {
  const out: Feature2D[] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    const ring = (g.type === 'Polygon' ? (g.coordinates as number[][][])[0] : (g.coordinates as number[][])) ?? [];
    if (ring.length < 2) continue;
    const xs = new Float64Array(ring.length);
    const ys = new Float64Array(ring.length);
    ring.forEach((p, i) => {
      xs[i] = p[0] - frame.cx;
      ys[i] = p[1] - frame.cy;
    });
    out.push({ kind: f.properties.kind, polygon: g.type === 'Polygon', xs, ys, name: f.properties.name });
  }
  return out;
}

export async function loadConfig(): Promise<AreaConfig> {
  return fetchJson<AreaConfig>('/demo/area.json');
}

// ---------------------------------------------------------------- offline

export async function loadOffline(onProgress: Progress = () => {}): Promise<AreaBundle> {
  onProgress(0.02, 'Loading demo area');
  const config = await loadConfig();
  const om = config.overviewMeta;
  const dm = config.detailMeta;
  const frame = frameOf(dm);
  const nd = cells(dm);
  let done = 0;
  const total = 6 + config.windHours.length * 2;
  const tick = (label: string) => onProgress(0.05 + (0.9 * ++done) / total, label);
  const [to, td, lo, ld, feats, weather] = await Promise.all([
    fetchBin('/demo/terrain_overview.bin', cells(om) * 4).then((r) => (tick('terrain'), new Float32Array(r.buf))),
    fetchBin('/demo/terrain_detail.bin', nd * 4).then((r) => (tick('terrain'), new Float32Array(r.buf))),
    fetchBin('/demo/landcover_overview.bin', cells(om)).then((r) => (tick('land cover'), new Uint8Array(r.buf))),
    fetchBin('/demo/landcover_detail.bin', nd).then((r) => (tick('land cover'), new Uint8Array(r.buf))),
    fetchJson<{ features: GeoFeature[] }>('/demo/features.geojson').then((r) => (tick('trails & streams'), r)),
    fetchJson<Weather>('/demo/weather.json').then((r) => (tick('weather'), r)),
  ]);
  const hours = config.windHours;
  const fbGrids = await Promise.all(hours.map((h) => fetchBin(`/demo/wind_fallback_${pad(h)}.bin`, nd * 8).then((r) => (tick('wind'), splitWind(r.buf, nd)))));
  let windninja: WindField | null = null;
  const warnings = [...(config.warnings ?? [])];
  if ((config.windNinjaHours?.length ?? 0) > 0) {
    try {
      const g = await Promise.all(hours.map((h) => fetchBin(`/demo/wind_${pad(h)}.bin`, nd * 8).then((r) => (tick('WindNinja wind'), splitWind(r.buf, nd)))));
      windninja = { hours, grids: g };
    } catch (e) {
      warnings.push('WindNinja wind files missing from bundle; using fallback wind.');
    }
  }
  onProgress(1, 'Ready');
  return {
    mode: 'offline',
    config,
    frame,
    overview: { meta: om, elev: to, landcover: lo },
    detail: { meta: dm, elev: td, landcover: ld },
    features: featuresToLocal(feats, frame),
    weather,
    windninja,
    fallback: { hours, grids: fbGrids },
    warnings,
  };
}

const pad = (h: number) => String(h).padStart(2, '0');

// ---------------------------------------------------------------- live

export async function backendHealthy(timeoutMs = 3000): Promise<{ ok: boolean; windninja: boolean }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const j = await fetchJson<{ ok: boolean; windninja: boolean }>(`${API}/api/health`, { signal: ctl.signal });
    return { ok: !!j.ok, windninja: !!j.windninja };
  } catch {
    return { ok: false, windninja: false };
  } finally {
    clearTimeout(timer);
  }
}

interface AreaResponse {
  areaId: string;
  overviewMeta: GridMeta;
  detailMeta: GridMeta;
}

async function pollJob(jobId: string, onProgress: Progress): Promise<{ source?: string; method?: string; hours?: number[] }> {
  for (;;) {
    const j = await fetchJson<{ status: string; progress: number; message: string; result: { source?: string; method?: string; hours?: number[] } }>(`${API}/api/jobs/${jobId}`);
    onProgress(0.55 + 0.35 * j.progress, j.message || 'Computing wind');
    if (j.status === 'done') return j.result ?? {};
    if (j.status === 'failed') throw new Error(j.message);
    await new Promise((r) => setTimeout(r, 700));
  }
}

/**
 * Live mode: same scenario as the demo config, data computed by the backend.
 * `detailCenter` (lat, lon) moves the focus segment ("Compute detail").
 */
export async function loadLive(onProgress: Progress = () => {}, detailCenter?: [number, number]): Promise<AreaBundle> {
  onProgress(0.02, 'Contacting backend');
  const base = await loadConfig();
  const area = await fetchJson<AreaResponse>(`${API}/api/areas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat: base.lat, lon: base.lon, timezone: base.timezone, detailCenter }),
  });
  const om = area.overviewMeta;
  const dm = area.detailMeta;
  const id = area.areaId;
  const frame = frameOf(dm);
  const nd = cells(dm);
  onProgress(0.1, 'Fetching terrain (USGS 3DEP)');
  const [to, td] = await Promise.all([
    fetchBin(`${API}/api/areas/${id}/terrain?level=overview`, cells(om) * 4).then((r) => new Float32Array(r.buf)),
    fetchBin(`${API}/api/areas/${id}/terrain?level=detail`, nd * 4).then((r) => new Float32Array(r.buf)),
  ]);
  onProgress(0.3, 'Fetching land cover & OpenStreetMap features');
  const [lo, ld, feats, weather] = await Promise.all([
    fetchBin(`${API}/api/areas/${id}/landcover?level=overview`, cells(om)).then((r) => new Uint8Array(r.buf)),
    fetchBin(`${API}/api/areas/${id}/landcover?level=detail`, nd).then((r) => new Uint8Array(r.buf)),
    fetchJson<{ features: GeoFeature[] }>(`${API}/api/areas/${id}/features`),
    fetchJson<Weather>(`${API}/api/areas/${id}/weather?date=${base.date}`),
  ]);
  onProgress(0.5, 'Starting wind job');
  const hours = base.windHours;
  const job = await fetchJson<{ jobId: string }>(`${API}/api/areas/${id}/wind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: base.date, startHour: hours[0], endHour: hours[hours.length - 1], stepHours: 1 }),
  });
  const res = await pollJob(job.jobId, onProgress);
  onProgress(0.92, 'Downloading wind grids');
  const fbGrids = await Promise.all(hours.map((h) => fetchBin(`${API}/api/areas/${id}/wind/fallback?date=${base.date}&hour=${h}`, nd * 8).then((r) => splitWind(r.buf, nd))));
  let windninja: WindField | null = null;
  const warnings: string[] = [];
  if (res.source === 'windninja') {
    const wn = await Promise.all(
      hours.map((h) =>
        fetchBin(`${API}/api/areas/${id}/wind?date=${base.date}&hour=${h}`, nd * 8).then((r) => ({ src: r.headers.get('X-Wind-Source'), g: splitWind(r.buf, nd) })),
      ),
    );
    if (wn.every((w) => w.src === 'windninja')) windninja = { hours, grids: wn.map((w) => w.g) };
    else warnings.push('WindNinja did not produce every hour; using fallback wind.');
  } else {
    warnings.push('WindNinja unavailable on the backend; using fallback wind.');
  }
  onProgress(1, 'Ready');
  const config: AreaConfig = {
    ...base,
    areaId: id,
    overviewMeta: om,
    detailMeta: dm,
    focus: { x: frame.cx, y: frame.cy, size: dm.cols * dm.cellSize },
    windSource: windninja ? 'windninja' : 'fallback',
    windMethod: res.method,
  };
  return {
    mode: 'live',
    config,
    frame,
    overview: { meta: om, elev: to, landcover: lo },
    detail: { meta: dm, elev: td, landcover: ld },
    features: featuresToLocal(feats, frame),
    weather,
    windninja,
    fallback: { hours, grids: fbGrids },
    warnings,
  };
}
