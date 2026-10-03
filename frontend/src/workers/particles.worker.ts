/// <reference lib="webworker" />
/**
 * Visible scent particles (15k) simulated off the main thread. Each "tick" carries two
 * transferable buffers (positions xyz in scene space, strength) which are filled and sent
 * back, ping-pong style, so nothing is copied or allocated per frame.
 */
import { NOSE, SCENT } from '../config/modelParams';
import { VERT_EXAG } from '../config/constants';
import type { GridLevel } from '../api/types';
import type { Frame } from '../geo/grid';
import { sampleLocal } from '../geo/grid';
import type { Place, Weather } from '../models/env';
import { createSim, makeStepEnv, step, type Sim, type StepEnv } from '../models/scent';
import { buildTerrainInfo, type TerrainInfo } from '../models/terrainInfo';
import { timeSlot, type WindField } from '../models/wind';
import { setTuning } from '../models/tuning';

export type ParticleMsg =
  | { type: 'init'; frame: Frame; detail: GridLevel; overview: GridLevel; weather: Weather; place: Place; wind: WindField; n: number }
  | { type: 'setWind'; wind: WindField }
  | { type: 'tuning'; tuning: { tauScale: number; liftScale: number } }
  | { type: 'release'; prob: Float32Array; seed: number; t: number }
  | { type: 'stop' }
  | { type: 'tick'; t: number; pos: Float32Array; strength: Float32Array };

export type ParticleReply = { type: 'frame'; pos: Float32Array; strength: Float32Array; active: boolean; ms: number };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const PREWARM_S = 1200;
const PREWARM_DT = 10;

let ti: TerrainInfo | null = null;
let wind: WindField | null = null;
let weather: Weather | null = null;
let place: Place | null = null;
let n = 0;
let sim: Sim | null = null;
let env: { se: StepEnv; t: number } | null = null;
let sunBuf: Uint8Array | null = null;

ctx.onmessage = (ev: MessageEvent<ParticleMsg>) => {
  const m = ev.data;
  switch (m.type) {
    case 'init':
      ti = buildTerrainInfo(m.detail.meta, m.frame, m.detail.elev, m.detail.landcover, m.overview);
      wind = m.wind;
      weather = m.weather;
      place = m.place;
      n = m.n;
      sim = null;
      env = null;
      sunBuf = new Uint8Array(ti.elev.length);
      break;
    case 'setWind':
      wind = m.wind;
      env = null;
      break;
    case 'release':
      if (!ti) return;
      // continuous release: births spread over one lifetime, so a steady stream builds up
      sim = createSim({ ti, prob: m.prob, n, seed: m.seed, staggerS: SCENT.lifetimeS });
      env = null;
      // pre-warm: simulate the first PREWARM_S seconds so a plume is already visible
      if (wind && weather && place) {
        const se = makeStepEnv(ti, wind, place, weather, m.t, PREWARM_DT, undefined, sunBuf ?? undefined);
        for (let k = 0; k < PREWARM_S / PREWARM_DT; k++) step(sim, wind, se, PREWARM_DT);
      }
      break;
    case 'tuning':
      setTuning(m.tuning);
      env = null;
      break;
    case 'stop':
      sim = null;
      break;
    case 'tick': {
      const t0 = performance.now();
      const { pos, strength } = m;
      if (!sim || !ti || !wind || !weather || !place) {
        strength.fill(0);
        ctx.postMessage({ type: 'frame', pos, strength, active: false, ms: 0 } satisfies ParticleReply, [pos.buffer, strength.buffer]);
        return;
      }
      const dt = SCENT.dt;
      if (!env || Math.abs(env.t - m.t) > 1 / 60) env = { se: makeStepEnv(ti, wind, place, weather, m.t, dt, undefined, sunBuf ?? undefined), t: m.t };
      else env.se.slot = timeSlot(wind, m.t);
      for (let k = 0; k < SCENT.stepsPerFrame; k++) step(sim, wind, env.se, dt);
      const lift = NOSE.heightM;
      for (let i = 0; i < sim.n; i++) {
        const x = sim.x[i];
        const y = sim.y[i];
        pos[i * 3] = x;
        pos[i * 3 + 1] = (sampleLocal(ti.elev, ti.map, x, y) + lift) * VERT_EXAG;
        pos[i * 3 + 2] = -y;
        // unborn particles (negative age) are invisible; fresh ones fade in so recycling doesn't pop
        strength[i] = sim.strength[i] * Math.min(1, Math.max(0, sim.age[i] / 20));
      }
      ctx.postMessage({ type: 'frame', pos, strength, active: true, ms: performance.now() - t0 } satisfies ParticleReply, [pos.buffer, strength.buffer]);
      break;
    }
  }
};
