import { describe, expect, it } from 'vitest';
import { frameOf, gridMap, type GridMeta } from '../geo/grid';
import { angleBetween, samplePoints, windConfidence } from './windConfidence';
import type { WindField } from './wind';

const n = 50;
const meta: GridMeta = { crs: 'EPSG:32618', originX: 500000, originY: 4600000, cellSize: 10, cols: n, rows: n, noData: -9999 };
const map = gridMap(meta, frameOf(meta));
const uniform = (u: number, v: number) => ({ u: new Float32Array(n * n).fill(u), v: new Float32Array(n * n).fill(v) });
const steady = (u: number, v: number): WindField => ({ hours: [14, 22], grids: [uniform(u, v), uniform(u, v)] });
const pts = samplePoints(map, 0, 0, 200, 5);

describe('wind confidence', () => {
  it('measures angles between wind vectors', () => {
    expect(angleBetween(1, 0, 0, 1)).toBeCloseTo(90, 6);
    expect(angleBetween(1, 0, -1, 0)).toBeCloseTo(180, 6);
    expect(angleBetween(1, 1, 1, 1)).toBeCloseTo(0, 6);
  });
  it('trusts a steady, moderate wind that both models agree on', () => {
    const c = windConfidence(steady(3, 0), steady(2.8, 0.3), map, pts, 18);
    expect(c.level).toBe('good');
    expect(c.reasons).toEqual([]);
  });
  it('distrusts light wind', () => {
    expect(windConfidence(steady(0.6, 0), null, map, pts, 18).level).toBe('poor');
    expect(windConfidence(steady(1.5, 0), null, map, pts, 18).level).toBe('fair');
  });
  it('distrusts models that disagree', () => {
    const c = windConfidence(steady(3, 0), steady(0, 3), map, pts, 18);
    expect(c.disagreeDeg).toBeCloseTo(90, 3);
    expect(c.level).toBe('poor');
  });
  it('distrusts a turning wind (evening transition)', () => {
    const turning: WindField = { hours: [17, 18, 19, 20], grids: [uniform(3, 0), uniform(3, 0), uniform(0, -3), uniform(0, -3)] };
    const c = windConfidence(turning, null, map, pts, 18.5);
    expect(c.turnDeg).toBeCloseTo(90, 3);
    expect(c.level).toBe('poor');
    expect(windConfidence(turning, null, map, pts, 20).turnDeg).toBeLessThan(1);
  });
  it('keeps sample points inside the grid', () => {
    for (const [x, y] of samplePoints(map, 10000, -10000)) {
      expect(Math.abs(x)).toBeLessThan(250);
      expect(Math.abs(y)).toBeLessThan(250);
    }
  });
});
