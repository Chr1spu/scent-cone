import { useState } from 'react';
import { COLORS, LANDCOVER_CLASSES } from '../config/constants';
import { FEATURE_COLORS } from '../scene/FeatureLines';
import { fmtTime } from '../state/controller';
import { useStore } from '../state/store';
import { useIsMobile } from './useIsMobile';

function Ramp({ from, to, stops, labels }: { from?: string; to?: string; stops?: string[]; labels: [string, string] }) {
  const bg = stops ? `linear-gradient(90deg, ${stops.join(',')})` : `linear-gradient(90deg, ${from}, ${to})`;
  return (
    <div>
      <div className="h-2 rounded-full" style={{ background: bg }} />
      <div className="mt-0.5 flex justify-between text-[10px] text-slate-500">
        <span>{labels[0]}</span>
        <span>{labels[1]}</span>
      </div>
    </div>
  );
}

function Row({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-slate-300">
      {line ? <span className="h-0.5 w-4 rounded" style={{ background: color }} /> : <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />}
      {label}
    </div>
  );
}

export function Legend() {
  const layers = useStore((s) => s.layers);
  const deployments = useStore((s) => s.deployments);
  const bundle = useStore((s) => s.bundle);
  const windSource = useStore((s) => s.windSource);
  const mobile = useIsMobile();
  const sheet = useStore((s) => s.mobileSheet);
  const [assumptions, setAssumptions] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  if (!bundle) return null;
  if (mobile && sheet !== 'legend') {
    if (sheet === 'plan') return null;
    return (
      <button
        className="panel pointer-events-auto absolute right-2 top-[104px] z-20 px-3 py-2 text-xs font-semibold text-white"
        onClick={() => useStore.getState().set({ mobileSheet: 'legend' })}
      >
        Legend{deployments.length ? ` · ${deployments.length} teams` : ''}
      </button>
    );
  }
  return (
    <aside
      className={
        mobile
          ? 'pointer-events-auto absolute bottom-[146px] left-2 right-2 top-[104px] z-20 flex flex-col gap-3 overflow-y-auto'
          : 'pointer-events-auto absolute right-4 top-[84px] z-10 flex max-h-[calc(100%-200px)] w-[270px] max-w-[calc(100vw-32px)] flex-col gap-3 overflow-y-auto'
      }
    >
      {mobile && (
        <button className="panel px-4 py-2 text-left text-xs font-semibold text-white" onClick={() => useStore.getState().set({ mobileSheet: 'none' })}>
          ✕ Close legend
        </button>
      )}
      {deployments.length > 0 && (
        <div className="panel px-4 py-3">
          <h3 className="label mb-2">Deployment plan</h3>
          <div className="flex flex-col gap-2">
            {deployments.map((d) => {
              const color = COLORS.team[(d.team - 1) % COLORS.team.length];
              const maxS = Math.max(...d.windowScores.map((w) => w.score), 1e-6);
              const dir = Math.round(((Math.atan2(d.upwind[0], d.upwind[1]) * 180) / Math.PI + 360) % 360);
              return (
                <div key={d.team} className="rounded-lg bg-white/5 px-2.5 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold" style={{ color }}>
                      Team {d.team}
                    </span>
                    <span className="text-slate-400">covers {(d.coveredProb * 100).toFixed(1)}%</span>
                  </div>
                  <div className="mt-0.5 text-slate-300">
                    Work upwind toward {dir}° · wind {d.windSpeed.toFixed(1)} m/s
                  </div>
                  <div className="mt-1 flex h-5 items-end gap-0.5" title="Scent score by hour">
                    {d.windowScores.map((w) => (
                      <div
                        key={w.hour}
                        className="flex-1 rounded-sm"
                        style={{ height: `${15 + 85 * (w.score / maxS)}%`, background: w.hour === d.bestWindow[1] ? color : 'rgba(255,255,255,0.18)' }}
                        title={`${w.hour - 1}:00–${w.hour}:00`}
                      />
                    ))}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-400">
                    Best window {fmtTime(d.bestWindow[0])}–{fmtTime(d.bestWindow[1])}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="panel px-4 py-3">
        <button className="flex w-full items-center justify-between" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
          <h3 className="label">Legend</h3>
          <span className="text-slate-500">{collapsed ? '+' : '−'}</span>
        </button>
        {!collapsed && (
          <div className="mt-2 flex flex-col gap-2.5">
            <Ramp stops={['#141f22', '#233531', '#435141', '#75725b', '#bdb9a8']} labels={['valley', 'ridge']} />
            {layers.probability && <Ramp from="rgba(51,209,230,0.05)" to="#33d1e6" labels={['less likely', 'more likely location']} />}
            {layers.heatmap && <Ramp stops={['#1a0833', '#8c1a6b', '#ed5a29', '#ffbf40', '#fff8c0']} labels={['faint scent', 'strong scent (60 min)']} />}
            {layers.scent && <Row color={COLORS.amber} label="Scent particles at dog nose height" />}
            {layers.wind && <Row color="#bfe6ff" label={`Wind streaks (${windSource === 'windninja' ? 'WindNinja' : 'fallback slope-wind'})`} line />}
            {layers.features && (
              <div className="grid grid-cols-2 gap-1">
                <Row color={FEATURE_COLORS.trail} label="Trail" line />
                <Row color={FEATURE_COLORS.road} label="Road" line />
                <Row color={FEATURE_COLORS.stream} label="Stream / water" line />
                <Row color={FEATURE_COLORS.cliff} label="Cliff" line />
              </div>
            )}
            {layers.landcover && (
              <div className="grid grid-cols-2 gap-1">
                {LANDCOVER_CLASSES.map((c) => (
                  <Row key={c.id} color={c.color} label={c.label} />
                ))}
              </div>
            )}
            {layers.alertZones && (
              <div className="grid grid-cols-2 gap-1">
                <Row color={COLORS.alert[0]} label="Alert 1 back-zone" />
                <Row color={COLORS.alert[1]} label="Alert 2 back-zone" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-1">
              <Row color={COLORS.amber} label="Focus segment" line />
              <Row color={COLORS.searched} label="Searched sector" line />
              <Row color={COLORS.recheck} label="Recheck (poor scent)" line />
              <Row color={COLORS.lkp} label="Last known point" />
            </div>
            <p className="text-[10px] leading-snug text-slate-500">Contours every 10 m (segment) / 50 m (overview). Vertical exaggeration ×1.5.</p>
          </div>
        )}
      </div>

      <div className="panel px-4 py-3">
        <button className="flex w-full items-center justify-between" onClick={() => setAssumptions(!assumptions)} aria-expanded={assumptions}>
          <h3 className="label">Model assumptions</h3>
          <span className="text-slate-500">{assumptions ? '−' : '+'}</span>
        </button>
        {assumptions && (
          <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-snug text-slate-400">
            <li>Scent physics are simplified, tunable heuristics — plausible and explainable, not validated.</li>
            <li>Probability: log-normal distance from LKP by profile (Lost Person Behavior medians), boosted near trails/streams, reduced across water/cliffs and on steep slopes.</li>
            <li>Wind: {windSource === 'windninja' ? 'USFS WindNinja (mass-conserving, diurnal) at 2 m' : 'forecast wind ×0.7 plus a slope-wind term (downslope at night, upslope on sunny slopes)'}.</li>
            <li>Scent is released continuously from every likely location and moves with the wind at dog-nose height (0.6 m): about 70% of the 2 m wind over open ground, 30% under forest canopy. It spreads by random-walk turbulence, pools in calm hollows, decays faster when hot, dry or sunny, and lofts off sunlit slopes (ridge shadows included).</li>
            <li>Detectability is absolute: thresholds come from a run with the same wind but neutral scent conditions, so poor conditions really lower it (the "Scent" rating shows the ratio).</li>
            <li>Deployment: greedy coverage with dog POD 0.7; teams 300 m apart on slopes ≤ 35°, away from water and cliffs.</li>
            <li>Alerts: 60-minute backward trace; zones multiply into the probability map. Searched sectors lower probability by how much of each location&apos;s scent reached them during the search window.</li>
            <li>Data: {Object.values(bundle.config.sources ?? {}).filter((v, i, a) => a.indexOf(v) === i).join(' · ') || 'demo bundle'}.</li>
          </ul>
        )}
      </div>
    </aside>
  );
}
