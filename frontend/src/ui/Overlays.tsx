import { useStore } from '../state/store';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const tone = {
    info: 'border-sky-400/40',
    warn: 'border-amber-400/60',
    error: 'border-rose-500/70',
    success: 'border-emerald-400/60',
  };
  return (
    <div className="pointer-events-none absolute bottom-32 right-4 z-30 flex w-[320px] max-w-[calc(100vw-32px)] flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`panel border-l-4 px-3 py-2 text-xs text-slate-200 ${tone[t.tone]}`}>
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
    <div className="panel pointer-events-none absolute left-1/2 top-[84px] z-20 w-[300px] -translate-x-1/2 px-4 py-2">
      <div className="flex items-center justify-between text-xs text-slate-300">
        <span>{busy.label}</span>
        <span className="tabular-nums text-slate-500">{Math.round(busy.frac * 100)}%</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-amber-400 transition-[width] duration-200" style={{ width: `${Math.max(4, busy.frac * 100)}%` }} />
      </div>
    </div>
  );
}

export function DebugOverlay() {
  const debug = useStore((s) => s.debug);
  const fps = useStore((s) => s.fps);
  const particles = useStore((s) => s.particleCount);
  const layers = useStore((s) => s.layers);
  const windSource = useStore((s) => s.windSource);
  const time = useStore((s) => s.time);
  const workerBusy = useStore((s) => s.workerBusy);
  const mode = useStore((s) => s.mode);
  const bundle = useStore((s) => s.bundle);
  if (!debug) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-[140px] z-30 -translate-x-1/2 rounded-md bg-black/80 px-3 py-2 font-mono text-[11px] leading-relaxed text-lime-300">
      <div>fps {fps}</div>
      <div>particles {layers.scent ? particles : 0}</div>
      <div>
        wind {windSource} {bundle?.config.windMethod ? `(${bundle.config.windMethod})` : ''}
      </div>
      <div>hour {time.toFixed(2)} → {Math.floor(time)}:00/{Math.min(Math.floor(time) + 1, 22)}:00</div>
      <div>worker {workerBusy > 0 ? `busy (${workerBusy})` : 'idle'}</div>
      <div>mode {mode} · area {bundle?.config.areaId}</div>
    </div>
  );
}

export function LoadingScreen() {
  const status = useStore((s) => s.status);
  const frac = useStore((s) => s.loadFrac);
  const label = useStore((s) => s.loadLabel);
  const error = useStore((s) => s.error);
  if (status === 'ready') return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-ink-950/95">
      <div className="w-[360px] max-w-[calc(100vw-32px)] text-center">
        <svg width="56" height="56" viewBox="0 0 32 32" className="mx-auto mb-4 animate-pulse" aria-hidden>
          <path d="M16 3 L28 28 L4 28 Z" fill="#ffb547" opacity="0.9" />
          <path d="M16 10 L23 25 L9 25 Z" fill="#0a0f14" opacity="0.6" />
        </svg>
        <h1 className="text-xl font-semibold text-white">Scent Cone</h1>
        <p className="mt-1 text-sm text-slate-400">Where and when to deploy air-scent dogs</p>
        {status === 'error' ? (
          <div className="mt-6 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-left text-xs text-rose-200">
            Could not load the area: {error}
            <button className="btn mt-3 w-full" onClick={() => location.reload()}>
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-amber-400 transition-[width] duration-300" style={{ width: `${Math.max(3, frac * 100)}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-400">{label}</p>
          </>
        )}
      </div>
    </div>
  );
}

export function HelpBar() {
  return (
    <div className="pointer-events-none absolute bottom-[118px] left-4 z-0 hidden text-[10px] text-slate-500 lg:block">
      Keys: <b>1–7</b> demo steps · <b>Space</b> play · <b>M</b> map/scene · <b>D</b> debug · <b>Esc</b> cancel tool
    </div>
  );
}
