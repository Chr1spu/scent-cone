import { describe, expect, it } from 'vitest';
import { sectorCentroid, sectorContains, type SearchedSector } from './searchUpdate';

describe('searched track corridors', () => {
  const track: SearchedSector = { kind: 'track', xs: [0, 300, 300], ys: [0, 0, 300], radius: 60 };
  it('contains points within the radius of the walked line, and nothing else', () => {
    expect(sectorContains(track, 150, 50)).toBe(true);
    expect(sectorContains(track, 150, 70)).toBe(false);
    expect(sectorContains(track, 350, 200)).toBe(true);
    expect(sectorContains(track, 360.5, 200)).toBe(false);
    expect(sectorContains(track, -50, 0)).toBe(true); // around the start
  });
  it('has its centroid on the mean of the points', () => {
    expect(sectorCentroid(track)).toEqual([200, 100]);
  });
});
