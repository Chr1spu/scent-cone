/** Promise wrapper around the compute worker. Requests are serialised by the worker itself. */
import type { Envelope, Reply, Request } from './protocol';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (f: number, l: string) => void };

export class ComputeClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  /** number of in-flight requests (for the debug overlay) */
  busy = 0;
  onBusyChange?: (busy: number, label: string) => void;

  constructor() {
    this.worker = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<Reply>) => {
      const msg = ev.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.kind === 'progress') {
        p.onProgress?.(msg.frac, msg.label);
        this.onBusyChange?.(this.busy, msg.label);
        return;
      }
      this.pending.delete(msg.id);
      this.busy--;
      this.onBusyChange?.(this.busy, '');
      if (msg.kind === 'ok') p.resolve(msg.result);
      else p.reject(new Error(msg.error));
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'worker error'));
      this.pending.clear();
      this.busy = 0;
    };
  }

  call<T>(req: Request, onProgress?: (f: number, l: string) => void, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    this.busy++;
    this.onBusyChange?.(this.busy, req.type);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
      this.worker.postMessage({ id, req } satisfies Envelope, transfer);
    });
  }

  terminate() {
    this.worker.terminate();
  }
}
