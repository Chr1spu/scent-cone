/**
 * Search segments, the way search managers assign dog teams: the area is cut into pieces of a
 * size one team searches in a few hours, with edges on things a team can recognise on the ground
 * (trails, roads, streams, ridgelines), each named like an ICS assignment (A1, A2, …). A dog
 * team is then given a whole segment; the handler picks the pattern. Scentline scores each
 * segment for a dog team at a given time: probability inside, the chance the team finds a person
 * there, scent it catches from outside, which edge to enter from (downwind) and how long it takes.
 *
 * Segmentation: seeds on a hexagonal grid, grown by multi-source least-cost distance in which
 * crossing a boundary feature is expensive, so regions stop at features where there are any and
 * fall back to compact shapes where there aren't. Pure; no React/three.
 */
import { HOTSPOTS, SEGMENTS } from '../config/modelParams';
import { boxBlur, cellAt, type GridMap } from '../geo/grid';
import { rasterizeLines, type Feature2D } from './probability';
import type { ReceiverDetection } from './detection';
import type { WindAt } from './hotspots';
import type { BlockIndex } from './scent';

export interface Segmentation {
  /** segment per detail cell, -1 where none (water) */
  id: Int32Array;
  n: number;
  names: string[];
  areaM2: Float64Array;
  centroid: [number, number][];
  /** outline rings per segment (local metres), simplified */
  rings: [number, number][][][];
}

export interface SegmentInput {
  map: GridMap;
  /** cells on features segment edges should follow (trails, roads, streams, ridgelines) */
  boundary: Uint8Array;
  /** cells no segment covers (water) */
  excluded: Uint8Array;
  /** target segment area (m²), default SEGMENTS.targetM2 */
  targetM2?: number;
}

/**
 * Cells segment edges should follow: trails, roads, streams and rivers, and ridgelines (cells at
 * least SEGMENTS.ridgeReliefM above the mean elevation within ~150 m).
 */
export function segmentBoundary(feats: Feature2D[], map: GridMap, elev: Float32Array): Uint8Array {
  const { cols, rows } = map;
  const boundary = new Uint8Array(cols * rows);
  rasterizeLines(feats.filter((f) => !f.polygon && (f.kind === 'trail' || f.kind === 'road' || f.kind === 'stream' || f.kind === 'river')), map, boundary);
  const radius = Math.max(1, Math.round(150 * map.inv));
  const mean = boxBlur(boxBlur(elev, cols, rows, radius), cols, rows, radius);
  for (let i = 0; i < boundary.length; i++) if (elev[i] - mean[i] >= SEGMENTS.ridgeReliefM) boundary[i] = 1;
  return boundary;
}

// ---------------------------------------------------------------- small binary heap

class Heap {
  private k: Float64Array;
  private v: Int32Array;
  size = 0;
  constructor(cap: number) {
    this.k = new Float64Array(cap);
    this.v = new Int32Array(cap);
  }
  push(key: number, val: number) {
    if (this.size === this.k.length) {
      const k = new Float64Array(this.size * 2);
      k.set(this.k);
      this.k = k;
      const v = new Int32Array(this.size * 2);
      v.set(this.v);
      this.v = v;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= key) break;
      this.k[i] = this.k[p];
      this.v[i] = this.v[p];
      i = p;
    }
    this.k[i] = key;
    this.v[i] = val;
  }
  pop(): [number, number] {
    const top: [number, number] = [this.k[0], this.v[0]];
    const key = this.k[--this.size];
    const val = this.v[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.k[c + 1] < this.k[c]) c++;
      if (this.k[c] >= key) break;
      this.k[i] = this.k[c];
      this.v[i] = this.v[c];
      i = c;
    }
    this.k[i] = key;
    this.v[i] = val;
    return top;
  }
}

const DR = [-1, 1, 0, 0, -1, -1, 1, 1];
const DC = [0, 0, -1, 1, -1, 1, -1, 1];

/** Grow regions from seed cells by least-cost distance; boundary cells cost `cross`× to enter. */
function grow(seeds: number[], cols: number, rows: number, boundary: Uint8Array, excluded: Uint8Array, cross: number): Int32Array {
  const n = cols * rows;
  const id = new Int32Array(n).fill(-1);
  const dist = new Float64Array(n).fill(Infinity);
  const heap = new Heap(1 << 15);
  seeds.forEach((c, k) => {
    dist[c] = 0;
    id[c] = k;
    heap.push(0, c);
  });
  while (heap.size > 0) {
    const [d, i] = heap.pop();
    if (d > dist[i]) continue;
    const r = Math.floor(i / cols);
    const c = i - r * cols;
    for (let q = 0; q < 8; q++) {
      const rr = r + DR[q];
      const cc = c + DC[q];
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
      const j = rr * cols + cc;
      if (excluded[j]) continue;
      const nd = d + (q < 4 ? 1 : Math.SQRT2) * (boundary[j] ? cross : 1);
      if (nd < dist[j]) {
        dist[j] = nd;
        id[j] = id[i];
        heap.push(nd, j);
      }
    }
  }
  return id;
}

/** Relabel so ids are 0..k-1 with no gaps; returns the count. */
function compact(id: Int32Array): number {
  const map = new Map<number, number>();
  for (let i = 0; i < id.length; i++) {
    if (id[i] < 0) continue;
    let m = map.get(id[i]);
    if (m === undefined) {
      m = map.size;
      map.set(id[i], m);
    }
    id[i] = m;
  }
  return map.size;
}

export function segmentArea(inp: SegmentInput): Segmentation {
  const { map, boundary, excluded } = inp;
  const { cols, rows } = map;
  const cell = 1 / map.inv;
  const target = inp.targetM2 ?? SEGMENTS.targetM2;
  // hexagonal seed lattice with one seed per target area
  const s = Math.sqrt((2 * target) / Math.sqrt(3)) / cell; // spacing in cells
  const seeds: number[] = [];
  const taken = new Uint8Array(cols * rows);
  for (let r = s / 2, row = 0; r < rows; r += (s * Math.sqrt(3)) / 2, row++) {
    for (let c = (row % 2 ? s : s / 2); c < cols; c += s) {
      // nudge onto a usable cell that is not on a feature
      let best = -1;
      let bd = Infinity;
      const rad = Math.ceil(s / 3);
      for (let dr = -rad; dr <= rad; dr++)
        for (let dc = -rad; dc <= rad; dc++) {
          const rr = Math.round(r) + dr;
          const cc = Math.round(c) + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const j = rr * cols + cc;
          if (excluded[j] || boundary[j] || taken[j]) continue;
          const d = dr * dr + dc * dc;
          if (d < bd) {
            bd = d;
            best = j;
          }
        }
      if (best >= 0) {
        seeds.push(best);
        taken[best] = 1;
      }
    }
  }
  let id = grow(seeds, cols, rows, boundary, excluded, SEGMENTS.crossCost);
  // fold slivers (cut off by features) into the neighbour they share the longest edge with
  const minCells = (SEGMENTS.minFraction * target) / (cell * cell);
  for (let pass = 0; pass < 3; pass++) {
    const k = compact(id);
    const count = new Float64Array(k);
    for (let i = 0; i < id.length; i++) if (id[i] >= 0) count[id[i]]++;
    const small = new Set<number>();
    for (let a = 0; a < k; a++) if (count[a] < minCells) small.add(a);
    if (small.size === 0) break;
    const shared = new Map<number, Map<number, number>>();
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const a = id[r * cols + c];
        if (a < 0 || !small.has(a)) continue;
        for (let q = 0; q < 4; q++) {
          const rr = r + DR[q];
          const cc = c + DC[q];
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const b = id[rr * cols + cc];
          if (b < 0 || b === a) continue;
          const m = shared.get(a) ?? new Map<number, number>();
          m.set(b, (m.get(b) ?? 0) + 1);
          shared.set(a, m);
        }
      }
    const into = new Map<number, number>();
    for (const a of small) {
      const m = shared.get(a);
      if (!m) continue;
      let best = -1;
      let bn = -1;
      for (const [b, v] of m) if (!small.has(b) && v > bn) {
        bn = v;
        best = b;
      }
      if (best < 0) for (const [b, v] of m) if (v > bn) {
        bn = v;
        best = b;
      }
      if (best >= 0) into.set(a, best);
    }
    if (into.size === 0) break;
    id = id.map((v) => (v >= 0 && into.has(v) ? into.get(v)! : v));
  }
  const n = compact(id);
  // geometry
  const areaM2 = new Float64Array(n);
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  for (let i = 0; i < id.length; i++) {
    const k = id[i];
    if (k < 0) continue;
    areaM2[k] += cell * cell;
    const r = Math.floor(i / cols);
    sx[k] += (i - r * cols - map.ox) / map.inv;
    sy[k] += -(r - map.oy) / map.inv;
  }
  const centroid: [number, number][] = Array.from({ length: n }, (_, k) => [sx[k] / (areaM2[k] / (cell * cell)), sy[k] / (areaM2[k] / (cell * cell))]);
  const names = nameSegments(centroid, Math.sqrt(target));
  const rings = traceOutlines(id, n, map).map((rs) => rs.map((ring) => simplify(ring, cell * SEGMENTS.simplifyCells)));
  return { id, n, names, areaM2, centroid, rings };
}

/** Rows of segments north to south get letters, west to east within a row get numbers: A1, A2, B1… */
export function nameSegments(centroid: [number, number][], rowHeight: number): string[] {
  const order = centroid.map((_, k) => k).sort((a, b) => centroid[b][1] - centroid[a][1]);
  const names = new Array<string>(centroid.length);
  let row = -1;
  let rowTop = Infinity;
  let members: number[] = [];
  const flush = () => {
    members.sort((a, b) => centroid[a][0] - centroid[b][0]);
    const letter = row < 26 ? String.fromCharCode(65 + row) : `Z${row - 25}`;
    members.forEach((k, i) => (names[k] = `${letter}${i + 1}`));
    members = [];
  };
  for (const k of order) {
    if (rowTop - centroid[k][1] > rowHeight * 0.75 || row < 0) {
      if (row >= 0) flush();
      row++;
      rowTop = centroid[k][1];
    }
    members.push(k);
  }
  if (members.length) flush();
  return names;
}

/**
 * Outline rings of each region along cell edges (local metres). Directed edges keep the region on
 * one side; chaining them gives closed rings (outer boundary and any holes).
 */
export function traceOutlines(id: Int32Array, n: number, map: GridMap): [number, number][][][] {
  const { cols, rows } = map;
  const W = cols + 1;
  const edges: Map<number, number[]>[] = Array.from({ length: n }, () => new Map());
  const add = (k: number, a: number, b: number) => {
    const m = edges[k];
    const l = m.get(a);
    if (l) l.push(b);
    else m.set(a, [b]);
  };
  const at = (r: number, c: number) => (r < 0 || c < 0 || r >= rows || c >= cols ? -1 : id[r * cols + c]);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const k = id[r * cols + c];
      if (k < 0) continue;
      // vertex (vr, vc) -> vr * W + vc; clockwise in grid (row-down) coordinates
      if (at(r - 1, c) !== k) add(k, r * W + c, r * W + c + 1);
      if (at(r, c + 1) !== k) add(k, r * W + c + 1, (r + 1) * W + c + 1);
      if (at(r + 1, c) !== k) add(k, (r + 1) * W + c + 1, (r + 1) * W + c);
      if (at(r, c - 1) !== k) add(k, (r + 1) * W + c, r * W + c);
    }
  const toLocal = (v: number): [number, number] => {
    const vr = Math.floor(v / W);
    const vc = v - vr * W;
    return [(vc - 0.5 - map.ox) / map.inv, -(vr - 0.5 - map.oy) / map.inv];
  };
  return edges.map((m) => {
    const rings: [number, number][][] = [];
    for (const start of m.keys()) {
      while ((m.get(start)?.length ?? 0) > 0) {
        const ring: [number, number][] = [toLocal(start)];
        let v = start;
        for (let guard = 0; guard < 1e6; guard++) {
          const outs = m.get(v)!;
          const next = outs.pop()!;
          if (outs.length === 0) m.delete(v);
          v = next;
          ring.push(toLocal(v));
          if (v === start) break;
          if (!m.has(v)) break;
        }
        if (ring.length > 3) rings.push(ring);
      }
    }
    // largest ring first (the outer boundary)
    return rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  });
}

export function ringArea(r: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return a / 2;
}

/** Douglas–Peucker simplification of a closed ring (keeps it closed). */
export function simplify(ring: [number, number][], tol: number): [number, number][] {
  if (ring.length < 5) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  // split a closed ring at its farthest point from the start so both halves simplify well
  let far = 0;
  let fd = -1;
  for (let i = 1; i < ring.length - 1; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  keep[far] = 1;
  const stack: [number, number][] = [
    [0, far],
    [far, ring.length - 1],
  ];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let idx = -1;
    let dmax = tol;
    const [x1, y1] = ring[a];
    const [x2, y2] = ring[b];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((x2 - x1) * (y1 - ring[i][1]) - (x1 - ring[i][0]) * (y2 - y1)) / len;
      if (d > dmax) {
        dmax = d;
        idx = i;
      }
    }
    if (idx >= 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

/** Point-in-segment test via the cell grid. */
export function segmentAt(seg: Segmentation, map: GridMap, x: number, y: number): number {
  const c = cellAt(map, x, y);
  return c < 0 ? -1 : seg.id[c];
}

// ---------------------------------------------------------------- scoring for a dog team

/**
 * Chance a team searching a whole segment detects a person who is in it (before acting on it):
 * 1 − e^(−coverage), coverage = SEGMENTS.coverageRef × scent conditions (scent present relative
 * to neutral, clamped).
 */
export function sweepDetection(relStrength: number): number {
  const cond = Math.min(SEGMENTS.maxCond, Math.max(SEGMENTS.minCond, relStrength));
  return 1 - Math.exp(-SEGMENTS.coverageRef * cond);
}

export interface SegmentScore {
  seg: number;
  /** share of the (focus-square) probability inside the segment */
  poa: number;
  /** chance the team finds a person who is inside the segment (model POD) */
  podInside: number;
  /** share of the total probability the team would find, inside and out (expected find) */
  value: number;
  /** of `value`, the part from people outside the segment whose scent drifts in */
  fromOutside: number;
  /** where to enter: the downwind edge (local metres) */
  entry: [number, number];
  /** unit vector to work toward (upwind) */
  upwind: [number, number];
  windSpeed: number;
  /** hours for one team at SEGMENTS.teamRateM2PerH */
  hours: number;
  /** the sources it covers, with detection (for combining teams) */
  cover: { src: Int32Array; d: Float32Array };
  /** the same for walking the segment alone, ignoring drifted scent (hedge teams) */
  insideCover: { src: Int32Array; d: Float32Array };
}

/** Receiver blocks per segment, by the segment holding each block's centre cell. */
export function receiversOfSegments(seg: Segmentation, map: GridMap, b: BlockIndex): number[][] {
  const out: number[][] = Array.from({ length: seg.n }, () => []);
  for (let r = 0; r < b.nRecv; r++) {
    const c = Math.min(map.cols - 1, (r % b.recvCols) * b.recvBlock + Math.floor(b.recvBlock / 2));
    const rr = Math.min(map.rows - 1, Math.floor(r / b.recvCols) * b.recvBlock + Math.floor(b.recvBlock / 2));
    const k = seg.id[rr * map.cols + c];
    if (k >= 0) out[k].push(r);
  }
  return out;
}

export interface ScoreInput {
  seg: Segmentation;
  map: GridMap;
  blocks: BlockIndex;
  det: ReceiverDetection;
  /** source-block probability */
  q: Float32Array;
  deployable: Uint8Array;
  windAt: WindAt;
  /** detection for people inside a segment the team searches (sweepDetection), default reference conditions */
  insideDet?: number;
  /** chance the team acts on a detection, default HOTSPOTS.dogPOD */
  pod?: number;
}

/**
 * A team searching a whole segment passes through every receiver block in it, so it detects each
 * possible location with the best single-person detection anywhere in the segment, and people
 * inside it at least at `insideDet` (it walks the ground). Probabilities are per source block.
 */
export function scoreSegments(inp: ScoreInput): SegmentScore[] {
  const { seg, map, blocks: b, det, q } = inp;
  const pod = inp.pod ?? HOTSPOTS.dogPOD;
  const inside = inp.insideDet ?? sweepDetection(1);
  const cols = map.cols;
  // receiver blocks and source blocks by the segment holding their centre cell
  const centreSeg = (blockCol: number, blockRow: number, size: number) => {
    const c = Math.min(cols - 1, blockCol * size + Math.floor(size / 2));
    const r = Math.min(map.rows - 1, blockRow * size + Math.floor(size / 2));
    return seg.id[r * cols + c];
  };
  const recvOfSeg = receiversOfSegments(seg, map, b);
  const srcSeg = new Int32Array(b.nSrc);
  for (let s = 0; s < b.nSrc; s++) srcSeg[s] = centreSeg(s % b.srcCols, Math.floor(s / b.srcCols), b.srcBlock);
  let qTotal = 0;
  for (let s = 0; s < b.nSrc; s++) qTotal += q[s];
  const val = new Float32Array(b.nSrc);
  const out: SegmentScore[] = [];
  for (let k = 0; k < seg.n; k++) {
    const touched: number[] = [];
    const bump = (s: number, d: number) => {
      if (val[s] === 0) touched.push(s);
      if (d > val[s]) val[s] = d;
    };
    // people outside: scent that drifts into the segment; people inside: search-theory coverage
    // (scent at zero range always "detects", so it would say nothing about conditions)
    for (const r of recvOfSeg[k]) for (let j = det.start[r]; j < det.start[r + 1]; j++) if (srcSeg[det.src[j]] !== k) bump(det.src[j], det.det[j]);
    for (let s = 0; s < b.nSrc; s++) if (srcSeg[s] === k && q[s] > 0) bump(s, inside);
    let poa = 0;
    let foundIn = 0;
    let foundOut = 0;
    const src = new Int32Array(touched.length);
    const d = new Float32Array(touched.length);
    touched.forEach((s, i) => {
      src[i] = s;
      d[i] = val[s];
      const f = q[s] * pod * val[s];
      if (srcSeg[s] === k) foundIn += f;
      else foundOut += f;
      val[s] = 0;
    });
    const ins: number[] = [];
    for (let s = 0; s < b.nSrc; s++)
      if (srcSeg[s] === k) {
        poa += q[s];
        if (q[s] > 0) ins.push(s);
      }
    // wind over the segment: mean of its receivers' centres
    let u = 0;
    let v = 0;
    for (const r of recvOfSeg[k]) {
      const c = Math.min(cols - 1, (r % b.recvCols) * b.recvBlock + Math.floor(b.recvBlock / 2));
      const rr = Math.min(map.rows - 1, Math.floor(r / b.recvCols) * b.recvBlock + Math.floor(b.recvBlock / 2));
      const w = inp.windAt((c - map.ox) / map.inv, -(rr - map.oy) / map.inv);
      u += w.u;
      v += w.v;
    }
    const sp = Math.hypot(u, v);
    const wn = recvOfSeg[k].length || 1;
    const dir: [number, number] = sp > 1e-6 ? [u / sp, v / sp] : [0, 1];
    out.push({
      seg: k,
      poa: poa / (qTotal || 1),
      podInside: poa > 0 ? foundIn / poa : pod * inside,
      value: (foundIn + foundOut) / (qTotal || 1),
      fromOutside: foundOut / (qTotal || 1),
      entry: entryPoint(seg, k, map, inp.deployable, dir),
      upwind: [-dir[0], -dir[1]],
      windSpeed: sp / wn,
      hours: seg.areaM2[k] / SEGMENTS.teamRateM2PerH,
      cover: { src, d },
      insideCover: { src: Int32Array.from(ins), d: new Float32Array(ins.length).fill(inside) },
    });
  }
  return out;
}

/** The usable cell farthest downwind in the segment (enter there and work upwind). */
function entryPoint(seg: Segmentation, k: number, map: GridMap, deployable: Uint8Array, downwind: [number, number]): [number, number] {
  const [cx, cy] = seg.centroid[k];
  let best: [number, number] = [cx, cy];
  let bd = -Infinity;
  for (let i = 0; i < seg.id.length; i++) {
    if (seg.id[i] !== k || !deployable[i]) continue;
    const r = Math.floor(i / map.cols);
    const x = (i - r * map.cols - map.ox) / map.inv;
    const y = -(r - map.oy) / map.inv;
    // downwind, and not off at a corner: penalise distance across the wind
    const along = (x - cx) * downwind[0] + (y - cy) * downwind[1];
    const across = Math.abs(-(x - cx) * downwind[1] + (y - cy) * downwind[0]);
    const score = along - 0.5 * across;
    if (score > bd) {
      bd = score;
      best = [x, y];
    }
  }
  return best;
}

export interface SegmentAssignment {
  team: number;
  score: SegmentScore;
  /** expected find from this team given the teams before it */
  marginal: number;
  /** a hedge team, chosen for the likeliest ground rather than drifted scent */
  ground: boolean;
}

/**
 * Give T teams the segments that add the most expected find, discounting what earlier teams
 * already cover (each source: P(missed) multiplies by 1 − pod·d per team).
 */
export function assignSegments(scores: SegmentScore[], q: Float32Array, teams: number, pod = HOTSPOTS.dogPOD, scentTeams = teams): SegmentAssignment[] {
  const miss = new Float64Array(q.length).fill(1);
  // hedge teams (after scentTeams) walk the likeliest ground, scored without drifted scent and
  // without leaning on what the scent-placed teams are assumed to cover
  const missGround = new Float64Array(q.length).fill(1);
  let qTotal = 0;
  for (let s = 0; s < q.length; s++) qTotal += q[s];
  const used = new Set<number>();
  const out: SegmentAssignment[] = [];
  for (let t = 0; t < teams; t++) {
    const ground = t >= scentTeams;
    const m = ground ? missGround : miss;
    let best: SegmentScore | null = null;
    let bv = 0;
    for (const sc of scores) {
      if (used.has(sc.seg)) continue;
      const cv = ground ? sc.insideCover : sc.cover;
      let v = 0;
      for (let i = 0; i < cv.src.length; i++) v += q[cv.src[i]] * m[cv.src[i]] * pod * cv.d[i];
      if (v > bv) {
        bv = v;
        best = sc;
      }
    }
    if (!best || bv / (qTotal || 1) < 0.005) break;
    used.add(best.seg);
    const cv = ground ? best.insideCover : best.cover;
    // the team really covers everything its segment gets (scent too); the hedge only chooses differently
    let marginal = 0;
    for (let i = 0; i < best.cover.src.length; i++) marginal += q[best.cover.src[i]] * miss[best.cover.src[i]] * pod * best.cover.d[i];
    for (let i = 0; i < best.cover.src.length; i++) miss[best.cover.src[i]] *= 1 - pod * best.cover.d[i];
    if (ground) for (let i = 0; i < cv.src.length; i++) missGround[cv.src[i]] *= 1 - pod * cv.d[i];
    out.push({ team: t + 1, score: best, marginal: marginal / (qTotal || 1), ground });
  }
  return out;
}
