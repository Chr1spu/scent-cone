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
import { DETECTION, ENSEMBLE, HOTSPOTS } from '../config/modelParams';
import { frameOf, type GridMeta } from '../geo/grid';
import type { Place, Weather } from './env';
import { blockIndex, runEnsemble, type BlockIndex } from './scent';
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
  const r0 = rows / 2 - sb / 2;
  for (let r = r0; r < r0 + sb; r++) for (let c = 0; c < sb; c++) prob[r * cols + c] = 1 / (sb * sb);
  const src = blocks.srcOf[r0 * cols];
  const { contrib } = runEnsemble({ ti, field, place, weather, prob, tEnd: 12, members, particles, blocks, neutral: true, seed: 7, rotDeg });
  // centreline: strongest receiver in each column of receiver blocks
  const recvRows = blocks.nRecv / blocks.recvCols;
  const srcX = (sb - 1) / 2;
  const profile: { d: number; c: number }[] = [];
  for (let rc = 0; rc < blocks.recvCols; rc++) {
    let best = 0;
    for (let rr = 0; rr < recvRows; rr++) best = Math.max(best, contrib![(rr * blocks.recvCols + rc) * blocks.nSrc + src]);
    profile.push({ d: (rc * rb + (rb - 1) / 2 - srcX) * cell, c: best });
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
export function receiverDetection(contrib: Float32Array, q: Float32Array, b: BlockIndex, curve: DetectionCurve, minDet = 0.01): ReceiverDetection {
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
      const d = detectFromConc(c * inv[s], curve);
      if (d >= minDet) {
        src.push(s);
        det.push(d);
      }
    }
  }
  start[b.nRecv] = src.length;
  return { start, src: Int32Array.from(src), det: Float32Array.from(det) };
}
