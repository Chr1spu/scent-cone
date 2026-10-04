import { useEffect, useMemo, useState } from 'react';
import { TIME } from '../config/modelParams';
import { envAt, scentQuality } from '../models/env';
import { uvToMet } from '../models/wind';
import { fmtTime, nowHourIn, setTime } from '../state/controller';
import { useStore } from '../state/store';
import { Icon } from '../ui/icons';

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (deg: number) => COMPASS[Math.round(deg / 22.5) % 16];

/** The real current time in the area (decimal hours from its start date), refreshed every 30 s. */
function useNowHour(c: { date: string; utcOffsetSeconds: number } | undefined) {
  const [now, setNow] = useState<number | null>(() => (c ? nowHourIn(c) : null));
  useEffect(() => {
    if (!c) return;
    setNow(nowHourIn(c));
    const id = setInterval(() => setNow(nowHourIn(c)), 30e3);
    return () => clearInterval(id);
  }, [c]);
  return now;
}

/** Docked time bar: play, the clock, conditions, and the model's scent rating. */
export function TimeBar() {
  const bundle = useStore((s) => s.bundle);
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const activeWind = useStore((s) => s.activeWind);
  const heat = useStore((s) => s.heat);
  const set = useStore((s) => s.set);
  const nowH = useNowHour(bundle?.config);
  const info = useMemo(() => {
    if (!bundle) return null;
    const c = bundle.config;
    const env = envAt({ date: c.date, lat: c.lat, lon: c.lon, utcOffsetSeconds: c.utcOffsetSeconds }, bundle.weather, time);
    let mean = { speed: env.windSpeed * 0.7, dir: env.windDirection };
    if (activeWind) {
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
  const { env, mean } = info;
  const model = heat && Math.abs(heat.t - time) < 1e-6 ? heat.relStrength : null;
  const label = model !== null ? (model > 0.8 ? 'Good' : model > 0.55 ? 'Fair' : 'Poor') : info.q.label;
  const detail = model !== null ? `${Math.round(model * 100)}% of neutral` : info.q.reason;
  const tone = label === 'Good' ? 'text-forest' : label === 'Fair' ? 'text-amber' : 'text-sar-dark';
  const ticks: number[] = [];
  for (let h = t0; h <= t1; h++) ticks.push(h);
  const missing = bundle.config.missingAt;
  const nowIn = nowH !== null && nowH >= t0 && nowH <= t1 ? nowH : null;
  const pos = (h: number) => `${((h - t0) / (t1 - t0)) * 100}%`;
  const tz = bundle.config.timezone;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-rule bg-paper px-3 py-2">
      <button
        className="btn btn-primary !h-10 !w-10 !rounded-full !p-0"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={() => {
          if (!playing && time >= t1) setTime(t0);
          set({ playing: !playing });
        }}
      >
        {playing ? <Icon.Pause /> : <Icon.Play />}
      </button>
      <div className="num w-[68px] text-2xl font-medium leading-none text-ink">{fmtTime(time)}</div>
      <div className="relative min-w-[200px] flex-1">
        <div className="pointer-events-none mb-0.5 flex justify-between text-[10px] text-ink-3">
          <span>
            Forecast window {fmtTime(t0)}–{fmtTime(t1)} · local time{tz ? ` (${tz.replace(/_/g, ' ')})` : ''}
          </span>
          <span className="hidden sm:inline">Drag to see conditions and scent at any hour</span>
        </div>
        {nowIn !== null && (
          <button
            className="absolute top-3 z-10 h-[22px] w-[2px] -translate-x-1/2 bg-forest"
            style={{ left: pos(nowIn) }}
            title={`Now (${fmtTime(nowIn)}): jump to the current time`}
            aria-label="Jump to the current time"
            onClick={() => setTime(Math.floor(nowIn * 4) / 4)}
          >
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm bg-forest px-1 text-[9px] font-semibold uppercase leading-[12px] text-ink-950">now</span>
          </button>
        )}
        <input type="range" min={t0} max={t1} step={TIME.stepMin / 60} value={time} aria-label="Time of day" onChange={(e) => setTime(Number(e.target.value))} className="w-full" />
        <div className="pointer-events-none relative h-3.5 text-[10px] text-ink-3">
          {ticks.map((h) => (
            <span key={h} className={`num absolute -translate-x-1/2 ${h % 24 === 0 && h > 0 ? 'font-semibold text-ink' : ''}`} style={{ left: `${((h - t0) / (t1 - t0)) * 100}%` }} title={h >= 24 ? 'next day' : undefined}>
              {h % 24}
            </span>
          ))}
          {missing > t0 && missing < t1 && (
            <span className="absolute top-0 hidden -translate-x-1/2 whitespace-nowrap pl-6 text-[10px] font-semibold text-[#ff4fa3] sm:inline" style={{ left: `${((missing - t0) / (t1 - t0)) * 100}%` }}>
              ▲ missing
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 text-[13px] text-ink-2">
        <span className="flex items-center gap-1" title="Sun elevation">
          <Icon.Sun size={14} />
          <span className="num">{env.sun.elevation.toFixed(0)}°</span>
        </span>
        <span className="flex items-center gap-1" title="Average model wind at 2 m">
          <Icon.Wind size={14} />
          <span className="num">{mean.speed.toFixed(1)}</span> m/s {compass(mean.dir)}
        </span>
        <span className="hidden items-center gap-1 lg:flex" title="Temperature and humidity">
          <Icon.Thermo size={14} />
          <span className="num">{env.temperature.toFixed(0)}°C</span>, <span className="num">{env.humidity.toFixed(0)}%</span>
        </span>
      </div>
      <div className="text-[13px]" title={info.q.reason}>
        Scent: <strong className={tone}>{label}</strong> <span className="hidden text-ink-3 sm:inline">({detail})</span>
      </div>
    </div>
  );
}
