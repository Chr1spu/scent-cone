/// <reference lib="webworker" />
/** Helper worker: runs slices of scent ensembles for the compute worker's pool. */
import type { GridLevel } from '../api/types';
import { HOTSPOTS } from '../config/modelParams';
import type { Frame } from '../geo/grid';
import type { Place, Weather } from '../models/env';
import { blockIndex, runEnsemble, type BlockIndex } from '../models/scent';
import { buildTerrainInfo, type TerrainInfo } from '../models/terrainInfo';
import type { WindField } from '../models/wind';
import { setTuning } from '../models/tuning';

export interface EnsembleTask {
  prob: Float32Array;
  tEnd: number;
  members: number;
  memberRange: [number, number];
  particles?: number;
  dt?: number;
  windowMin?: number;
  seed: number;
  neutral?: boolean;
  rotDeg?: number;
  withBlocks: boolean;
}

export type HelperMsg =
  | { type: 'init'; frame: Frame; detail: GridLevel; overview: GridLevel; weather: Weather; place: Place; wind: WindField }
  | { type: 'wind'; wind: WindField }
  | { type: 'tuning'; tuning: { tauScale: number; liftScale: number } }
  | { type: 'run'; id: number; task: EnsembleTask };

export type HelperReply = { id: number; heat: Float32Array; contrib?: Float32Array; events: number } | { id: number; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let ti: TerrainInfo | null = null;
let blocks: BlockIndex | null = null;
let wind: WindField | null = null;
let weather: Weather | null = null;
let place: Place | null = null;

ctx.onmessage = (ev: MessageEvent<HelperMsg>) => {
  const m = ev.data;
  if (m.type === 'init') {
    ti = buildTerrainInfo(m.detail.meta, m.frame, m.detail.elev, m.detail.landcover, m.overview);
    blocks = blockIndex(m.detail.meta.cols, m.detail.meta.rows, HOTSPOTS.recvBlockCells, HOTSPOTS.srcBlockCells);
    wind = m.wind;
    weather = m.weather;
    place = m.place;
    return;
  }
  if (m.type === 'wind') {
    wind = m.wind;
    return;
  }
  if (m.type === 'tuning') {
    setTuning(m.tuning);
    return;
  }
  try {
    if (!ti || !wind || !weather || !place) throw new Error('helper not initialised');
    const t = m.task;
    const r = runEnsemble({
      ti,
      field: wind,
      place,
      weather,
      prob: t.prob,
      tEnd: t.tEnd,
      members: t.members,
      memberRange: t.memberRange,
      particles: t.particles,
      dt: t.dt,
      windowMin: t.windowMin,
      seed: t.seed,
      neutral: t.neutral,
      rotDeg: t.rotDeg,
      blocks: t.withBlocks ? (blocks ?? undefined) : undefined,
    });
    const transfer: Transferable[] = [r.heat.buffer];
    if (r.contrib) transfer.push(r.contrib.buffer);
    ctx.postMessage({ id: m.id, heat: r.heat, contrib: r.contrib, events: r.events } satisfies HelperReply, transfer);
  } catch (e) {
    ctx.postMessage({ id: m.id, error: e instanceof Error ? e.message : String(e) } satisfies HelperReply);
  }
};
