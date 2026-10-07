/**
 * Probability map (CLAUDE.md §8.1): where the person might be, per overview cell, summing to 1.
 * distance prior (log-normal) × linear features × barriers × slope × (water = 0), plus brush edits.
 */
import { DISPERSION, PROBABILITY, TERRAIN, type ProfileParams } from '../config/modelParams';
import { boxBlur, cellAt, cellCenterLocal, slopeDegrees, type GridMap, type GridMeta } from '../geo/grid';
import { LC } from './terrainInfo';

export type FeatureKind = 'trail' | 'road' | 'stream' | 'river' | 'lake' | 'cliff';

/** A feature in local coordinates (metres from the frame centre). */
export interface Feature2D {
  kind: FeatureKind;
  polygon: boolean;
  xs: Float64Array;
  ys: Float64Array;
  name?: string | null;
}

export interface StaticLayers {
  /** distance (m) to nearest trail/road/stream */
  featureDist: Float32Array;
  /** distance (m) to the nearest feature of each kind (terrain model) */
  trailDist: Float32Array;
  roadDist: Float32Array;
  streamDist: Float32Array;
  lakeDist: Float32Array;
  /** percentile rank (0–1) of tpi in the area: high = low-lying, low = high points */
  tpiPct: Float32Array;
  /** water cells (land cover water, lakes, rivers) */
  water: Uint8Array;
  /** cells that are costly to cross (water or cliff) */
  barrier: Uint8Array;
  slopeDeg: Float32Array;
  /** topographic position: mean elevation within ~300 m minus own elevation (m); > 0 in valleys */
  tpi: Float32Array;
  landcover: Uint8Array;
}

// ---------------------------------------------------------------- rasterisation

export function rasterizeLines(feats: Feature2D[], m: GridMap, out: Uint8Array): void {
  const step = 0.5 / m.inv;
  for (const f of feats) {
    for (let k = 0; k + 1 < f.xs.length; k++) {
      const x0 = f.xs[k];
      const y0 = f.ys[k];
      const dx = f.xs[k + 1] - x0;
      const dy = f.ys[k + 1] - y0;
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / step));
      for (let s = 0; s <= n; s++) {
        const idx = cellAt(m, x0 + (dx * s) / n, y0 + (dy * s) / n);
        if (idx >= 0) out[idx] = 1;
      }
    }
  }
}

/** Even-odd scanline fill of polygons at cell centres. */
export function rasterizePolygons(feats: Feature2D[], m: GridMap, out: Uint8Array): void {
  const xsInt: number[] = [];
  for (const f of feats) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < f.ys.length; k++) {
      minY = Math.min(minY, f.ys[k]);
      maxY = Math.max(maxY, f.ys[k]);
    }
    const r0 = Math.max(0, Math.floor(-maxY * m.inv + m.oy));
    const r1 = Math.min(m.rows - 1, Math.ceil(-minY * m.inv + m.oy));
    for (let r = r0; r <= r1; r++) {
      const y = -(r - m.oy) / m.inv;
      xsInt.length = 0;
      const n = f.xs.length;
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n;
        const ya = f.ys[k];
        const yb = f.ys[j];
        if (ya <= y !== yb <= y) xsInt.push(f.xs[k] + ((y - ya) / (yb - ya)) * (f.xs[j] - f.xs[k]));
      }
      xsInt.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xsInt.length; q += 2) {
        const c0 = Math.max(0, Math.ceil(xsInt[q] * m.inv + m.ox));
        const c1 = Math.min(m.cols - 1, Math.floor(xsInt[q + 1] * m.inv + m.ox));
        for (let c = c0; c <= c1; c++) out[r * m.cols + c] = 1;
      }
    }
  }
}

/** Two-pass chamfer distance transform (metres) from cells where mask = 1. */
export function distanceTransform(mask: Uint8Array, cols: number, rows: number, cell: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(mask.length);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  const a = cell;
  const b = cell * Math.SQRT2;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let v = d[i];
      if (c > 0) v = Math.min(v, d[i - 1] + a);
      if (r > 0) {
        v = Math.min(v, d[i - cols] + a);
        if (c > 0) v = Math.min(v, d[i - cols - 1] + b);
        if (c < cols - 1) v = Math.min(v, d[i - cols + 1] + b);
      }
      d[i] = v;
    }
  for (let r = rows - 1; r >= 0; r--)
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      let v = d[i];
      if (c < cols - 1) v = Math.min(v, d[i + 1] + a);
      if (r < rows - 1) {
        v = Math.min(v, d[i + cols] + a);
        if (c < cols - 1) v = Math.min(v, d[i + cols + 1] + b);
        if (c > 0) v = Math.min(v, d[i + cols - 1] + b);
      }
      d[i] = v;
    }
  return d;
}

export function buildStaticLayers(meta: GridMeta, m: GridMap, elev: Float32Array, landcover: Uint8Array, feats: Feature2D[]): StaticLayers {
  const n = meta.cols * meta.rows;
  const linear = new Uint8Array(n);
  rasterizeLines(feats.filter((f) => f.kind === 'trail' || f.kind === 'road' || f.kind === 'stream'), m, linear);
  const featureDist = distanceTransform(linear, meta.cols, meta.rows, meta.cellSize);
  const water = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (landcover[i] === LC.water) water[i] = 1;
  rasterizePolygons(feats.filter((f) => f.kind === 'lake' && f.polygon), m, water);
  rasterizeLines(feats.filter((f) => f.kind === 'river'), m, water);
  const barrier = water.slice();
  rasterizeLines(feats.filter((f) => f.kind === 'cliff'), m, barrier);
  const radius = Math.max(1, Math.round(150 / meta.cellSize));
  const mean = boxBlur(boxBlur(elev, meta.cols, meta.rows, radius), meta.cols, meta.rows, radius);
  const tpi = new Float32Array(n);
  for (let i = 0; i < n; i++) tpi[i] = mean[i] - elev[i];
  const distTo = (kinds: FeatureKind[]) => {
    const g = new Uint8Array(n);
    rasterizeLines(feats.filter((f) => kinds.includes(f.kind) && !f.polygon), m, g);
    return distanceTransform(g, meta.cols, meta.rows, meta.cellSize);
  };
  const lakes = new Uint8Array(n);
  rasterizePolygons(feats.filter((f) => f.kind === 'lake' && f.polygon), m, lakes);
  for (let i = 0; i < n; i++) if (landcover[i] === LC.water) lakes[i] = 1;
  return {
    featureDist,
    trailDist: distTo(['trail']),
    roadDist: distTo(['road']),
    streamDist: distTo(['stream', 'river']),
    lakeDist: distanceTransform(lakes, meta.cols, meta.rows, meta.cellSize),
    tpiPct: percentRank(tpi),
    water,
    barrier,
    slopeDeg: slopeDegrees(elev, meta.cols, meta.rows, meta.cellSize),
    tpi,
    landcover,
  };
}

/** Percentile rank (0–1) of every value; ties share their lowest rank. */
export function percentRank(a: Float32Array): Float32Array {
  const idx = Array.from(a.keys()).sort((x, y) => a[x] - a[y]);
  const out = new Float32Array(a.length);
  const n = Math.max(1, a.length - 1);
  let k = 0;
  while (k < idx.length) {
    let j = k;
    while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[k]]) j++;
    for (let q = k; q <= j; q++) out[idx[q]] = k / n;
    k = j + 1;
  }
  return out;
}

/** Soft track-offset membership: 1 within the offset, decaying over one more offset beyond it. */
function near(d: number, w: number): number {
  return d <= w ? 1 : Math.exp(-(d - w) / Math.max(w, 1));
}

/** Terrain multiplier at cell i (TERRAIN, Jacobs 2015): the largest feature effect that applies. */
export function terrainFactor(layers: StaticLayers, i: number, trackOffsetM: number, cellSize: number): number {
  // a cell's own feature is up to half a cell away
  const w = Math.max(trackOffsetM, cellSize / 2);
  const T = TERRAIN;
  const gT = near(layers.trailDist[i], w);
  const gS = near(layers.streamDist[i], w);
  let f = 1 + (T.trail - 1) * gT;
  f = Math.max(f, 1 + (T.road - 1) * near(layers.roadDist[i], w));
  f = Math.max(f, 1 + (T.stream - 1) * gS);
  if (!layers.water[i]) f = Math.max(f, 1 + (T.lake - 1) * near(layers.lakeDist[i], w));
  const wi = Math.max(T.trailStreamM, cellSize / 2);
  f = Math.max(f, 1 + (T.trailStream - 1) * near(layers.trailDist[i], wi) * near(layers.streamDist[i], wi));
  if (layers.tpiPct[i] >= T.lowPct && layers.tpi[i] >= T.minReliefM) f = Math.max(f, T.low);
  if (layers.tpiPct[i] <= T.highPct && layers.tpi[i] <= -T.minReliefM) f = Math.max(f, T.high);
  return f;
}

/** Relative weight (mean 1 over 0–180°) of a find at angle `diff` (deg) off the direction of travel. */
export function dispersionWeight(diffDeg: number): number {
  const c = DISPERSION.cdf;
  const d = Math.min(180, Math.abs(diffDeg));
  for (let k = 1; k < c.length; k++) if (d <= c[k][0]) return ((c[k][1] - c[k - 1][1]) / (c[k][0] - c[k - 1][0])) * 180;
  return 1;
}

// ---------------------------------------------------------------- barriers (cost-distance)

/** Least-cost distance (m) from a start cell, 8-connected; barrier cells cost `barrierCost`×. */
export function costDistance(barrier: Uint8Array, cols: number, rows: number, cell: number, start: number, barrierCost: number): Float64Array {
  const n = cols * rows;
  const dist = new Float64Array(n).fill(Infinity);
  // binary heap of (key, idx) with lazy deletion
  let size = 0;
  let cap = 1 << 16;
  let keys = new Float64Array(cap);
  let ids = new Int32Array(cap);
  const push = (k: number, id: number) => {
    if (size === cap) {
      cap *= 2;
      const nk = new Float64Array(cap);
      nk.set(keys);
      keys = nk;
      const ni = new Int32Array(cap);
      ni.set(ids);
      ids = ni;
    }
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      keys[i] = keys[p];
      ids[i] = ids[p];
      i = p;
    }
    keys[i] = k;
    ids[i] = id;
  };
  const pop = (): number => {
    const top = ids[0];
    const k = keys[--size];
    const id = ids[size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= size) break;
      if (c + 1 < size && keys[c + 1] < keys[c]) c++;
      if (keys[c] >= k) break;
      keys[i] = keys[c];
      ids[i] = ids[c];
      i = c;
    }
    keys[i] = k;
    ids[i] = id;
    return top;
  };
  dist[start] = 0;
  push(0, start);
  const DC = [-1, 0, 1, -1, 1, -1, 0, 1];
  const DR = [-1, -1, -1, 0, 0, 1, 1, 1];
  while (size > 0) {
    const k = keys[0];
    const i = pop();
    if (k > dist[i]) continue;
    const r = (i / cols) | 0;
    const c = i - r * cols;
    const wi = barrier[i] ? barrierCost : 1;
    for (let q = 0; q < 8; q++) {
      const rr = r + DR[q];
      const cc = c + DC[q];
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
      const j = rr * cols + cc;
      const len = (DR[q] !== 0 && DC[q] !== 0 ? Math.SQRT2 : 1) * cell;
      const wj = barrier[j] ? barrierCost : 1;
      const nd = k + len * 0.5 * (wi + wj);
      if (nd < dist[j]) {
        dist[j] = nd;
        push(nd, j);
      }
    }
  }
  return dist;
}

/** ×0.2 for cells only reachable by crossing water/cliffs (large detour ratio), 1 otherwise. */
export function barrierFactor(layers: StaticLayers, meta: GridMeta, m: GridMap, lkp: [number, number]): Float32Array {
  const n = meta.cols * meta.rows;
  const out = new Float32Array(n).fill(1);
  let start = cellAt(m, lkp[0], lkp[1]);
  if (start < 0) return out;
  const startBarrier = layers.barrier[start];
  const barrier = layers.barrier;
  if (startBarrier) {
    // LKP on a water/cliff cell (e.g. a bridge): don't penalise leaving it
    barrier[start] = 0;
  }
  const cd = costDistance(barrier, meta.cols, meta.rows, meta.cellSize, start, PROBABILITY.barrierCost);
  barrier[start] = startBarrier;
  const { barrierRatioLo: lo, barrierRatioHi: hi, barrierFactor: f } = PROBABILITY;
  for (let i = 0; i < n; i++) {
    const [x, y] = cellCenterLocal(m, i);
    const e = Math.max(Math.hypot(x - lkp[0], y - lkp[1]), meta.cellSize * 3);
    const ratio = cd[i] / e;
    const t = Math.min(Math.max((ratio - lo) / (hi - lo), 0), 1);
    out[i] = 1 - (1 - f) * t;
  }
  return out;
}

// ---------------------------------------------------------------- probability

export function logNormalPdf(d: number, median: number, spread: number): number {
  const z = (Math.log(d) - Math.log(median)) / spread;
  return Math.exp(-0.5 * z * z) / (d * spread * Math.sqrt(2 * Math.PI));
}

export function normalize(p: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += p[i];
  if (s > 0) for (let i = 0; i < p.length; i++) p[i] /= s;
  return p;
}

export interface ProbabilityInput {
  meta: GridMeta;
  map: GridMap;
  layers: StaticLayers;
  barrier: Float32Array;
  lkp: [number, number];
  profile: ProfileParams;
  /** optional multiplicative brush edits, same grid */
  edits?: Float32Array;
  /** weight low ground: × e^(bias · clamp(TPI / 40 m, ±1.5)) (cadaver, debris) */
  lowGroundBias?: number;
  /** hours since the person went missing (time-since-missing limit); omitted = no limit */
  elapsedH?: number;
  /** intended direction of travel (degrees from north), if known */
  travelDirDeg?: number | null;
}

/** Furthest straight-line distance (m) the profile could plausibly have covered; Infinity = no limit. */
export function travelReachM(profile: ProfileParams, elapsedH: number | undefined): number {
  if (elapsedH === undefined || !profile.maxSpeedKmh) return Infinity;
  return profile.maxSpeedKmh * 1000 * Math.max(elapsedH, PROBABILITY.travelMinH);
}

/** Soft cut-off on distance: ~1 well inside the reach, 0.5 at it, ~0 well beyond. */
export function travelFactor(d: number, reachM: number): number {
  if (!Number.isFinite(reachM)) return 1;
  return 1 / (1 + Math.exp((d - reachM) / (PROBABILITY.travelSoftness * reachM)));
}

/** Whether the time limit changes the map at all (reach inside the profile's 99th-percentile distance). */
export function travelLimitBinds(profile: ProfileParams, elapsedH: number | undefined): boolean {
  return travelReachM(profile, elapsedH) < profile.medianM * Math.exp(2.33 * profile.spread);
}

export function computeProbability(inp: ProbabilityInput): Float32Array {
  const { meta, map, layers, barrier, lkp, profile, edits } = inp;
  const bias = inp.lowGroundBias ?? 0;
  const lcw = profile.landcoverWeight;
  const reach = travelReachM(profile, inp.elapsedH);
  const n = meta.cols * meta.rows;
  const p = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (layers.water[i]) continue;
    const [x, y] = cellCenterLocal(map, i);
    const d = Math.max(Math.hypot(x - lkp[0], y - lkp[1]), meta.cellSize);
    let w = logNormalPdf(d / 1000, profile.medianM / 1000, profile.spread) / (2 * Math.PI * d);
    w *= travelFactor(d, reach);
    if (profile.terrain) w *= terrainFactor(layers, i, profile.terrain.trackOffsetM, meta.cellSize);
    else {
      w *= 1 + profile.featureA * Math.exp(-layers.featureDist[i] / profile.featureL);
      w *= Math.exp(-layers.slopeDeg[i] / PROBABILITY.slopeScaleDeg);
    }
    w *= barrier[i];
    if (inp.travelDirDeg !== undefined && inp.travelDirDeg !== null) {
      const bearing = (Math.atan2(x - lkp[0], y - lkp[1]) * 180) / Math.PI;
      const diff = ((bearing - inp.travelDirDeg + 540) % 360) - 180;
      const fade = Math.min(1, d / DISPERSION.fadeM);
      w *= 1 + (dispersionWeight(diff) - 1) * fade;
    }
    if (edits) w *= edits[i];
    if (lcw) w *= lcw[layers.landcover[i]] ?? 1;
    if (bias) w *= Math.exp(bias * Math.max(-1.5, Math.min(1.5, layers.tpi[i] / 40)));
    p[i] = w;
  }
  return normalize(p);
}

/** Brush: multiply edits within a radius by `factor` (smooth edge). */
export function applyBrush(edits: Float32Array, m: GridMap, lx: number, ly: number, radius: number, factor: number): void {
  const cs = 1 / m.inv;
  const rc = Math.ceil(radius / cs) + 1;
  const c0 = Math.round(lx * m.inv + m.ox);
  const r0 = Math.round(-ly * m.inv + m.oy);
  for (let r = r0 - rc; r <= r0 + rc; r++) {
    if (r < 0 || r >= m.rows) continue;
    for (let c = c0 - rc; c <= c0 + rc; c++) {
      if (c < 0 || c >= m.cols) continue;
      const i = r * m.cols + c;
      const [x, y] = cellCenterLocal(m, i);
      const d = Math.hypot(x - lx, y - ly);
      if (d > radius) continue;
      const fall = d < radius * 0.6 ? 1 : 1 - (d - radius * 0.6) / (radius * 0.4);
      edits[i] *= Math.pow(factor, fall);
    }
  }
}

/** Overview probability -> detail grid (bilinear on density, renormalised within the segment). */
export function resampleToDetail(
  ovProb: Float32Array,
  ovMap: GridMap,
  detailMap: GridMap,
  detailWater?: Uint8Array,
): { prob: Float32Array; segmentFraction: number } {
  const n = detailMap.cols * detailMap.rows;
  const out = new Float32Array(n);
  const areaRatio = (ovMap.inv * ovMap.inv) / (detailMap.inv * detailMap.inv); // detail cell area / overview cell area
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (detailWater && detailWater[i]) continue;
    const [x, y] = cellCenterLocal(detailMap, i);
    const fc = x * ovMap.inv + ovMap.ox;
    const fr = -y * ovMap.inv + ovMap.oy;
    let v = bilinearClamp(ovProb, ovMap.cols, ovMap.rows, fc, fr) * areaRatio;
    if (v < 0) v = 0;
    out[i] = v;
    s += v;
  }
  if (s > 0) for (let i = 0; i < n; i++) out[i] /= s;
  return { prob: out, segmentFraction: Math.min(1, s) };
}

function bilinearClamp(a: Float32Array, cols: number, rows: number, fc: number, fr: number): number {
  fc = Math.min(Math.max(fc, 0), cols - 1);
  fr = Math.min(Math.max(fr, 0), rows - 1);
  const c0 = Math.min(fc | 0, cols - 2);
  const r0 = Math.min(fr | 0, rows - 2);
  const tc = fc - c0;
  const tr = fr - r0;
  const i = r0 * cols + c0;
  return (a[i] * (1 - tc) + a[i + 1] * tc) * (1 - tr) + (a[i + cols] * (1 - tc) + a[i + cols + 1] * tc) * tr;
}

/**
 * Combine the overview prior with a detail-grid likelihood (alerts, searched sectors).
 * Overview cells inside the segment take the mean detail likelihood; cells outside take `outside`.
 */
export function overviewPosterior(prior: Float32Array, ovMap: GridMap, detailMap: GridMap, L: Float32Array, outside: number): Float32Array {
  const sum = new Float32Array(prior.length);
  const cnt = new Uint16Array(prior.length);
  const nd = detailMap.cols * detailMap.rows;
  for (let i = 0; i < nd; i++) {
    const [x, y] = cellCenterLocal(detailMap, i);
    const o = cellAt(ovMap, x, y);
    if (o >= 0) {
      sum[o] += L[i];
      cnt[o]++;
    }
  }
  const out = new Float32Array(prior.length);
  for (let i = 0; i < prior.length; i++) out[i] = prior[i] * (cnt[i] ? sum[i] / cnt[i] : outside);
  return normalize(out);
}

export function sumInside(p: Float32Array, m: GridMap, bounds: { minX: number; maxX: number; minY: number; maxY: number }): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    if (p[i] === 0) continue;
    const [x, y] = cellCenterLocal(m, i);
    if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) s += p[i];
  }
  return s;
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 erf, |error| < 1.5e-7). */
function normCdf(z: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/**
 * Share of a profile's distance distribution that lies outside a square of the given half-width
 * centred on the last known point (approximated by the equal-area circle, radius 2h/√π). The map
 * is normalised inside the modelled area, so this much is silently left out; worth saying.
 */
export function shareBeyond(profile: { medianM: number; spread: number }, halfWidthM: number): number {
  const r = (2 * halfWidthM) / Math.sqrt(Math.PI);
  return 1 - normCdf(Math.log(r / profile.medianM) / profile.spread);
}
