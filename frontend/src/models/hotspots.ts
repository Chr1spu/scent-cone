/**
 * Hotspot scoring and greedy dog-team deployment (CLAUDE.md §8.4).
 * Works on receiver blocks (50 m) and source blocks (100 m) from contribution tracking, with
 * absolute single-person detection (models/detection.ts) along each team's upwind route.
 */
import { HOTSPOTS } from '../config/modelParams';
import { cellAt, smoothstep, type GridMap } from '../geo/grid';
import { receiverDetection, type DetectionCurve, type ReceiverDetection } from './detection';
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
  /** detail cell where the team starts */
  cell: number;
  x: number;
  y: number;
  score: number;
  /** share of segment probability this team would detect along its route */
  coveredProb: number;
  coveredSources: number[];
  /** placed by drifting scent, or (hedge) on the most likely ground by close range alone */
  kind: 'scent' | 'ground';
  /** the route the team works: upwind from the start (local metres, first point = start) */
  route: [number, number][];
}

/** Local wind (m/s, east and north) at a point, at the planning time. */
export type WindAt = (x: number, y: number) => { u: number; v: number };

/**
 * The route a team works in its search window: from the start, upwind into the local wind (dogs
 * work toward the source), in steps of HOTSPOTS.routeStepM. Stops early on ground a team can't use,
 * at the grid edge, or in calm air (where there is no "upwind" to follow).
 */
export function traceRoute(map: GridMap, deployable: Uint8Array, x0: number, y0: number, windAt: WindAt | undefined, lengthM: number): [number, number][] {
  const pts: [number, number][] = [[x0, y0]];
  if (!windAt || lengthM <= 0) return pts;
  const step = HOTSPOTS.routeStepM;
  let x = x0;
  let y = y0;
  for (let d = step; d <= lengthM + 1e-6; d += step) {
    const w = windAt(x, y);
    const s = Math.hypot(w.u, w.v);
    if (s < HOTSPOTS.routeCalmWind) break;
    const nx = x - (w.u / s) * step;
    const ny = y - (w.v / s) * step;
    const c = cellAt(map, nx, ny);
    if (c < 0 || !deployable[c]) break;
    x = nx;
    y = ny;
    pts.push([x, y]);
  }
  return pts;
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

export interface CoverageOptions {
  blocks: BlockIndex;
  map: GridMap;
  /** absolute single-person detection per receiver; null = close range only */
  det: ReceiverDetection | null;
  nearRadiusM?: number;
  nearDet?: number;
}

/** Sparse coverage: detection probability per source block. */
export interface Coverage {
  src: Int32Array;
  d: Float32Array;
}

const scratchFor = new WeakMap<BlockIndex, { val: Float32Array; seen: Uint8Array }>();

/**
 * What a team detects along its route, per source block: the best scent detection at any
 * receiver it passes, and at least `nearDet` for sources within `nearRadiusM` of the route
 * (a dog finds a person it passes close to even when the drifted scent is weak).
 */
export function routeCoverage(route: [number, number][], o: CoverageOptions): Coverage {
  const b = o.blocks;
  let sc = scratchFor.get(b);
  if (!sc) {
    sc = { val: new Float32Array(b.nSrc), seen: new Uint8Array(b.nRecv) };
    scratchFor.set(b, sc);
  }
  const { val, seen } = sc;
  const nearR = o.nearRadiusM ?? HOTSPOTS.nearRadiusM;
  const nearDet = o.nearDet ?? HOTSPOTS.nearDet;
  const touched: number[] = [];
  const recvs: number[] = [];
  for (const [x, y] of route) {
    const c = cellAt(o.map, x, y);
    if (c < 0) continue;
    const r = b.recvOf[c];
    if (seen[r]) continue;
    seen[r] = 1;
    recvs.push(r);
  }
  const bump = (s: number, d: number) => {
    if (val[s] === 0) touched.push(s);
    if (d > val[s]) val[s] = d;
  };
  for (const r of recvs) {
    if (o.det) for (let k = o.det.start[r]; k < o.det.start[r + 1]; k++) bump(o.det.src[k], o.det.det[k]);
    if (nearR > 0 && nearDet > 0) for (const s of nearSources(b, o.map, r, nearR)) bump(s, nearDet);
  }
  const out: Coverage = { src: new Int32Array(touched.length), d: new Float32Array(touched.length) };
  touched.forEach((s, i) => {
    out.src[i] = s;
    out.d[i] = val[s];
    val[s] = 0;
  });
  for (const r of recvs) seen[r] = 0;
  return out;
}

export interface DeployInput {
  contrib: Float32Array;
  blocks: BlockIndex;
  /** source-block probability (sums to ~1) */
  q: Float32Array;
  /** detail-level heat (picks the start cell inside a block) */
  heat: Float32Array;
  /** detail-level probability (start cell of a ground team) */
  prob?: Float32Array;
  deployable: Uint8Array;
  map: GridMap;
  teams: number;
  /** single-person detection curve (models/detection.ts) */
  curve: DetectionCurve;
  /** precomputed receiver detection (else built from contrib, q and curve) */
  det?: ReceiverDetection;
  /** local wind for each team's upwind route; omitted = teams stay at their start */
  windAt?: WindAt;
  /** route length (m), default HOTSPOTS.routeM */
  routeM?: number;
  /** chance a dog detects what it covers (default HOTSPOTS.dogPOD) */
  pod?: number;
  /** minimum spacing between team starts (m) */
  spacingM?: number;
  /** a team must cover at least this share of the probability to be placed */
  minCover?: number;
  nearRadiusM?: number;
  nearDet?: number;
  /**
   * Place only this many teams by scent; the rest go on the most likely ground by close range
   * alone (a hedge when the wind direction is uncertain). Default: all teams by scent.
   */
  scentTeams?: number;
}

export function greedyDeploy(inp: DeployInput): Deployment[] {
  const { blocks: b, q, deployable, map, heat } = inp;
  const { nRecv, nSrc, recvCols } = b;
  const recvRows = nRecv / recvCols;
  const cols = map.cols;
  const routeM = inp.routeM ?? HOTSPOTS.routeM;
  const det = inp.det ?? receiverDetection(inp.contrib, q, b, inp.curve);
  const xy = (cell: number): [number, number] => {
    const row = Math.floor(cell / cols);
    return [(cell - row * cols - map.ox) / map.inv, -(row - map.oy) / map.inv];
  };
  // start cell per block: strongest scent (scent teams) and most likely ground (ground teams)
  const bestCell = new Int32Array(nRecv).fill(-1);
  const bestHeat = new Float32Array(nRecv).fill(-1);
  const groundCell = new Int32Array(nRecv).fill(-1);
  const groundP = new Float32Array(nRecv).fill(-1);
  for (let i = 0; i < deployable.length; i++) {
    if (!deployable[i]) continue;
    const r = b.recvOf[i];
    if (heat[i] > bestHeat[r]) {
      bestHeat[r] = heat[i];
      bestCell[r] = i;
    }
    const p = inp.prob ? inp.prob[i] : heat[i];
    if (p > groundP[r]) {
      groundP[r] = p;
      groundCell[r] = i;
    }
  }
  const scentTeams = inp.scentTeams ?? inp.teams;
  const opts: CoverageOptions = { blocks: b, map, det, nearRadiusM: inp.nearRadiusM, nearDet: inp.nearDet };
  const groundOpts: CoverageOptions = { ...opts, det: null };
  const empty: Coverage = { src: new Int32Array(0), d: new Float32Array(0) };
  const routes: [number, number][][] = new Array(nRecv);
  const cover: Coverage[] = new Array(nRecv).fill(empty);
  const groundRoutes: [number, number][][] = new Array(nRecv);
  const groundCover: Coverage[] = new Array(nRecv).fill(empty);
  for (let r = 0; r < nRecv; r++) {
    if (bestCell[r] < 0) continue;
    if (scentTeams > 0) {
      const [x, y] = xy(bestCell[r]);
      routes[r] = traceRoute(map, deployable, x, y, inp.windAt, routeM);
      cover[r] = routeCoverage(routes[r], opts);
    }
    if (scentTeams < inp.teams) {
      const [x, y] = xy(groundCell[r]);
      groundRoutes[r] = traceRoute(map, deployable, x, y, inp.windAt, routeM);
      groundCover[r] = routeCoverage(groundRoutes[r], groundOpts);
    }
  }
  const w = new Float32Array(nSrc).fill(1);
  // ground (hedge) teams discount only what other ground teams cover: the hedge exists for when the
  // scent teams' coverage is wrong, so it must not lean on it
  const wGround = new Float32Array(nSrc).fill(1);
  const suppressed = new Uint8Array(nRecv);
  const raw = new Float32Array(nRecv);
  const smooth = new Float32Array(nRecv);
  const out: Deployment[] = [];
  const blockM = b.recvBlock / map.inv;
  const pod = inp.pod ?? HOTSPOTS.dogPOD;
  for (let team = 0; team < inp.teams; team++) {
    const kind = team < scentTeams ? 'scent' : 'ground';
    const cov = kind === 'scent' ? cover : groundCover;
    const wk = kind === 'scent' ? w : wGround;
    for (let r = 0; r < nRecv; r++) {
      const c = cov[r];
      let s = 0;
      for (let k = 0; k < c.src.length; k++) s += q[c.src[k]] * wk[c.src[k]] * c.d[k];
      raw[r] = s;
    }
    // light [1 2 1] blur at 50 m blocks (~30 m kernel): prefer starts in good neighbourhoods
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
    const cell = kind === 'scent' ? bestCell[best] : groundCell[best];
    const [x, y] = xy(cell);
    const c = cov[best];
    out.push({
      team: team + 1,
      recv: best,
      cell,
      x,
      y,
      score: bestScore,
      coveredProb: raw[best],
      coveredSources: Array.from(c.src),
      kind,
      route: (kind === 'scent' ? routes : groundRoutes)[best] ?? [[x, y]],
    });
    for (let k = 0; k < c.src.length; k++) {
      const f = 1 - pod * c.d[k];
      w[c.src[k]] *= f;
      if (kind === 'ground') wGround[c.src[k]] *= f;
    }
    // suppress starts within the spacing
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
