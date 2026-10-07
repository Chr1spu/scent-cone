/**
 * Physics and logic checks: plume spread against the Briggs/Pasquill curves, symmetry and
 * invariance properties, the probability prior against its own profile statistics, and
 * end-to-end sanity of deployment and back-tracing. These test that the rules do what they claim;
 * they cannot show the rules match real dogs (that needs field data).
 */
import { describe, expect, it } from 'vitest';
import { HOTSPOTS, PROFILES, TURBULENCE } from '../config/modelParams';
import { cellAt, cellCenterLocal, frameOf, gridMap, type GridMeta } from '../geo/grid';
import { meanderCoef, stabilityClass, sunAt, type Weather } from './env';
import { calibrateDetection } from './detection';
import { deployableCells, greedyDeploy, sourceSums } from './hotspots';
import { barrierFactor, buildStaticLayers, computeProbability, shareBeyond, travelFactor, travelLimitBinds, travelReachM } from './probability';
import { blockIndex, createSim, makeStepEnv, runEnsemble, step } from './scent';
import { buildTerrainInfo, LC, noseWindFactor, type TerrainInfo } from './terrainInfo';
import { backtrace } from './triangulation';
import { IDENTITY_MEMBER, type WindField } from './wind';

function meta(n: number, cell: number): GridMeta {
  return { crs: 'EPSG:32618', originX: 500000, originY: 4600000, cellSize: cell, cols: n, rows: n, noData: -9999 };
}
function flat(n: number, cell: number): TerrainInfo {
  const m = meta(n, cell);
  return buildTerrainInfo(m, frameOf(m), new Float32Array(n * n).fill(100), new Uint8Array(n * n).fill(LC.open));
}
function uniform(n: number, u: number, v: number): WindField {
  const g = { u: new Float32Array(n * n).fill(u), v: new Float32Array(n * n).fill(v) };
  return { hours: [0, 30], grids: [g, g] };
}
const place = { date: '2026-09-24', lat: 42.16, lon: -74.2, utcOffsetSeconds: -4 * 3600 };
const weatherWith = (windSpeed: number, cloudCover: number): Weather => ({
  utcOffsetSeconds: -4 * 3600,
  hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, temperature: 12, humidity: 60, cloudCover, windSpeed, windDirection: 270 })),
});
const std = (a: number[]) => {
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};

describe('stability class (Pasquill, Turner method)', () => {
  const sun = (elevation: number) => ({ elevation, azimuth: 180, dir: [0, 0, 1] as [number, number, number] });
  it('strong sun and light wind are very unstable; overcast is neutral; clear calm nights are stable', () => {
    expect(stabilityClass({ windSpeed: 1, cloudCover: 0, sun: sun(65) })).toBe(0); // A
    expect(stabilityClass({ windSpeed: 4, cloudCover: 10, sun: sun(45) })).toBe(1.5); // B-C
    expect(stabilityClass({ windSpeed: 7, cloudCover: 10, sun: sun(45) })).toBe(3); // D
    expect(stabilityClass({ windSpeed: 1, cloudCover: 95, sun: sun(50) })).toBe(3); // overcast: D
    expect(stabilityClass({ windSpeed: 1, cloudCover: 0, sun: sun(-10) })).toBe(5); // F
    expect(stabilityClass({ windSpeed: 4, cloudCover: 80, sun: sun(-10) })).toBe(3); // windy cloudy night: D
  });
  it('interpolates the spread coefficient between classes', () => {
    const t = TURBULENCE.briggsA;
    expect(meanderCoef(0, t)).toBeCloseTo(0.22);
    expect(meanderCoef(5, t)).toBeCloseTo(0.04);
    const bc = meanderCoef(1.5, t);
    expect(bc).toBeLessThan(0.16);
    expect(bc).toBeGreaterThan(0.11);
  });
});

/**
 * A puff released at one point drifts in uniform 2 m/s nose-height wind; its lateral spread
 * at downwind distance x should follow Briggs' open-country σy(x) = a·x·(1 + 0.0001x)^-0.5 for
 * the stability class of that hour (within ±25%, the scatter between published curve sets).
 */
function plumeSpread(hour: number, wx: Weather): { x: number; model: number; briggs: number }[] {
  const n = 260;
  const ti = flat(n, 10);
  const U = 2; // nose height
  const field = uniform(n, U / noseWindFactor(LC.open), 0);
  const prob = new Float32Array(n * n);
  prob[cellAt(ti.map, -1100, 0)] = 1;
  const sim = createSim({ ti, prob, n: 3000, seed: 3 });
  const dt = 5;
  const se = makeStepEnv(ti, field, place, wx, hour, dt, IDENTITY_MEMBER);
  const a = se.sigmaA;
  const out: { x: number; model: number; briggs: number }[] = [];
  let t = 0;
  for (const x of [200, 500, 1000]) {
    while (t < x / U - 1e-6) {
      step(sim, field, se, dt);
      t += dt;
    }
    const ys: number[] = [];
    for (let i = 0; i < sim.n; i++) if (Math.abs(sim.age[i] - t) < 1e-3) ys.push(sim.y[i]);
    expect(ys.length).toBeGreaterThan(2000); // nearly all particles still in their first life
    out.push({ x, model: std(ys), briggs: a * x * Math.pow(1 + 0.0001 * x, -0.5) });
  }
  return out;
}

describe('plume spread matches Briggs/Pasquill', () => {
  it('stable clear night (class F)', () => {
    for (const r of plumeSpread(22, weatherWith(1.5, 0))) {
      expect(r.model / r.briggs).toBeGreaterThan(0.75);
      expect(r.model / r.briggs).toBeLessThan(1.25);
    }
  });
  it('sunny early afternoon (class B), and wider than at night', () => {
    expect(sunAt(place, 13).elevation).toBeGreaterThan(35);
    const day = plumeSpread(13, weatherWith(2.5, 0));
    for (const r of day) {
      expect(r.model / r.briggs).toBeGreaterThan(0.75);
      expect(r.model / r.briggs).toBeLessThan(1.25);
    }
    const night = plumeSpread(22, weatherWith(1.5, 0));
    expect(day[2].model).toBeGreaterThan(2.5 * night[2].model);
  });
});

describe('symmetry and invariance', () => {
  it('in still air a puff spreads evenly in all directions', () => {
    const n = 120;
    const ti = flat(n, 10);
    const field = uniform(n, 0, 0);
    const prob = new Float32Array(n * n);
    prob[cellAt(ti.map, 0, 0)] = 1;
    const sim = createSim({ ti, prob, n: 3000, seed: 8 });
    const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length;
    const x0 = mean(sim.x);
    const y0 = mean(sim.y);
    const se = makeStepEnv(ti, field, place, weatherWith(0.5, 0), 22, 5, IDENTITY_MEMBER);
    for (let k = 0; k < 120; k++) step(sim, field, se, 5);
    const xs = Array.from(sim.x);
    const ys = Array.from(sim.y);
    // no drift: the cloud stays centred on where it was released (±3 m on a ~40 m spread)
    expect(Math.abs(mean(sim.x) - x0)).toBeLessThan(3);
    expect(Math.abs(mean(sim.y) - y0)).toBeLessThan(3);
    expect(std(xs) / std(ys)).toBeGreaterThan(0.9);
    expect(std(xs) / std(ys)).toBeLessThan(1.1);
  });

  it('rotating the wind by 90° rotates the plume by 90°', () => {
    const n = 100;
    const ti = flat(n, 10);
    const centroid = (heat: Float32Array) => {
      let sx = 0;
      let sy = 0;
      let s = 0;
      for (let i = 0; i < heat.length; i++) {
        const r = Math.floor(i / n);
        const c = i - r * n;
        sx += (c - n / 2 + 0.5) * 10 * heat[i];
        sy += -(r - n / 2 + 0.5) * 10 * heat[i];
        s += heat[i];
      }
      return [sx / s, sy / s];
    };
    const prob = new Float32Array(n * n);
    prob[cellAt(ti.map, 0, 0)] = 1;
    const wx = weatherWith(2, 0);
    const east = centroid(runEnsemble({ ti, field: uniform(n, 0.6, 0), place, weather: wx, prob, tEnd: 21, members: 1, particles: 3000, dt: 10 }).heat);
    const north = centroid(runEnsemble({ ti, field: uniform(n, 0, 0.6), place, weather: wx, prob, tEnd: 21, members: 1, particles: 3000, dt: 10, seed: 99 }).heat);
    expect(east[0]).toBeGreaterThan(50);
    expect(Math.abs(east[1])).toBeLessThan(0.15 * east[0]);
    expect(north[1]).toBeGreaterThan(50);
    expect(Math.abs(north[0])).toBeLessThan(0.15 * north[1]);
    expect(north[1] / east[0]).toBeGreaterThan(0.9);
    expect(north[1] / east[0]).toBeLessThan(1.1);
  });
});

describe('probability prior reproduces its profile statistics', () => {
  // On featureless flat ground the prior's distance distribution must be the profile's
  // log-normal: half the probability inside the median distance. A slip in the 1/(2πd)
  // ring conversion or the units would move this. Grid: 24 km so the tails are not cut off.
  for (const id of ['child16', 'child712', 'dementia', 'hiker'] as const) {
    it(`${PROFILES[id].label}: half the mass lies within the median distance`, () => {
      const n = 400;
      const m = meta(n, 60);
      const gm = gridMap(m, frameOf(m));
      const layers = buildStaticLayers(m, gm, new Float32Array(n * n).fill(500), new Uint8Array(n * n).fill(LC.open), []);
      const barrier = barrierFactor(layers, m, gm, [0, 0]);
      const p = computeProbability({ meta: m, map: gm, layers, barrier, lkp: [0, 0], profile: PROFILES[id] });
      let inside = 0;
      for (let i = 0; i < p.length; i++) {
        const r = Math.floor(i / n);
        const c = i - r * n;
        if (Math.hypot((c - n / 2 + 0.5) * 60, (r - n / 2 + 0.5) * 60) <= PROFILES[id].medianM) inside += p[i];
      }
      // the grid keeps only the part of the distribution inside it; renormalised, the median share is
      // 0.5 / (1 − share beyond the grid) (wide profiles such as the hiker lose a visible tail)
      const expected = 0.5 / (1 - shareBeyond(PROFILES[id], (n * 60) / 2));
      expect(Math.abs(inside - expected)).toBeLessThan(0.05);
    });
  }
});

describe('probability outside the modelled area', () => {
  it('is small for a young child and large for a hiker in a 12 km area', () => {
    expect(shareBeyond(PROFILES.child16, 6000)).toBeLessThan(0.001);
    const hiker = shareBeyond(PROFILES.hiker, 6000);
    expect(hiker).toBeGreaterThan(0.2); // sourced spread (Australian study quartiles): a long tail
    expect(hiker).toBeLessThan(0.35);
    // half the distribution lies beyond the median by definition (equal-area radius = median)
    expect(shareBeyond({ medianM: 1000, spread: 0.9 }, (1000 * Math.sqrt(Math.PI)) / 2)).toBeCloseTo(0.5, 5);
  });
});

describe('time-since-missing limit', () => {
  it('reach grows with time and has a floor', () => {
    expect(travelReachM(PROFILES.child712, 1)).toBe(3000);
    expect(travelReachM(PROFILES.child712, 0)).toBe(750); // 15-minute floor
    expect(travelReachM(PROFILES.child712, undefined)).toBe(Infinity);
    expect(travelReachM(PROFILES.catIndoor, 1)).toBe(Infinity); // no speed given: no limit
  });
  it('is a soft cut-off at the reach', () => {
    expect(travelFactor(1500, 1500)).toBeCloseTo(0.5, 6);
    expect(travelFactor(500, 1500)).toBeGreaterThan(0.95);
    expect(travelFactor(3000, 1500)).toBeLessThan(0.01);
    expect(travelFactor(1e6, Infinity)).toBe(1);
  });
  it('binds early and lets go once anyone could have gone further than people are found', () => {
    expect(travelLimitBinds(PROFILES.child712, 0.5)).toBe(true);
    expect(travelLimitBinds(PROFILES.child712, 6)).toBe(false);
    expect(travelLimitBinds(PROFILES.hiker, 3)).toBe(true);
  });
  it('pulls the map in early and leaves it alone later', () => {
    const n = 200;
    const cell = 30;
    const m = { crs: 'EPSG:32618', originX: 500000, originY: 4600000, cellSize: cell, cols: n, rows: n, noData: -9999 };
    const elev = new Float32Array(n * n).fill(100);
    const map = gridMap(m, frameOf(m));
    const layers = buildStaticLayers(m, map, elev, new Uint8Array(n * n).fill(2), []);
    const barrier = new Float32Array(n * n).fill(1);
    const within = (p: Float32Array, r: number) => {
      let s = 0;
      for (let i = 0; i < p.length; i++) {
        const [x, y] = cellCenterLocal(map, i);
        if (Math.hypot(x, y) <= r) s += p[i];
      }
      return s;
    };
    const base = { meta: m, map, layers, barrier, lkp: [0, 0] as [number, number], profile: PROFILES.child712 };
    const early = computeProbability({ ...base, elapsedH: 0.5 }); // reach 1.5 km
    const late = computeProbability({ ...base, elapsedH: 8 });
    const none = computeProbability(base);
    expect(within(early, 2000)).toBeGreaterThan(0.97);
    expect(within(none, 2000)).toBeLessThan(0.9); // ~0.78 analytically; the 6 km grid trims the tail
    expect(Math.abs(within(late, 2000) - within(none, 2000))).toBeLessThan(0.01);
  });
});

describe('end-to-end sanity', () => {
  it('the first team starts downwind of a single likely spot, not upwind', () => {
    const n = 100;
    const ti = flat(n, 10);
    const field = uniform(n, 0.5, 0); // toward the east
    const prob = new Float32Array(n * n);
    prob[cellAt(ti.map, -250, 0)] = 1;
    const blocks = blockIndex(n, n, HOTSPOTS.recvBlockCells, HOTSPOTS.srcBlockCells);
    const deployable = deployableCells(ti, new Uint8Array(n * n), new Uint8Array(n * n));
    const { heat, contrib } = runEnsemble({ ti, field, place, weather: weatherWith(2, 0), prob, tEnd: 21, members: 2, particles: 3000, dt: 10, blocks });
    const [first] = greedyDeploy({ contrib: contrib!, blocks, curve: calibrateDetection(), windAt: () => ({ u: 0.5, v: 0 }), routeM: 0, heat, q: sourceSums(prob, blocks), deployable, map: ti.map, teams: 2 });
    expect(first).toBeDefined();
    expect(first.x).toBeGreaterThan(-250); // east of the source = downwind
    expect(Math.abs(first.y)).toBeLessThan(150); // inside the plume
  });

  it('with turbulence on, a back-trace still centres on the true source', () => {
    const n = 200;
    const ti = flat(n, 10);
    const u = 0.25 / noseWindFactor(LC.open); // 900 m in 60 min at nose height
    const field = uniform(n, u, 0);
    const zone = backtrace({ ti, field, t: 20, x: 600, y: 0, particles: 1500, perturbWind: false, sigmaA: TURBULENCE.briggsA.D });
    let sx = 0;
    let s = 0;
    for (let i = 0; i < zone.length; i++) {
      if (zone[i] < 0.3) continue;
      const c = i % n;
      sx += (c - n / 2 + 0.5) * 10 * zone[i];
      s += zone[i];
    }
    // the swept zone runs from the alert back upwind toward the source: it reaches the source,
    // which lies on its axis, and nothing comes from downwind of the alert. In this light wind
    // (0.25 m/s) the meander floor makes the far end wide, as near-calm air really is.
    const at = (x: number, y: number) => zone[cellAt(ti.map, x, y)];
    expect(at(-300, 0)).toBeGreaterThan(0.05);
    expect(at(-300, 0)).toBeGreaterThan(2 * at(-300, 450));
    expect(at(900, 0)).toBeLessThan(0.02);
    expect(sx / s).toBeLessThan(600);
    expect(sx / s).toBeGreaterThan(-300);
  });
});
