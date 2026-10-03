/** Alert triangulation (CLAUDE.md §8.5): backward particle trace from an alert point. */
import { SCENT, TRIANGULATION } from '../config/modelParams';
import { boxBlur } from '../geo/grid';
import { Rng } from './rng';
import type { TerrainInfo } from './terrainInfo';
import { makeMember, perturb, sampleUVFrac, timeSlot, type WindField } from './wind';

export interface BacktraceInput {
  ti: TerrainInfo;
  field: WindField;
  /** alert time (local hours) */
  t: number;
  x: number;
  y: number;
  particles?: number;
  minutes?: number;
  dt?: number;
  seed?: number;
  /** per-particle wind perturbation (ensemble spread); off in unit tests */
  perturbWind?: boolean;
  /** turbulence on/off (tests) */
  turbulence?: boolean;
}

/** Integrates particles backward in time (x -= u·dt) and returns visited density, max-normalised. */
export function backtrace(inp: BacktraceInput): Float32Array {
  const { ti, field } = inp;
  const m = ti.map;
  const { cols, rows, inv, ox, oy } = m;
  const n = inp.particles ?? TRIANGULATION.particles;
  const dt = inp.dt ?? TRIANGULATION.dt;
  const steps = Math.round(((inp.minutes ?? TRIANGULATION.backMinutes) * 60) / dt);
  const rng = new Rng(inp.seed ?? 77);
  const X = new Float32Array(n);
  const Y = new Float32Array(n);
  const alive = new Uint8Array(n).fill(1);
  const members = [];
  for (let i = 0; i < n; i++) {
    X[i] = inp.x + rng.normal() * 3;
    Y[i] = inp.y + rng.normal() * 3;
    members.push(inp.perturbWind === false ? { cos: 1, sin: 0, scale: 1 } : makeMember(rng));
  }
  const density = new Float32Array(cols * rows);
  const uv = new Float32Array(2);
  const turb = inp.turbulence !== false;
  for (let k = 0; k < steps; k++) {
    const slot = timeSlot(field, inp.t - (k * dt) / 3600);
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      const fc = X[i] * inv + ox;
      const fr = -Y[i] * inv + oy;
      sampleUVFrac(field, slot, cols, rows, fc, fr, uv);
      perturb(members[i], uv);
      const cell = Math.min(rows - 1, Math.max(0, Math.round(fr))) * cols + Math.min(cols - 1, Math.max(0, Math.round(fc)));
      // same nose-height wind and pooling as the forward model
      const k = ti.noseFactor[cell];
      const speed = Math.hypot(uv[0], uv[1]) * k;
      const damp = speed < SCENT.calmWind && ti.localLow[cell] ? SCENT.calmDamp : 1;
      let x = X[i] - uv[0] * k * dt * damp;
      let y = Y[i] - uv[1] * k * dt * damp;
      if (turb) {
        const sig = Math.sqrt(2 * (SCENT.turbK0 + SCENT.turbKPerWind * speed) * dt) * damp;
        x += sig * rng.normal();
        y += sig * rng.normal();
      }
      const c2 = Math.round(x * inv + ox);
      const r2 = Math.round(-y * inv + oy);
      if (c2 < 0 || r2 < 0 || c2 >= cols || r2 >= rows) {
        alive[i] = 0;
        continue;
      }
      X[i] = x;
      Y[i] = y;
      density[r2 * cols + c2] += 1;
    }
  }
  let z = density;
  for (let p = 0; p < TRIANGULATION.blurPasses; p++) z = boxBlur(z, cols, rows, 2);
  let mx = 0;
  for (let i = 0; i < z.length; i++) if (z[i] > mx) mx = z[i];
  if (mx > 0) for (let i = 0; i < z.length; i++) z[i] /= mx;
  return z;
}

/** Mean particle end position of a plain backward trace (used by tests and demo helpers). */
export function backtraceCentroid(inp: BacktraceInput): { x: number; y: number } {
  const z = backtrace({ ...inp, particles: inp.particles ?? 500 });
  const m = inp.ti.map;
  let sx = 0;
  let sy = 0;
  let s = 0;
  for (let i = 0; i < z.length; i++) {
    if (z[i] < 0.5) continue;
    const r = Math.floor(i / m.cols);
    const c = i - r * m.cols;
    sx += ((c - m.ox) / m.inv) * z[i];
    sy += (-(r - m.oy) / m.inv) * z[i];
    s += z[i];
  }
  return { x: sx / s, y: sy / s };
}

/** Likelihood factor for one alert: ε + backZone. */
export function alertLikelihood(zone: Float32Array, eps = TRIANGULATION.eps): Float32Array {
  const L = new Float32Array(zone.length);
  for (let i = 0; i < zone.length; i++) L[i] = eps + zone[i];
  return L;
}

/** post = prior · Π(ε + backZone_k), normalised. */
export function posterior(prior: Float32Array, zones: Float32Array[], eps = TRIANGULATION.eps): Float32Array {
  const out = new Float32Array(prior.length);
  let s = 0;
  for (let i = 0; i < prior.length; i++) {
    let v = prior[i];
    for (const z of zones) v *= eps + z[i];
    out[i] = v;
    s += v;
  }
  if (s > 0) for (let i = 0; i < out.length; i++) out[i] /= s;
  return out;
}

export function argmax(a: Float32Array): number {
  let best = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
  return best;
}

/** Forward trace without turbulence: where does scent from (x, y) drift by time t + minutes? */
export function driftPoint(ti: TerrainInfo, field: WindField, x: number, y: number, t: number, minutes: number, dt = 10): { x: number; y: number } {
  const m = ti.map;
  const uv = new Float32Array(2);
  for (let k = 0; k < (minutes * 60) / dt; k++) {
    const fc = x * m.inv + m.ox;
    const fr = -y * m.inv + m.oy;
    sampleUVFrac(field, timeSlot(field, t + (k * dt) / 3600), m.cols, m.rows, fc, fr, uv);
    const cell = Math.min(m.rows - 1, Math.max(0, Math.round(fr))) * m.cols + Math.min(m.cols - 1, Math.max(0, Math.round(fc)));
    const f = ti.noseFactor[cell];
    x += uv[0] * dt * f;
    y += uv[1] * dt * f;
  }
  return { x, y };
}
