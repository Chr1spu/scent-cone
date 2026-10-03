/**
 * Pool of helper workers for scent ensembles. Each ensemble member runs as its own task;
 * results are summed. Falls back to running inline if nested workers are unavailable.
 */
import { runEnsemble, type EnsembleInput, type EnsembleResult } from '../models/scent';
import type { EnsembleTask, HelperMsg, HelperReply } from './ensemble.worker';

type Pending = { resolve: (r: { heat: Float32Array; contrib?: Float32Array }) => void; reject: (e: Error) => void };

export class EnsemblePool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { task: EnsembleTask; p: Pending }[] = [];
  private pending = new Map<number, { w: Worker; p: Pending }>();
  private nextId = 1;

  constructor(size: number, init: Extract<HelperMsg, { type: 'init' }>) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./ensemble.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (ev: MessageEvent<HelperReply>) => this.done(w, ev.data);
      w.onerror = (ev) => this.fail(w, new Error(ev.message || 'ensemble helper failed'));
      w.postMessage(init);
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  setWind(wind: Extract<HelperMsg, { type: 'wind' }>['wind']) {
    for (const w of this.workers) w.postMessage({ type: 'wind', wind } satisfies HelperMsg);
  }

  run(task: EnsembleTask): Promise<{ heat: Float32Array; contrib?: Float32Array }> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, p: { resolve, reject } });
      this.pump();
    });
  }

  terminate() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
  }

  private pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const { task, p } = this.queue.shift()!;
      const id = this.nextId++;
      this.pending.set(id, { w, p });
      w.postMessage({ type: 'run', id, task } satisfies HelperMsg);
    }
  }

  private done(w: Worker, r: HelperReply) {
    const entry = this.pending.get(r.id);
    if (!entry) return;
    this.pending.delete(r.id);
    this.idle.push(w);
    if ('error' in r) entry.p.reject(new Error(r.error));
    else entry.p.resolve(r);
    this.pump();
  }

  private fail(w: Worker, e: Error) {
    for (const [id, entry] of this.pending) {
      if (entry.w === w) {
        this.pending.delete(id);
        entry.p.reject(e);
      }
    }
  }
}

export function poolSize(): number {
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  // leave room for the main thread, the particle worker and this worker
  return Math.max(1, Math.min(6, hc - 3));
}

/**
 * Run an ensemble with each member as a separate pool task (or inline without a pool).
 * The summed result equals runEnsemble on the whole input.
 */
export async function parallelEnsemble(pool: EnsemblePool | null, inp: EnsembleInput, onProgress?: (f: number) => void): Promise<EnsembleResult> {
  const members = inp.members ?? 1;
  if (!pool || pool.size === 0) return runEnsemble({ ...inp, onProgress });
  let finished = 0;
  const tasks = Array.from({ length: members }, (_, i) =>
    pool
      .run({
        prob: inp.prob,
        tEnd: inp.tEnd,
        members,
        memberRange: [i, i + 1],
        particles: inp.particles,
        dt: inp.dt,
        windowMin: inp.windowMin,
        seed: inp.seed ?? 1234,
        neutral: inp.neutral,
        withBlocks: !!inp.blocks,
      })
      .then((r) => {
        onProgress?.(++finished / members);
        return r;
      }),
  );
  const parts = await Promise.all(tasks);
  const heat = parts[0].heat;
  const contrib = parts[0].contrib;
  for (let k = 1; k < parts.length; k++) {
    const h = parts[k].heat;
    for (let i = 0; i < heat.length; i++) heat[i] += h[i];
    const c = parts[k].contrib;
    if (contrib && c) for (let i = 0; i < contrib.length; i++) contrib[i] += c[i];
  }
  return { heat, contrib };
}
