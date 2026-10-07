/**
 * Simulation trials and sensitivity analysis on the bundled Catskills scenario.
 *   npx vite-node scripts/evaluate.ts [--quick]
 *
 * Question 1: do Scentline's scent-aware start points cover the likely person better than simpler
 * strategies, and how does that hold up when the forecast wind is wrong?
 *   - The plan is made with the forecast wind (WindNinja, 19:00, window 18:00-19:00).
 *   - "Truth worlds" re-run the scent with the wind rotated by e degrees (random sign) and its
 *     speed scaled by U(0.7, 1.3), plus a different turbulence seed: the world as it might really be.
 *   - In each world, each team works a route upwind from its start in the TRUE wind (a handler
 *     follows the wind they feel) and finds a person at source block s with probability
 *     POD · det, where det is the best absolute single-person detection along the route in that
 *     world (single-plume calibration), or close-range detection within 150 m of the route.
 *   - Success = Σ_s P(person at s) · P(at least one team finds them).
 * This scores plans under the model's own physics, so it measures robustness to wind error and the
 * value of planning with scent at all, not agreement with real dogs (that needs field trials).
 *
 * Question 2: which assumptions move the plan? Each parameter is varied, the plan is recomputed,
 * and we report how far the start points move and how success changes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DETECTION, ENSEMBLE, HOTSPOTS, PROFILES, SCENT, TURBULENCE } from '../src/config/modelParams';
import { loadOffline } from '../src/api/loader';
import { cellCenterLocal, gridMap, toLocal } from '../src/geo/grid';
import { calibrateDetection, receiverDetection, type ReceiverDetection } from '../src/models/detection';
import { deployableCells, greedyDeploy, routeCoverage, sourceSums, traceRoute, type WindAt } from '../src/models/hotspots';
import { samplePoints, windConfidence } from '../src/models/windConfidence';
import { barrierFactor, buildStaticLayers, computeProbability, rasterizeLines, rasterizePolygons, resampleToDetail } from '../src/models/probability';
import { Rng } from '../src/models/rng';
import { blockIndex, runEnsemble, type BlockIndex } from '../src/models/scent';
import { buildTerrainInfo, LC } from '../src/models/terrainInfo';
import { sampleWind, type WindField } from '../src/models/wind';

const QUICK = process.argv.includes('--quick');
const PUBLIC = join(__dirname, '..', 'public');
// serve the demo bundle from disk to the browser loader
globalThis.fetch = (async (url: string | URL) => {
  const p = join(PUBLIC, String(url).replace(/^\/+/, ''));
  return new Response(readFileSync(p), { status: 200, headers: { 'content-type': p.endsWith('.json') || p.endsWith('.geojson') ? 'application/json' : 'application/octet-stream' } });
}) as typeof fetch;

const T = 19; // deploy time
const TEAMS = 3;
const WORLDS = QUICK ? 3 : 8;
const ERRORS = [0, 15, 30, 45, 90];

const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

const b = await loadOffline();
const wind = b.windninja ?? b.fallback;
const c = b.config;
const place = { date: c.date, lat: c.lat, lon: c.lon, utcOffsetSeconds: c.utcOffsetSeconds };
const ti = buildTerrainInfo(b.detail.meta, b.frame, b.detail.elev, b.detail.landcover, b.overview);
const ovMap = gridMap(b.overview.meta, b.frame);
const ovLayers = buildStaticLayers(b.overview.meta, ovMap, b.overview.elev, b.overview.landcover, b.features);
const lkp = toLocal(b.frame, c.lkp.x, c.lkp.y);
const nD = b.detail.elev.length;
const water = new Uint8Array(nD);
for (let i = 0; i < nD; i++) if (b.detail.landcover[i] === LC.water) water[i] = 1;
rasterizePolygons(b.features.filter((f) => f.kind === 'lake' && f.polygon), ti.map, water);
rasterizeLines(b.features.filter((f) => f.kind === 'river'), ti.map, water);
const cliff = new Uint8Array(nD);
rasterizeLines(b.features.filter((f) => f.kind === 'cliff'), ti.map, cliff);
const deployable = deployableCells(ti, water, cliff);
const blocks = blockIndex(b.detail.meta.cols, b.detail.meta.rows, HOTSPOTS.recvBlockCells, HOTSPOTS.srcBlockCells);
const cols = b.detail.meta.cols;
const rows = b.detail.meta.rows;

const ovProb = computeProbability({ meta: b.overview.meta, map: ovMap, layers: ovLayers, barrier: barrierFactor(ovLayers, b.overview.meta, ovMap, lkp), lkp, profile: PROFILES[c.profile as keyof typeof PROFILES] });
const { prob, segmentFraction } = resampleToDetail(ovProb, ovMap, ti.map, water);
const q = sourceSums(prob, blocks);
log(`demo loaded: ${cols}x${rows} detail grid, focus square holds ${(segmentFraction * 100).toFixed(0)}% of the probability`);

// ---------------------------------------------------------------- scent runs
interface Run {
  contrib: Float32Array;
  heat: Float32Array;
  field: WindField;
}
function scent(field: WindField, seed: number, members = ENSEMBLE.members): Run {
  const { heat, contrib } = runEnsemble({ ti, field, place, weather: b.weather, prob, tEnd: T, members, particles: QUICK ? 2500 : ENSEMBLE.particlesPerMember, blocks, seed });
  return { heat, contrib: contrib!, field };
}
const windAtOf =
  (field: WindField): WindAt =>
  (x, y) =>
    sampleWind(field, ti.map, x, y, T);
/** physical (single plume) calibration: what a dog in the true world detects */
const physCurve = calibrateDetection({ members: 1 });
function rotated(field: WindField, deg: number, scale: number): WindField {
  const r = (deg * Math.PI) / 180;
  const cs = Math.cos(r) * scale;
  const sn = Math.sin(r) * scale;
  return {
    hours: field.hours,
    grids: field.grids.map((g) => {
      const u = new Float32Array(g.u.length);
      const v = new Float32Array(g.v.length);
      for (let i = 0; i < u.length; i++) {
        u[i] = g.u[i] * cs - g.v[i] * sn;
        v[i] = g.u[i] * sn + g.v[i] * cs;
      }
      return { u, v };
    }),
  };
}

// ---------------------------------------------------------------- strategies (receiver blocks)
const recvOfCell = (cell: number) => blocks.recvOf[cell];
const cellXY = (cell: number) => cellCenterLocal(ti.map, cell);
function nearestDeployable(x: number, y: number): number {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < nD; i++) {
    if (!deployable[i]) continue;
    const [cx, cy] = cellXY(i);
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}
function spaced(cands: number[], k: number, sepM: number): number[] {
  const out: number[] = [];
  for (const i of cands) {
    if (out.length >= k) break;
    const [x, y] = cellXY(i);
    if (out.every((j) => Math.hypot(x - cellXY(j)[0], y - cellXY(j)[1]) >= sepM)) out.push(i);
  }
  return out;
}

interface PlanOpts {
  pod?: number;
  spacingM?: number;
  d50M?: number;
  routeM?: number;
  scentTeams?: number;
  /** single-realization run (oracle): use the physical calibration */
  physical?: boolean;
}
function scentlinePlan(run: Run, o: PlanOpts = {}): number[] {
  const curve = o.physical ? physCurve : calibrateDetection({ d50M: o.d50M });
  return greedyDeploy({
    contrib: run.contrib,
    blocks,
    curve,
    windAt: windAtOf(run.field),
    routeM: o.routeM,
    heat: run.heat,
    q,
    prob,
    deployable,
    map: ti.map,
    teams: TEAMS,
    pod: o.pod,
    spacingM: o.spacingM,
    scentTeams: o.scentTeams,
  }).map((d) => d.cell);
}
const probabilityPlan = () =>
  spaced(
    [...Array(nD).keys()].filter((i) => deployable[i]).sort((a, b2) => prob[b2] - prob[a]),
    TEAMS,
    HOTSPOTS.suppressRadiusM,
  );
const lkpRingPlan = () => [nearestDeployable(lkp[0], lkp[1]), ...[0, 120, 240].slice(0, TEAMS - 1).map((a) => nearestDeployable(lkp[0] + 400 * Math.sin((a * Math.PI) / 180), lkp[1] + 400 * Math.cos((a * Math.PI) / 180)))];
function downwindPlan(): number[] {
  const w = sampleWind(wind, ti.map, lkp[0], lkp[1], T);
  const s = Math.hypot(w.u, w.v) || 1;
  return [250, 550, 850].slice(0, TEAMS).map((d) => nearestDeployable(lkp[0] + (w.u / s) * d, lkp[1] + (w.v / s) * d));
}
function randomPlan(rng: Rng): number[] {
  const cands = [...Array(nD).keys()].filter((i) => deployable[i] && Math.hypot(cellXY(i)[0] - lkp[0], cellXY(i)[1] - lkp[1]) < 1500);
  for (let k = cands.length - 1; k > 0; k--) {
    const j = Math.floor(rng.next() * (k + 1));
    [cands[k], cands[j]] = [cands[j], cands[k]];
  }
  return spaced(cands, TEAMS, HOTSPOTS.suppressRadiusM);
}

// ---------------------------------------------------------------- scoring in a world
interface World {
  run: Run;
  det: ReceiverDetection;
  windAt: WindAt;
}
function world(run: Run): World {
  return { run, det: receiverDetection(run.contrib, q, blocks, physCurve), windAt: windAtOf(run.field) };
}
function success(plan: number[], w: World, pod = HOTSPOTS.dogPOD): number {
  const miss = new Float64Array(blocks.nSrc).fill(1);
  for (const cell of plan) {
    const [x, y] = cellXY(cell);
    const route = traceRoute(ti.map, deployable, x, y, w.windAt, HOTSPOTS.routeM);
    const c = routeCoverage(route, { blocks, map: ti.map, det: w.det });
    for (let k = 0; k < c.src.length; k++) miss[c.src[k]] *= 1 - pod * c.d[k];
  }
  let found = 0;
  for (let s = 0; s < blocks.nSrc; s++) found += q[s] * (1 - miss[s]);
  return found;
}

// ---------------------------------------------------------------- question 1
log('model ensemble (forecast wind)…');
const conf = windConfidence(wind, b.windninja ? b.fallback : null, ti.map, samplePoints(ti.map, lkp[0], lkp[1]), T);
log(`wind confidence at ${T}:00: ${conf.level} (speed ${conf.speed.toFixed(1)} m/s, models differ ${conf.disagreeDeg?.toFixed(0) ?? '-'}°, turn ${conf.turnDeg.toFixed(0)}°)`);
const model = scent(wind, 1000 + T * 60);
const wide = (() => {
  const save = ENSEMBLE.rotDeg;
  ENSEMBLE.rotDeg = 35;
  const run = scent(wind, 1000 + T * 60);
  const p = { all: scentlinePlan(run), hedged: scentlinePlan(run, { scentTeams: TEAMS - 1 }) };
  ENSEMBLE.rotDeg = save;
  return p;
})();
const appRule = conf.level === 'good' ? 'all teams by scent, ±20° planning' : 'one team hedged on likely ground, ±35° planning';
log(`app rule for this wind: ${appRule}`);
const plans: Record<string, number[]> = {
  [`Scentline (app rule: ${appRule})`]: conf.level === 'good' ? scentlinePlan(model) : wide.hedged,
  'Scent±20 (all teams by scent, ±20° planning)': scentlinePlan(model),
  'Scent±35 (all teams by scent, ±35° planning)': wide.all,
  'Hedge±20 (2 by scent + 1 on likely ground, ±20°)': scentlinePlan(model, { scentTeams: TEAMS - 1 }),
  'NoRoute (±20°, starts planned without routes)': scentlinePlan(model, { routeM: 0 }),
  'Most-likely ground (no scent)': probabilityPlan(),
  'Ring around the LKP': lkpRingPlan(),
  'Straight downwind of the LKP': downwindPlan(),
};
for (const [n, pl] of Object.entries(plans)) log(n, pl.map((cell) => cellXY(cell).map((v) => Math.round(v)).join(',')).join(' | '), 'lkp', lkp.map(Math.round).join(','));
const rng = new Rng(4242);
const randomPlans = Array.from({ length: 30 }, () => randomPlan(rng));
const results: Record<string, number[]> = Object.fromEntries([...Object.keys(plans), 'Random (within 1.5 km)', 'Oracle (knows the true wind)'].map((k) => [k, [] as number[]]));
const meanStd = (a: number[]) => {
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return { m, sd: Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length - 1)) };
};
const table: { err: number; rows: Record<string, { m: number; sd: number }> }[] = [];
const wrng = new Rng(99);
const worldsByErr = new Map<number, World[]>();
for (const err of ERRORS) {
  const per: Record<string, number[]> = Object.fromEntries(Object.keys(results).map((k) => [k, [] as number[]]));
  worldsByErr.set(err, []);
  for (let k = 0; k < WORLDS; k++) {
    const sign = wrng.next() < 0.5 ? -1 : 1;
    const truthField = rotated(wind, sign * err, wrng.uniform(0.7, 1.3));
    const truthRun = scent(truthField, 5000 + 31 * k + err, 1);
    const w = world(truthRun);
    worldsByErr.get(err)!.push(w);
    for (const [name, plan] of Object.entries(plans)) per[name].push(success(plan, w));
    per['Random (within 1.5 km)'].push(randomPlans.reduce((s, p) => s + success(p, w), 0) / randomPlans.length);
    per['Oracle (knows the true wind)'].push(success(scentlinePlan(truthRun, { physical: true }), w));
  }
  const rowsOut: Record<string, { m: number; sd: number }> = {};
  for (const [name, v] of Object.entries(per)) rowsOut[name] = meanStd(v);
  table.push({ err, rows: rowsOut });
  log(`wind error ±${err}°:`, Object.entries(rowsOut).map(([n, r]) => `${n.split(' ')[0]} ${(r.m * 100).toFixed(1)}±${(r.sd * 100).toFixed(1)}%`).join(' · '));
}

// ---------------------------------------------------------------- question 1b: plan for more wind uncertainty?
// The planning ensemble rotates the wind by U(-rot, +rot). A wider spread hedges against a wrong
// forecast direction; does it cost much when the forecast is right?
log('ensemble spread…');
const spread: { rotDeg: number; byErr: Record<number, number>; mean: number }[] = [];
const saveRot = ENSEMBLE.rotDeg;
for (const rot of [20, 35, 50]) {
  ENSEMBLE.rotDeg = rot;
  const plan = scentlinePlan(scent(wind, 1000 + T * 60));
  ENSEMBLE.rotDeg = saveRot;
  const byErr: Record<number, number> = {};
  for (const err of ERRORS) {
    const ws = worldsByErr.get(err)!;
    byErr[err] = ws.reduce((a, w) => a + success(plan, w), 0) / ws.length;
  }
  const mean = ERRORS.reduce((a, e) => a + byErr[e], 0) / ERRORS.length;
  spread.push({ rotDeg: rot, byErr, mean });
  log(`ensemble ±${rot}°:`, ERRORS.map((e) => `${e}°→${(byErr[e] * 100).toFixed(1)}%`).join(' '), `mean ${(mean * 100).toFixed(1)}%`);
}

// ---------------------------------------------------------------- question 2: sensitivity
log('sensitivity…');
const truthRef = [0, 1, 2].map((k) => world(scent(rotated(wind, (k - 1) * 15, 1), 7000 + k, 1))); // modest wind error
const basePlan = scentlinePlan(model);
const baseScore = truthRef.reduce((s, w) => s + success(basePlan, w), 0) / truthRef.length;
const shift = (plan: number[]) => {
  // mean distance from each new start to the nearest base start
  return plan.reduce((s, cell) => s + Math.min(...basePlan.map((bc) => Math.hypot(cellXY(cell)[0] - cellXY(bc)[0], cellXY(cell)[1] - cellXY(bc)[1]))), 0) / plan.length;
};
interface Variant {
  name: string;
  apply: () => void;
  undo: () => void;
  plan?: PlanOpts;
}
const save = { ...SCENT };
const saveT = { ...TURBULENCE, briggsA: { ...TURBULENCE.briggsA } };
const restore = () => {
  Object.assign(SCENT, save);
  Object.assign(TURBULENCE, saveT, { briggsA: { ...saveT.briggsA } });
};
const scaleBriggs = (f: number) => {
  for (const k of Object.keys(TURBULENCE.briggsA)) TURBULENCE.briggsA[k] = saveT.briggsA[k] * f;
};
const variants: Variant[] = [
  { name: 'Scent decay time ×0.5 (15 min)', apply: () => (SCENT.baseTauS = save.baseTauS * 0.5), undo: restore },
  { name: 'Scent decay time ×2 (60 min)', apply: () => (SCENT.baseTauS = save.baseTauS * 2), undo: restore },
  { name: 'Plume spread ×0.5', apply: () => scaleBriggs(0.5), undo: restore },
  { name: 'Plume spread ×2', apply: () => scaleBriggs(2), undo: restore },
  { name: 'Turbulence memory 300 s', apply: () => (TURBULENCE.lagrangianS = 300), undo: restore },
  { name: 'Turbulence memory 1200 s', apply: () => (TURBULENCE.lagrangianS = 1200), undo: restore },
  { name: 'Team acts on a detection 50%', apply: () => {}, undo: () => {}, plan: { pod: 0.5 } },
  { name: 'Team acts on a detection 90%', apply: () => {}, undo: () => {}, plan: { pod: 0.9 } },
  { name: 'Dog range (d50) 120 m', apply: () => {}, undo: () => {}, plan: { d50M: 120 } },
  { name: 'Dog range (d50) 320 m', apply: () => {}, undo: () => {}, plan: { d50M: 320 } },
  { name: 'Route 300 m', apply: () => {}, undo: () => {}, plan: { routeM: 300 } },
  { name: 'Route 1000 m', apply: () => {}, undo: () => {}, plan: { routeM: 1000 } },
  { name: 'Close-range detectability 0.3', apply: () => (HOTSPOTS.nearDet = 0.3), undo: () => (HOTSPOTS.nearDet = 0.6) },
  { name: 'Close-range detectability 0.9', apply: () => (HOTSPOTS.nearDet = 0.9), undo: () => (HOTSPOTS.nearDet = 0.6) },
  { name: 'Team spacing 150 m', apply: () => {}, undo: () => {}, plan: { spacingM: 150 } },
  { name: 'Team spacing 500 m', apply: () => {}, undo: () => {}, plan: { spacingM: 500 } },
];
const sens: { name: string; shiftM: number; score: number }[] = [];
for (const v of variants) {
  v.apply();
  const scentChanged = v.plan === undefined;
  const run = scentChanged ? scent(wind, 1000 + T * 60) : model;
  const plan = scentlinePlan(run, v.plan);
  v.undo();
  const score = truthRef.reduce((s, w) => s + success(plan, w), 0) / truthRef.length;
  sens.push({ name: v.name, shiftM: shift(plan), score });
  log(`${v.name}: starts move ${shift(plan).toFixed(0)} m, success ${(score * 100).toFixed(1)}% (base ${(baseScore * 100).toFixed(1)}%)`);
}

const out = { date: new Date().toISOString(), quick: QUICK, worlds: WORLDS, segmentFraction, deployHour: T, teams: TEAMS, detection: { d50M: DETECTION.d50M, routeM: HOTSPOTS.routeM }, windConfidence: conf, trials: table, ensembleSpread: spread, sensitivity: { baseScore, variants: sens } };
writeFileSync(join(__dirname, 'evaluation-results.json'), JSON.stringify(out, null, 1));
log('wrote scripts/evaluation-results.json');
