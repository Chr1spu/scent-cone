/** Wind access: hourly u/v grids on the detail grid, bilinear in space, linear in time.
 *  Also the frontend mirror of the fallback slope-wind model (backend/app/slopewind.py). */
import { ENSEMBLE, SLOPE_WIND } from '../config/modelParams';
import { boxBlur, gradients, smoothstep, type GridMap } from '../geo/grid';
import type { Rng } from './rng';

export interface WindHour {
  u: Float32Array;
  v: Float32Array;
}

export interface WindField {
  /** sorted local hours, e.g. [14, 15, ..., 22] */
  hours: number[];
  grids: WindHour[];
}

/** Meteorological "from" direction (deg clockwise from north) -> (u east, v north). */
export function metToUV(speed: number, dirDeg: number): { u: number; v: number } {
  const r = (dirDeg * Math.PI) / 180;
  return { u: -speed * Math.sin(r), v: -speed * Math.cos(r) };
}

/** (u, v) -> meteorological speed and "from" direction. */
export function uvToMet(u: number, v: number): { speed: number; dir: number } {
  const speed = Math.hypot(u, v);
  const dir = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
  return { speed, dir };
}

export interface TimeSlot {
  i0: number;
  i1: number;
  w: number;
}

export function timeSlot(field: WindField, t: number): TimeSlot {
  const hs = field.hours;
  if (t <= hs[0]) return { i0: 0, i1: 0, w: 0 };
  if (t >= hs[hs.length - 1]) return { i0: hs.length - 1, i1: hs.length - 1, w: 0 };
  let i = 0;
  while (i < hs.length - 2 && hs[i + 1] <= t) i++;
  return { i0: i, i1: i + 1, w: (t - hs[i]) / (hs[i + 1] - hs[i]) };
}

/** Writes (u, v) at fractional cell coords into out[0], out[1]. Hot path: no allocation. */
export function sampleUVFrac(field: WindField, slot: TimeSlot, cols: number, rows: number, fc: number, fr: number, out: Float32Array | number[]): void {
  if (fc < 0) fc = 0;
  else if (fc > cols - 1) fc = cols - 1;
  if (fr < 0) fr = 0;
  else if (fr > rows - 1) fr = rows - 1;
  let c0 = fc | 0;
  let r0 = fr | 0;
  if (c0 >= cols - 1) c0 = cols - 2;
  if (r0 >= rows - 1) r0 = rows - 2;
  const tc = fc - c0;
  const tr = fr - r0;
  const i = r0 * cols + c0;
  const w00 = (1 - tc) * (1 - tr);
  const w01 = tc * (1 - tr);
  const w10 = (1 - tc) * tr;
  const w11 = tc * tr;
  const a = field.grids[slot.i0];
  let u = a.u[i] * w00 + a.u[i + 1] * w01 + a.u[i + cols] * w10 + a.u[i + cols + 1] * w11;
  let v = a.v[i] * w00 + a.v[i + 1] * w01 + a.v[i + cols] * w10 + a.v[i + cols + 1] * w11;
  if (slot.w > 0) {
    const b = field.grids[slot.i1];
    const ub = b.u[i] * w00 + b.u[i + 1] * w01 + b.u[i + cols] * w10 + b.u[i + cols + 1] * w11;
    const vb = b.v[i] * w00 + b.v[i + 1] * w01 + b.v[i + cols] * w10 + b.v[i + cols + 1] * w11;
    u += (ub - u) * slot.w;
    v += (vb - v) * slot.w;
  }
  out[0] = u;
  out[1] = v;
}

/** sampleWind(x, y, t) -> {u, v}: bilinear in space, linear in time (local coords). */
export function sampleWind(field: WindField, m: GridMap, lx: number, ly: number, t: number): { u: number; v: number } {
  const out = [0, 0];
  sampleUVFrac(field, timeSlot(field, t), m.cols, m.rows, lx * m.inv + m.ox, -ly * m.inv + m.oy, out);
  return { u: out[0], v: out[1] };
}

/** Full-grid blend at time t (for rendering / statistics). */
export function blendField(field: WindField, t: number, outU: Float32Array, outV: Float32Array): void {
  const s = timeSlot(field, t);
  const a = field.grids[s.i0];
  const b = field.grids[s.i1];
  for (let i = 0; i < outU.length; i++) {
    outU[i] = a.u[i] + (b.u[i] - a.u[i]) * s.w;
    outV[i] = a.v[i] + (b.v[i] - a.v[i]) * s.w;
  }
}

export interface EnsembleMember {
  cos: number;
  sin: number;
  scale: number;
}

export const IDENTITY_MEMBER: EnsembleMember = { cos: 1, sin: 0, scale: 1 };

/** Ensemble perturbation: rotate by U(-20°, 20°), scale speed by U(0.7, 1.3). */
export function makeMember(rng: Rng): EnsembleMember {
  const d = (rng.uniform(-ENSEMBLE.rotDeg, ENSEMBLE.rotDeg) * Math.PI) / 180;
  return { cos: Math.cos(d), sin: Math.sin(d), scale: rng.uniform(ENSEMBLE.scaleMin, ENSEMBLE.scaleMax) };
}

export function perturb(m: EnsembleMember, uv: Float32Array | number[]): void {
  const u = uv[0];
  const v = uv[1];
  uv[0] = m.scale * (u * m.cos - v * m.sin);
  uv[1] = m.scale * (u * m.sin + v * m.cos);
}

// ---------------------------------------------------------------- fallback model

export interface TerrainGradients {
  gx: Float32Array;
  gy: Float32Array;
}

/** Gradients of the smoothed DEM, matching backend terrain_gradients(). */
export function smoothedGradients(elev: Float32Array, cols: number, rows: number, cell: number): TerrainGradients {
  let z = elev;
  for (let p = 0; p < SLOPE_WIND.smoothPasses; p++) z = boxBlur(z, cols, rows, SLOPE_WIND.smoothRadius);
  return gradients(z, cols, rows, cell);
}

/**
 * wind = forecastWind(×0.7 to 2 m) + weight · min(k·slope, cap) · dir, where dir is downhill at
 * night and uphill on sun-facing slopes by day, blended smoothly by sun elevation.
 */
export function computeFallbackWind(
  grads: TerrainGradients,
  forecastSpeed: number,
  forecastDir: number,
  sunElevDeg: number,
  sunAzDeg: number,
): WindHour {
  const p = SLOPE_WIND;
  const { gx, gy } = grads;
  const n = gx.length;
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const se = (sunElevDeg * Math.PI) / 180;
  const sa = (sunAzDeg * Math.PI) / 180;
  const sx = Math.cos(se) * Math.sin(sa);
  const sy = Math.cos(se) * Math.cos(sa);
  const sz = Math.sin(se);
  const day = smoothstep(p.nightSunElev, p.daySunElev, sunElevDeg);
  const weight = forecastSpeed < p.calmForecast ? 1 : Math.max(p.minSlopeWeight, p.calmForecast / forecastSpeed);
  const f = metToUV(forecastSpeed * p.forecastTo2m, forecastDir);
  for (let i = 0; i < n; i++) {
    const ax = gx[i];
    const ay = gy[i];
    const slope = Math.sqrt(ax * ax + ay * ay);
    const inv = 1 / Math.max(slope, 1e-6);
    const upx = ax * inv;
    const upy = ay * inv;
    const ndot = (-ax * sx - ay * sy + sz) / Math.sqrt(ax * ax + ay * ay + 1);
    const sunfacing = smoothstep(p.sunFacingDot - 0.1, p.sunFacingDot + 0.1, ndot);
    const dx = (1 - day) * -upx + day * sunfacing * upx;
    const dy = (1 - day) * -upy + day * sunfacing * upy;
    const mag = Math.min(p.k * slope, p.cap) * weight;
    u[i] = f.u + mag * dx;
    v[i] = f.v + mag * dy;
  }
  return { u, v };
}

/** Mean wind over the grid (for badges / arrows). */
export function meanWind(h: WindHour): { u: number; v: number } {
  let su = 0;
  let sv = 0;
  for (let i = 0; i < h.u.length; i++) {
    su += h.u[i];
    sv += h.v[i];
  }
  return { u: su / h.u.length, v: sv / h.u.length };
}
