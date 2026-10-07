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
export interface DeployableOptions {
  maxSlopeDeg?: number;
  /** 'waterAndShore': boats on water plus land within 40 m of it (water searches) */
  mode?: 'land' | 'waterAndShore';
}

/** Detail cells a team can reach: slope limit, ≥ 20 m from a cliff, and not water (unless boats). */
export function deployableCells(ti: TerrainInfo, water: Uint8Array, cliff: Uint8Array, opts: DeployableOptions = {}): Uint8Array {
  const { cols, rows, cellSize } = ti.meta;
  const maxSlope = opts.maxSlopeDeg ?? HOTSPOTS.maxSlopeDeg;
  const cliffDist = distanceTransform(cliff, cols, rows, cellSize);
  const isWater = (i: number) => water[i] === 1 || ti.landcover[i] === LC.water;
  const out = new Uint8Array(cols * rows);
  if (opts.mode === 'waterAndShore') {
    const wm = new Uint8Array(cols * rows);
    for (let i = 0; i < wm.length; i++) wm[i] = isWater(i) ? 1 : 0;
    const shoreDist = distanceTransform(wm, cols, rows, cellSize);
    for (let i = 0; i < out.length; i++) {
      const shore = !wm[i] && shoreDist[i] <= 40 && ti.slopeDeg[i] <= maxSlope && cliffDist[i] >= HOTSPOTS.cliffBufferM;
      out[i] = wm[i] || shore ? 1 : 0;
    }
    return out;
  }
  for (let i = 0; i < out.length; i++) {
    out[i] = ti.slopeDeg[i] <= maxSlope && !isWater(i) && cliffDist[i] >= HOTSPOTS.cliffBufferM ? 1 : 0;
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
  /** share of segment probability this team would detect (scent reaching it × detectability, plus close range) */
  coveredProb: number;
  coveredSources: number[];
  /** placed by drifting scent, or (hedge) on the most likely ground by close range alone */
  kind: 'scent' | 'ground';
}

export interface DeployInput {
  contrib: Float32Array;
  blocks: BlockIndex;
  /** receiver-level detectability */
  detRecv: Float32Array;
  /** detail-level heat (for choosing the best cell inside a block) */
  heat: Float32Array;
  /** detail-level probability (for placing a ground team inside its block) */
  prob?: Float32Array;
  /** source-block probability (sums to ~1) */
  q: Float32Array;
  deployable: Uint8Array;
  map: GridMap;
  teams: number;
  /** chance a dog detects what it covers (default HOTSPOTS.dogPOD) */
  pod?: number;
  /** minimum spacing between teams in metres (default HOTSPOTS.suppressRadiusM) */
  spacingM?: number;
  /** a team must intercept at least this share of the probability to be placed */
  minCover?: number;
  /** close-range search radius around the start (m) and its detectability; 0 turns it off */
  nearRadiusM?: number;
  nearDet?: number;
  /**
   * Place only this many teams by scent; the rest go on the most likely ground by close range
   * alone (a hedge when the wind direction is uncertain). Default: all teams by scent.
   */
  scentTeams?: number;
}

/** Source blocks whose centre lies within `radiusM` of receiver r's centre (ground the team works itself). */
export function nearSources(b: BlockIndex, map: GridMap, r: number, radiusM: number): number[] {
  const rr = Math.floor(r / b.recvCols);
  const rc = r - rr * b.recvCols;
  const cx = rc * b.recvBlock + (b.recvBlock - 1) / 2;
  const cy = rr * b.recvBlock + (b.recvBlock - 1) / 2;
  const rad = radiusM * map.inv; // in cells
  const srcRows = Math.ceil(b.nSrc / b.srcCols);
  const out: number[] = [];
  const s0 = Math.max(0, Math.floor((cy - rad) / b.srcBlock));
  const s1 = Math.min(srcRows - 1, Math.floor((cy + rad) / b.srcBlock));
  const c0 = Math.max(0, Math.floor((cx - rad) / b.srcBlock));
  const c1 = Math.min(b.srcCols - 1, Math.floor((cx + rad) / b.srcBlock));
  for (let sr = s0; sr <= s1; sr++)
    for (let sc = c0; sc <= c1; sc++) {
      const dx = sc * b.srcBlock + (b.srcBlock - 1) / 2 - cx;
      const dy = sr * b.srcBlock + (b.srcBlock - 1) / 2 - cy;
      if (Math.hypot(dx, dy) <= rad) out.push(sr * b.srcCols + sc);
    }
  return out;
}

/**
 * What a team at receiver r detects, per source block: `det` (scent detectability at r) for sources
 * whose scent reaches r, and at least `nearDet` for sources on the ground the team works around its
 * start (a dog finds a person it passes close to even when the drifted scent is weak).
 */
export function teamCoverage(contribList: number[], det: number, near: number[], nearDet: number): Map<number, number> {
  const m = new Map<number, number>();
  if (det > 0) for (const s of contribList) m.set(s, det);
  for (const s of near) m.set(s, Math.max(m.get(s) ?? 0, nearDet));
  return m;
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
  const nearR = inp.nearRadiusM ?? HOTSPOTS.nearRadiusM;
  const nearDet = inp.nearDet ?? HOTSPOTS.nearDet;
  const cover: [number, number][][] = new Array(nRecv);
  const groundCover: [number, number][][] = new Array(nRecv);
  for (let r = 0; r < nRecv; r++) {
    if (bestCell[r] < 0) {
      cover[r] = groundCover[r] = [];
      continue;
    }
    const scent = detRecv[r] > 0 ? contributingSources(contrib, nSrc, r) : [];
    const near = nearR > 0 && nearDet > 0 ? nearSources(b, map, r, nearR) : [];
    cover[r] = [...teamCoverage(scent, detRecv[r], near, nearDet)];
    groundCover[r] = [...teamCoverage([], 0, near, nearDet)];
  }
  const scentTeams = inp.scentTeams ?? inp.teams;
  const w = new Float32Array(nSrc).fill(1);
  // ground (hedge) teams discount only what other ground teams cover: the hedge exists for when the
  // scent teams' coverage is wrong, so it must not lean on it
  const wGround = new Float32Array(nSrc).fill(1);
  const suppressed = new Uint8Array(nRecv);
  const raw = new Float32Array(nRecv);
  const smooth = new Float32Array(nRecv);
  const out: Deployment[] = [];
  const blockM = b.recvBlock / map.inv;
  for (let team = 0; team < inp.teams; team++) {
    const kind = team < scentTeams ? 'scent' : 'ground';
    const cov = kind === 'scent' ? cover : groundCover;
    const wk = kind === 'scent' ? w : wGround;
    for (let r = 0; r < nRecv; r++) {
      let s = 0;
      for (const [src, d] of cov[r]) s += q[src] * wk[src] * d;
      raw[r] = s;
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
    // stop rather than place a team that would cover (almost) nothing
    if (best < 0 || raw[best] < (inp.minCover ?? 0.01)) break;
    // on the ground, stand on the most likely cell of the block rather than the strongest scent
    let cell = bestCell[best];
    if (kind === 'ground' && inp.prob) {
      let bp = -1;
      for (let i = 0; i < b.recvOf.length; i++) if (b.recvOf[i] === best && deployable[i] && inp.prob[i] > bp) {
        bp = inp.prob[i];
        cell = i;
      }
    }
    const row = Math.floor(cell / cols);
    const col = cell - row * cols;
    const x = (col - map.ox) / map.inv;
    const y = -(row - map.oy) / map.inv;
    out.push({ team: team + 1, recv: best, cell, x, y, score: bestScore, coveredProb: raw[best], coveredSources: cov[best].map(([src]) => src), kind });
    const pod = inp.pod ?? HOTSPOTS.dogPOD;
    for (const [src, d] of cov[best]) w[src] *= 1 - pod * d;
    if (kind === 'ground') for (const [src, d] of cov[best]) wGround[src] *= 1 - pod * d;
    // suppress receivers within 300 m
    const br = Math.floor(best / recvCols);
    const bc = best - br * recvCols;
    const spacing = inp.spacingM ?? HOTSPOTS.suppressRadiusM;
    const rad = Math.ceil(spacing / blockM);
    for (let dr = -rad; dr <= rad; dr++)
      for (let dc = -rad; dc <= rad; dc++) {
        const y2 = br + dr;
        const x2 = bc + dc;
        if (y2 < 0 || x2 < 0 || y2 >= recvRows || x2 >= recvCols) continue;
        if (Math.hypot(dr, dc) * blockM <= spacing) suppressed[y2 * recvCols + x2] = 1;
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

/**
 * Restrict deployable cells to within `reachM` of the core: the cells that together hold
 * `share` of the probability (highest first).
 */
export function withinReach(deployable: Uint8Array, prob: Float32Array, cols: number, rows: number, cell: number, reachM: number, share = 0.9): Uint8Array {
  const idx: number[] = [];
  for (let i = 0; i < prob.length; i++) if (prob[i] > 0) idx.push(i);
  idx.sort((a, b) => prob[b] - prob[a]);
  const core = new Uint8Array(prob.length);
  let acc = 0;
  for (const i of idx) {
    core[i] = 1;
    acc += prob[i];
    if (acc >= share) break;
  }
  const d = distanceTransform(core, cols, rows, cell);
  const out = new Uint8Array(deployable.length);
  for (let i = 0; i < out.length; i++) out[i] = deployable[i] && d[i] <= reachM ? 1 : 0;
  return out;
}
