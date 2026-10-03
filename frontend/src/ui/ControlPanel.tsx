import { useState, type ReactNode } from 'react';
import { PROFILES, type ProfileId } from '../config/modelParams';
import { computeDetailAt, deployTeams, releaseScent, resetSearch, scheduleHeat, setOnsiteWind, setProfile } from '../state/controller';
import { LAYER_LABELS, useStore, type LayerId, type Tool } from '../state/store';
import { AreaPicker } from './AreaPicker';
import { SearchOptions } from './SearchOptions';
import { useIsMobile } from './useIsMobile';

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-white/5 px-4 py-3 last:border-0">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="label">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function ToolButton({ tool, children, title }: { tool: Tool; children: ReactNode; title?: string }) {
  const active = useStore((s) => s.tool === tool);
  return (
    <button
      className={`btn flex-1 !px-2 text-xs ${active ? 'btn-active' : ''}`}
      title={title}
      aria-pressed={active}
      onClick={() => useStore.getState().set({ tool: active ? 'none' : tool, hover: null, focusPreview: tool === 'focus' ? useStore.getState().focusPreview : null })}
    >
      {children}
    </button>
  );
}

export function ControlPanel() {
  const mobile = useIsMobile();
  const sheet = useStore((s) => s.mobileSheet);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const open = mobile ? sheet === 'plan' : desktopOpen;
  const setOpen = (v: boolean) => (mobile ? useStore.getState().set({ mobileSheet: v ? 'plan' : 'none' }) : setDesktopOpen(v));
  const [layersOpen, setLayersOpen] = useState(false);
  const bundle = useStore((s) => s.bundle);
  const profile = useStore((s) => s.profile);
  const prob = useStore((s) => s.prob);
  const teams = useStore((s) => s.teams);
  const mode = useStore((s) => s.mode);
  const layers = useStore((s) => s.layers);
  const tool = useStore((s) => s.tool);
  const focusPreview = useStore((s) => s.focusPreview);
  const alerts = useStore((s) => s.alerts.length);
  const searched = useStore((s) => s.searched.length);
  const onsite = useStore((s) => s.onsiteWind);
  const busy = useStore((s) => s.busy);
  const [wDir, setWDir] = useState('300');
  const [wSpd, setWSpd] = useState('2');
  const set = useStore((s) => s.set);
  const toggleLayer = useStore((s) => s.toggleLayer);

  if (!bundle) return null;
  return (
    <aside
      className={
        mobile
          ? `panel pointer-events-auto absolute left-2 z-20 flex flex-col overflow-hidden ${open ? 'right-2 top-[104px] bottom-[146px]' : 'top-[104px]'}`
          : 'panel pointer-events-auto absolute left-4 top-[84px] z-10 flex max-h-[calc(100%-200px)] w-[300px] max-w-[calc(100vw-32px)] flex-col overflow-hidden'
      }
    >
      <button className="flex items-center justify-between px-4 py-2.5 text-left text-sm font-semibold text-white" onClick={() => setOpen(!open)} aria-expanded={open}>
        Search planning
        <span className="text-slate-400">{open ? (mobile ? '✕' : '−') : '+'}</span>
      </button>
      {open && (
        <div className="overflow-y-auto border-t border-white/5">
          <Section title="Scenario">
            <p className="text-xs leading-relaxed text-slate-300">{bundle.config.scenario}</p>
          </Section>

          <Section title="Subject profile">
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(PROFILES) as ProfileId[]).map((id) => (
                <button key={id} className={`btn !px-2 text-xs ${profile === id ? 'btn-active' : ''}`} onClick={() => setProfile(id)} title={`median ${PROFILES[id].medianM} m · ${PROFILES[id].note}`}>
                  {PROFILES[id].label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-1.5">
              <ToolButton tool="lkp" title="Click the terrain to move the last known point">
                📍 Place LKP
              </ToolButton>
              <ToolButton tool="brushUp" title="Click to double probability within 250 m">
                ＋ Brush
              </ToolButton>
              <ToolButton tool="brushDown" title="Click to halve probability within 250 m">
                − Brush
              </ToolButton>
            </div>
            {prob && (
              <div className="mt-2 rounded-md bg-cyan-500/10 px-2.5 py-1.5 text-xs text-cyan-100 ring-1 ring-cyan-400/20">
                This segment holds <b className="text-cyan-300">{(prob.segmentFraction * 100).toFixed(0)}%</b> of the probability
              </div>
            )}
          </Section>

          <Section title="Search area (live)">
            <AreaPicker key={bundle.config.areaId} />
          </Section>

          {mode === 'live' && (
            <Section title="Focus segment (3 km)">
              <div className="flex gap-1.5">
                <ToolButton tool="focus" title="Click the overview to choose a new focus segment">
                  ⌖ Move focus
                </ToolButton>
                <button className="btn btn-primary flex-1 !px-2 text-xs" disabled={!focusPreview} onClick={() => focusPreview && computeDetailAt(focusPreview[0], focusPreview[1])}>
                  Compute detail
                </button>
              </div>
              {tool === 'focus' && <p className="mt-1.5 text-[11px] text-slate-400">Drag on the terrain to move the new square (camera rotation is paused), then Compute detail.</p>}
            </Section>
          )}

          <Section title="Scent & teams">
            <div className="flex gap-1.5">
              <button className="btn flex-1 text-xs" onClick={releaseScent}>
                ✦ Release scent
              </button>
              <button
                className={`btn flex-1 text-xs ${layers.heatmap ? 'btn-active' : ''}`}
                onClick={() => {
                  set({ layers: { ...layers, heatmap: !layers.heatmap, hotspots: !layers.heatmap } });
                  if (!layers.heatmap) setTimeout(() => scheduleHeat(0));
                }}
              >
                ◍ Heatmap
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <label className="text-xs text-slate-300" htmlFor="teams">
                Teams
              </label>
              <input
                id="teams"
                type="number"
                min={1}
                max={6}
                value={teams}
                onChange={(e) => set({ teams: Math.min(6, Math.max(1, Number(e.target.value) || 1)) })}
                className="w-14 rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-sm"
              />
              <button className="btn btn-primary flex-1 text-xs" disabled={!!busy} onClick={deployTeams}>
                Deploy {teams} team{teams > 1 ? 's' : ''}
              </button>
            </div>
          </Section>

          <Section title="Search updates" right={<span className="text-[11px] text-slate-500">{alerts} alerts · {searched} sectors</span>}>
            <div className="flex gap-1.5">
              <ToolButton tool="alert" title="Click where a dog alerted (at the slider time)">
                ▲ Add alert
              </ToolButton>
              <ToolButton tool="searched" title="Mark an area a team searched without an alert">
                ◯ Searched
              </ToolButton>
              <button className="btn !px-2 text-xs" onClick={resetSearch}>
                Reset
              </button>
            </div>
            {tool === 'alert' && <p className="mt-1.5 text-[11px] text-pink-200/80">Click a pink radio marker (or anywhere in the segment) to log an alert.</p>}
            {tool === 'searched' && <SearchOptions />}
          </Section>

          <Section title="On-site wind" right={onsite && <span className="text-[11px] text-sky-300">active {onsite.hour}:00</span>}>
            <div className="flex items-center gap-1.5 text-xs">
              <input aria-label="Wind from (degrees)" className="w-14 rounded-md border border-white/10 bg-ink-800 px-2 py-1" value={wDir} onChange={(e) => setWDir(e.target.value)} />
              <span className="text-slate-400">° from</span>
              <input aria-label="Wind speed (m/s)" className="w-12 rounded-md border border-white/10 bg-ink-800 px-2 py-1" value={wSpd} onChange={(e) => setWSpd(e.target.value)} />
              <span className="text-slate-400">m/s</span>
              <button className="btn ml-auto !px-2 text-xs" onClick={() => setOnsiteWind(Number(wDir) % 360, Math.max(0, Number(wSpd)))}>
                Apply
              </button>
              {onsite && (
                <button className="btn !px-2 text-xs" onClick={() => setOnsiteWind(null, null)}>
                  ✕
                </button>
              )}
            </div>
          </Section>

          <Section title="Layers" right={<button className="text-[11px] text-slate-400 hover:text-white" onClick={() => setLayersOpen(!layersOpen)}>{layersOpen ? 'hide' : 'show'}</button>}>
            {layersOpen && (
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {(Object.keys(LAYER_LABELS) as LayerId[]).map((id) => (
                  <label key={id} className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-300">
                    <input type="checkbox" checked={layers[id]} onChange={() => toggleLayer(id)} className="accent-amber-400" />
                    {LAYER_LABELS[id]}
                  </label>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
    </aside>
  );
}
