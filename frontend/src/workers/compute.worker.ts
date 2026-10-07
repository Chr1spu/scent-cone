/// <reference lib="webworker" />
/**
 * Heavy computation off the main thread: probability, ensembles, hotspots, deployment,
 * alert back-tracing and negative search updates. Holds the search state (prior, likelihood).
 */
import { ENSEMBLE, HOTSPOTS, PROBABILITY, PROFILES, TRIANGULATION } from '../config/modelParams';
import { envAt } from '../models/env';
import { MISSIONS, type MissionId } from '../config/missions';
import { aggregateToOverview, areaPrior, habitatPrior, hidesPrior, waterPrior } from '../models/sources';
import { setTuning } from '../models/tuning';
import { cellAt, cellCenterLocal, gridMap, insideGrid, localBounds, type GridMap } from '../geo/grid';
import { blockMean, deployableCells, detThresholds, greedyDeploy, snapshotScore, sourceSums, withinReach, type DetThresholds } from '../models/hotspots';
import { calibrateDetection, receiverDetection } from '../models/detection';
import {
  applyBrush,
  barrierFactor,
  buildStaticLayers,
  computeProbability,
  distanceTransform,
  normalize,
  overviewPosterior,
  rasterizeLines,
  rasterizePolygons,
  resampleToDetail,
  sumInside,
  type StaticLayers,
} from '../models/probability';
import { normalizeContrib, blockIndex, meanderFor, type BlockIndex } from '../models/scent';
import { EnsemblePool, parallelEnsemble, poolSize } from './pool';
import { searchUpdate, type SearchedSector } from '../models/searchUpdate';
import { buildTerrainInfo, LC, type TerrainInfo } from '../models/terrainInfo';
import { alertLikelihood, argmax, backtrace, driftPoint } from '../models/triangulation';
import { sampleWind, type WindField } from '../models/wind';
import type { AlertResult, DeploymentOut, Envelope, HeatResult, InitMsg, ProbResult, Reply, SearchResult, SegmentInfo, SegmentsResult, SourceSpec } from './protocol';
import { assignSegments, receiversOfSegments, scoreSegments, segmentArea, segmentBoundary, sweepDetection, type Segmentation } from '../models/segments';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

interface State {
  init: InitMsg;
  ovMap: GridMap;
  ti: TerrainInfo;
  ovLayers: StaticLayers;
  detailWater: Uint8Array;
  deployable: Uint8Array;
  blocks: BlockIndex;
  wind: WindField;
  barrierCache: Map<string, Float32Array>;
  edits: Float32Array;
  prior: Float32Array | null;
  L: Float32Array;
  outside: number;
  probVersion: number;
  windVersion: number;
  ovPost: Float32Array | null;
  detailPost: Float32Array | null;
  segmentFraction: number;
  last: Ensemble | null;
  snapshots: { key: string; byHour: Map<number, Float32Array> } | null;
  profile: keyof typeof PROFILES;
  lkp: [number, number];
  /** hours since the person went missing, for the travel limit (undefined = none) */
  elapsedH: number | undefined;
  /** planning ensemble spread (±degrees) */
  rotDeg: number;
  /** search segments of the focus square (built on first use) */
  seg: Segmentation | null;
  /** product of negative-update (searched, no alert) factors per detail cell */
  Lneg: Float32Array;
  /** intended direction of travel (degrees from north) or null */
  travelDir: number | null;
  warmed: boolean;
  mission: MissionId;
  source: SourceSpec;
  /** prior computed directly on the detail grid (all sources except 'lkp') */
  detailPrior: Float32Array | null;
  cliff: Uint8Array;
  /** distance to the nearest stream on the detail grid (habitat surveys) */
  streamDist: Float32Array;
}

interface Ensemble {
  t: number;
  windowMin: number;
  key: string;
  heat: Float32Array;
  contrib: Float32Array;
  heatRecv: Float32Array;
  /** absolute thresholds from the neutral reference run, detail- and receiver-level */
  th: DetThresholds;
  /** scent present relative to the neutral reference */
  relStrength: number;
  thRecv: DetThresholds;
}

let S: State | null = null;
let pool: EnsemblePool | null = null;

function st(): State {
  if (!S) throw new Error('worker not initialised');
  return S;
}

function init(m: InitMsg) {
  const ovMap = gridMap(m.overview.meta, m.frame);
  const ti = buildTerrainInfo(m.detail.meta, m.frame, m.detail.elev, m.detail.landcover, m.overview);
  const ovLayers = buildStaticLayers(m.overview.meta, ovMap, m.overview.elev, m.overview.landcover, m.features);
  const nD = m.detail.elev.length;
  const detailWater = new Uint8Array(nD);
  for (let i = 0; i < nD; i++) if (m.detail.landcover[i] === LC.water) detailWater[i] = 1;
  rasterizePolygons(m.features.filter((f) => f.kind === 'lake' && f.polygon), ti.map, detailWater);
  rasterizeLines(m.features.filter((f) => f.kind === 'river'), ti.map, detailWater);
  const cliff = new Uint8Array(nD);
  rasterizeLines(m.features.filter((f) => f.kind === 'cliff'), ti.map, cliff);
  const streams = new Uint8Array(nD);
  rasterizeLines(m.features.filter((f) => f.kind === 'stream' || f.kind === 'river'), ti.map, streams);
  const streamDist = distanceTransform(streams, m.detail.meta.cols, m.detail.meta.rows, m.detail.meta.cellSize);
  S = {
    init: m,
    ovMap,
    ti,
    ovLayers,
    detailWater,
    deployable: deployableCells(ti, detailWater, cliff),
    blocks: blockIndex(m.detail.meta.cols, m.detail.meta.rows, HOTSPOTS.recvBlockCells, HOTSPOTS.srcBlockCells),
    wind: m.wind,
    barrierCache: new Map(),
    edits: new Float32Array(m.overview.elev.length).fill(1),
    elapsedH: undefined,
    rotDeg: ENSEMBLE.rotDeg,
    seg: null,
    Lneg: new Float32Array(nD).fill(1),
    travelDir: null,
    prior: null,
    L: new Float32Array(nD).fill(1),
    outside: 1,
    probVersion: 0,
    windVersion: 0,
    ovPost: null,
    detailPost: null,
    segmentFraction: 0,
    last: null,
    snapshots: null,
    profile: 'child712',
    lkp: [0, 0],
    warmed: false,
    mission: 'wilderness',
    source: { kind: 'lkp' },
    detailPrior: null,
    cliff,
    streamDist,
  };
  setTuning(MISSIONS.wilderness.tuning);
  // helper workers run ensemble members in parallel (inline fallback if unavailable)
  pool?.terminate();
  pool = null;
  try {
    if (typeof Worker !== 'undefined') {
      pool = new EnsemblePool(poolSize(), { type: 'init', frame: m.frame, detail: m.detail, overview: m.overview, weather: m.weather, place: m.place, wind: m.wind });
    }
  } catch {
    pool = null;
  }
  return { ok: true, helpers: pool?.size ?? 0 };
}

/** A friendly reason when a source has nowhere to put probability. */
class SourceError extends Error {}

function recomputePrior() {
  const s = st();
  const mission = MISSIONS[s.mission];
  const src = s.source;
  if (src.kind !== 'lkp') {
    const m = s.ti.map;
    let p: Float32Array | null = null;
    if (src.kind === 'hides') p = hidesPrior(m, src.hides);
    else if (src.kind === 'area') p = src.area ? areaPrior(m, src.area, s.ti.elev, s.ti.slopeDeg, s.detailWater, mission.tuning.lowGroundBias) : null;
    else if (src.kind === 'water') p = waterPrior(m, s.detailWater, s.lkp);
    else if (src.kind === 'habitat') p = habitatPrior(s.ti.landcover, s.ti.slopeDeg, s.streamDist, src.habitat);
    if (!p) {
      const why: Record<string, string> = {
        hides: 'Place at least one hide.',
        area: 'Draw the search area first.',
        water: 'There is no water in the focus square. Move the focus square onto a lake or river.',
        habitat: 'No ground in the focus square matches this habitat. Add land-cover types or relax the limits.',
      };
      throw new SourceError(why[src.kind]);
    }
    s.detailPrior = p;
    s.prior = aggregateToOverview(p, s.ti.map, s.ovMap);
    return;
  }
  s.detailPrior = null;
  const key = `${s.lkp[0].toFixed(0)},${s.lkp[1].toFixed(0)}`;
  let barrier = s.barrierCache.get(key);
  if (!barrier) {
    barrier = barrierFactor(s.ovLayers, s.init.overview.meta, s.ovMap, s.lkp);
    s.barrierCache.set(key, barrier);
  }
  s.prior = computeProbability({
    meta: s.init.overview.meta,
    map: s.ovMap,
    layers: s.ovLayers,
    barrier,
    lkp: s.lkp,
    profile: PROFILES[s.profile],
    edits: s.edits,
    elapsedH: s.elapsedH,
    travelDirDeg: s.travelDir,
    lowGroundBias: mission.tuning.lowGroundBias,
  });
}

function recomputePosterior(): ProbResult {
  const s = st();
  if (!s.prior) recomputePrior();
  const prior = s.prior!;
  let ovPost: Float32Array;
  let prob: Float32Array;
  if (s.detailPrior) {
    // detail-grid sources: everything is inside the focus square
    prob = s.detailPrior.slice();
    for (let i = 0; i < prob.length; i++) prob[i] *= s.L[i];
    normalize(prob);
    ovPost = aggregateToOverview(prob, s.ti.map, s.ovMap);
    s.segmentFraction = 1;
  } else {
    ovPost = overviewPosterior(prior, s.ovMap, s.ti.map, s.L, s.outside);
    prob = resampleToDetail(prior, s.ovMap, s.ti.map, s.detailWater).prob;
    for (let i = 0; i < prob.length; i++) prob[i] *= s.L[i];
    normalize(prob);
    const b = localBounds(s.init.detail.meta, s.init.frame);
    s.segmentFraction = sumInside(ovPost, s.ovMap, b);
  }
  s.ovPost = ovPost;
  s.detailPost = prob;
  s.probVersion++;
  s.last = null;
  s.snapshots = null;
  return { overview: ovPost.slice(), detail: prob.slice(), segmentFraction: s.segmentFraction, peak: cellCenterLocal(s.ti.map, argmax(prob)) };
}

/** Switch mission: scent tuning (here, helpers), where teams can stand, the source model. */
function setMission(mission: MissionId, source: SourceSpec): ProbResult {
  const s = st();
  const t = MISSIONS[mission].tuning;
  s.mission = mission;
  setTuning(t);
  pool?.setTuning(t);
  s.deployable = deployableCells(s.ti, s.detailWater, s.cliff, { maxSlopeDeg: t.maxSlopeDeg, mode: t.deploy });
  s.L.fill(1);
  s.Lneg.fill(1);
  s.outside = 1;
  s.source = source;
  s.prior = null;
  recomputePrior();
  return recomputePosterior();
}

/**
 * Ensemble for the window ending at t, plus a neutral-conditions reference run with the same
 * wind that fixes the absolute detectability thresholds.
 */
async function ensembleAt(t: number, report: (f: number, l: string) => void, windowMin: number = ENSEMBLE.windowMin): Promise<Ensemble> {
  const s = st();
  const key = `${s.probVersion}:${s.windVersion}:${s.rotDeg}`;
  if (s.last && s.last.key === key && Math.abs(s.last.t - t) < 1e-6 && s.last.windowMin === windowMin) return s.last;
  const base = { ti: s.ti, field: s.wind, place: s.init.place, weather: s.init.weather, prob: s.detailPost!, tEnd: t, windowMin };
  const total = ENSEMBLE.members + ENSEMBLE.referenceMembers;
  let doneMain = 0;
  let doneRef = 0;
  const tick = () => report(0.05 + 0.9 * ((doneMain * ENSEMBLE.members + doneRef * ENSEMBLE.referenceMembers) / total), 'Scent ensemble');
  // the ensemble and its neutral reference run together across the helper pool
  const [main, ref] = await Promise.all([
    parallelEnsemble(pool, { ...base, members: ENSEMBLE.members, rotDeg: s.rotDeg, blocks: s.blocks, seed: 1000 + Math.round(t * 60) }, (f) => {
      doneMain = f;
      tick();
    }),
    parallelEnsemble(pool, { ...base, members: ENSEMBLE.referenceMembers, particles: ENSEMBLE.referenceParticles, neutral: true, seed: 7 + Math.round(t * 60) }, (f) => {
      doneRef = f;
      tick();
    }),
  ]);
  const { heat, contrib } = normalizeContrib(main, ENSEMBLE.members, ENSEMBLE.particlesPerMember);
  const cols = s.ti.meta.cols;
  const rows = s.ti.meta.rows;
  s.last = {
    t,
    windowMin,
    key,
    heat,
    contrib: contrib!,
    heatRecv: blockMean(heat, cols, rows, s.blocks),
    th: detThresholds(ref.heat),
    relStrength: sumOf(heat) / Math.max(sumOf(ref.heat), 1e-12),
    thRecv: detThresholds(blockMean(ref.heat, cols, rows, s.blocks)),
  };
  return s.last;
}

function sumOf(a: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s;
}

function topHotspots(heat: Float32Array, map: GridMap, minHeat: number, k = 8, minSepM = 200): number[] {
  const idx: number[] = [];
  for (let i = 0; i < heat.length; i++) if (heat[i] > minHeat) idx.push(i);
  idx.sort((a, b) => heat[b] - heat[a]);
  const out: number[] = [];
  for (const i of idx) {
    if (out.length >= k) break;
    const [x, y] = cellCenterLocal(map, i);
    if (
      out.every((j) => {
        const [x2, y2] = cellCenterLocal(map, j);
        return Math.hypot(x - x2, y - y2) > minSepM;
      })
    )
      out.push(i);
  }
  return out;
}

async function heatAt(t: number, report: (f: number, l: string) => void): Promise<HeatResult> {
  const s = st();
  const e = await ensembleAt(t, report);
  return { t, heat: e.heat.slice(), lo: e.th.lo, hi: e.th.hi, refHi: e.th.hi, relStrength: e.relStrength, hotspots: topHotspots(e.heat, s.ti.map, e.th.lo) };
}

async function hourlySnapshots(report: (f: number, l: string) => void): Promise<Map<number, Float32Array>> {
  const s = st();
  const key = `${s.probVersion}:${s.windVersion}`;
  if (s.snapshots && s.snapshots.key === key) return s.snapshots.byHour;
  const byHour = new Map<number, Float32Array>();
  const hours = s.wind.hours.slice(1);
  let n = 0;
  // one cheap single-member run per hour, all in parallel
  await Promise.all(
    hours.map((h) =>
      parallelEnsemble(pool, {
        ti: s.ti,
        field: s.wind,
        place: s.init.place,
        weather: s.init.weather,
        prob: s.detailPost!,
        tEnd: h,
        members: 1,
        particles: ENSEMBLE.hourlyParticles,
        dt: 15,
        seed: 50 + h,
      }).then(({ heat }) => {
        byHour.set(h, blockMean(heat, s.ti.meta.cols, s.ti.meta.rows, s.blocks));
        report(0.6 + (0.35 * ++n) / hours.length, 'Scoring time windows');
      }),
    ),
  );
  s.snapshots = { key, byHour };
  return byHour;
}

// ---------------------------------------------------------------- segments

function segmentation(): Segmentation {
  const s = st();
  if (s.seg) return s.seg;
  const boundary = segmentBoundary(s.init.features, s.ti.map, s.ti.elev);
  s.seg = segmentArea({ map: s.ti.map, boundary, excluded: s.detailWater });
  return s.seg;
}

/** Score every segment for a dog team over the hour ending at t. */
async function scoreAt(t: number, report: (f: number, l: string) => void) {
  const s = st();
  const seg = segmentation();
  const e = await ensembleAt(t, (f, l) => report(f * 0.55, l));
  const q = sourceSums(s.detailPost!, s.blocks);
  const scores = scoreSegments({
    seg,
    map: s.ti.map,
    blocks: s.blocks,
    det: detectionAt(e, t),
    q,
    deployable: s.deployable,
    windAt: (x, y) => sampleWind(s.wind, s.ti.map, x, y, t),
    pod: MISSIONS[s.mission].tuning.pod,
    insideDet: sweepDetection(e.relStrength),
  });
  const snaps = await hourlySnapshots(report);
  const recv = receiversOfSegments(seg, s.ti.map, s.blocks);
  const hours = [...snaps.keys()].sort((a, b) => a - b);
  const windows = recv.map((rs) =>
    hours.map((hour) => {
      const hr = snaps.get(hour)!;
      let sum = 0;
      for (const r of rs) sum += snapshotScore(hr, r, e.thRecv);
      return { hour, score: rs.length ? sum / rs.length : 0 };
    }),
  );
  return { seg, scores, q, windows };
}

/** Cumulative POD per segment from the searches logged so far: the share of its prior removed. */
function searchedPod(seg: Segmentation): Float32Array {
  const s = st();
  const prior = s.detailPrior ?? resampleToDetail(s.prior!, s.ovMap, s.ti.map, s.detailWater).prob;
  const before = new Float64Array(seg.n);
  const after = new Float64Array(seg.n);
  for (let i = 0; i < prior.length; i++) {
    const k = seg.id[i];
    if (k < 0) continue;
    before[k] += prior[i];
    after[k] += prior[i] * s.Lneg[i];
  }
  return Float32Array.from(before, (b, k) => (b > 0 ? 1 - after[k] / b : 0));
}

async function segmentsAt(t: number, report: (f: number, l: string) => void): Promise<SegmentsResult> {
  const s = st();
  const { seg, scores, windows } = await scoreAt(t, report);
  const searched = searchedPod(seg);
  const f = s.segmentFraction;
  const segs: SegmentInfo[] = scores.map((sc) => {
    const ws = windows[sc.seg];
    const best = ws.reduce((a, b) => (b.score > a.score ? b : a), ws[0] ?? { hour: Math.ceil(t), score: 0 });
    return {
      index: sc.seg,
      name: seg.names[sc.seg],
      areaM2: seg.areaM2[sc.seg],
      poa: sc.poa * f,
      value: sc.value * f,
      fromOutside: sc.fromOutside * f,
      podInside: sc.podInside,
      podSearched: searched[sc.seg],
      entry: sc.entry,
      upwind: sc.upwind,
      windSpeed: sc.windSpeed,
      hours: sc.hours,
      bestWindow: [best.hour - 1, best.hour],
      windowScores: ws,
    };
  });
  return { t, id: seg.id.slice(), names: seg.names, rings: seg.rings, centroid: seg.centroid, segs };
}

/** Assign teams to whole segments (the handler picks the pattern inside). */
async function deploySegments(t: number, teams: number, hedge: boolean, report: (f: number, l: string) => void): Promise<DeploymentOut[]> {
  const s = st();
  const { seg, scores, q, windows } = await scoreAt(t, report);
  const tune = MISSIONS[s.mission].tuning;
  const scentTeams = hedge && teams >= HOTSPOTS.hedgeMinTeams ? teams - 1 : teams;
  const picks = assignSegments(scores, q, teams, tune.pod, scentTeams);
  return picks.map((a) => {
    const sc = a.score;
    const ws = windows[sc.seg];
    const best = ws.reduce((x, y) => (y.score > x.score ? y : x), ws[0] ?? { hour: Math.ceil(t), score: 0 });
    return {
      team: a.team,
      x: sc.entry[0],
      y: sc.entry[1],
      upwind: sc.upwind,
      windSpeed: sc.windSpeed,
      coveredProb: a.marginal * s.segmentFraction,
      bestWindow: [best.hour - 1, best.hour] as [number, number],
      windowScores: ws,
      kind: a.ground ? 'ground' : 'scent',
      segment: {
        index: sc.seg,
        name: seg.names[sc.seg],
        areaM2: seg.areaM2[sc.seg],
        poa: sc.poa * s.segmentFraction,
        podInside: sc.podInside,
        hours: sc.hours,
        ring: seg.rings[sc.seg][0] ?? [],
      },
    };
  });
}

/**
 * Single-person detection at every team position for the ensemble ending at t, with the plume
 * width of the stability class at that time and the planning calibration for the current spread.
 */
function detectionAt(e: Ensemble, t: number) {
  const s = st();
  const { sigmaA } = meanderFor(envAt(s.init.place, s.init.weather, t), TRIANGULATION.dt);
  return receiverDetection(e.contrib, sourceSums(s.detailPost!, s.blocks), s.blocks, calibrateDetection({ rotDeg: s.rotDeg }), 0.01, { sigmaA, cellM: s.ti.meta.cellSize });
}

async function deploy(t: number, teams: number, hedge: boolean, report: (f: number, l: string) => void, mode: 'segments' | 'points' = 'points'): Promise<DeploymentOut[]> {
  const s = st();
  if (mode === 'segments') return deploySegments(t, teams, hedge, report);
  const e = await ensembleAt(t, (f, l) => report(f * 0.55, l));
  report(0.56, 'Greedy deployment');
  const tune = MISSIONS[s.mission].tuning;
  const deps = greedyDeploy({
    pod: tune.pod,
    spacingM: tune.spacingM,
    contrib: e.contrib,
    blocks: s.blocks,
    curve: calibrateDetection({ rotDeg: s.rotDeg }),
    det: detectionAt(e, t),
    windAt: (x, y) => sampleWind(s.wind, s.ti.map, x, y, t),
    heat: e.heat,
    q: sourceSums(s.detailPost!, s.blocks),
    deployable: tune.reachM === null ? s.deployable : withinReach(s.deployable, s.detailPost!, s.ti.meta.cols, s.ti.meta.rows, s.ti.meta.cellSize, tune.reachM),
    map: s.ti.map,
    teams,
    prob: s.detailPost!,
    scentTeams: hedge && teams >= HOTSPOTS.hedgeMinTeams ? teams - 1 : teams,
  });
  const snaps = await hourlySnapshots(report);
  return deps.map((d) => {
    // hours in order (results arrive in completion order); ties go to the earliest hour
    const windowScores = [...snaps.entries()].sort((p, q) => p[0] - q[0]).map(([hour, hr]) => ({ hour, score: snapshotScore(hr, d.recv, e.thRecv) }));
    const best = windowScores.reduce((a, b) => (b.score > a.score ? b : a), windowScores[0]);
    let su = 0;
    let sv = 0;
    for (const [ox, oy] of [[0, 0], [60, 0], [-60, 0], [0, 60], [0, -60]]) {
      const w = sampleWind(s.wind, s.ti.map, d.x + ox, d.y + oy, t);
      su += w.u;
      sv += w.v;
    }
    const sp = Math.hypot(su, sv) / 5;
    const len = Math.hypot(su, sv) || 1;
    return {
      team: d.team,
      x: d.x,
      y: d.y,
      upwind: [-su / len, -sv / len] as [number, number],
      windSpeed: sp,
      coveredProb: d.coveredProb * s.segmentFraction,
      bestWindow: [best.hour - 1, best.hour] as [number, number],
      windowScores,
      kind: d.kind,
      route: d.route,
    };
  });
}

/**
 * For each point, the model's chance that a dog there detects one of the sources (in Training:
 * the hides), over the hour ending at t. Same detection as deployment planning.
 */
async function trialDetection(pts: [number, number][], t: number, report: (f: number, l: string) => void): Promise<Float32Array> {
  const s = st();
  const e = await ensembleAt(t, (f, l) => report(f * 0.9, l));
  const det = detectionAt(e, t);
  const out = new Float32Array(pts.length);
  pts.forEach(([x, y], i) => {
    const c = cellAt(s.ti.map, x, y);
    if (c < 0) return;
    const r = s.blocks.recvOf[c];
    let best = 0;
    for (let k = det.start[r]; k < det.start[r + 1]; k++) best = Math.max(best, det.det[k]);
    out[i] = best;
  });
  return out;
}

function alert(x: number, y: number, t: number, report: (f: number, l: string) => void): AlertResult {
  const s = st();
  report(0.2, 'Back-tracing scent from alert');
  const { sigmaA } = meanderFor(envAt(s.init.place, s.init.weather, t), TRIANGULATION.dt);
  const zone = backtrace({ ti: s.ti, field: s.wind, t, x, y, sigmaA, seed: Math.round(x * 7 + y * 13 + t * 100) });
  const L = alertLikelihood(zone);
  for (let i = 0; i < L.length; i++) s.L[i] *= L[i];
  s.outside *= alertLikelihood(new Float32Array(1))[0];
  // keep the likelihood well-scaled
  let mx = 0;
  for (let i = 0; i < s.L.length; i++) mx = Math.max(mx, s.L[i]);
  if (mx > 0) {
    for (let i = 0; i < s.L.length; i++) s.L[i] /= mx;
    s.outside /= mx;
  }
  report(0.9, 'Updating probability');
  return { zone, prob: recomputePosterior() };
}

async function searched(sector: SearchedSector, t0: number, t1: number, report: (f: number, l: string) => void): Promise<SearchResult> {
  const s = st();
  const windowMin = Math.max(15, Math.round((t1 - t0) * 60));
  const e = await ensembleAt(t1, (f, l) => report(f * 0.9, l), windowMin);
  const det = detectionAt(e, t1);
  const r = searchUpdate({ sector, det, blocks: s.blocks, heatRecv: e.heatRecv, th: e.thRecv, map: s.ti.map, pod: MISSIONS[s.mission].tuning.pod, insideDet: sweepDetection(e.relStrength) });
  for (let i = 0; i < s.L.length; i++) {
    s.L[i] *= r.factor[i];
    s.Lneg[i] *= r.factor[i];
  }
  return { meanDet: r.meanDet, recheck: r.recheck, prob: recomputePosterior() };
}

/**
 * Demo helper: "radio-reported" alert points downwind of the hidden subject. Candidate times are
 * drift-traced from the truth location; the pair whose back-traced zones best pin the truth
 * (posterior peak closest to it) is returned.
 */
function suggestAlerts(truth: [number, number], times: number[]): [number, number, number][] {
  const s = st();
  const DRIFT_MIN = 15;
  const cands: { p: [number, number, number]; zone: Float32Array }[] = [];
  for (const t of times) {
    let p = driftPoint(s.ti, s.wind, truth[0], truth[1], t - DRIFT_MIN / 60, DRIFT_MIN);
    if (Math.hypot(p.x - truth[0], p.y - truth[1]) < 120) {
      const w = sampleWind(s.wind, s.ti.map, truth[0], truth[1], t);
      const l = Math.hypot(w.u, w.v) || 1;
      p = { x: truth[0] + (200 * (w.u || 1)) / l, y: truth[1] + (200 * w.v) / l };
    }
    if (!insideGrid(s.ti.map, p.x, p.y)) continue;
    const zone = backtrace({ ti: s.ti, field: s.wind, t, x: p.x, y: p.y, particles: 1200, seed: 5 });
    cands.push({ p: [p.x, p.y, t], zone });
  }
  if (cands.length < 2) return cands.map((c) => c.p);
  const prior = s.detailPost!;
  const eps = alertLikelihood(new Float32Array(1))[0];
  let best: [number, number] = [0, 1];
  let bestD = Infinity;
  for (let i = 0; i < cands.length; i++)
    for (let j = i + 1; j < cands.length; j++) {
      const a = cands[i];
      const b = cands[j];
      if (Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) < 250) continue;
      let peak = 0;
      let pv = -1;
      for (let k = 0; k < prior.length; k++) {
        const v = prior[k] * (eps + a.zone[k]) * (eps + b.zone[k]);
        if (v > pv) {
          pv = v;
          peak = k;
        }
      }
      const [px, py] = cellCenterLocal(s.ti.map, peak);
      const d = Math.hypot(px - truth[0], py - truth[1]);
      if (d < bestD) {
        bestD = d;
        best = [i, j];
      }
    }
  return best.map((k) => cands[k].p).sort((p, q) => p[2] - q[2]);
}

// requests are handled strictly one at a time (some await the helper pool)
let queue: Promise<void> = Promise.resolve();
ctx.onmessage = (ev: MessageEvent<Envelope>) => {
  queue = queue.then(() => handle(ev.data));
};

async function handle({ id, req }: Envelope): Promise<void> {
  const report = (frac: number, label: string) => ctx.postMessage({ id, kind: 'progress', frac, label } satisfies Reply);
  try {
    let result: unknown;
    switch (req.type) {
      case 'init':
        result = init(req.data);
        break;
      case 'setSpread': {
        const s = st();
        if (s.rotDeg !== req.rotDeg) {
          s.rotDeg = req.rotDeg;
          s.last = null;
        }
        result = null;
        break;
      }
      case 'setWind': {
        const s = st();
        s.wind = req.wind;
        s.windVersion++;
        pool?.setWind(req.wind);
        s.last = null;
        s.snapshots = null;
        result = { ok: true };
        break;
      }
      case 'probability': {
        const s = st();
        s.profile = req.profile;
        s.lkp = req.lkp;
        s.elapsedH = req.elapsedH;
        s.travelDir = req.travelDir ?? null;
        recomputePrior();
        result = recomputePosterior();
        if (!s.warmed && pool && s.detailPost) {
          // first probability map: warm the helpers in the background
          s.warmed = true;
          pool.warm(s.detailPost, s.wind.hours[Math.min(2, s.wind.hours.length - 1)]);
        }
        break;
      }
      case 'brush': {
        const s = st();
        applyBrush(s.edits, s.ovMap, req.x, req.y, PROBABILITY.brushRadiusM, req.factor);
        recomputePrior();
        result = recomputePosterior();
        break;
      }
      case 'heat':
        result = await heatAt(req.t, report);
        break;
      case 'deploy':
        result = await deploy(req.t, req.teams, !!req.hedge, report, req.mode);
        break;
      case 'segments':
        result = await segmentsAt(req.t, report);
        break;
      case 'trial':
        result = await trialDetection(req.pts, req.t, report);
        break;
      case 'alert':
        result = alert(req.x, req.y, req.t, report);
        break;
      case 'searched':
        result = await searched(req.sector, req.t0, req.t1, report);
        break;
      case 'resetSearch': {
        const s = st();
        s.L.fill(1);
        s.Lneg.fill(1);
        s.outside = 1;
        s.edits.fill(1);
        recomputePrior();
        result = recomputePosterior();
        break;
      }
      case 'mission':
        result = setMission(req.mission, req.source);
        break;
      case 'source': {
        const s = st();
        s.source = req.source;
        s.prior = null;
        recomputePrior();
        result = recomputePosterior();
        break;
      }
      case 'suggestAlerts':
        result = suggestAlerts(req.truth, req.times);
        break;
    }
    ctx.postMessage({ id, kind: 'ok', result } satisfies Reply);
  } catch (e) {
    ctx.postMessage({ id, kind: 'error', error: e instanceof Error ? e.message : String(e) } satisfies Reply);
  }
}
