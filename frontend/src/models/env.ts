/** Time-varying environment: interpolated weather and sun position. */
import * as SunCalc from 'suncalc';
import { SCENT } from '../config/modelParams';
import { TUNING } from './tuning';

export interface WeatherHour {
  hour: number;
  temperature: number;
  humidity: number;
  cloudCover: number;
  windSpeed: number;
  windDirection: number;
}

export interface Weather {
  utcOffsetSeconds: number;
  hours: WeatherHour[];
  source?: string;
}

export interface SunState {
  /** degrees above horizon */
  elevation: number;
  /** degrees clockwise from north */
  azimuth: number;
  /** unit vector (east, north, up) toward the sun */
  dir: [number, number, number];
}

export interface Env {
  t: number;
  temperature: number;
  humidity: number;
  cloudCover: number;
  windSpeed: number;
  windDirection: number;
  sun: SunState;
}

export interface Place {
  date: string; // YYYY-MM-DD local
  lat: number;
  lon: number;
  utcOffsetSeconds: number;
}

export function localToDate(date: string, hour: number, utcOffsetSeconds: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + hour * 3600e3 - utcOffsetSeconds * 1000);
}

export function sunAt(place: Place, hour: number): SunState {
  const p = SunCalc.getPosition(localToDate(place.date, hour, place.utcOffsetSeconds), place.lat, place.lon);
  // suncalc >= 2: altitude and azimuth in degrees, azimuth clockwise from north
  const az = (p.azimuth + 360) % 360;
  const el = p.altitude;
  const er = (el * Math.PI) / 180;
  const ar = (az * Math.PI) / 180;
  return { elevation: el, azimuth: az, dir: [Math.cos(er) * Math.sin(ar), Math.cos(er) * Math.cos(ar), Math.sin(er)] };
}

function lerpAngle(a: number, b: number, w: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * w + 360) % 360;
}

export function weatherAt(weather: Weather, t: number): Omit<Env, 't' | 'sun'> {
  const hs = weather.hours;
  // hours may continue past 23 (windows that cross midnight)
  const last = hs.length ? hs[hs.length - 1].hour : 23;
  const h0 = Math.max(0, Math.min(last, Math.floor(t)));
  const h1 = Math.min(last, h0 + 1);
  const a = hs.find((h) => h.hour === h0) ?? hs[0];
  const b = hs.find((h) => h.hour === h1) ?? a;
  const w = Math.min(Math.max(t - h0, 0), 1);
  const L = (x: number, y: number) => x + (y - x) * w;
  return {
    temperature: L(a.temperature, b.temperature),
    humidity: L(a.humidity, b.humidity),
    cloudCover: L(a.cloudCover, b.cloudCover),
    windSpeed: L(a.windSpeed, b.windSpeed),
    windDirection: lerpAngle(a.windDirection, b.windDirection, w),
  };
}

export function envAt(place: Place, weather: Weather, t: number): Env {
  return { t, ...weatherAt(weather, t), sun: sunAt(place, t) };
}

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

/** Scent decay time constant (s) for shaded / sunlit cells, CLAUDE.md §8.3. */
export function decayTau(env: Pick<Env, 'humidity' | 'temperature'>, sunlitHigh: boolean): number {
  const humidityFactor = clamp(0.5 + env.humidity / 100, 0.6, 1.4);
  const tempFactor = clamp(1.4 - (env.temperature - 10) / 40, 0.6, 1.4);
  const sunFactor = sunlitHigh ? SCENT.sunFactor : 1;
  return SCENT.baseTauS * humidityFactor * tempFactor * sunFactor * TUNING.tauScale;
}

/**
 * Pasquill stability class as a number (A = 0 very unstable … F = 5 stable; halves are the
 * table's in-between classes), from the 10 m wind, sun elevation and cloud cover (Turner's
 * method, simplified). Day: stronger sun and lighter wind = more convective mixing. Night: clear
 * skies and light wind = a stable surface layer. Overcast skies are neutral (D) day and night.
 */
export function stabilityClass(env: Pick<Env, 'windSpeed' | 'cloudCover' | 'sun'>): number {
  const u = env.windSpeed;
  const cloud = env.cloudCover;
  if (cloud >= 90) return 3; // overcast
  const row = u < 2 ? 0 : u < 3 ? 1 : u < 5 ? 2 : u < 6 ? 3 : 4;
  if (env.sun.elevation > 0) {
    // insolation: 0 strong, 1 moderate, 2 slight (low sun or broken cloud drop a step)
    let ins = env.sun.elevation > 60 ? 0 : env.sun.elevation > 35 ? 1 : 2;
    if (cloud > 50) ins = Math.min(2, ins + 1);
    if (env.sun.elevation < 15) return Math.max(2, [2, 2.5, 3][ins]); // weak sun: near neutral
    const DAY = [
      [0, 0.5, 1], // < 2 m/s
      [0.5, 1, 2], // 2-3
      [1, 1.5, 2], // 3-5
      [2, 2.5, 3], // 5-6
      [2, 3, 3], // > 6
    ];
    return DAY[row][ins];
  }
  const cloudy = cloud >= 50;
  const NIGHT = [
    [5, 5], // < 2 m/s: stable (the table leaves it blank; F is the usual choice)
    [4, 5], // 2-3
    [3, 4], // 3-5
    [3, 3], // 5-6
    [3, 3], // > 6
  ];
  return NIGHT[row][cloudy ? 0 : 1];
}

/** Near-field σy/x for a (possibly in-between) stability class, interpolated between classes. */
export function meanderCoef(cls: number, table: Record<string, number>): number {
  const keys = ['A', 'B', 'C', 'D', 'E', 'F'];
  const lo = Math.max(0, Math.min(5, Math.floor(cls)));
  const hi = Math.min(5, lo + 1);
  const w = cls - lo;
  return Math.exp((1 - w) * Math.log(table[keys[lo]]) + w * Math.log(table[keys[hi]]));
}

/** Human-readable scent conditions for the slider readout. */
export function scentQuality(env: Env): { label: 'Good' | 'Fair' | 'Poor'; score: number; reason: string } {
  const sunHigh = env.sun.elevation > SCENT.sunHighElev;
  const tau = decayTau(env, sunHigh && env.cloudCover < 70);
  let score = tau / SCENT.baseTauS; // ~0.4 .. 2
  const lofting = env.sun.elevation > 10 && env.cloudCover < 60;
  if (lofting) score *= 0.75;
  if (env.windSpeed > 8) score *= 0.8;
  if (env.sun.elevation < 0) score *= 1.15; // evening: stable air, scent pools
  const label = score > 1.2 ? 'Good' : score > 0.8 ? 'Fair' : 'Poor';
  const reason =
    env.sun.elevation < 0
      ? 'stable evening air, scent pools in drainages'
      : lofting
        ? 'sun-heated slopes loft scent upward'
        : env.humidity > 70
          ? 'humid air holds scent'
          : 'moderate conditions';
  return { label, score, reason };
}
