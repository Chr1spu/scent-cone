import { describe, expect, it } from 'vitest';
import { HOTSPOTS } from '../config/modelParams';
import { cellAt, frameOf, gridMap, type GridMeta } from '../geo/grid';
import type { ReceiverDetection } from './detection';
import { blockIndex } from './scent';
import { assignSegments, nameSegments, ringArea, scoreSegments, segmentArea, segmentAt, sweepDetection } from './segments';

const n = 100;
const meta: GridMeta = { crs: 'EPSG:32618', originX: 500000, originY: 4600000, cellSize: 10, cols: n, rows: n, noData: -9999 };
const map = gridMap(meta, frameOf(meta));
const none = new Uint8Array(n * n);
const noDet = (nRecv: number): ReceiverDetection => ({ start: new Int32Array(nRecv + 1), src: new Int32Array(0), det: new Float32Array(0) });

describe('segmentation', () => {
  it('covers the area with segments near the target size, named A1, A2, …', () => {
    const seg = segmentArea({ map, boundary: none, excluded: none, targetM2: 100_000 });
    expect(seg.n).toBeGreaterThanOrEqual(7);
    expect(seg.n).toBeLessThanOrEqual(14);
    for (let i = 0; i < seg.id.length; i++) expect(seg.id[i]).toBeGreaterThanOrEqual(0);
    for (const a of seg.areaM2) {
      expect(a).toBeGreaterThan(30_000);
      expect(a).toBeLessThan(250_000);
    }
    expect(new Set(seg.names).size).toBe(seg.n);
    expect(seg.names).toContain('A1');
    // A is the northernmost row
    const a1 = seg.names.indexOf('A1');
    expect(Math.max(...seg.centroid.map((c) => c[1]))).toBeCloseTo(Math.max(...seg.centroid.filter((_, k) => seg.names[k].startsWith('A')).map((c) => c[1])), 6);
    expect(a1).toBeGreaterThanOrEqual(0);
  });
  it('puts edges on features: segments rarely straddle a stream', () => {
    const boundary = new Uint8Array(n * n);
    for (let c = 0; c < n; c++) boundary[47 * n + c] = 1; // a stream across the middle, slightly off the seed rows
    const seg = segmentArea({ map, boundary, excluded: none, targetM2: 100_000 });
    let straddle = 0;
    for (let k = 0; k < seg.n; k++) {
      let north = 0;
      let south = 0;
      for (let i = 0; i < seg.id.length; i++) {
        if (seg.id[i] !== k || boundary[i]) continue;
        if (Math.floor(i / n) < 47) north++;
        else south++;
      }
      if (Math.min(north, south) > 0.1 * (north + south)) straddle++;
    }
    expect(straddle).toBe(0);
  });
  it('leaves water out', () => {
    const excluded = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 80; c < n; c++) excluded[r * n + c] = 1;
    const seg = segmentArea({ map, boundary: none, excluded, targetM2: 100_000 });
    expect(seg.id[50 * n + 90]).toBe(-1);
    expect(seg.id[50 * n + 10]).toBeGreaterThanOrEqual(0);
  });
  it('traces outlines that enclose each segment’s area', () => {
    const seg = segmentArea({ map, boundary: none, excluded: none, targetM2: 100_000 });
    for (let k = 0; k < seg.n; k++) {
      const outer = seg.rings[k][0];
      // simplification shaves a little off the staircase; within 10%
      expect(Math.abs(Math.abs(ringArea(outer)) - seg.areaM2[k]) / seg.areaM2[k]).toBeLessThan(0.1);
    }
  });
  it('names rows north to south and west to east', () => {
    expect(
      nameSegments(
        [
          [0, 100],
          [-100, 100],
          [0, -100],
        ],
        150,
      ),
    ).toEqual(['A2', 'A1', 'B1']);
  });
});

describe('segment scoring and assignment', () => {
  const seg = segmentArea({ map, boundary: none, excluded: none, targetM2: 100_000 });
  const blocks = blockIndex(n, n, HOTSPOTS.recvBlockCells, HOTSPOTS.srcBlockCells);
  const q = new Float32Array(blocks.nSrc);
  const home = cellAt(map, -200, 200);
  q[blocks.srcOf[home]] = 1;
  const windAt = () => ({ u: 1.5, v: 0 }); // toward the east
  const scores = scoreSegments({ seg, map, blocks, det: noDet(blocks.nRecv), q, deployable: new Uint8Array(n * n).fill(1), windAt });
  const homeSeg = seg.id[home];
  it('gives the segment holding the probability its POA and the walk-through POD', () => {
    const s = scores[homeSeg];
    expect(s.poa).toBeCloseTo(1, 5);
    expect(s.podInside).toBeCloseTo(HOTSPOTS.dogPOD * sweepDetection(1), 5);
    expect(s.podInside).toBeCloseTo(0.5, 2); // NASAR's working average for a dog team
    expect(s.fromOutside).toBe(0);
    for (const o of scores) if (o.seg !== homeSeg) expect(o.value).toBe(0);
  });
  it('search-theory detection rises with scent conditions and saturates', () => {
    expect(sweepDetection(0.3)).toBeLessThan(sweepDetection(1));
    expect(sweepDetection(1)).toBeLessThan(sweepDetection(1.5));
    expect(sweepDetection(5)).toBeCloseTo(sweepDetection(1.5), 9); // clamped
    expect(sweepDetection(0)).toBeGreaterThan(0); // never zero: the team still walks the ground
  });
  it('enters from the downwind edge and works upwind', () => {
    const s = scores[homeSeg];
    expect(s.entry[0]).toBeGreaterThan(seg.centroid[homeSeg][0]);
    expect(s.upwind[0]).toBeCloseTo(-1, 6);
    expect(s.hours).toBeGreaterThan(0.3);
  });
  it('credits scent drifting in from outside the segment', () => {
    // a receiver in another segment that detects the home source strongly
    const other = segmentAt(seg, map, 300, -300);
    const r = blocks.recvOf[cellAt(map, 300, -300)];
    const det: ReceiverDetection = { start: new Int32Array(blocks.nRecv + 1), src: Int32Array.from([blocks.srcOf[home]]), det: Float32Array.from([0.9]) };
    for (let j = r + 1; j <= blocks.nRecv; j++) det.start[j] = 1;
    const sc = scoreSegments({ seg, map, blocks, det, q, deployable: new Uint8Array(n * n).fill(1), windAt });
    expect(sc[other].fromOutside).toBeCloseTo(HOTSPOTS.dogPOD * 0.9, 5);
  });
  it('assigns the best segment first and stops when the rest add nothing', () => {
    const a = assignSegments(scores, q, 3);
    expect(a.length).toBe(1);
    expect(a[0].score.seg).toBe(homeSeg);
  });
});
