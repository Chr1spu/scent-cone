/**
 * How far to trust the modelled wind direction around the search area at a given time.
 * Direction errors over ~30° wipe out the benefit of scent-based placement (docs/EVALUATION.md),
 * and they are most likely when the wind is light, when two independent wind models disagree, or
 * when the wind is turning (the evening downslope transition). Heuristic thresholds in
 * WIND_CONFIDENCE; pure, no React/three.
 */
import { WIND_CONFIDENCE } from '../config/modelParams';
import type { GridMap } from '../geo/grid';
import { sampleWind, type WindField } from './wind';

export type ConfidenceLevel = 'good' | 'fair' | 'poor';

export interface WindConfidence {
  level: ConfidenceLevel;
  /** mean 2 m wind speed over the sample points (m/s) */
  speed: number;
  /** mean direction difference between the two wind models (degrees), null with one model */
  disagreeDeg: number | null;
  /** change in mean direction between t − 1 h and t + 1 h (degrees) */
  turnDeg: number;
  reasons: string[];
}

const DEG = 180 / Math.PI;

/** Smallest angle between two vectors (degrees, 0–180). */
export function angleBetween(u1: number, v1: number, u2: number, v2: number): number {
  const d = Math.abs(Math.atan2(u1 * v2 - v1 * u2, u1 * u2 + v1 * v2)) * DEG;
  return Number.isFinite(d) ? d : 0;
}

function meanVector(field: WindField, map: GridMap, pts: [number, number][], t: number): { u: number; v: number; speed: number } {
  let u = 0;
  let v = 0;
  let s = 0;
  for (const [x, y] of pts) {
    const w = sampleWind(field, map, x, y, t);
    u += w.u;
    v += w.v;
    s += Math.hypot(w.u, w.v);
  }
  const n = pts.length || 1;
  return { u: u / n, v: v / n, speed: s / n };
}

export function windConfidence(field: WindField, alt: WindField | null, map: GridMap, pts: [number, number][], t: number): WindConfidence {
  const P = WIND_CONFIDENCE;
  const now = meanVector(field, map, pts, t);
  const lo = field.hours[0];
  const hi = field.hours[field.hours.length - 1];
  const before = meanVector(field, map, pts, Math.max(lo, t - 1));
  const after = meanVector(field, map, pts, Math.min(hi, t + 1));
  const turnDeg = Math.hypot(before.u, before.v) > 0.05 && Math.hypot(after.u, after.v) > 0.05 ? angleBetween(before.u, before.v, after.u, after.v) : 0;

  let disagreeDeg: number | null = null;
  if (alt) {
    let sum = 0;
    let n = 0;
    for (const [x, y] of pts) {
      const a = sampleWind(field, map, x, y, t);
      const b = sampleWind(alt, map, x, y, t);
      if (Math.hypot(a.u, a.v) < P.minSpeedForDirection || Math.hypot(b.u, b.v) < P.minSpeedForDirection) continue;
      sum += angleBetween(a.u, a.v, b.u, b.v);
      n++;
    }
    disagreeDeg = n > 0 ? sum / n : null;
  }

  const reasons: string[] = [];
  let score = 0; // 0 good, 1 fair, 2 poor
  const rate = (v: number, fair: number, poor: number, higherIsWorse: boolean, why: string) => {
    const s = higherIsWorse ? (v >= poor ? 2 : v >= fair ? 1 : 0) : v <= poor ? 2 : v <= fair ? 1 : 0;
    if (s > 0) reasons.push(why);
    score = Math.max(score, s);
  };
  rate(now.speed, P.fairSpeed, P.poorSpeed, false, `light wind (${now.speed.toFixed(1)} m/s): its direction wanders`);
  if (disagreeDeg !== null) rate(disagreeDeg, P.fairDisagreeDeg, P.poorDisagreeDeg, true, `the two wind models differ by ${Math.round(disagreeDeg)}°`);
  rate(turnDeg, P.fairTurnDeg, P.poorTurnDeg, true, `the wind turns ${Math.round(turnDeg)}° within an hour either side`);
  return { level: (['good', 'fair', 'poor'] as const)[score], speed: now.speed, disagreeDeg, turnDeg, reasons };
}

/** Sample points on a square grid around a centre, kept inside the grid. */
export function samplePoints(map: GridMap, cx: number, cy: number, halfM = WIND_CONFIDENCE.radiusM, n = 9): [number, number][] {
  const out: [number, number][] = [];
  const hx = ((map.cols - 1) / 2 / map.inv) * 0.98;
  const hy = ((map.rows - 1) / 2 / map.inv) * 0.98;
  // grid centre in local coordinates
  const gx = ((map.cols - 1) / 2 - map.ox) / map.inv;
  const gy = -((map.rows - 1) / 2 - map.oy) / map.inv;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x = Math.min(Math.max(cx - halfM + (2 * halfM * i) / (n - 1), gx - hx), gx + hx);
      const y = Math.min(Math.max(cy - halfM + (2 * halfM * j) / (n - 1), gy - hy), gy + hy);
      out.push([x, y]);
    }
  return out;
}
