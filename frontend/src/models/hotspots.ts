/**
 * Hotspot scoring and greedy dog-team deployment (CLAUDE.md §8.4).
 * Works on receiver blocks (50 m) and source blocks (100 m) from contribution tracking.
 */
import { HOTSPOTS } from '../config/modelParams';
import { smoothstep, type GridMap } from '../geo/grid';
import { distanceTransform } from './probability';
import type { BlockIndex } from './scent';
import { LC, type TerrainInfo } from './terrainInfo';

export function percentileOfNonzero(a: Float32Array, p: number): number {
  const v: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] > 0) v.push(a[i]);
  if (v.length === 0) return 0;
  v.sort((x, y) => x - y);
  return v[Math.min(v.length - 1, Math.max(0, Math.floor(p * (v.length - 1))))];
}

export interface DetThresholds {
  lo: number;
  hi: number;
}

/**
 * θ1/θ2 at the configured percentiles of nonzero heat. Called on a neutral-conditions
 * reference run (see ENSEMBLE.reference*), which makes the thresholds absolute.
 */
export function detThresholds(heat: Float32Array): DetThresholds {
  const lo = percentileOfNonzero(heat, HOTSPOTS.detLoPct);
  const hi = Math.max(percentileOfNonzero(heat, HOTSPOTS.detHiPct), lo * 1.0001 + 1e-12);
  return { lo, hi };
}

/** det = smoothstep(θ1, θ2, heat) */
export function detectability(heat: Float32Array, th: DetThresholds): Float32Array {
  const d = new Float32Array(heat.length);
  for (let i = 0; i < heat.length; i++) d[i] = heat[i] > 0 ? smoothstep(th.lo, th.hi, heat[i]) : 0;
  return d;
}

/** Mean of detail cells per receiver block. */
export function blockMean(a: Float32Array, cols: number, rows: number, b: BlockIndex): Float32Array {
  const sum = new Float32Array(b.nRecv);
  const cnt = new Float32Array(b.nRecv);
  for (let i = 0; i < cols * rows; i++) {
    sum[b.recvOf[i]] += a[i];
    cnt[b.recvOf[i]]++;
  }
  for (let r = 0; r < b.nRecv; r++) sum[r] /= cnt[r] || 1;
  return sum;
}

/** Sum of detail cells per source block (e.g. probability mass). */
export function sourceSums(a: Float32Array, b: BlockIndex): Float32Array {
  const s = new Float32Array(b.nSrc);
  for (let i = 0; i < a.length; i++) s[b.srcOf[i]] += a[i];
  return s;
}

/** Detail cells a team can reach: slope ≤ 35°, not water, ≥ 20 m from a cliff. */
export function deployableCells(ti: TerrainInfo, water: Uint8Array, cliff: Uint8Array): Uint8Array {
  const { cols, rows, cellSize } = ti.meta;
  const cliffDist = distanceTransform(cliff, cols, rows, cellSize);
  const out = new Uint8Array(cols * rows);
  for (let i = 0; i < out.length; i++) {
    out[i] =
      ti.slopeDeg[i] <= HOTSPOTS.maxSlopeDeg && !water[i] && ti.landcover[i] !== LC.water && cliffDist[i] >= HOTSPOTS.cliffBufferM ? 1 : 0;
  }
  return out;
}

export interface Deployment {
  team: number;
  /** receiver block */
  recv: number;
  /** detail cell where the team stands */
  cell: number;
  x: number;
  y: number;
  score: number;
  /** share of segment probability whose scent this point intercepts (× detectability) */
  coveredProb: number;
  coveredSources: number[];
}

export interface DeployInput {
  contrib: Float32Array;
  blocks: BlockIndex;
  /** receiver-level detectability */
  detRecv: Float32Array;
  /** detail-level heat (for choosing the best cell inside a block) */
  heat: Float32Array;
  /** source-block probability (sums to ~1) */
  q: Float32Array;
  deployable: Uint8Array;
  map: GridMap;
  teams: number;
}

/** Sources contributing at receiver r: ≥ share of its scent, top-N by strength. */
export function contributingSources(contrib: Float32Array, nSrc: number, r: number): number[] {
  const off = r * nSrc;
  let total = 0;
  for (let s = 0; s < nSrc; s++) total += contrib[off + s];
  if (total <= 0) return [];
  const thr = total * HOTSPOTS.contribShare;
  const list: number[] = [];
  for (let s = 0; s < nSrc; s++) if (contrib[off + s] >= thr) list.push(s);
  if (list.length > HOTSPOTS.maxSourcesPerRecv) {
    list.sort((a, b) => contrib[off + b] - contrib[off + a]);
    list.length = HOTSPOTS.maxSourcesPerRecv;
  }
  return list;
}

export function greedyDeploy(inp: DeployInput): Deployment[] {
  const { contrib, blocks: b, detRecv, q, deployable, map, heat } = inp;
  const { nRecv, nSrc, recvCols } = b;
  const recvRows = nRecv / recvCols;
  const cols = map.cols;
  // receiver deployability + best cell per block
  const bestCell = new Int32Array(nRecv).fill(-1);
  const bestHeat = new Float32Array(nRecv).fill(-1);
  for (let i = 0; i < deployable.length; i++) {
    if (!deployable[i]) continue;
    const r = b.recvOf[i];
    if (heat[i] > bestHeat[r]) {
      bestHeat[r] = heat[i];
      bestCell[r] = i;
    }
  }
  const contribs: number[][] = new Array(nRecv);
  for (let r = 0; r < nRecv; r++) contribs[r] = detRecv[r] > 0 ? contributingSources(contrib, nSrc, r) : [];
  const w = new Float32Array(nSrc).fill(1);
  const suppressed = new Uint8Array(nRecv);
  const raw = new Float32Array(nRecv);
  const smooth = new Float32Array(nRecv);
  const out: Deployment[] = [];
  const blockM = b.recvBlock / map.inv;
  for (let team = 0; team < inp.teams; team++) {
    for (let r = 0; r < nRecv; r++) {
      let s = 0;
      for (const src of contribs[r]) s += q[src] * w[src];
      raw[r] = s * detRecv[r];
    }
    // ~30 m smoothing kernel at 50 m blocks: light [1 2 1] blur
    for (let rr = 0; rr < recvRows; rr++)
      for (let rc = 0; rc < recvCols; rc++) {
        let acc = 0;
        let wsum = 0;
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const y = rr + dr;
            const x = rc + dc;
            if (y < 0 || x < 0 || y >= recvRows || x >= recvCols) continue;
            const k = (dr === 0 ? 2 : 1) * (dc === 0 ? 2 : 1);
            acc += raw[y * recvCols + x] * k;
            wsum += k;
          }
        smooth[rr * recvCols + rc] = 0.5 * raw[rr * recvCols + rc] + 0.5 * (acc / wsum);
      }
    let best = -1;
    let bestScore = 0;
    for (let r = 0; r < nRecv; r++) {
      if (suppressed[r] || bestCell[r] < 0) continue;
      if (smooth[r] > bestScore) {
        bestScore = smooth[r];
        best = r;
      }
    }
    if (best < 0) break;
    const cell = bestCell[best];
    const row = Math.floor(cell / cols);
    const col = cell - row * cols;
    const x = (col - map.ox) / map.inv;
    const y = -(row - map.oy) / map.inv;
    out.push({ team: team + 1, recv: best, cell, x, y, score: bestScore, coveredProb: raw[best], coveredSources: contribs[best].slice() });
    const pod = HOTSPOTS.dogPOD * detRecv[best];
    for (const src of contribs[best]) w[src] *= 1 - pod;
    // suppress receivers within 300 m
    const br = Math.floor(best / recvCols);
    const bc = best - br * recvCols;
    const rad = Math.ceil(HOTSPOTS.suppressRadiusM / blockM);
    for (let dr = -rad; dr <= rad; dr++)
      for (let dc = -rad; dc <= rad; dc++) {
        const y2 = br + dr;
        const x2 = bc + dc;
        if (y2 < 0 || x2 < 0 || y2 >= recvRows || x2 >= recvCols) continue;
        if (Math.hypot(dr, dc) * blockM <= HOTSPOTS.suppressRadiusM) suppressed[y2 * recvCols + x2] = 1;
      }
  }
  return out;
}

/**
 * Score of a receiver in an hourly snapshot (for best time windows), against fixed absolute
 * thresholds so hours compare: detectability, plus a small tie-break on raw strength.
 */
export function snapshotScore(heatRecv: Float32Array, r: number, th: DetThresholds): number {
  const h = heatRecv[r];
  return smoothstep(th.lo, th.hi, h) + (0.1 * Math.min(h / (th.hi || 1), 3)) / 3;
}
