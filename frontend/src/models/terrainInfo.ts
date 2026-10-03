/** Static per-cell terrain attributes used by the scent and deployment models. */
import { NOSE, SCENT } from '../config/modelParams';
import { gradients, gridMap, type Frame, type GridMap, type GridMeta } from '../geo/grid';

export const LC = { unknown: 0, water: 1, open: 2, shrub: 3, forest: 4, developed: 5, wetland: 6 } as const;

/** Coarser surrounding terrain used to find ridges that shade the detail grid. */
export interface Horizon {
  elev: Float32Array;
  map: GridMap;
}

export interface TerrainInfo {
  meta: GridMeta;
  map: GridMap;
  elev: Float32Array;
  landcover: Uint8Array;
  /** unit surface normals (east, north, up) */
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
  slopeDeg: Float32Array;
  localLow: Uint8Array;
  /** wind at nose height as a fraction of the 2 m model wind */
  noseFactor: Float32Array;
  horizon?: Horizon;
  maxElev: number;
  /** cache of sunlit masks keyed by quantised sun position */
  sunCache: Map<string, Uint8Array>;
}

/** Nose-height / 2 m wind ratio for a land-cover class (log profile, or canopy attenuation). */
export function noseWindFactor(lc: number): number {
  if (lc === LC.forest) return NOSE.forestFactor;
  const z0 =
    lc === LC.water ? NOSE.z0.water : lc === LC.wetland ? NOSE.z0.wetland : lc === LC.shrub ? NOSE.z0.shrub : lc === LC.developed ? NOSE.z0.developed : NOSE.z0.open;
  return Math.log(NOSE.heightM / z0) / Math.log(NOSE.refHeightM / z0);
}

export function buildTerrainInfo(meta: GridMeta, frame: Frame, elev: Float32Array, landcover: Uint8Array, horizon?: { meta: GridMeta; elev: Float32Array }): TerrainInfo {
  const { cols, rows, cellSize } = meta;
  const { gx, gy } = gradients(elev, cols, rows, cellSize);
  const n = elev.length;
  const nx = new Float32Array(n);
  const ny = new Float32Array(n);
  const nz = new Float32Array(n);
  const slopeDeg = new Float32Array(n);
  const noseFactor = new Float32Array(n);
  const lut = new Float32Array(8);
  for (let k = 0; k < 8; k++) lut[k] = noseWindFactor(k);
  let maxElev = -Infinity;
  for (let i = 0; i < n; i++) {
    const l = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i] + 1);
    nx[i] = -gx[i] / l;
    ny[i] = -gy[i] / l;
    nz[i] = 1 / l;
    slopeDeg[i] = (Math.atan(Math.hypot(gx[i], gy[i])) * 180) / Math.PI;
    noseFactor[i] = lut[landcover[i] & 7];
    if (elev[i] > maxElev) maxElev = elev[i];
  }
  const localLow = new Uint8Array(n);
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c;
      const z = elev[i];
      let lower = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (z < elev[i + dr * cols + dc]) lower++;
        }
      localLow[i] = lower >= SCENT.localLowNeighbours ? 1 : 0;
    }
  }
  let hz: Horizon | undefined;
  if (horizon) {
    hz = { elev: horizon.elev, map: gridMap(horizon.meta, frame) };
    for (const v of horizon.elev) if (v > maxElev) maxElev = v;
  }
  return { meta, map: gridMap(meta, frame), elev, landcover, nx, ny, nz, slopeDeg, localLow, noseFactor, horizon: hz, maxElev, sunCache: new Map() };
}

const SHADOW_STRIDE = 2; // compute shadows every 2nd cell (20 m), nearest-neighbour fill
const SHADOW_STEP_M = 30;
const SHADOW_MAX_M = 5000;

function elevNearest(ti: TerrainInfo, x: number, y: number): number {
  const m = ti.map;
  const c = Math.round(x * m.inv + m.ox);
  const r = Math.round(-y * m.inv + m.oy);
  if (c >= 0 && r >= 0 && c < m.cols && r < m.rows) return ti.elev[r * m.cols + c];
  const h = ti.horizon;
  if (!h) return -Infinity;
  const c2 = Math.round(x * h.map.inv + h.map.ox);
  const r2 = Math.round(-y * h.map.inv + h.map.oy);
  if (c2 >= 0 && r2 >= 0 && c2 < h.map.cols && r2 < h.map.rows) return h.elev[r2 * h.map.cols + c2];
  return -Infinity;
}

/** Cast-shadow mask (1 = a ridge blocks the sun) by marching from each cell toward the sun. */
export function shadowMask(ti: TerrainInfo, sunDir: [number, number, number]): Uint8Array {
  const m = ti.map;
  const out = new Uint8Array(ti.elev.length);
  const horiz = Math.hypot(sunDir[0], sunDir[1]) || 1e-9;
  const dx = sunDir[0] / horiz;
  const dy = sunDir[1] / horiz;
  const rise = sunDir[2] / horiz; // metres up per metre along the ground
  const cs = 1 / m.inv;
  for (let r = 0; r < m.rows; r += SHADOW_STRIDE) {
    for (let c = 0; c < m.cols; c += SHADOW_STRIDE) {
      const i = r * m.cols + c;
      const x0 = (c - m.ox) * cs;
      const y0 = -(r - m.oy) * cs;
      const z0 = ti.elev[i] + NOSE.heightM;
      let shaded = 0;
      for (let d = SHADOW_STEP_M; d <= SHADOW_MAX_M; d += SHADOW_STEP_M) {
        const ray = z0 + d * rise;
        if (ray > ti.maxElev) break;
        if (elevNearest(ti, x0 + dx * d, y0 + dy * d) > ray) {
          shaded = 1;
          break;
        }
      }
      for (let rr = r; rr < Math.min(r + SHADOW_STRIDE, m.rows); rr++)
        for (let cc = c; cc < Math.min(c + SHADOW_STRIDE, m.cols); cc++) out[rr * m.cols + cc] = shaded;
    }
  }
  return out;
}

/**
 * Per-cell sunlit flag: sun above the horizon, slope faces it, and no ridge casts a shadow.
 * Cached per quantised sun position (0.5°), so ensembles reuse it across members.
 */
export function sunlitMask(ti: TerrainInfo, sunDir: [number, number, number], out?: Uint8Array): Uint8Array {
  const n = ti.elev.length;
  const m = out ?? new Uint8Array(n);
  if (sunDir[2] <= 0) {
    m.fill(0);
    return m;
  }
  const el = Math.round(((Math.asin(Math.min(1, sunDir[2])) * 180) / Math.PI) * 2);
  const az = Math.round(((Math.atan2(sunDir[0], sunDir[1]) * 180) / Math.PI) * 2);
  const key = `${el},${az}`;
  let cached = ti.sunCache.get(key);
  if (!cached) {
    const shadow = shadowMask(ti, sunDir);
    cached = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      cached[i] = !shadow[i] && ti.nx[i] * sunDir[0] + ti.ny[i] * sunDir[1] + ti.nz[i] * sunDir[2] > 0.05 ? 1 : 0;
    }
    if (ti.sunCache.size > 200) ti.sunCache.clear();
    ti.sunCache.set(key, cached);
  }
  m.set(cached);
  return m;
}
