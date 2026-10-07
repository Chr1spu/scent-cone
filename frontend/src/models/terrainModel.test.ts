import { describe, expect, it } from 'vitest';
import { PROFILES, TERRAIN } from '../config/modelParams';
import { cellAt, cellCenterLocal, frameOf, gridMap, type GridMeta } from '../geo/grid';
import { barrierFactor, buildStaticLayers, computeProbability, dispersionWeight, percentRank, terrainFactor, type Feature2D } from './probability';
import { LC } from './terrainInfo';

const n = 100;
const meta: GridMeta = { crs: 'EPSG:32618', originX: 500000, originY: 4600000, cellSize: 30, cols: n, rows: n, noData: -9999 };
const map = gridMap(meta, frameOf(meta));
const line = (kind: Feature2D['kind'], x0: number, y0: number, x1: number, y1: number): Feature2D => ({ kind, polygon: false, xs: Float64Array.from([x0, x1]), ys: Float64Array.from([y0, y1]) });

describe('terrain model (ISRID multipliers)', () => {
  const feats = [line('trail', -1500, 0, 1500, 0), line('stream', 0, -1500, 0, 1500), line('road', -1500, 900, 1500, 900)];
  const layers = buildStaticLayers(meta, map, new Float32Array(n * n).fill(100), new Uint8Array(n * n).fill(LC.forest), feats);
  const f = (x: number, y: number) => terrainFactor(layers, cellAt(map, x, y), 100, 30);
  it('applies each feature within the track offset and fades beyond it', () => {
    expect(f(-900, 0)).toBeCloseTo(TERRAIN.trail, 5);
    expect(f(-900, 900)).toBeCloseTo(TERRAIN.road, 5);
    expect(f(450, -900)).toBeLessThan(1.3); // far from everything
    expect(f(-900, 60)).toBeCloseTo(TERRAIN.trail, 5); // 60 m off the trail: inside 100 m
  });
  it('rates where a trail crosses a stream highest', () => {
    expect(f(0, 0)).toBeCloseTo(TERRAIN.trailStream, 5);
  });
  it('leaves flat ground without low or high points', () => {
    expect(f(450, -450)).toBeLessThan(1.3);
  });
  it('ranks values with ties sharing a rank', () => {
    const r = Array.from(percentRank(Float32Array.from([3, 1, 1, 2])));
    expect(r.slice(0, 3)).toEqual([1, 0, 0]);
    expect(r[3]).toBeCloseTo(2 / 3, 6);
  });
});

describe('direction of travel (ISRID dispersion)', () => {
  it('weights average to one over the half circle and favour the heading', () => {
    let s = 0;
    for (let d = 0.5; d < 180; d++) s += dispersionWeight(d);
    expect(s / 180).toBeCloseTo(1, 2);
    expect(dispersionWeight(10)).toBeCloseTo(3, 6);
    expect(dispersionWeight(-10)).toBeCloseTo(3, 6);
    expect(dispersionWeight(170)).toBeLessThan(0.3);
  });
  it('puts about 75% of the probability within 66° of the heading (away from the LKP)', () => {
    const layers = buildStaticLayers(meta, map, new Float32Array(n * n).fill(100), new Uint8Array(n * n).fill(LC.open), []);
    const barrier = barrierFactor(layers, meta, map, [0, 0]);
    const p = computeProbability({ meta, map, layers, barrier, lkp: [0, 0], profile: PROFILES.child712, travelDirDeg: 90 });
    let within = 0;
    let total = 0;
    for (let i = 0; i < p.length; i++) {
      const [x, y] = cellCenterLocal(map, i);
      const d = Math.hypot(x, y);
      if (d < 300 || d > 1400) continue; // past the fade, inside the grid
      const bearing = (Math.atan2(x, y) * 180) / Math.PI;
      total += p[i];
      if (Math.abs(bearing - 90) <= 66) within += p[i];
    }
    expect(within / total).toBeGreaterThan(0.7);
    expect(within / total).toBeLessThan(0.8);
  });
});
