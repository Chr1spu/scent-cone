import { loadMode, setView, setWindSource } from '../state/controller';
import { useStore } from '../state/store';

export function TopBar() {
  const bundle = useStore((s) => s.bundle);
  const mode = useStore((s) => s.mode);
  const backend = useStore((s) => s.backend);
  const windSource = useStore((s) => s.windSource);
  const onsite = useStore((s) => s.onsiteWind);
  const view = useStore((s) => s.view);
  const hasWN = !!bundle?.windninja;
  return (
    <div className="pointer-events-auto absolute left-0 right-0 top-0 flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="panel flex items-center gap-3 px-4 py-2">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
          <path d="M16 3 L28 28 L4 28 Z" fill="#ffb547" opacity="0.9" />
          <path d="M16 10 L23 25 L9 25 Z" fill="#0a0f14" opacity="0.6" />
        </svg>
        <div>
          <div className="text-sm font-semibold tracking-wide text-white">Scent Cone</div>
          <div className="text-[11px] text-slate-400">{bundle?.config.name ?? 'Air-scent dog deployment planner'}</div>
        </div>
      </div>

      <div className="panel flex items-center gap-1 p-1 text-xs" role="group" aria-label="Data mode">
        <button className={`btn !py-1 ${mode === 'offline' ? 'btn-active' : ''}`} onClick={() => mode !== 'offline' && loadMode('offline')}>
          Offline demo
        </button>
        <button
          className={`btn !py-1 ${mode === 'live' ? 'btn-active' : ''}`}
          disabled={!backend.ok}
          title={backend.ok ? 'Use the live backend' : 'Backend not reachable'}
          onClick={() => mode !== 'live' && loadMode('live')}
        >
          Live {backend.ok ? '' : '(offline)'}
        </button>
      </div>

      <div className="panel flex items-center gap-2 px-3 py-1.5 text-xs" title="Wind source used by all models">
        <span className="label">Wind</span>
        <button
          className={`rounded-full px-2.5 py-0.5 font-semibold ${windSource === 'windninja' ? 'bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/50' : 'text-slate-400 hover:text-slate-200'}`}
          disabled={!hasWN}
          onClick={() => setWindSource('windninja')}
        >
          WindNinja
        </button>
        <button
          className={`rounded-full px-2.5 py-0.5 font-semibold ${windSource === 'fallback' ? 'bg-amber-500/25 text-amber-200 ring-1 ring-amber-400/50' : 'text-slate-400 hover:text-slate-200'}`}
          onClick={() => setWindSource('fallback')}
        >
          Fallback
        </button>
        {onsite && <span className="rounded-full bg-sky-500/25 px-2 py-0.5 text-sky-200 ring-1 ring-sky-400/50">on-site {onsite.hour}:00</span>}
      </div>

      <div className="flex-1" />

      <div className="panel flex items-center gap-1 p-1 text-xs" role="group" aria-label="View">
        <button className={`btn !py-1 ${view === 'map' ? 'btn-active' : ''}`} onClick={() => setView('map')}>
          Map view
        </button>
        <button className={`btn !py-1 ${view === 'scene' ? 'btn-active' : ''}`} onClick={() => setView('scene')}>
          Scene view
        </button>
      </div>
    </div>
  );
}
