import { useState } from 'react';
import { loadMode } from '../state/controller';
import { useStore } from '../state/store';

const inputCls = 'w-full rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs tabular-nums';

/**
 * Live mode: choose any location (the last known point), the date and the 8-hour window to
 * model, or "now" for a real-time forecast run. The backend downloads terrain, land cover,
 * OSM features and weather for the area and runs WindNinja (about a minute for a new area).
 */
export function AreaPicker() {
  const bundle = useStore((s) => s.bundle);
  const backend = useStore((s) => s.backend);
  const mode = useStore((s) => s.mode);
  const c = bundle?.config;
  const [lat, setLat] = useState(c ? c.lat.toFixed(5) : '');
  const [lon, setLon] = useState(c ? c.lon.toFixed(5) : '');
  const [date, setDate] = useState(c?.date ?? '');
  const [start, setStart] = useState(String(c?.startHour ?? 14));
  const [now, setNow] = useState(false);
  if (!bundle) return null;
  if (!backend.ok) {
    return (
      <p className="text-[11px] leading-snug text-slate-400">
        Choosing another location or today&apos;s weather needs the live backend (<code>docker compose up</code>). The offline demo is fixed to the Catskills scenario.
      </p>
    );
  }
  const latN = Number(lat);
  const lonN = Number(lon);
  const valid = Number.isFinite(latN) && Number.isFinite(lonN) && Math.abs(latN) <= 84 && Math.abs(lonN) <= 180 && (now || /^\d{4}-\d{2}-\d{2}$/.test(date));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        <label className="text-[10px] text-slate-400">
          Latitude
          <input className={inputCls} value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" />
        </label>
        <label className="text-[10px] text-slate-400">
          Longitude
          <input className={inputCls} value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" />
        </label>
        <label className="text-[10px] text-slate-400">
          Date
          <input type="date" className={inputCls} value={date} disabled={now} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-[10px] text-slate-400">
          From hour
          <select className={inputCls} value={start} disabled={now} onChange={(e) => setStart(e.target.value)}>
            {Array.from({ length: 23 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-slate-300">
        <input type="checkbox" checked={now} onChange={(e) => setNow(e.target.checked)} className="accent-amber-400" />
        Today, from the current hour (live forecast)
      </label>
      <button
        className="btn btn-primary text-xs"
        disabled={!valid}
        onClick={() => loadMode('live', { lat: latN, lon: lonN, date, startHour: Number(start), now, detailCenter: null })}
      >
        {mode === 'live' ? 'Load area' : 'Load area (switches to live)'}
      </button>
      <p className="text-[10px] leading-snug text-slate-500">The point becomes the last known point. Models an 8-hour window; a new area takes about a minute.</p>
    </div>
  );
}
