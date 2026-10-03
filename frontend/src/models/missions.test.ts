import { afterEach, describe, expect, it } from 'vitest';
import { MISSIONS } from '../config/missions';
import { PROFILES } from '../config/modelParams';
import { cellAt, frameOf, gridMap, type GridMeta } from '../geo/grid';
import { decayTau } from './env';
import { deployableCells } from './hotspots';
import { barrierFactor, buildStaticLayers, computeProbability } from './probability';
import { areaPrior, habitatPrior, hidesPrior, waterPrior } from './sources';
import { buildTerrainInfo, LC } from './terrainInfo';
import { setTuning } from './tuning';

function meta(n: number, cell: number): GridMeta {
  return { crs: 'EPSG:32618', originX: 500000, originY: 4600000, cellSize: cell, cols: n, rows: n, noData: -9999 };
}
const sum = (a: Float32Array) => a.reduce((x, y) => x + y, 0);

describe('mission source models', () => {
  const m = meta(60, 10);
  const map = gridMap(m, frameOf(m));

  it('hides: peaks at each hide, sums to 1, empty without hides', () => {
    const p = hidesPrior(map, [[-100, 50], [120, -80]])!;
    expect(sum(p)).toBeCloseTo(1, 5);
    const at = (x: number, y: number) => p[cellAt(map, x, y)];
    expect(at(-100, 50)).toBeGreaterThan(at(-50, 50) * 5);
    expect(at(120, -80)).toBeCloseTo(at(-100, 50), 3); // equal weight per hide
    expect(hidesPrior(map, [])).toBeNull();
  });

  it('area: only inside the drawn area, never on water, lower ground favoured when asked', () => {
    const n = 60 * 60;
    const elev = new Float32Array(n);
    for (let i = 0; i < n; i++) elev[i] = 500 + Math.floor(i / 60) * -2; // lower to the south
    const slope = new Float32Array(n);
    const water = new Uint8Array(n);
    water[cellAt(map, 0, 0)] = 1;
    const p = areaPrior(map, { kind: 'circle', x: 0, y: 0, radius: 100 }, elev, slope, water, 0.5)!;
    expect(sum(p)).toBeCloseTo(1, 5);
    expect(p[cellAt(map, 200, 200)]).toBe(0);
    expect(p[cellAt(map, 0, 0)]).toBe(0);
    expect(p[cellAt(map, 0, -80)]).toBeGreaterThan(p[cellAt(map, 0, 80)]);
  });

  it('water: probability only on water, nearer the entry point', () => {
    const water = new Uint8Array(60 * 60);
    for (let c = 0; c < 60; c++) for (let r = 25; r < 35; r++) water[r * 60 + c] = 1; // a lake band
    const p = waterPrior(map, water, [0, 0])!;
    expect(sum(p)).toBeCloseTo(1, 5);
    expect(p[cellAt(map, 0, 200)]).toBe(0); // land
    expect(p[cellAt(map, 50, 0)]).toBeGreaterThan(p[cellAt(map, 280, 0)]);
    expect(waterPrior(map, new Uint8Array(60 * 60), [0, 0])).toBeNull();
  });

  it('habitat: chosen classes only, within the slope limit and stream distance', () => {
    const n = 60 * 60;
    const lc = new Uint8Array(n).fill(LC.forest);
    for (let i = 0; i < 600; i++) lc[i] = LC.open;
    const slope = new Float32Array(n).fill(10);
    slope[2000] = 40;
    const streamDist = new Float32Array(n).fill(50);
    streamDist[3000] = 500;
    const p = habitatPrior(lc, slope, streamDist, { classes: [LC.forest], maxSlopeDeg: 30, nearStreamM: 150 })!;
    expect(sum(p)).toBeCloseTo(1, 5);
    expect(p[100]).toBe(0); // open, not chosen
    expect(p[2000]).toBe(0); // too steep
    expect(p[3000]).toBe(0); // too far from a stream
    expect(p[1500]).toBeGreaterThan(0);
  });
});

describe('mission tuning and deployment', () => {
  afterEach(() => setTuning({ tauScale: 1, liftScale: 1 }));

  it('cadaver scent lasts longer (decay time scales with the mission)', () => {
    const base = decayTau({ humidity: 50, temperature: 10 }, false);
    setTuning(MISSIONS.cadaver.tuning);
    expect(decayTau({ humidity: 50, temperature: 10 }, false)).toBeCloseTo(base * MISSIONS.cadaver.tuning.tauScale, 6);
  });

  it('water searches deploy on the water and its shore, not inland', () => {
    const m = meta(60, 10);
    const elev = new Float32Array(60 * 60).fill(100);
    const lc = new Uint8Array(60 * 60).fill(LC.open);
    for (let r = 0; r < 60; r++) for (let c = 0; c < 20; c++) lc[r * 60 + c] = LC.water;
    const ti = buildTerrainInfo(m, frameOf(m), elev, lc);
    const water = new Uint8Array(60 * 60);
    const d = deployableCells(ti, water, new Uint8Array(60 * 60), { mode: 'waterAndShore' });
    expect(d[30 * 60 + 5]).toBe(1); // on the water (boat)
    expect(d[30 * 60 + 22]).toBe(1); // shore, 20-30 m from the water
    expect(d[30 * 60 + 50]).toBe(0); // inland
    const land = deployableCells(ti, water, new Uint8Array(60 * 60));
    expect(land[30 * 60 + 5]).toBe(0);
    expect(land[30 * 60 + 50]).toBe(1);
  });

  it('cats prefer cover: shrub beats open ground at the same distance', () => {
    const n = 80;
    const m = meta(n, 30);
    const map = gridMap(m, frameOf(m));
    const elev = new Float32Array(n * n).fill(300);
    const lc = new Uint8Array(n * n).fill(LC.open);
    // cell centres sit at ±15, ±45, ±75 m on this grid: use a symmetric pair
    const shrubCell = cellAt(map, 75, 15);
    const openCell = cellAt(map, -75, 15);
    lc[shrubCell] = LC.shrub;
    const layers = buildStaticLayers(m, map, elev, lc, []);
    const p = computeProbability({ meta: m, map, layers, barrier: barrierFactor(layers, m, map, [0, 0]), lkp: [0, 0], profile: PROFILES.catOutdoor });
    expect(p[shrubCell]).toBeGreaterThan(p[openCell] * 2);
  });
});
