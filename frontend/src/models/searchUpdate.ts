/** Negative updates (CLAUDE.md §8.6): a searched sector with no alert lowers probability. */
import { HOTSPOTS, SEARCH } from '../config/modelParams';
import { smoothstep, type GridMap } from '../geo/grid';
import type { DetThresholds } from './hotspots';
import type { BlockIndex } from './scent';

export interface SearchedSector {
  x: number;
  y: number;
  radius: number;
}

export interface SearchUpdateInput {
  sector: SearchedSector;
  contrib: Float32Array;
  blocks: BlockIndex;
  /** receiver-level heat for the search window and its detectability thresholds */
  heatRecv: Float32Array;
  th: DetThresholds;
  map: GridMap;
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
 * Sources inside the sector itself get at least 0.7 × local detectability (the dog walked there).
 */
export function searchUpdate(inp: SearchUpdateInput): SearchUpdateResult {
  const { sector, contrib, blocks: b, heatRecv, th, map } = inp;
  const inArea: number[] = [];
  let nearest = 0;
  let nearestD = Infinity;
  for (let r = 0; r < b.nRecv; r++) {
    const [x, y] = recvCenter(b, map, r);
    const d = Math.hypot(x - sector.x, y - sector.y);
    if (d <= sector.radius) inArea.push(r);
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
    let pod = total > 0 ? HOTSPOTS.dogPOD * (reached / total) : 0;
    const [sx, sy] = srcCenter(b, map, s);
    if (Math.hypot(sx - sector.x, sy - sector.y) <= sector.radius) pod = Math.max(pod, HOTSPOTS.dogPOD * meanDet);
    podSrc[s] = Math.min(pod, HOTSPOTS.dogPOD);
  }
  const factor = new Float32Array(b.srcOf.length);
  for (let i = 0; i < factor.length; i++) factor[i] = 1 - podSrc[b.srcOf[i]];
  return { factor, podSrc, meanDet, recheck: meanDet < SEARCH.recheckDet };
}
