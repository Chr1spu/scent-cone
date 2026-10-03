/**
 * Source models other than "distance from a last known point": where the target can be for
 * training hides, a drawn search area, water searches and habitat surveys. All work on the
 * 10 m detail grid and return a probability map that sums to 1 (or null if empty).
 */
import type { HabitatSpec } from '../config/missions';
import { cellCenterLocal, type GridMap } from '../geo/grid';
import { logNormalPdf, normalize } from './probability';
import { sectorContains, type SearchedSector } from './searchUpdate';
import { LC } from './terrainInfo';

function finish(p: Float32Array): Float32Array | null {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += p[i];
  return s > 0 ? normalize(p) : null;
}

/** Training hides: a tight Gaussian (σ ≈ 15 m) at each hide, equal weight per hide. */
export function hidesPrior(m: GridMap, hides: [number, number][], sigmaM = 15): Float32Array | null {
  const n = m.cols * m.rows;
  const p = new Float32Array(n);
  if (hides.length === 0) return null;
  const inv2s2 = 1 / (2 * sigmaM * sigmaM);
  const cs = 1 / m.inv;
  const reach = Math.ceil((4 * sigmaM) / cs);
  for (const [hx, hy] of hides) {
    const c0 = Math.round(hx * m.inv + m.ox);
    const r0 = Math.round(-hy * m.inv + m.oy);
    const part = new Float32Array(n);
    for (let r = r0 - reach; r <= r0 + reach; r++) {
      if (r < 0 || r >= m.rows) continue;
      for (let c = c0 - reach; c <= c0 + reach; c++) {
        if (c < 0 || c >= m.cols) continue;
        const i = r * m.cols + c;
        const [x, y] = cellCenterLocal(m, i);
        part[i] = Math.exp(-((x - hx) ** 2 + (y - hy) ** 2) * inv2s2);
      }
    }
    const one = finish(part);
    if (one) for (let i = 0; i < n; i++) p[i] += one[i];
  }
  return finish(p);
}

/**
 * A drawn area (evidence, debris field): uniform inside, less on steep ground, none on water.
 * `lowGroundBias` > 0 favours the lower part of the area (debris and people end up there).
 */
export function areaPrior(m: GridMap, sector: SearchedSector, elev: Float32Array, slopeDeg: Float32Array, water: Uint8Array, lowGroundBias = 0): Float32Array | null {
  const n = m.cols * m.rows;
  const p = new Float32Array(n);
  const inside: number[] = [];
  let zmin = Infinity;
  let zmax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (water[i]) continue;
    const [x, y] = cellCenterLocal(m, i);
    if (!sectorContains(sector, x, y)) continue;
    inside.push(i);
    zmin = Math.min(zmin, elev[i]);
    zmax = Math.max(zmax, elev[i]);
  }
  const span = Math.max(zmax - zmin, 1);
  for (const i of inside) {
    let w = Math.exp(-slopeDeg[i] / 45);
    if (lowGroundBias) w *= Math.exp(lowGroundBias * 2 * (1 - (elev[i] - zmin) / span));
    p[i] = w;
  }
  return finish(p);
}

/**
 * Water search: water cells only, weighted by a log-normal of distance from where the person
 * went in (median ~80 m: drowning victims are usually found close to the point last seen).
 */
export function waterPrior(m: GridMap, water: Uint8Array, lkp: [number, number], medianM = 80, spread = 0.8): Float32Array | null {
  const n = m.cols * m.rows;
  const p = new Float32Array(n);
  const cs = 1 / m.inv;
  for (let i = 0; i < n; i++) {
    if (!water[i]) continue;
    const [x, y] = cellCenterLocal(m, i);
    const d = Math.max(Math.hypot(x - lkp[0], y - lkp[1]), cs);
    p[i] = logNormalPdf(d, medianM, spread) / d;
  }
  return finish(p);
}

/**
 * Habitat survey: suitability from chosen land-cover classes, a slope limit and (optionally)
 * closeness to streams. Gentle ground and stream edges score higher.
 */
export function habitatPrior(landcover: Uint8Array, slopeDeg: Float32Array, streamDist: Float32Array, spec: HabitatSpec): Float32Array | null {
  const n = landcover.length;
  const p = new Float32Array(n);
  const classes = new Set(spec.classes);
  for (let i = 0; i < n; i++) {
    if (landcover[i] === LC.water || !classes.has(landcover[i])) continue;
    if (slopeDeg[i] > spec.maxSlopeDeg) continue;
    let w = 1 - (0.5 * slopeDeg[i]) / Math.max(spec.maxSlopeDeg, 1);
    if (spec.nearStreamM > 0) {
      if (streamDist[i] > spec.nearStreamM) continue;
      w *= 1 + 1 - streamDist[i] / spec.nearStreamM;
    }
    p[i] = w;
  }
  return finish(p);
}

/** Detail probability summed into overview cells (for display outside the focus square). */
export function aggregateToOverview(detail: Float32Array, detailMap: GridMap, ovMap: GridMap): Float32Array {
  const out = new Float32Array(ovMap.cols * ovMap.rows);
  for (let i = 0; i < detail.length; i++) {
    if (detail[i] === 0) continue;
    const [x, y] = cellCenterLocal(detailMap, i);
    const c = Math.round(x * ovMap.inv + ovMap.ox);
    const r = Math.round(-y * ovMap.inv + ovMap.oy);
    if (c >= 0 && r >= 0 && c < ovMap.cols && r < ovMap.rows) out[r * ovMap.cols + c] += detail[i];
  }
  return out;
}
