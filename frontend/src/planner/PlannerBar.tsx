import { setMission, setView, setWindSource } from '../state/controller';
import { MISSIONS, visibleMissions, type MissionId } from '../config/missions';
import { useStore } from '../state/store';
import { Link } from '../router';
import { Icon, Logo } from '../ui/icons';
import { useIsMobile } from '../ui/useIsMobile';

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: string; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex overflow-hidden rounded border border-rule" role="group" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.v}
          className={`px-2.5 py-1 text-[13px] font-medium ${i ? 'border-l border-rule' : ''} ${value === o.v ? 'bg-ink text-paper' : 'bg-paper text-ink-2 hover:bg-paper-2'} disabled:opacity-40`}
          disabled={o.disabled}
          title={o.title}
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PlannerBar() {
  const bundle = useStore((s) => s.bundle);
  const mode = useStore((s) => s.mode);
  const windSource = useStore((s) => s.windSource);
  const onsite = useStore((s) => s.onsiteWind);
  const view = useStore((s) => s.view);
  const sheet = useStore((s) => s.mobileSheet);
  const set = useStore((s) => s.set);
  const mobile = useIsMobile();
  const c = bundle?.config;
  const mission = useStore((s) => s.mission);
  const pickMission = (m: MissionId) => {
    // keep the mission in the address so links and reloads keep it
    const q = new URLSearchParams(location.search);
    q.set('mission', m);
    history.replaceState(null, '', `${location.pathname}?${q.toString()}`);
    setMission(m);
  };
  const missionSelect = (
    <select
      aria-label="Mission"
      className="field !w-auto !py-1 !text-[13px] font-medium"
      value={mission}
      disabled={!bundle}
      onChange={(e) => pickMission(e.target.value as MissionId)}
    >
      {visibleMissions().map((m) => (
        <option key={m} value={m}>
          {MISSIONS[m].label}
        </option>
      ))}
    </select>
  );
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-rule bg-paper px-3">
      <Link to="/" className="flex items-center gap-1.5 text-ink no-underline hover:text-ink" title="Scentline home">
        <Logo size={24} />
        <span className="hidden font-display text-lg font-bold sm:inline">Scentline</span>
      </Link>
      <div className="h-6 w-px bg-rule" />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-semibold">{c?.name ?? 'Loading area'}</div>
        <div className="truncate text-[11px] text-ink-3">
          {c && (
            <>
              <span className="num">{c.date}</span> · {mode === 'live' ? 'live server' : 'bundled demo data'}
            </>
          )}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {missionSelect}
        {!mobile && (
          <>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Wind</span>
            <Seg
              label="Wind source"
              value={windSource}
              onChange={(v) => setWindSource(v)}
              options={[
                { v: 'windninja', label: 'WindNinja', disabled: !bundle?.windninja, title: bundle?.windninja ? 'Terrain-adjusted wind from WindNinja' : 'No WindNinja output for this area' },
                { v: 'fallback', label: 'Simple', title: 'Forecast wind plus a slope-wind rule' },
              ]}
            />
            {onsite && <span className="rounded-sm bg-forest px-1.5 py-0.5 text-[11px] font-semibold text-white">on-site wind {onsite.hour}:00</span>}
            <Seg
              label="View"
              value={view}
              onChange={(v) => setView(v)}
              options={[
                { v: 'map', label: 'Map' },
                { v: 'scene', label: '3D' },
              ]}
            />
            <Link to="/guide" className="btn btn-sm" title="How to use the planner">
              Guide
            </Link>
          </>
        )}
        {mobile && (
          <>
            <button className={`btn btn-sm ${sheet === 'plan' ? 'btn-on' : ''}`} onClick={() => set({ mobileSheet: sheet === 'plan' ? 'none' : 'plan' })}>
              Controls
            </button>
            <button className={`btn btn-sm ${sheet === 'legend' ? 'btn-on' : ''}`} onClick={() => set({ mobileSheet: sheet === 'legend' ? 'none' : 'legend' })} aria-label="Plan and legend">
              <Icon.Layers />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
