import { finishPolygon, fmtTime } from '../state/controller';
import { useStore } from '../state/store';

const WINDOWS = [30, 60, 90, 120];

/** Settings for "mark searched": circle or polygon, and how long the team searched. */
export function SearchOptions() {
  const draft = useStore((s) => s.searchDraft);
  const time = useStore((s) => s.time);
  const start = useStore((s) => s.bundle?.config.startHour ?? 14);
  const set = useStore((s) => s.set);
  const upd = (p: Partial<typeof draft>) => set({ searchDraft: { ...draft, ...p } });
  const t0 = Math.max(start, time - draft.windowMin / 60);
  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded-md bg-white/5 p-2 text-xs">
      <div className="flex gap-1">
        <button className={`btn flex-1 !py-0.5 text-xs ${draft.shape === 'circle' ? 'btn-active' : ''}`} onClick={() => upd({ shape: 'circle', pts: [] })}>
          Circle
        </button>
        <button className={`btn flex-1 !py-0.5 text-xs ${draft.shape === 'polygon' ? 'btn-active' : ''}`} onClick={() => upd({ shape: 'polygon', pts: [] })}>
          Polygon
        </button>
      </div>
      {draft.shape === 'circle' ? (
        <label className="flex items-center gap-2 text-slate-300">
          Radius
          <input
            type="number"
            min={30}
            max={800}
            step={10}
            value={draft.radius}
            onChange={(e) => upd({ radius: Math.min(800, Math.max(30, Number(e.target.value) || 150)) })}
            className="w-16 rounded-md border border-white/10 bg-ink-800 px-2 py-0.5"
          />
          m · click the terrain
        </label>
      ) : (
        <div className="flex items-center gap-1.5 text-slate-300">
          <span className="flex-1">{draft.pts.length} points · click to add, click the first point or Enter to finish</span>
          <button className="btn !px-2 !py-0.5 text-xs" disabled={draft.pts.length === 0} onClick={() => upd({ pts: draft.pts.slice(0, -1) })}>
            Undo
          </button>
          <button className="btn btn-primary !px-2 !py-0.5 text-xs" disabled={draft.pts.length < 3} onClick={finishPolygon}>
            Finish
          </button>
        </div>
      )}
      <label className="flex items-center gap-2 text-slate-300">
        Searched for
        <select
          value={draft.windowMin}
          onChange={(e) => upd({ windowMin: Number(e.target.value) })}
          className="rounded-md border border-white/10 bg-ink-800 px-1.5 py-0.5"
        >
          {WINDOWS.map((w) => (
            <option key={w} value={w}>
              {w} min
            </option>
          ))}
        </select>
        <span className="text-slate-400">
          {fmtTime(t0)}–{fmtTime(time)}
        </span>
      </label>
      <p className="text-[10px] text-slate-500">The window ends at the slider time; move the slider to when the team finished.</p>
    </div>
  );
}
