/**
 * Absolute detection: the chance a dog at a team position detects ONE person at a given source
 * block, from the scent that person alone would put there.
 *
 * The ensemble releases scent from every possible location in proportion to its probability and
 * records, per (team position r, source block s), how much arrived (contrib). Dividing by the
 * source's probability q_s gives the concentration a single person at s would produce at r (same
 * units for every source). That is compared with a reference plume: one person upwind in a steady,
 * neutral wind (DETECTION.refWind, class D, neutral scent decay), simulated with the same ensemble
 * machinery and grid. The curve is anchored by one handler-readable number, DETECTION.d50M: the
 * distance straight downwind at which a dog detects that person half the time. Beyond that it is a
 * logistic in log-concentration, 0.9 at half the distance and 0.1 at twice it.
 */
import { DETECTION, ENSEMBLE, HOTSPOTS, TURBULENCE } from '../config/modelParams';
import { frameOf, type GridMeta } from '../geo/grid';
import type { Place, Weather } from './env';
import { blockIndex, normalizeContrib, runEnsemble, type BlockIndex } from './scent';
import { buildTerrainInfo, LC } from './terrainInfo';
import type { WindField } from './wind';

export interface DetectionCurve {
  /** ln concentration at d50 (detection 0.5) */
  lnC50: number;
  /** logistic slope per unit ln concentration */
  k: number;
  /** concentration along the reference centreline by distance (m), for display and tests */
  profile: { d: number; c: number }[];
}

const cache = new Map<string, DetectionCurve>();

/**
 * Block totals -> peak concentration. Scent is tracked per 50 m receiver block, but a plume a few
 * hundred metres from a person is often only tens of metres wide, so a block total barely changes
 * with distance while the concentration a dog meets in the plume falls roughly as 1/width. The
 * dog crosses the plume as it works the block, so what matters is the peak: block mean × block
 * width / (√(2π)·σy), with σy from the Briggs curve the turbulence model is calibrated to (a for
 * the stability class), never below one cell and never above the block.
 */
export function peakFactor(distM: number, sigmaA: number, cellM: number, blockM: number): number {
  const x = Math.max(distM, cellM);
  const sigma = Math.max(cellM / 2, sigmaA * x * Math.pow(1 + 0.0001 * x, -0.5));
  return Math.min(blockM / cellM, Math.max(1, blockM / (Math.sqrt(2 * Math.PI) * sigma)));
}

/** Distance (m) between receiver block r and source block s centres. */
export function blockDistance(b: BlockIndex, r: number, s: number, cellM: number): number {
  const rx = (r % b.recvCols) * b.recvBlock + (b.recvBlock - 1) / 2;
  const ry = Math.floor(r / b.recvCols) * b.recvBlock + (b.recvBlock - 1) / 2;
  const sx = (s % b.srcCols) * b.srcBlock + (b.srcBlock - 1) / 2;
  const sy = Math.floor(s / b.srcCols) * b.srcBlock + (b.srcBlock - 1) / 2;
  return Math.hypot(rx - sx, ry - sy) * cellM;
}

/**
 * Reference single-person plume, measured with the production block layout.
 * members = ENSEMBLE.members (default) calibrates the planner: its ensemble spreads each plume over
 * the forecast-direction uncertainty, so this curve gives the expected detection under that
 * uncertainty. members = 1 calibrates a single real plume (truth worlds in the evaluation).
 */
export function calibrateDetection(opts: { d50M?: number; particles?: number; members?: number; rotDeg?: number } = {}): DetectionCurve {
  const d50 = opts.d50M ?? DETECTION.d50M;
  const particles = opts.particles ?? ENSEMBLE.particlesPerMember;
  const members = opts.members ?? ENSEMBLE.members;
  const rotDeg = opts.rotDeg ?? ENSEMBLE.rotDeg;
  const key = `${d50}|${particles}|${members}|${DETECTION.refWind}|${HOTSPOTS.recvBlockCells}|${HOTSPOTS.srcBlockCells}|${rotDeg}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const cell = 10;
  const sb = HOTSPOTS.srcBlockCells;
  const rb = HOTSPOTS.recvBlockCells;
  const cols = Math.ceil((d50 * 2.6 + 200) / cell / rb) * rb;
  const rows = Math.ceil(Math.max(400, d50 * 1.6) / cell / (sb * 2)) * sb * 2;
  const meta: GridMeta = { crs: 'EPSG:32618', originX: 500000, originY: 4600000, cellSize: cell, cols, rows, noData: -9999 };
  const ti = buildTerrainInfo(meta, frameOf(meta), new Float32Array(cols * rows).fill(100), new Uint8Array(cols * rows).fill(LC.open));
  const u = new Float32Array(cols * rows).fill(DETECTION.refWind);
  const v = new Float32Array(cols * rows);
  const field: WindField = { hours: [0, 23], grids: [{ u, v }, { u, v }] };
  const weather: Weather = {
    utcOffsetSeconds: 0,
    hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, temperature: 10, humidity: 60, cloudCover: 100, windSpeed: DETECTION.refWind / 0.7, windDirection: 270 })),
  };
  const place: Place = { date: '2026-06-21', lat: 45, lon: 0, utcOffsetSeconds: 0 };
  // the person: one source block, west edge, middle row
  const blocks: BlockIndex = blockIndex(cols, rows, rb, sb);
  const prob = new Float32Array(cols * rows);
  const r0 = Math.floor(rows / 2 / sb) * sb; // aligned to a source block, so the block holds all of it
  for (let r = r0; r < r0 + sb; r++) for (let c = 0; c < sb; c++) prob[r * cols + c] = 1 / (sb * sb);
  const src = blocks.srcOf[r0 * cols];
  const { contrib } = normalizeContrib(runEnsemble({ ti, field, place, weather, prob, tEnd: 12, members, particles, blocks, neutral: true, seed: 7, rotDeg }), members, particles);
  // centreline: in each column of receiver blocks, the plume core. The source block's centre lies
  // on a receiver-block edge, so the plume splits between two blocks: take the best adjacent pair.
  const recvRows = blocks.nRecv / blocks.recvCols;
  const srcX = (sb - 1) / 2;
  const sigmaA = TURBULENCE.briggsA.D; // reference: neutral, class D
  const profile: { d: number; c: number }[] = [];
  for (let rc = 0; rc < blocks.recvCols; rc++) {
    let best = 0;
    let bestR = 0;
    for (let rr = 0; rr + 1 < recvRows; rr++) {
      const a = contrib![(rr * blocks.recvCols + rc) * blocks.nSrc + src] + contrib![((rr + 1) * blocks.recvCols + rc) * blocks.nSrc + src];
      if (a > best) {
        best = a;
        bestR = rr;
      }
    }
    const d = (rc * rb + (rb - 1) / 2 - srcX) * cell;
    const dist = blockDistance(blocks, bestR * blocks.recvCols + rc, src, cell);
    profile.push({ d, c: best * peakFactor(dist, sigmaA, cell, rb * cell) });
  }
  const lnAt = (d: number) => {
    const pts = profile.filter((p) => p.c > 0 && p.d > 0);
    let lo = pts[0];
    for (const p of pts) {
      if (p.d >= d) {
        if (p === lo) return Math.log(p.c);
        const f = (d - lo.d) / (p.d - lo.d);
        return Math.log(lo.c) * (1 - f) + Math.log(p.c) * f;
      }
      lo = p;
    }
    return Math.log(lo.c);
  };
  const lnC50 = lnAt(d50);
  // 0.9 at d50/2 and 0.1 at 2·d50: fit one slope through both
  const span = lnAt(d50 / 2) - lnAt(d50 * 2);
  const k = span > 0 ? (2 * Math.log(9)) / span : 4;
  const curve = { lnC50, k, profile };
  cache.set(key, curve);
  return curve;
}

/** Detection probability for a single-person concentration. */
export function detectFromConc(c: number, curve: DetectionCurve): number {
  if (c <= 0) return 0;
  return 1 / (1 + Math.exp(-curve.k * (Math.log(c) - curve.lnC50)));
}

export interface ReceiverDetection {
  /** CSR layout: sources of receiver r are src[start[r] .. start[r+1]) */
  start: Int32Array;
  src: Int32Array;
  det: Float32Array;
}

/**
 * Per team position, the sources it could detect (detection ≥ minDet). q_s is floored at
 * DETECTION.minQ so a barely-sampled source (a handful of particles) can't look like a full plume.
 */
export function receiverDetection(
  contrib: Float32Array,
  q: Float32Array,
  b: BlockIndex,
  curve: DetectionCurve,
  minDet = 0.01,
  /** Briggs coefficient for the current stability class (plume width), and the grid cell size */
  opts: { sigmaA?: number; cellM?: number } = {},
): ReceiverDetection {
  const sigmaA = opts.sigmaA ?? TURBULENCE.briggsA.D;
  const cellM = opts.cellM ?? 10;
  const blockM = b.recvBlock * cellM;
  const start = new Int32Array(b.nRecv + 1);
  const src: number[] = [];
  const det: number[] = [];
  const inv = new Float32Array(b.nSrc);
  for (let s = 0; s < b.nSrc; s++) inv[s] = q[s] > 0 ? 1 / Math.max(q[s], DETECTION.minQ) : 0;
  for (let r = 0; r < b.nRecv; r++) {
    start[r] = src.length;
    const off = r * b.nSrc;
    for (let s = 0; s < b.nSrc; s++) {
      const c = contrib[off + s];
      if (c <= 0 || inv[s] === 0) continue;
      const d = detectFromConc(c * inv[s] * peakFactor(blockDistance(b, r, s, cellM), sigmaA, cellM, blockM), curve);
      if (d >= minDet) {
        src.push(s);
        det.push(d);
      }
    }
  }
  start[b.nRecv] = src.length;
  return { start, src: Int32Array.from(src), det: Float32Array.from(det) };
}
