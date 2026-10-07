import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOTSPOTS, PROFILES, SCENT, TURBULENCE } from '../config/modelParams';
import { bilinear, cellAt, frameOf, gridMap, sampleLocal, type GridMeta } from '../geo/grid';
import { decayTau, type Weather } from './env';
import { deployableCells, detThresholds, detectability, blockMean, greedyDeploy, sourceSums } from './hotspots';
import { buildStaticLayers, barrierFactor, computeProbability, resampleToDetail } from './probability';
import { backtrace, posterior } from './triangulation';
import { blockIndex, createSim, makeStepEnv, runEnsemble, step, type StepEnv } from './scent';
import { buildTerrainInfo, LC, noseWindFactor, shadowMask, sunlitMask, type TerrainInfo } from './terrainInfo';
import { computeFallbackWind, metToUV, sampleWind, smoothedGradients, timeSlot, uvToMet, IDENTITY_MEMBER, type WindField } from './wind';

function meta(n: number, cell: number): GridMeta {
  return { crs: 'EPSG:32618', originX: 500000, originY: 4600000, cellSize: cell, cols: n, rows: n, noData: -9999 };
}

function flatTerrain(n = 100, cell = 10, elevFn?: (c: number, r: number) => number): TerrainInfo {
  const m = meta(n, cell);
  const elev = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) elev[r * n + c] = elevFn ? elevFn(c, r) : 100;
  return buildTerrainInfo(m, frameOf(m), elev, new Uint8Array(n * n).fill(2));
}

function uniformField(n: number, u: number, v: number): WindField {
  const g = { u: new Float32Array(n * n).fill(u), v: new Float32Array(n * n).fill(v) };
  return { hours: [14, 22], grids: [g, g] };
}

const weather: Weather = {
  utcOffsetSeconds: -4 * 3600,
  hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, temperature: 10, humidity: 50, cloudCover: 0, windSpeed: 2, windDirection: 270 })),
};
const place = { date: '2026-09-24', lat: 42.16, lon: -74.2, utcOffsetSeconds: -4 * 3600 };

describe('wind direction conversion', () => {
  it('meteorological from-direction to u/v', () => {
    const w = metToUV(10, 270); // from west -> blows east
    expect(w.u).toBeCloseTo(10);
    expect(w.v).toBeCloseTo(0);
    const n = metToUV(5, 0); // from north -> blows south
    expect(n.u).toBeCloseTo(0);
    expect(n.v).toBeCloseTo(-5);
    const sw = metToUV(Math.SQRT2, 225); // from SW -> blows NE
    expect(sw.u).toBeCloseTo(1);
    expect(sw.v).toBeCloseTo(1);
  });
  it('round-trips through uvToMet', () => {
    for (const d of [0, 45, 135, 200, 296, 359]) {
      const { u, v } = metToUV(3, d);
      const back = uvToMet(u, v);
      expect(back.speed).toBeCloseTo(3);
      expect(Math.abs(((back.dir - d + 540) % 360) - 180)).toBeLessThan(1e-6);
    }
  });
});

describe('bilinear sampling', () => {
  it('interpolates a plane exactly and clamps at edges', () => {
    const cols = 4;
    const rows = 3;
    const a = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) a[r * cols + c] = 2 * c + 10 * r;
    expect(bilinear(a, cols, rows, 1.5, 0.5)).toBeCloseTo(2 * 1.5 + 10 * 0.5);
    expect(bilinear(a, cols, rows, 3, 2)).toBeCloseTo(26);
    expect(bilinear(a, cols, rows, -5, -5)).toBeCloseTo(0);
  });
  it('maps local coordinates to cell centres (row 0 = north)', () => {
    const m = meta(10, 10);
    const gm = gridMap(m, frameOf(m));
    const a = new Float32Array(100);
    for (let i = 0; i < 100; i++) a[i] = Math.floor(i / 10); // row number
    // north-west cell centre is at local (-45, +45)
    expect(sampleLocal(a, gm, -45, 45)).toBeCloseTo(0);
    expect(sampleLocal(a, gm, -45, -45)).toBeCloseTo(9);
    expect(cellAt(gm, -45, 45)).toBe(0);
  });
  it('samples wind linearly in time', () => {
    const n = 4;
    const g0 = { u: new Float32Array(n * n).fill(0), v: new Float32Array(n * n).fill(0) };
    const g1 = { u: new Float32Array(n * n).fill(2), v: new Float32Array(n * n).fill(-4) };
    const field: WindField = { hours: [14, 15], grids: [g0, g1] };
    const m = meta(n, 10);
    const w = sampleWind(field, gridMap(m, frameOf(m)), 0, 0, 14.25);
    expect(w.u).toBeCloseTo(0.5);
    expect(w.v).toBeCloseTo(-1);
    expect(timeSlot(field, 30).i0).toBe(1);
  });
});

describe('probability map', () => {
  it('is normalised, zero on water, and peaks near the median distance', () => {
    const n = 120;
    const m = meta(n, 30);
    const gm = gridMap(m, frameOf(m));
    const elev = new Float32Array(n * n).fill(500);
    const lc = new Uint8Array(n * n).fill(2);
    lc[0] = 1; // water
    const layers = buildStaticLayers(m, gm, elev, lc, []);
    const barrier = barrierFactor(layers, m, gm, [0, 0]);
    const p = computeProbability({ meta: m, map: gm, layers, barrier, lkp: [0, 0], profile: PROFILES.child712 });
    let s = 0;
    for (let i = 0; i < p.length; i++) s += p[i];
    expect(s).toBeCloseTo(1, 5);
    expect(p[0]).toBe(0);
    // radial mass: ring around 1 km should hold more than ring around 3 km
    let near = 0;
    let far = 0;
    for (let i = 0; i < p.length; i++) {
      const r = Math.floor(i / n);
      const c = i - r * n;
      const d = Math.hypot((c - n / 2 + 0.5) * 30, (r - n / 2 + 0.5) * 30);
      if (d > 700 && d < 1300) near += p[i];
      if (d > 2700 && d < 3300) far += p[i];
    }
    expect(near).toBeGreaterThan(far);
    const det = resampleToDetail(p, gm, gridMap(meta(30, 10), frameOf(m)));
    let sd = 0;
    for (let i = 0; i < det.prob.length; i++) sd += det.prob[i];
    expect(sd).toBeCloseTo(1, 4);
    expect(det.segmentFraction).toBeGreaterThan(0);
    expect(det.segmentFraction).toBeLessThan(1);
  });
});

describe('scent particles', () => {
  let saved: typeof SCENT;
  let savedTurb: typeof TURBULENCE;
  beforeEach(() => {
    saved = { ...SCENT };
    savedTurb = { ...TURBULENCE };
  });
  afterEach(() => {
    Object.assign(SCENT, saved);
    Object.assign(TURBULENCE, savedTurb);
  });

  function env(ti: TerrainInfo, field: WindField, dt: number): StepEnv {
    const se = makeStepEnv(ti, field, place, weather, 21, dt, IDENTITY_MEMBER); // night: no sun
    return se;
  }

  it('advects u·dt at nose height (2 m wind × log-profile factor) with K = 0', () => {
    SCENT.turbK0 = 0;
    SCENT.turbKPerWind = 0;
    TURBULENCE.scale = 0;
    const ti = flatTerrain();
    const field = uniformField(100, 1.5, -0.5);
    const prob = new Float32Array(100 * 100);
    prob[50 * 100 + 50] = 1;
    const sim = createSim({ ti, prob, n: 50, seed: 1 });
    const x0 = Array.from(sim.x);
    const y0 = Array.from(sim.y);
    const dt = 2;
    const se = env(ti, field, dt);
    for (let k = 0; k < 10; k++) step(sim, field, se, dt);
    const k = noseWindFactor(LC.open);
    for (let i = 0; i < sim.n; i++) {
      expect(sim.x[i] - x0[i]).toBeCloseTo(1.5 * k * dt * 10, 3);
      expect(sim.y[i] - y0[i]).toBeCloseTo(-0.5 * k * dt * 10, 3);
    }
  });

  it('decays with the configured half-life (τ ln 2)', () => {
    SCENT.turbK0 = 0;
    SCENT.turbKPerWind = 0;
    TURBULENCE.scale = 0;
    const ti = flatTerrain();
    const field = uniformField(100, 0, 0);
    const prob = new Float32Array(100 * 100);
    prob[50 * 100 + 50] = 1;
    const sim = createSim({ ti, prob, n: 10, seed: 2 });
    const dt = 2;
    const se = env(ti, field, dt);
    const tau = decayTau({ humidity: 50, temperature: 10 }, false);
    const half = tau * Math.LN2;
    const steps = Math.round(half / dt);
    for (let k = 0; k < steps; k++) step(sim, field, se, dt);
    expect(sim.strength[0]).toBeCloseTo(0.5, 2);
  });

  it('ensemble heat is concentrated downwind of the source', () => {
    const ti = flatTerrain();
    const field = uniformField(100, 0.3, 0); // east
    const prob = new Float32Array(100 * 100);
    prob[50 * 100 + 30] = 1;
    const { heat } = runEnsemble({ ti, field, place, weather, prob, tEnd: 21, members: 2, particles: 500, dt: 10 });
    let east = 0;
    let west = 0;
    for (let r = 0; r < 100; r++)
      for (let c = 0; c < 100; c++) {
        if (c > 32) east += heat[r * 100 + c];
        if (c < 28) west += heat[r * 100 + c];
      }
    expect(east).toBeGreaterThan(5 * west);
  });
});

describe('backward trace', () => {
  it('returns to the source in uniform wind', () => {
    const ti = flatTerrain(200, 10);
    // 2 m wind chosen so the nose-height wind carries scent 900 m in 60 min on open ground
    const u = 0.25 / noseWindFactor(LC.open);
    const field = uniformField(200, u, 0);
    // source at (-300, 0); scent reaches (+600, 0) after 60 min
    const zone = backtrace({ ti, field, t: 20, x: 600 - 1e-3, y: 0, particles: 300, perturbWind: false, turbulence: false });
    const at = (x: number, y: number) => zone[cellAt(ti.map, x, y)];
    expect(at(-300, 0)).toBeGreaterThan(0.2);
    expect(at(-450, 0)).toBeLessThan(0.05);
    expect(at(150, 0)).toBeGreaterThan(0.2);
    expect(at(-300, 200)).toBeLessThan(0.05);
  });
  it('posterior multiplies zones and normalises', () => {
    const prior = new Float32Array([0.25, 0.25, 0.25, 0.25]);
    const post = posterior(prior, [new Float32Array([1, 0, 1, 0]), new Float32Array([1, 1, 0, 0])]);
    expect(post.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(post[0]).toBeGreaterThan(0.9);
  });
});

describe('greedy deployment', () => {
  it('never picks non-deployable cells', () => {
    // steep west half (slope > 35°), flat east half; scent everywhere
    const n = 100;
    const ti = flatTerrain(n, 10, (c) => (c < 50 ? c * 10 : 500));
    const water = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) water[r * n + 80] = 1;
    const cliff = new Uint8Array(n * n);
    for (let c = 0; c < n; c++) cliff[60 * n + c] = 1;
    const deployable = deployableCells(ti, water, cliff);
    expect(deployable[50 * n + 10]).toBe(0); // steep
    expect(deployable[50 * n + 80]).toBe(0); // water
    expect(deployable[61 * n + 70]).toBe(0); // within 20 m of cliff
    expect(deployable[30 * n + 70]).toBe(1);
    const field = uniformField(n, 0.4, 0.1);
    const prob = new Float32Array(n * n).fill(1 / (n * n));
    const blocks = blockIndex(n, n, HOTSPOTS.recvBlockCells, HOTSPOTS.srcBlockCells);
    const { heat, contrib } = runEnsemble({ ti, field, place, weather, prob, tEnd: 21, members: 2, particles: 3000, dt: 10, blocks });
    const heatRecv = blockMean(heat, n, n, blocks);
    const detRecv = detectability(heatRecv, detThresholds(heatRecv));
    const deps = greedyDeploy({ contrib: contrib!, blocks, detRecv, heat, q: sourceSums(prob, blocks), deployable, map: ti.map, teams: 4 });
    expect(deps.length).toBeGreaterThan(0);
    for (const d of deps) expect(deployable[d.cell]).toBe(1);
    for (let i = 0; i < deps.length; i++)
      for (let j = i + 1; j < deps.length; j++) expect(Math.hypot(deps[i].x - deps[j].x, deps[i].y - deps[j].y)).toBeGreaterThan(HOTSPOTS.suppressRadiusM - 60);
  });
});

describe('fallback wind mirror', () => {
  it('blows downhill at night', () => {
    const n = 40;
    const elev = new Float32Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) elev[r * n + c] = c * 2; // rises east (slope 0.2)
    const grads = smoothedGradients(elev, n, n, 10);
    const w = computeFallbackWind(grads, 0, 0, -5, 270);
    const i = 20 * n + 20;
    expect(w.u[i]).toBeLessThan(-0.5);
    expect(Math.abs(w.v[i])).toBeLessThan(1e-3);
  });
});

describe('nose-height wind', () => {
  it('slows wind near the ground, most under a forest canopy', () => {
    const open = noseWindFactor(LC.open);
    expect(open).toBeGreaterThan(0.65);
    expect(open).toBeLessThan(0.75);
    expect(noseWindFactor(LC.water)).toBeGreaterThan(open); // smoother surface
    expect(noseWindFactor(LC.shrub)).toBeLessThan(open);
    expect(noseWindFactor(LC.forest)).toBeLessThan(noseWindFactor(LC.developed));
  });
});

describe('continuous release', () => {
  it('forms a steady plume: strongest near the source, fading downwind', () => {
    const ti = flatTerrain(100, 10);
    const field = uniformField(100, 1, 0); // east
    const prob = new Float32Array(100 * 100);
    prob[50 * 100 + 20] = 1; // source at column 20
    const { heat } = runEnsemble({ ti, field, place, weather, prob, tEnd: 21, members: 1, particles: 3000, dt: 10 });
    const band = (c0: number, c1: number) => {
      let s = 0;
      for (let r = 45; r <= 55; r++) for (let c = c0; c <= c1; c++) s += heat[r * 100 + c];
      return s;
    };
    const near = band(20, 30);
    const mid = band(45, 55);
    const far = band(80, 90);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0); // continuous: scent all along the plume, not one puff
  });

  it('is normalised per particle, so different particle counts agree', () => {
    const ti = flatTerrain(60, 10);
    const field = uniformField(60, 0.5, 0);
    const prob = new Float32Array(60 * 60).fill(1 / 3600);
    const sum = (a: Float32Array) => a.reduce((x, y) => x + y, 0);
    const a = runEnsemble({ ti, field, place, weather, prob, tEnd: 21, members: 1, particles: 1000, dt: 15 });
    const b = runEnsemble({ ti, field, place, weather, prob, tEnd: 21, members: 1, particles: 4000, dt: 15 });
    expect(sum(b.heat) / sum(a.heat)).toBeGreaterThan(0.9);
    expect(sum(b.heat) / sum(a.heat)).toBeLessThan(1.1);
  });

  it('lofting on sunny slopes lowers scent below the neutral reference', () => {
    // gentle slope, sunlit in the early afternoon (sun ~40° up), light wind
    const ti = flatTerrain(60, 10, (_c, r) => 500 + r * 3);
    const field = uniformField(60, 0.5, 0);
    const prob = new Float32Array(60 * 60).fill(1 / 3600);
    const sum = (a: Float32Array) => a.reduce((x, y) => x + y, 0);
    const sunny = runEnsemble({ ti, field, place, weather, prob, tEnd: 14.5, members: 1, particles: 2000, dt: 15 });
    const neutral = runEnsemble({ ti, field, place, weather, prob, tEnd: 14.5, members: 1, particles: 2000, dt: 15, neutral: true });
    expect(sum(sunny.heat)).toBeLessThan(0.8 * sum(neutral.heat));
  });
});

describe('terrain shadows', () => {
  it('a ridge shades the ground on its far side from a low sun', () => {
    // ridge 300 m high along column 70 (east); flat ground west of it
    const ti = flatTerrain(100, 10, (c) => (c >= 70 && c <= 72 ? 800 : 500));
    const lowEast: [number, number, number] = [Math.cos(0.1), 0, Math.sin(0.1)]; // sun ~6° above the east horizon
    const sh = shadowMask(ti, lowEast);
    expect(sh[50 * 100 + 60]).toBe(1); // just west of the ridge: shaded
    expect(sh[50 * 100 + 90]).toBe(0); // east of the ridge: lit
    const high: [number, number, number] = [0, 0, 1];
    expect(shadowMask(ti, high)[50 * 100 + 60]).toBe(0);
    expect(sunlitMask(ti, lowEast)[50 * 100 + 60]).toBe(0);
    expect(sunlitMask(ti, lowEast)[50 * 100 + 90]).toBe(1);
  });
});

describe('parallel ensemble slices', () => {
  it('summing member slices reproduces the full run exactly', () => {
    const ti = flatTerrain(60, 10);
    const field = uniformField(60, 0.6, 0.2);
    const prob = new Float32Array(60 * 60).fill(1 / 3600);
    const blocks = blockIndex(60, 60, 5, 10);
    const base = { ti, field, place, weather, prob, tEnd: 20, members: 3, particles: 400, dt: 15, seed: 9, blocks };
    const full = runEnsemble(base);
    const parts = [0, 1, 2].map((i) => runEnsemble({ ...base, memberRange: [i, i + 1] as [number, number] }));
    for (let k = 0; k < full.heat.length; k += 37) {
      const sum = parts.reduce((a, p) => a + p.heat[k], 0);
      expect(sum).toBeCloseTo(full.heat[k], 6);
    }
    let cs = 0;
    let cf = 0;
    for (let k = 0; k < full.contrib!.length; k++) {
      cf += full.contrib![k];
      cs += parts[0].contrib![k] + parts[1].contrib![k] + parts[2].contrib![k];
    }
    expect(cs).toBeCloseTo(cf, 5);
  });
});
