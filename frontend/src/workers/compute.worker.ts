/// <reference lib="webworker" />
/**
 * Heavy computation off the main thread: probability, ensembles, hotspots, deployment,
 * alert back-tracing and negative search updates. Holds the search state (prior, likelihood).
 */
import { ENSEMBLE, HOTSPOTS, PROBABILITY, PROFILES, SEARCH } from '../config/modelParams';
import { cellCenterLocal, gridMap, insideGrid, localBounds, type GridMap } from '../geo/grid';
import { blockMean, deployableCells, detThresholds, detectability, greedyDeploy, snapshotScore, sourceSums } from '../models/hotspots';
import {
  applyBrush,
  barrierFactor,
  buildStaticLayers,
  computeProbability,
  normalize,
  overviewPosterior,
  rasterizeLines,
  rasterizePolygons,
  resampleToDetail,
  sumInside,
  type StaticLayers,
} from '../models/probability';
import { blockIndex, runEnsemble, type BlockIndex } from '../models/scent';
import { searchUpdate } from '../models/searchUpdate';
import { buildTerrainInfo, LC, type TerrainInfo } from '../models/terrainInfo';
import { alertLikelihood, argmax, backtrace, driftPoint } from '../models/triangulation';
import { sampleWind, type WindField } from '../models/wind';
import type { AlertResult, DeploymentOut, Envelope, HeatResult, InitMsg, ProbResult, Reply, SearchResult } from './protocol';

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
  last: { t: number; key: string; heat: Float32Array; contrib: Float32Array; heatRecv: Float32Array } | null;
  snapshots: { key: string; byHour: Map<number, Float32Array> } | null;
  profile: keyof typeof PROFILES;
  lkp: [number, number];
}

let S: State | null = null;

function st(): State {
  if (!S) throw new Error('worker not initialised');
  return S;
}

function init(m: InitMsg) {
  const ovMap = gridMap(m.overview.meta, m.frame);
  const ti = buildTerrainInfo(m.detail.meta, m.frame, m.detail.elev, m.detail.landcover);
  const ovLayers = buildStaticLayers(m.overview.meta, ovMap, m.overview.elev, m.overview.landcover, m.features);
  const nD = m.detail.elev.length;
  const detailWater = new Uint8Array(nD);
  for (let i = 0; i < nD; i++) if (m.detail.landcover[i] === LC.water) detailWater[i] = 1;
  rasterizePolygons(m.features.filter((f) => f.kind === 'lake' && f.polygon), ti.map, detailWater);
  rasterizeLines(m.features.filter((f) => f.kind === 'river'), ti.map, detailWater);
  const cliff = new Uint8Array(nD);
  rasterizeLines(m.features.filter((f) => f.kind === 'cliff'), ti.map, cliff);
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
  };
  return { ok: true };
}

function recomputePrior() {
  const s = st();
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
  });
}

function recomputePosterior(): ProbResult {
  const s = st();
  if (!s.prior) recomputePrior();
  const prior = s.prior!;
  const ovPost = overviewPosterior(prior, s.ovMap, s.ti.map, s.L, s.outside);
  const { prob } = resampleToDetail(prior, s.ovMap, s.ti.map, s.detailWater);
  for (let i = 0; i < prob.length; i++) prob[i] *= s.L[i];
  normalize(prob);
  const b = localBounds(s.init.detail.meta, s.init.frame);
  s.segmentFraction = sumInside(ovPost, s.ovMap, b);
  s.ovPost = ovPost;
  s.detailPost = prob;
  s.probVersion++;
  s.last = null;
  s.snapshots = null;
  return { overview: ovPost.slice(), detail: prob.slice(), segmentFraction: s.segmentFraction, peak: cellCenterLocal(s.ti.map, argmax(prob)) };
}

function ensembleAt(t: number, report: (f: number, l: string) => void) {
  const s = st();
  const key = `${s.probVersion}:${s.windVersion}`;
  if (s.last && s.last.key === key && Math.abs(s.last.t - t) < 1e-6) return s.last;
  const { heat, contrib } = runEnsemble({
    ti: s.ti,
    field: s.wind,
    place: s.init.place,
    weather: s.init.weather,
    prob: s.detailPost!,
    tEnd: t,
    blocks: s.blocks,
    seed: 1000 + Math.round(t * 60),
    onProgress: (f) => report(0.05 + 0.9 * f, `Scent ensemble ${Math.round(f * ENSEMBLE.members)}/${ENSEMBLE.members}`),
  });
  const heatRecv = blockMean(heat, s.ti.meta.cols, s.ti.meta.rows, s.blocks);
  s.last = { t, key, heat, contrib: contrib!, heatRecv };
  return s.last;
}

function topHotspots(heat: Float32Array, map: GridMap, k = 8, minSepM = 200): number[] {
  const idx: number[] = [];
  for (let i = 0; i < heat.length; i++) if (heat[i] > 0) idx.push(i);
  idx.sort((a, b) => heat[b] - heat[a]);
  const out: number[] = [];
  for (const i of idx) {
    if (out.length >= k) break;
    const [x, y] = cellCenterLocal(map, i);
    if (out.every((j) => {
      const [x2, y2] = cellCenterLocal(map, j);
      return Math.hypot(x - x2, y - y2) > minSepM;
    }))
      out.push(i);
  }
  return out;
}

function heatAt(t: number, report: (f: number, l: string) => void): HeatResult {
  const s = st();
  const e = ensembleAt(t, report);
  const th = detThresholds(e.heat);
  return { t, heat: e.heat.slice(), lo: th.lo, hi: th.hi, hotspots: topHotspots(e.heat, s.ti.map) };
}

function hourlySnapshots(report: (f: number, l: string) => void): Map<number, Float32Array> {
  const s = st();
  const key = `${s.probVersion}:${s.windVersion}`;
  if (s.snapshots && s.snapshots.key === key) return s.snapshots.byHour;
  const byHour = new Map<number, Float32Array>();
  const hours = s.wind.hours.slice(1);
  hours.forEach((h, k) => {
    const { heat } = runEnsemble({
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
    });
    byHour.set(h, blockMean(heat, s.ti.meta.cols, s.ti.meta.rows, s.blocks));
    report(0.6 + (0.35 * (k + 1)) / hours.length, `Scoring time windows ${h - 1}:00–${h}:00`);
  });
  s.snapshots = { key, byHour };
  return byHour;
}

function deploy(t: number, teams: number, report: (f: number, l: string) => void): DeploymentOut[] {
  const s = st();
  const e = ensembleAt(t, (f, l) => report(f * 0.55, l));
  report(0.56, 'Greedy deployment');
  const detRecv = detectability(e.heatRecv, detThresholds(e.heatRecv));
  const deps = greedyDeploy({
    contrib: e.contrib,
    blocks: s.blocks,
    detRecv,
    heat: e.heat,
    q: sourceSums(s.detailPost!, s.blocks),
    deployable: s.deployable,
    map: s.ti.map,
    teams,
  });
  const snaps = hourlySnapshots(report);
  return deps.map((d) => {
    const windowScores = [...snaps.entries()].map(([hour, hr]) => ({ hour, score: snapshotScore(hr, d.recv) }));
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
    };
  });
}

function alert(x: number, y: number, t: number, report: (f: number, l: string) => void): AlertResult {
  const s = st();
  report(0.2, 'Back-tracing scent from alert');
  const zone = backtrace({ ti: s.ti, field: s.wind, t, x, y, seed: Math.round(x * 7 + y * 13 + t * 100) });
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

function searched(x: number, y: number, radius: number, t: number, report: (f: number, l: string) => void): SearchResult {
  const s = st();
  const e = ensembleAt(t, (f, l) => report(f * 0.85, l));
  const th = detThresholds(e.heatRecv);
  const r = searchUpdate({ sector: { x, y, radius }, contrib: e.contrib, blocks: s.blocks, heatRecv: e.heatRecv, th, map: s.ti.map });
  for (let i = 0; i < s.L.length; i++) s.L[i] *= r.factor[i];
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

ctx.onmessage = (ev: MessageEvent<Envelope>) => {
  const { id, req } = ev.data;
  const report = (frac: number, label: string) => ctx.postMessage({ id, kind: 'progress', frac, label } satisfies Reply);
  try {
    let result: unknown;
    switch (req.type) {
      case 'init':
        result = init(req.data);
        break;
      case 'setWind': {
        const s = st();
        s.wind = req.wind;
        s.windVersion++;
        s.last = null;
        s.snapshots = null;
        result = { ok: true };
        break;
      }
      case 'probability': {
        const s = st();
        s.profile = req.profile;
        s.lkp = req.lkp;
        recomputePrior();
        result = recomputePosterior();
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
        result = heatAt(req.t, report);
        break;
      case 'deploy':
        result = deploy(req.t, req.teams, report);
        break;
      case 'alert':
        result = alert(req.x, req.y, req.t, report);
        break;
      case 'searched':
        result = searched(req.x, req.y, req.radius ?? SEARCH.defaultRadiusM, req.t, report);
        break;
      case 'resetSearch': {
        const s = st();
        s.L.fill(1);
        s.outside = 1;
        s.edits.fill(1);
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
};
