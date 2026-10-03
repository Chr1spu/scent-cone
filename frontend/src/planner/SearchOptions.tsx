import { finishPolygon, fmtTime } from '../state/controller';
import { useStore } from '../state/store';

const WINDOWS = [30, 60, 90, 120];

/** Settings for "searched, no alert": circle or polygon, and how long the team searched. */
export function SearchOptions() {
  const draft = useStore((s) => s.searchDraft);
  const time = useStore((s) => s.time);
  const start = useStore((s) => s.bundle?.config.startHour ?? 14);
  const set = useStore((s) => s.set);
  const upd = (p: Partial<typeof draft>) => set({ searchDraft: { ...draft, ...p } });
  const t0 = Math.max(start, time - draft.windowMin / 60);
  return (
    <div className="mt-2 space-y-2 rounded-sm border border-rule bg-white p-2 text-[13px]">
      <div className="flex overflow-hidden rounded border border-rule">
        {(['circle', 'polygon'] as const).map((shape, i) => (
          <button
            key={shape}
            className={`flex-1 py-1 text-xs font-medium ${i ? 'border-l border-rule' : ''} ${draft.shape === shape ? 'bg-ink text-paper' : 'bg-paper text-ink-2'}`}
            onClick={() => upd({ shape, pts: [] })}
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
            max={800}
            step={10}
            value={draft.radius}
            onChange={(e) => upd({ radius: Math.min(800, Math.max(30, Number(e.target.value) || 150)) })}
            className="field !w-16 !py-0.5"
          />
          m, then click the map
        </label>
      ) : (
        <div className="flex items-center gap-1.5 text-ink-2">
          <span className="flex-1">{draft.pts.length} corners. Click the map; Enter or the first corner closes it.</span>
          <button className="btn btn-sm" disabled={draft.pts.length === 0} onClick={() => upd({ pts: draft.pts.slice(0, -1) })}>
            Undo
          </button>
          <button className="btn btn-primary btn-sm" disabled={draft.pts.length < 3} onClick={finishPolygon}>
            Finish
          </button>
        </div>
      )}
      <label className="flex items-center gap-2 text-ink-2">
        For
        <select value={draft.windowMin} onChange={(e) => upd({ windowMin: Number(e.target.value) })} className="field !w-auto !py-0.5">
          {WINDOWS.map((w) => (
            <option key={w} value={w}>
              {w} min
            </option>
          ))}
        </select>
        <span className="num text-ink-3">
          {fmtTime(t0)} to {fmtTime(time)}
        </span>
      </label>
      <p className="text-[11px] leading-snug text-ink-3">The window ends at the time on the time bar.</p>
    </div>
  );
}
