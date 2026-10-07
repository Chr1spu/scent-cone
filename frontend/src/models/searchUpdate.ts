/** Negative updates (CLAUDE.md §8.6): a searched sector with no alert lowers probability. */
import { HOTSPOTS, SEARCH } from '../config/modelParams';
import { smoothstep, type GridMap } from '../geo/grid';
import type { DetThresholds } from './hotspots';
import type { BlockIndex } from './scent';

/** A searched area: a circle around a point, or a polygon (local metres). */
export type SearchedSector =
  | { kind: 'circle'; x: number; y: number; radius: number }
  | { kind: 'polygon'; xs: number[]; ys: number[] };

export function sectorContains(s: SearchedSector, x: number, y: number): boolean {
  if (s.kind === 'circle') return Math.hypot(x - s.x, y - s.y) <= s.radius;
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
  contrib: Float32Array;
  blocks: BlockIndex;
  /** receiver-level heat for the search window and absolute (reference) detectability thresholds */
  heatRecv: Float32Array;
  th: DetThresholds;
  map: GridMap;
  /** chance a dog detects what reaches it (default HOTSPOTS.dogPOD) */
  pod?: number;
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
 * POD(source) = 0.7 × fraction of the source's scent that reached the searched area above θ1.
 * Sources inside the sector itself get at least 0.7 × max(local detectability, close-range detectability):
 * the dog walked there.
 */
export function searchUpdate(inp: SearchUpdateInput): SearchUpdateResult {
  const { sector, contrib, blocks: b, heatRecv, th, map } = inp;
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
  for (let s = 0; s < b.nSrc; s++) {
    let total = 0;
    for (let r = 0; r < b.nRecv; r++) total += contrib[r * b.nSrc + s];
    let reached = 0;
    if (total > 0) for (const r of inArea) if (heatRecv[r] > th.lo) reached += contrib[r * b.nSrc + s];
    let pod = total > 0 ? POD * (reached / total) : 0;
    const [sx, sy] = srcCenter(b, map, s);
    if (sectorContains(sector, sx, sy)) pod = Math.max(pod, POD * Math.max(meanDet, HOTSPOTS.nearDet));
    podSrc[s] = Math.min(pod, POD);
  }
  const factor = new Float32Array(b.srcOf.length);
  for (let i = 0; i < factor.length; i++) factor[i] = 1 - podSrc[b.srcOf[i]];
  return { factor, podSrc, meanDet, recheck: meanDet < SEARCH.recheckDet };
}
