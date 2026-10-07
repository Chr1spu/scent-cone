import type { ReactNode } from 'react';
import { HABITAT_CLASSES, MISSIONS } from '../config/missions';
import { PROFILES } from '../config/modelParams';
import { shareBeyond } from '../models/probability';
import { clearHides, finishPolygon, fmtTime, scoreTrialGpx, setHabitat, setProfile, setTravelDir } from '../state/controller';
import { DETECTION } from '../config/modelParams';
import { download } from './exportPlan';
import { useStore, type Tool } from '../state/store';
import { Icon } from '../ui/icons';

function ToolButton({ tool, children, title }: { tool: Tool; children: ReactNode; title: string }) {
  const active = useStore((s) => s.tool === tool);
  return (
    <button
      className={`btn btn-sm flex-1 ${active ? 'btn-on' : ''}`}
      title={title}
      aria-pressed={active}
      onClick={() => useStore.getState().set({ tool: active ? 'none' : tool, hover: null, searchDraft: { ...useStore.getState().searchDraft, pts: [] } })}
    >
      {children}
    </button>
  );
}

/** First panel section: what the mission's source model needs (profile, hides, area, habitat). */
export function SourceSection() {
  const mission = useStore((s) => MISSIONS[s.mission]);
  const profile = useStore((s) => s.profile);
  const prob = useStore((s) => s.prob);
  const hides = useStore((s) => s.hides);
  const area = useStore((s) => s.area);
  const habitat = useStore((s) => s.habitat);
  const tool = useStore((s) => s.tool);
  const draft = useStore((s) => s.searchDraft);
  const set = useStore((s) => s.set);
  const mode = useStore((s) => s.mode);
  const travelDir = useStore((s) => s.travelDir);
  const ov = useStore((s) => s.bundle?.overview.meta);
  const areaKm = ov ? (Math.min(ov.cols, ov.rows) * ov.cellSize) / 1000 : 12;
  const outside = ov && PROFILES[profile] ? shareBeyond(PROFILES[profile], (areaKm * 1000) / 2) : 0;

  if (mission.source === 'lkp' || mission.source === 'water') {
    return (
      <>
        {mission.profiles && (
          <div className="grid grid-cols-2 gap-1">
            {mission.profiles.map((id) => (
              <button key={id} className={`btn btn-sm ${profile === id ? 'btn-on' : ''}`} onClick={() => setProfile(id)} title={`median distance ${PROFILES[id].medianM} m (${PROFILES[id].note})`}>
                {PROFILES[id].label}
              </button>
            ))}
          </div>
        )}
        {mission.source === 'lkp' && mission.id !== 'pet' && (
          <label className="mt-1.5 flex items-center gap-1.5 text-[13px] text-ink-2" title="ISRID: three in four lost people are found within 66° of the direction they set off in">
            Heading when last seen
            <select
              className="field !w-auto !py-0.5"
              value={travelDir === null ? '' : String(travelDir)}
              onChange={(e) => setTravelDir(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">unknown</option>
              {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((c, k) => (
                <option key={c} value={k * 45}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="mt-1.5 flex gap-1">
          <ToolButton tool="lkp" title={`Click the terrain to move: ${mission.lkpLabel.toLowerCase()}`}>
            <Icon.Pin size={14} /> Move point
          </ToolButton>
          {mission.source === 'lkp' && (
            <>
              <ToolButton tool="brushUp" title="Click to double the probability within 250 m">
                <Icon.Brush size={14} /> Raise
              </ToolButton>
              <ToolButton tool="brushDown" title="Click to halve the probability within 250 m">
                <Icon.Minus size={14} /> Lower
              </ToolButton>
            </>
          )}
        </div>
        {mission.source === 'water' && <p className="mt-2 text-xs text-ink-2">Probability is on the water only, falling off with distance from where the person went in.</p>}
        {prob && mission.source === 'lkp' && (
          <p className="mt-2 text-[13px] text-ink-2">
            The 3 km focus square holds <span className="num font-semibold text-ink">{(prob.segmentFraction * 100).toFixed(0)}%</span> of the probability.
          </p>
        )}
        {prob && mission.source === 'lkp' && prob.segmentFraction < 0.5 && (
          <p className="mt-1.5 rounded-sm border-l-2 border-amber bg-amber/10 px-2 py-1 text-xs leading-snug text-ink-2">
            Most of the probability is outside the focus square, where scent and team placements are not modelled. Plan the rest by probability, or move the square
            {mode === 'live' ? ' (Focus square, below)' : ''}.
          </p>
        )}
        {outside >= 0.05 && mission.source === 'lkp' && (
          <p className="mt-1.5 text-xs leading-snug text-ink-3">
            About <span className="num">{Math.round(outside * 100)}%</span> of where a {PROFILES[profile].label.toLowerCase()} typically ends up lies beyond the{' '}
            {Math.round(areaKm)} km modelled area and isn&apos;t on the map.
          </p>
        )}
      </>
    );
  }

  if (mission.source === 'hides') {
    return (
      <>
        <div className="flex gap-1">
          <ToolButton tool="hide" title="Click the terrain to place a hide (up to 3)">
            <Icon.Pin size={14} /> Place hide
          </ToolButton>
          <button className="btn btn-sm" disabled={hides.length === 0} onClick={clearHides}>
            Clear
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-2">
          {hides.length === 0 ? 'No hides yet.' : `${hides.length} hide${hides.length > 1 ? 's' : ''} placed (up to 3).`} Scrub the time bar to see where each scent cone goes.
        </p>
        <TrialImport enabled={hides.length > 0} />
      </>
    );
  }

  if (mission.source === 'area') {
    const drawing = tool === 'area';
    return (
      <>
        <div className="flex gap-1">
          <ToolButton tool="area" title="Draw the area to search">
            <Icon.Square size={14} /> {area ? 'Redraw area' : 'Draw area'}
          </ToolButton>
        </div>
        {drawing && (
          <div className="mt-2 space-y-1.5 rounded-sm border border-rule bg-card p-2 text-[13px]">
            <div className="flex overflow-hidden rounded border border-rule">
              {(['circle', 'polygon'] as const).map((shape, i) => (
                <button
                  key={shape}
                  className={`flex-1 py-1 text-xs font-medium ${i ? 'border-l border-rule' : ''} ${draft.shape === shape ? 'bg-ink text-paper' : 'bg-paper text-ink-2'}`}
                  onClick={() => set({ searchDraft: { ...draft, shape, pts: [] } })}
                >
                  {shape === 'circle' ? 'Circle' : 'Polygon'}
                </button>
              ))}
            </div>
            {draft.shape === 'circle' ? (
              <label className="flex items-center gap-2 text-ink-2">
                Radius
                <input
                  type="number"
                  min={30}
                  max={1200}
                  step={10}
                  value={draft.radius}
                  onChange={(e) => set({ searchDraft: { ...draft, radius: Math.min(1200, Math.max(30, Number(e.target.value) || 150)) } })}
                  className="field !w-16 !py-0.5"
                />
                m, then click the map
              </label>
            ) : (
              <div className="flex items-center gap-1.5 text-ink-2">
                <span className="flex-1">{draft.pts.length} corners. Enter or the first corner closes it.</span>
                <button className="btn btn-primary btn-sm" disabled={draft.pts.length < 3} onClick={finishPolygon}>
                  Finish
                </button>
              </div>
            )}
          </div>
        )}
        <p className="mt-2 text-xs text-ink-2">
          {mission.id === 'disaster' ? 'Probability is spread over the debris field, weighted toward its lower end.' : 'Probability is spread evenly over the area, less on steep ground.'}
        </p>
      </>
    );
  }

  // habitat
  const toggle = (id: number) => {
    const classes = habitat.classes.includes(id) ? habitat.classes.filter((c) => c !== id) : [...habitat.classes, id];
    if (classes.length) setHabitat({ ...habitat, classes });
  };
  return (
    <div className="space-y-2 text-[13px]">
      <div>
        <div className="mb-1 text-xs text-ink-3">Land cover</div>
        <div className="grid grid-cols-2 gap-1">
          {HABITAT_CLASSES.map((c) => (
            <button key={c.id} className={`btn btn-sm ${habitat.classes.includes(c.id) ? 'btn-on' : ''}`} onClick={() => toggle(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center justify-between gap-2 text-ink-2">
        Slopes up to
        <select className="field !w-auto !py-0.5" value={habitat.maxSlopeDeg} onChange={(e) => setHabitat({ ...habitat, maxSlopeDeg: Number(e.target.value) })}>
          {[15, 20, 25, 30, 35, 45].map((v) => (
            <option key={v} value={v}>
              {v}°
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-ink-2">
        Near streams
        <select className="field !w-auto !py-0.5" value={habitat.nearStreamM} onChange={(e) => setHabitat({ ...habitat, nearStreamM: Number(e.target.value) })}>
          <option value={0}>anywhere</option>
          {[50, 100, 150, 300].map((v) => (
            <option key={v} value={v}>
              within {v} m
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/**
 * Field validation for training runs: import the dog's GPS track with alert waypoints and see
 * whether the model scored the alert spots higher than the rest of the track (docs/FIELD_TRIALS.md).
 */
function TrialImport({ enabled }: { enabled: boolean }) {
  const trial = useStore((s) => s.trial);
  const hides = useStore((s) => s.hides);
  const bundle = useStore((s) => s.bundle);
  const onsite = useStore((s) => s.onsiteWind);
  const windSource = useStore((s) => s.windSource);
  const onFile = async (f: File | undefined) => {
    if (f) await scoreTrialGpx(await f.text(), f.name);
  };
  const saveRecord = () => {
    if (!trial || !bundle) return;
    const record = {
      kind: 'scentline-trial',
      version: 1,
      saved: new Date().toISOString(),
      area: bundle.config.name,
      date: bundle.config.date,
      crs: bundle.detail.meta.crs,
      frame: bundle.frame,
      hides,
      windowEnd: trial.t,
      wind: { source: windSource, measured: onsite },
      detection: { d50M: DETECTION.d50M },
      file: trial.file,
      score: trial.score,
      points: trial.points,
    };
    download(`scentline-trial-${bundle.config.date}-${trial.file.replace(/\.[^.]+$/, '')}.json`, 'application/json', JSON.stringify(record, null, 1));
  };
  return (
    <div className="mt-2 border-t border-rule pt-2">
      <p className="text-xs font-semibold text-ink">Score a training run</p>
      <p className="mt-0.5 text-xs leading-snug text-ink-2">
        Load the dog&apos;s GPS track (GPX) with a waypoint at each alert. Enter the measured wind first.
      </p>
      <label className={`btn btn-sm mt-1.5 w-full justify-center ${enabled ? '' : 'pointer-events-none opacity-50'}`}>
        Import GPX
        <input type="file" accept=".gpx,application/gpx+xml" className="hidden" disabled={!enabled} onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {trial && (
        <div className="mt-1.5 rounded-sm border border-rule bg-card p-2 text-xs leading-snug text-ink-2">
          <div className="flex justify-between">
            <span className="truncate">{trial.file}</span>
            <span className="num">to {fmtTime(trial.t)}</span>
          </div>
          <div className="mt-1">
            {trial.score.nAlerts} alert{trial.score.nAlerts === 1 ? '' : 's'}: model detection{' '}
            <span className="num font-semibold text-ink">{trial.score.meanDetAlert.toFixed(2)}</span> at alerts vs{' '}
            <span className="num">{trial.score.meanDetOther.toFixed(2)}</span> along the rest of the track.
          </div>
          {trial.score.auc !== null && (
            <div className="mt-0.5">
              AUC <span className="num font-semibold text-ink">{trial.score.auc.toFixed(2)}</span> (0.5 = chance, 1 = alerts always where the model expected).
            </div>
          )}
          <button className="mt-1 text-ink-3 underline hover:text-ink" onClick={saveRecord}>
            Save trial record (JSON)
          </button>
        </div>
      )}
    </div>
  );
}
