import type { AreaBundle } from '../api/types';
import { VERT_EXAG } from '../config/constants';
import { gridMap, insideGrid, sampleLocal, type GridMap } from './grid';

const cache = new WeakMap<AreaBundle, { d: GridMap; o: GridMap }>();

function maps(b: AreaBundle) {
  let m = cache.get(b);
  if (!m) {
    m = { d: gridMap(b.detail.meta, b.frame), o: gridMap(b.overview.meta, b.frame) };
    cache.set(b, m);
  }
  return m;
}

/** Ground elevation (m, unexaggerated) at a local point: detail grid if inside, else overview. */
export function elevationAt(b: AreaBundle, lx: number, ly: number): number {
  const m = maps(b);
  if (insideGrid(m.d, lx, ly)) return sampleLocal(b.detail.elev, m.d, lx, ly);
  return sampleLocal(b.overview.elev, m.o, lx, ly);
}

/** Scene-space y of the ground (exaggerated). */
export function groundY(b: AreaBundle, lx: number, ly: number): number {
  return elevationAt(b, lx, ly) * VERT_EXAG;
}

/** Local (lx, ly) -> scene [x, y, z] at height `above` metres over the ground. */
export function toScene(b: AreaBundle, lx: number, ly: number, above = 0): [number, number, number] {
  return [lx, groundY(b, lx, ly) + above * VERT_EXAG, -ly];
}
