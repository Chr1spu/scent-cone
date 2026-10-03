/**
 * Scent particle simulation (CLAUDE.md §8.3). Struct-of-arrays, no per-step allocation.
 * Positions are local metres (east, north) relative to the frame centre.
 */
import { ENSEMBLE, SCENT } from '../config/modelParams';
import { decayTau, envAt, type Place, type Weather } from './env';
import { Rng } from './rng';
import { LC, sunlitMask, type TerrainInfo } from './terrainInfo';
import { IDENTITY_MEMBER, makeMember, perturb, sampleUVFrac, timeSlot, type EnsembleMember, type TimeSlot, type WindField } from './wind';

export interface Sources {
  cells: Uint32Array;
  cdf: Float64Array;
}

export function buildSources(prob: Float32Array, minProb = 1e-6): Sources {
  const cells: number[] = [];
  for (let i = 0; i < prob.length; i++) if (prob[i] >= minProb) cells.push(i);
  const cdf = new Float64Array(cells.length);
  let s = 0;
  for (let k = 0; k < cells.length; k++) {
    s += prob[cells[k]];
    cdf[k] = s;
  }
  for (let k = 0; k < cdf.length; k++) cdf[k] /= s || 1;
  return { cells: Uint32Array.from(cells), cdf };
}

export interface Sim {
  n: number;
  x: Float32Array;
  y: Float32Array;
  strength: Float32Array;
  age: Float32Array;
  source: Uint32Array;
  sources: Sources;
  ti: TerrainInfo;
  rng: Rng;
}

export interface SimParams {
  ti: TerrainInfo;
  prob: Float32Array;
  n: number;
  seed: number;
  sources?: Sources;
}

export function createSim(p: SimParams): Sim {
  const sim: Sim = {
    n: p.n,
    x: new Float32Array(p.n),
    y: new Float32Array(p.n),
    strength: new Float32Array(p.n),
    age: new Float32Array(p.n),
    source: new Uint32Array(p.n),
    sources: p.sources ?? buildSources(p.prob),
    ti: p.ti,
    rng: new Rng(p.seed),
  };
  for (let i = 0; i < p.n; i++) emit(sim, i);
  return sim;
}

/** (Re-)emit particle i from a source cell drawn proportional to probability. */
export function emit(sim: Sim, i: number): void {
  const { cdf, cells } = sim.sources;
  if (cells.length === 0) {
    sim.strength[i] = 0;
    return;
  }
  const u = sim.rng.next();
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < u) lo = mid + 1;
    else hi = mid;
  }
  const cell = cells[lo];
  const m = sim.ti.map;
  const r = Math.floor(cell / m.cols);
  const c = cell - r * m.cols;
  sim.x[i] = (c + sim.rng.next() - 0.5 - m.ox) / m.inv;
  sim.y[i] = -(r + sim.rng.next() - 0.5 - m.oy) / m.inv;
  sim.strength[i] = 1;
  sim.age[i] = 0;
  sim.source[i] = cell;
}

export interface StepEnv {
  slot: TimeSlot;
  member: EnsembleMember;
  sunlit: Uint8Array;
  sunHigh: boolean;
  /** sun above horizon (lofting possible) */
  sunUp: boolean;
  decayShade: number;
  decaySun: number;
}

/** Per-time environment for stepping; recompute when t changes noticeably. */
export function makeStepEnv(ti: TerrainInfo, field: WindField, place: Place, weather: Weather, t: number, dt: number, member: EnsembleMember = IDENTITY_MEMBER, sunlitBuf?: Uint8Array): StepEnv {
  const env = envAt(place, weather, t);
  const sunlit = sunlitMask(ti, env.sun.dir, sunlitBuf);
  const sunHigh = env.sun.elevation > SCENT.sunHighElev;
  return {
    slot: timeSlot(field, t),
    member,
    sunlit,
    sunHigh,
    sunUp: env.sun.elevation > 0,
    decayShade: Math.exp(-dt / decayTau(env, false)),
    decaySun: Math.exp(-dt / decayTau(env, sunHigh)),
  };
}

/** Optional deposition into a concentration grid and source→receiver contribution matrix. */
export interface Accum {
  conc: Float32Array;
  weight: number;
  contrib?: Float32Array;
  /** detail cell -> receiver block */
  recvOf?: Int32Array;
  /** detail cell -> source block */
  srcOf?: Int32Array;
  nSrc?: number;
}

const uvTmp = new Float32Array(2);

export function step(sim: Sim, field: WindField, se: StepEnv, dt: number, acc?: Accum): void {
  const m = sim.ti.map;
  const { cols, rows, inv, ox, oy } = m;
  const lc = sim.ti.landcover;
  const low = sim.ti.localLow;
  const { x: X, y: Y, strength: S, age: A, source: SRC } = sim;
  const rng = sim.rng;
  const sunlit = se.sunlit;
  const twoDt = 2 * dt;
  for (let i = 0; i < sim.n; i++) {
    let x = X[i];
    let y = Y[i];
    let fc = x * inv + ox;
    let fr = -y * inv + oy;
    sampleUVFrac(field, se.slot, cols, rows, fc, fr, uvTmp);
    perturb(se.member, uvTmp);
    const u = uvTmp[0];
    const v = uvTmp[1];
    const speed = Math.sqrt(u * u + v * v);
    let c = Math.round(fc);
    let r = Math.round(fr);
    if (c < 0) c = 0;
    else if (c >= cols) c = cols - 1;
    if (r < 0) r = 0;
    else if (r >= rows) r = rows - 1;
    let cell = r * cols + c;
    let adv = 1;
    let damp = 1;
    if (lc[cell] === LC.forest) adv = SCENT.forestSlow;
    if (speed < SCENT.calmWind && low[cell]) {
      adv *= SCENT.calmDamp;
      damp = SCENT.calmDamp;
    }
    const K = SCENT.turbK0 + SCENT.turbKPerWind * speed;
    const sig = Math.sqrt(K * twoDt) * damp;
    x += u * dt * adv + sig * rng.normal();
    y += v * dt * adv + sig * rng.normal();
    let s = S[i] * (sunlit[cell] && se.sunHigh ? se.decaySun : se.decayShade);
    if (se.sunUp && sunlit[cell] && speed < SCENT.liftWind) s *= 1 - SCENT.liftPerS * dt;
    A[i] += dt;
    fc = x * inv + ox;
    fr = -y * inv + oy;
    if (fc < -0.5 || fr < -0.5 || fc > cols - 0.5 || fr > rows - 0.5 || s < SCENT.minStrength) {
      emit(sim, i);
      continue;
    }
    X[i] = x;
    Y[i] = y;
    S[i] = s;
    if (acc) {
      c = Math.round(fc);
      r = Math.round(fr);
      if (c >= cols) c = cols - 1;
      if (r >= rows) r = rows - 1;
      cell = r * cols + c;
      const w = s * acc.weight;
      acc.conc[cell] += w;
      if (acc.contrib && acc.recvOf && acc.srcOf && acc.nSrc) {
        acc.contrib[acc.recvOf[cell] * acc.nSrc + acc.srcOf[SRC[i]]] += w;
      }
    }
  }
}

// ---------------------------------------------------------------- ensembles

export interface BlockIndex {
  recvOf: Int32Array;
  srcOf: Int32Array;
  nRecv: number;
  nSrc: number;
  recvCols: number;
  srcCols: number;
  recvBlock: number;
  srcBlock: number;
}

export function blockIndex(cols: number, rows: number, recvBlock: number, srcBlock: number): BlockIndex {
  const rc = Math.ceil(cols / recvBlock);
  const rr = Math.ceil(rows / recvBlock);
  const sc = Math.ceil(cols / srcBlock);
  const sr = Math.ceil(rows / srcBlock);
  const recvOf = new Int32Array(cols * rows);
  const srcOf = new Int32Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      recvOf[r * cols + c] = Math.floor(r / recvBlock) * rc + Math.floor(c / recvBlock);
      srcOf[r * cols + c] = Math.floor(r / srcBlock) * sc + Math.floor(c / srcBlock);
    }
  return { recvOf, srcOf, nRecv: rc * rr, nSrc: sc * sr, recvCols: rc, srcCols: sc, recvBlock, srcBlock };
}

export interface EnsembleInput {
  ti: TerrainInfo;
  field: WindField;
  place: Place;
  weather: Weather;
  prob: Float32Array;
  /** end of the window (local hours) */
  tEnd: number;
  members?: number;
  particles?: number;
  dt?: number;
  windowMin?: number;
  seed?: number;
  blocks?: BlockIndex;
  onProgress?: (f: number) => void;
}

export interface EnsembleResult {
  heat: Float32Array;
  contrib?: Float32Array;
}

/** runEnsemble: perturbed-wind members over a window ending at tEnd, averaged into a heat grid. */
export function runEnsemble(inp: EnsembleInput): EnsembleResult {
  const members = inp.members ?? ENSEMBLE.members;
  const n = inp.particles ?? ENSEMBLE.particlesPerMember;
  const dt = inp.dt ?? ENSEMBLE.dt;
  const windowS = (inp.windowMin ?? ENSEMBLE.windowMin) * 60;
  const seed = inp.seed ?? 1234;
  const cells = inp.ti.elev.length;
  const heat = new Float32Array(cells);
  const contrib = inp.blocks ? new Float32Array(inp.blocks.nRecv * inp.blocks.nSrc) : undefined;
  const sources = buildSources(inp.prob);
  const sunBuf = new Uint8Array(cells);
  const steps = Math.round(windowS / dt);
  const envEvery = Math.max(1, Math.round(300 / dt)); // refresh env every 5 min
  const halfLife = SCENT.accumHalfLifeS;
  const memberRng = new Rng(seed ^ 0x9e3779b9);
  for (let mi = 0; mi < members; mi++) {
    const member = members === 1 ? IDENTITY_MEMBER : makeMember(memberRng);
    const sim = createSim({ ti: inp.ti, prob: inp.prob, n, seed: seed + 101 * mi, sources });
    let se: StepEnv | null = null;
    for (let k = 0; k < steps; k++) {
      const t = inp.tEnd - (windowS - k * dt) / 3600;
      if (k % envEvery === 0 || !se) se = makeStepEnv(inp.ti, inp.field, inp.place, inp.weather, t, dt, member, sunBuf);
      else se.slot = timeSlot(inp.field, t);
      const ageS = (steps - k) * dt;
      const acc: Accum = {
        conc: heat,
        weight: Math.pow(2, -ageS / halfLife) / members,
        contrib,
        recvOf: inp.blocks?.recvOf,
        srcOf: inp.blocks?.srcOf,
        nSrc: inp.blocks?.nSrc,
      };
      step(sim, inp.field, se, dt, acc);
    }
    inp.onProgress?.((mi + 1) / members);
  }
  return { heat, contrib };
}
