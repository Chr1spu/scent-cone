/** Negative updates (CLAUDE.md §8.6): a searched sector with no alert lowers probability. */
import { HOTSPOTS, SEARCH } from '../config/modelParams';
import { smoothstep, type GridMap } from '../geo/grid';
import type { ReceiverDetection } from './detection';
import type { DetThresholds } from './hotspots';
import type { BlockIndex } from './scent';

/**
 * A searched area: a circle around a point, a polygon, or the corridor along a team's GPS track
 * (local metres).
 */
export type SearchedSector =
  | { kind: 'circle'; x: number; y: number; radius: number }
  | { kind: 'polygon'; xs: number[]; ys: number[] }
  | { kind: 'track'; xs: number[]; ys: number[]; radius: number };

/** Distance from a point to a polyline. */
function distToPolyline(xs: number[], ys: number[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (i + 1 >= xs.length) {
      best = Math.min(best, Math.hypot(x - xs[i], y - ys[i]));
      break;
    }
    const dx = xs[i + 1] - xs[i];
    const dy = ys[i + 1] - ys[i];
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - xs[i]) * dx + (y - ys[i]) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - xs[i] - t * dx, y - ys[i] - t * dy));
  }
  return best;
}

export function sectorContains(s: SearchedSector, x: number, y: number): boolean {
  if (s.kind === 'circle') return Math.hypot(x - s.x, y - s.y) <= s.radius;
  if (s.kind === 'track') return distToPolyline(s.xs, s.ys, x, y) <= s.radius;
  let inside = false;
  for (let i = 0, j = s.xs.length - 1; i < s.xs.length; j = i++) {
    const yi = s.ys[i];
    const yj = s.ys[j];
    if (yi > y !== yj > y && x < ((s.xs[j] - s.xs[i]) * (y - yi)) / (yj - yi) + s.xs[i]) inside = !inside;
  }
  return inside;
}

export function sectorCentroid(s: SearchedSector): [number, number] {
  if (s.kind === 'circle') return [s.x, s.y];
  const n = s.xs.length;
  return [s.xs.reduce((a, b) => a + b, 0) / n, s.ys.reduce((a, b) => a + b, 0) / n];
}

export interface SearchUpdateInput {
  sector: SearchedSector;
  /** absolute single-person detection per receiver (models/detection.ts) */
  det: ReceiverDetection;
  blocks: BlockIndex;
  /** receiver-level heat for the search window and absolute (reference) detectability thresholds */
  heatRecv: Float32Array;
  th: DetThresholds;
  map: GridMap;
  /** chance a dog detects what reaches it (default HOTSPOTS.dogPOD) */
  pod?: number;
  /** detection for people inside the searched area (search-theory coverage), default HOTSPOTS.nearDet */
  insideDet?: number;
}

export interface SearchUpdateResult {
  /** per-detail-cell multiplier (1 − POD) */
  factor: Float32Array;
  podSrc: Float32Array;
  meanDet: number;
  recheck: boolean;
}

function recvCenter(b: BlockIndex, m: GridMap, r: number): [number, number] {
  const rr = Math.floor(r / b.recvCols);
  const rc = r - rr * b.recvCols;
  const col = rc * b.recvBlock + (b.recvBlock - 1) / 2;
  const row = rr * b.recvBlock + (b.recvBlock - 1) / 2;
  return [(col - m.ox) / m.inv, -(row - m.oy) / m.inv];
}

function srcCenter(b: BlockIndex, m: GridMap, s: number): [number, number] {
  const sr = Math.floor(s / b.srcCols);
  const sc = s - sr * b.srcCols;
  const col = sc * b.srcBlock + (b.srcBlock - 1) / 2;
  const row = sr * b.srcBlock + (b.srcBlock - 1) / 2;
  return [(col - m.ox) / m.inv, -(row - m.oy) / m.inv];
}

/**
 * POD(source): inside the searched area, 0.7 × the search-theory detection for that effort and
 * scent conditions (the team searched it); outside, 0.7 × the best single-person detection the
 * team passed through × SEARCH.driftCredit (scent that should have reached it, discounted because
 * it depends on the modelled wind). The recheck flag uses scent conditions across the area.
 */
export function searchUpdate(inp: SearchUpdateInput): SearchUpdateResult {
  const { sector, blocks: b, heatRecv, th, map } = inp;
  const POD = inp.pod ?? HOTSPOTS.dogPOD;
  const inArea: number[] = [];
  let nearest = 0;
  let nearestD = Infinity;
  const [cx, cy] = sectorCentroid(sector);
  for (let r = 0; r < b.nRecv; r++) {
    const [x, y] = recvCenter(b, map, r);
    const d = Math.hypot(x - cx, y - cy);
    if (sectorContains(sector, x, y)) inArea.push(r);
    if (d < nearestD) {
      nearestD = d;
      nearest = r;
    }
  }
  if (inArea.length === 0) inArea.push(nearest);
  let detSum = 0;
  for (const r of inArea) detSum += smoothstep(th.lo, th.hi, heatRecv[r]);
  const meanDet = detSum / inArea.length;
  const podSrc = new Float32Array(b.nSrc);
  const inside = new Uint8Array(b.nSrc);
  for (let s = 0; s < b.nSrc; s++) {
    const [sx, sy] = srcCenter(b, map, s);
    inside[s] = sectorContains(sector, sx, sy) ? 1 : 0;
  }
  // outside the area: scent that should have drifted to the team, only partly credited
  for (const r of inArea)
    for (let k = inp.det.start[r]; k < inp.det.start[r + 1]; k++) {
      const s = inp.det.src[k];
      if (!inside[s]) podSrc[s] = Math.max(podSrc[s], POD * inp.det.det[k] * SEARCH.driftCredit);
    }
  // inside: the team searched it
  for (let s = 0; s < b.nSrc; s++) if (inside[s]) podSrc[s] = POD * (inp.insideDet ?? HOTSPOTS.nearDet);
  const factor = new Float32Array(b.srcOf.length);
  for (let i = 0; i < factor.length; i++) factor[i] = 1 - podSrc[b.srcOf[i]];
  return { factor, podSrc, meanDet, recheck: meanDet < SEARCH.recheckDet };
}
