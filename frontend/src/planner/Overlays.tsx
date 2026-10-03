import { Link } from '../router';
import { useStore } from '../state/store';
import { Logo } from '../ui/icons';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const bar = { info: 'border-l-ink-2', warn: 'border-l-sar', error: 'border-l-red-700', success: 'border-l-forest' };
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-30 flex w-[330px] max-w-[calc(100%-24px)] flex-col gap-1.5" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`rounded-sm border border-l-4 border-rule bg-paper px-3 py-2 text-[13px] leading-snug text-ink shadow-sm ${bar[t.tone]}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function BusyIndicator() {
  const busy = useStore((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-20 w-[280px] -translate-x-1/2 rounded-sm border border-rule bg-paper px-3 py-2 shadow-sm">
      <div className="flex items-center justify-between text-[12px] text-ink-2">
        <span>{busy.label}</span>
        <span className="num text-ink-3">{Math.round(busy.frac * 100)}%</span>
      </div>
      <div className="mt-1.5 h-[3px] bg-paper-3">
        <div className="h-full bg-sar transition-[width] duration-200" style={{ width: `${Math.max(4, busy.frac * 100)}%` }} />
      </div>
    </div>
  );
}

export function DebugOverlay() {
  const s = useStore();
  if (!s.debug) return null;
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-30 rounded-sm bg-ink-950/90 px-3 py-2 font-mono text-[11px] leading-relaxed text-[#b5e48c]">
      <div>fps {s.fps}</div>
      <div>particles {s.layers.scent ? s.particleCount : 0}</div>
      <div>
        wind {s.windSource} {s.bundle?.config.windMethod ? `(${s.bundle.config.windMethod})` : ''}
      </div>
      <div>hour {s.time.toFixed(2)}</div>
      <div>worker {s.workerBusy > 0 ? `busy (${s.workerBusy})` : 'idle'}</div>
      <div>
        {s.mode} · area {s.bundle?.config.areaId}
      </div>
    </div>
  );
}

/** Loading progress, or an error with a way forward (demo / back to the search form). */
export function LoadingScreen() {
  const status = useStore((s) => s.status);
  const frac = useStore((s) => s.loadFrac);
  const label = useStore((s) => s.loadLabel);
  const error = useStore((s) => s.error);
  const errorKind = useStore((s) => s.errorKind);
  if (status === 'ready') return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-paper">
      <div className="w-[380px] max-w-[calc(100vw-32px)]">
        <div className="flex items-center gap-2 text-ink">
          <Logo size={30} />
          <span className="font-display text-2xl font-bold">Scent Cone</span>
        </div>
        {status === 'error' ? (
          <div className="mt-6">
            <h1 className="font-display text-2xl font-bold">{errorKind === 'server' ? 'No server for this area' : 'The area could not be loaded'}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{error}</p>
            {errorKind === 'server' && (
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
                Start the server with <code className="rounded-sm bg-paper-2 px-1 font-mono text-sm">docker compose up</code> and set its address on the search page, or explore the bundled demo.
              </p>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/planner?demo" className="btn btn-primary">
                Open the demo
              </Link>
              <Link to="/new" className="btn">
                Back to Plan a search
              </Link>
              <Link to="/guide#server" className="btn">
                Server setup
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-6">
            <div className="h-[3px] bg-paper-3">
              <div className="h-full bg-sar transition-[width] duration-300" style={{ width: `${Math.max(3, frac * 100)}%` }} />
            </div>
            <p className="mt-2 text-sm text-ink-2">{label}</p>
            <p className="mt-6 text-xs leading-relaxed text-ink-3">A new area takes about a minute while the server downloads terrain and runs WindNinja for each hour.</p>
          </div>
        )}
      </div>
    </div>
  );
}
