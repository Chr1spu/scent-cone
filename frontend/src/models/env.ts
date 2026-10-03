/** Time-varying environment: interpolated weather and sun position. */
import SunCalc from 'suncalc';
import { SCENT } from '../config/modelParams';

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
  // suncalc azimuth: radians from south, positive toward west
  const az = ((p.azimuth * 180) / Math.PI + 180 + 360) % 360;
  const el = (p.altitude * 180) / Math.PI;
  const er = p.altitude;
  const ar = (az * Math.PI) / 180;
  return { elevation: el, azimuth: az, dir: [Math.cos(er) * Math.sin(ar), Math.cos(er) * Math.cos(ar), Math.sin(er)] };
}

function lerpAngle(a: number, b: number, w: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * w + 360) % 360;
}

export function weatherAt(weather: Weather, t: number): Omit<Env, 't' | 'sun'> {
  const hs = weather.hours;
  const h0 = Math.max(0, Math.min(23, Math.floor(t)));
  const h1 = Math.min(23, h0 + 1);
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
  return SCENT.baseTauS * humidityFactor * tempFactor * sunFactor;
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
