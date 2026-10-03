import { useState } from 'react';
import { COLORS, LANDCOVER_CLASSES } from '../config/constants';
import { Link } from '../router';
import { FEATURE_COLORS } from '../scene/FeatureLines';
import { fmtTime } from '../state/controller';
import { useStore } from '../state/store';

type Tab = 'plan' | 'legend' | 'notes';

function Ramp({ stops, labels }: { stops: string[]; labels: [string, string] }) {
  return (
    <div>
      <div className="h-2.5 rounded-sm border border-rule" style={{ background: `linear-gradient(90deg, ${stops.join(',')})` }} />
      <div className="mt-0.5 flex justify-between text-[11px] text-ink-3">
        <span>{labels[0]}</span>
        <span>{labels[1]}</span>
      </div>
    </div>
  );
}

function Key({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-ink-2">
      {line ? <span className="h-[3px] w-4 shrink-0" style={{ background: color }} /> : <span className="h-3 w-3 shrink-0 rounded-sm border border-black/10" style={{ background: color }} />}
      {label}
    </div>
  );
}

const compass = (deg: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];

function Plan() {
  const deployments = useStore((s) => s.deployments);
  const time = useStore((s) => s.time);
  if (deployments.length === 0) {
    return (
      <p className="text-[13px] leading-relaxed text-ink-2">
        No teams placed yet. Set the time bar to when teams can start, then press <strong>Deploy</strong> in section 3. Each team gets a start point, a heading into the wind and its best hour.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-3">Planned for {fmtTime(time)}. Bars: scent score for each hour at that point.</p>
      {deployments.map((d) => {
        const color = COLORS.team[(d.team - 1) % COLORS.team.length];
        const maxS = Math.max(...d.windowScores.map((w) => w.score), 1e-6);
        const dir = Math.round(((Math.atan2(d.upwind[0], d.upwind[1]) * 180) / Math.PI + 360) % 360);
        return (
          <div key={d.team} className="rounded-sm border border-rule bg-white px-2.5 py-2 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-semibold">
                <span className="h-3 w-3 rounded-full" style={{ background: color }} />
                Team {d.team}
              </span>
              <span className="num text-xs text-ink-2">covers {(d.coveredProb * 100).toFixed(1)}%</span>
            </div>
            <div className="mt-1 text-ink-2">
              Work toward <span className="num">{dir}°</span> ({compass(dir)}), into a <span className="num">{d.windSpeed.toFixed(1)} m/s</span> wind.
            </div>
            <div className="mt-1.5 flex h-6 items-end gap-[2px]" aria-label="Scent score by hour">
              {d.windowScores.map((w) => (
                <div
                  key={w.hour}
                  className="flex-1"
                  style={{ height: `${12 + 88 * (w.score / maxS)}%`, background: w.hour === d.bestWindow[1] ? color : '#d3c9b2' }}
                  title={`${w.hour - 1}:00 to ${w.hour}:00`}
                />
              ))}
            </div>
            <div className="num mt-0.5 text-[11px] text-ink-3">
              best {fmtTime(d.bestWindow[0])} to {fmtTime(d.bestWindow[1])}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Legend() {
  const layers = useStore((s) => s.layers);
  const windSource = useStore((s) => s.windSource);
  return (
    <div className="space-y-3">
      <Ramp stops={['#141f22', '#233531', '#435141', '#75725b', '#bdb9a8']} labels={['valley', 'ridge']} />
      {layers.probability && <Ramp stops={['rgba(35,181,196,0.05)', '#23b5c4']} labels={['less likely', 'more likely location']} />}
      {layers.heatmap && <Ramp stops={['#1a0833', '#8c1a6b', '#ed5a29', '#ffbf40', '#fff8c0']} labels={['faint scent', 'strong scent (last hour)']} />}
      <div className="grid grid-cols-2 gap-1.5">
        {layers.scent && <Key color={COLORS.amber} label="Scent at nose height" />}
        {layers.wind && <Key color="#9fd3ff" label={windSource === 'windninja' ? 'Wind (WindNinja)' : 'Wind (simple)'} line />}
        <Key color={FEATURE_COLORS.trail} label="Trail" line />
        <Key color={FEATURE_COLORS.road} label="Road" line />
        <Key color={FEATURE_COLORS.stream} label="Stream, water" line />
        <Key color={FEATURE_COLORS.cliff} label="Cliff" line />
        <Key color="#9a968e" label="Trailhead (cairn)" />
        <Key color={COLORS.amber} label="Focus square" line />
        <Key color={COLORS.searched} label="Searched area" line />
        <Key color={COLORS.recheck} label="Recheck" line />
        <Key color={COLORS.alert[0]} label="Alert back-trace" />
      </div>
      {layers.landcover && (
        <div className="grid grid-cols-2 gap-1.5 border-t border-rule pt-2">
          {LANDCOVER_CLASSES.map((c) => (
            <Key key={c.id} color={c.color} label={c.label} />
          ))}
        </div>
      )}
      <p className="text-[11px] leading-snug text-ink-3">Contours every 10 m in the focus square, 50 m outside. Heights exaggerated 1.5 times.</p>
    </div>
  );
}

function Notes() {
  const bundle = useStore((s) => s.bundle);
  const windSource = useStore((s) => s.windSource);
  const sources = Object.values(bundle?.config.sources ?? {}).filter((v, i, a) => a.indexOf(v) === i);
  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-ink-2">
      <p>The scent model is a set of simplified rules, not a validated simulation. Use it alongside experienced handlers.</p>
      <ul className="list-disc space-y-1 pl-4">
        <li>Wind: {windSource === 'windninja' ? 'WindNinja, terrain-adjusted, hourly' : 'forecast plus a slope-wind rule'}; scent moves with it at 0.6 m.</li>
        <li>Scent is released continuously, fades in heat and sun, lifts off sunny slopes, pools in calm hollows.</li>
        <li>Detectability is measured against neutral scent conditions.</li>
        <li>Teams: 70% chance a dog finds what it covers; 300 m apart.</li>
      </ul>
      {sources.length > 0 && <p className="text-xs text-ink-3">Data: {sources.join(', ')}.</p>}
      <p>
        <Link to="/how-it-works">How it works</Link>, with every parameter.
      </p>
    </div>
  );
}

export function InfoPanel() {
  const deployments = useStore((s) => s.deployments.length);
  const [tab, setTab] = useState<Tab>('legend');
  const [lastDeploys, setLastDeploys] = useState(0);
  // jump to the plan tab when teams are deployed
  if (deployments !== lastDeploys) {
    setLastDeploys(deployments);
    if (deployments > 0) setTab('plan');
  }
  const tabs: [Tab, string][] = [
    ['plan', deployments ? `Plan (${deployments})` : 'Plan'],
    ['legend', 'Legend'],
    ['notes', 'Notes'],
  ];
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-rule" role="tablist">
        {tabs.map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`flex-1 py-2 text-[13px] font-semibold ${tab === t ? 'border-b-2 border-sar text-ink' : 'border-b-2 border-transparent text-ink-3 hover:text-ink'}`}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'plan' && <Plan />}
        {tab === 'legend' && <Legend />}
        {tab === 'notes' && <Notes />}
      </div>
    </div>
  );
}
