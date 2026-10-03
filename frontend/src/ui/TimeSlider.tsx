import { useMemo } from 'react';
import { TIME } from '../config/modelParams';
import { envAt, scentQuality } from '../models/env';
import { uvToMet } from '../models/wind';
import { fmtTime, setTime } from '../state/controller';
import { useStore } from '../state/store';

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (deg: number) => COMPASS[Math.round(deg / 22.5) % 16];

export function TimeSlider() {
  const bundle = useStore((s) => s.bundle);
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const activeWind = useStore((s) => s.activeWind);
  const set = useStore((s) => s.set);
  const info = useMemo(() => {
    if (!bundle) return null;
    const c = bundle.config;
    const env = envAt({ date: c.date, lat: c.lat, lon: c.lon, utcOffsetSeconds: c.utcOffsetSeconds }, bundle.weather, time);
    let mean = { speed: env.windSpeed * 0.7, dir: env.windDirection };
    if (activeWind) {
      // mean model wind at this time (cheap: sample a sparse lattice)
      const h = Math.max(0, Math.min(activeWind.hours.length - 1, Math.round(time) - activeWind.hours[0]));
      const g = activeWind.grids[h];
      let su = 0;
      let sv = 0;
      let n = 0;
      for (let i = 0; i < g.u.length; i += 97) {
        su += g.u[i];
        sv += g.v[i];
        n++;
      }
      mean = uvToMet(su / n, sv / n);
    }
    return { env, q: scentQuality(env), mean };
  }, [bundle, time, activeWind]);
  if (!bundle || !info) return null;
  const t0 = bundle.config.startHour ?? TIME.start;
  const t1 = bundle.config.endHour ?? TIME.end;
  const { env, q, mean } = info;
  const qCls = q.label === 'Good' ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-400/40' : q.label === 'Fair' ? 'bg-amber-500/20 text-amber-200 ring-amber-400/40' : 'bg-rose-500/20 text-rose-200 ring-rose-400/40';
  const ticks = [];
  for (let h = t0; h <= t1; h++) ticks.push(h);
  const missing = bundle.config.missingAt;
  return (
    <div className="panel pointer-events-auto absolute bottom-4 left-1/2 z-10 w-[min(860px,calc(100vw-32px))] -translate-x-1/2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <button
          className="btn btn-primary w-20"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => {
            if (!playing && time >= t1) setTime(t0);
            set({ playing: !playing });
          }}
        >
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <div className="font-mono text-2xl font-semibold tabular-nums text-white">{fmtTime(time)}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
          <span title="Sun elevation">
            ☀ <b className="tabular-nums">{env.sun.elevation.toFixed(1)}°</b>
          </span>
          <span title="Model wind (domain mean)">
            ➶ <b className="tabular-nums">{mean.speed.toFixed(1)} m/s</b> from {compass(mean.dir)}
          </span>
          <span>
            🌡 {env.temperature.toFixed(0)}°C · RH {env.humidity.toFixed(0)}% · cloud {env.cloudCover.toFixed(0)}%
          </span>
        </div>
        <div className={`ml-auto rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${qCls}`} title={q.reason}>
          Scent: {q.label} <span className="font-normal opacity-80">· {q.reason}</span>
        </div>
      </div>
      <div className="relative mt-2">
        <input
          type="range"
          min={t0}
          max={t1}
          step={TIME.stepMin / 60}
          value={time}
          aria-label="Time of day"
          onChange={(e) => setTime(Number(e.target.value))}
          className="w-full"
        />
        <div className="pointer-events-none relative mt-0.5 h-4 text-[10px] text-slate-500">
          {ticks.map((h) => (
            <span key={h} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${((h - t0) / (t1 - t0)) * 100}%` }}>
              {h}:00
            </span>
          ))}
          {missing >= t0 && (
            <span className="absolute -top-7 -translate-x-1/2 text-[10px] font-semibold text-pink-300" style={{ left: `${((missing - t0) / (t1 - t0)) * 100}%` }}>
              ▼ missing
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
