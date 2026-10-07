/**
 * Field validation: does the model predict where a real dog alerts?
 *
 * A training run gives a known hide (the "person"), the dog's GPS track and the points where it
 * alerted. For every track point the model gives the chance a dog there detects the hide (absolute
 * single-person detection, models/detection.ts). If the model is right, alert points should score
 * higher than the rest of the track. The headline number is the AUC: the probability that a random
 * alert point outscores a random non-alert point (1 = perfect, 0.5 = no better than chance).
 * Pure; GPX parsing has no DOM dependency.
 */

export interface TrackPoint {
  /** local metres (east, north of the frame centre) */
  x: number;
  y: number;
  /** local time of day in hours, if the GPX had timestamps */
  t: number | null;
  alert: boolean;
}

export interface TrialScore {
  nAlerts: number;
  nOther: number;
  meanDetAlert: number;
  meanDetOther: number;
  /** P(det at an alert > det at a non-alert point), ties count half; null without both kinds */
  auc: number | null;
  /** per point, for the trial record */
  points: (TrackPoint & { det: number })[];
}

/** Mann–Whitney AUC of two samples. */
export function auc(pos: number[], neg: number[]): number | null {
  if (pos.length === 0 || neg.length === 0) return null;
  const all = [...pos.map((v) => [v, 1] as const), ...neg.map((v) => [v, 0] as const)].sort((a, b) => a[0] - b[0]);
  // average ranks for ties
  let rankSumPos = 0;
  let k = 0;
  while (k < all.length) {
    let j = k;
    while (j + 1 < all.length && all[j + 1][0] === all[k][0]) j++;
    const rank = (k + j) / 2 + 1;
    for (let q = k; q <= j; q++) if (all[q][1] === 1) rankSumPos += rank;
    k = j + 1;
  }
  return (rankSumPos - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}

/**
 * Score a trial. Track points within `excludeM` of an alert are left out of the comparison (the
 * dog was already working that scent); the alerts themselves are the positives.
 */
export function scoreTrial(points: TrackPoint[], detAt: (p: TrackPoint) => number, excludeM = 30): TrialScore {
  const alerts = points.filter((p) => p.alert);
  const scored = points.map((p) => ({ ...p, det: detAt(p) }));
  const pos: number[] = [];
  const neg: number[] = [];
  for (const p of scored) {
    if (p.alert) pos.push(p.det);
    else if (alerts.every((a) => Math.hypot(a.x - p.x, a.y - p.y) > excludeM)) neg.push(p.det);
  }
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  return { nAlerts: pos.length, nOther: neg.length, meanDetAlert: mean(pos), meanDetOther: mean(neg), auc: auc(pos, neg), points: scored };
}

export interface GpxPoint {
  lat: number;
  lon: number;
  /** UTC milliseconds, if present */
  time: number | null;
  name: string | null;
}

const num = (s: string | undefined) => (s === undefined ? NaN : Number(s));

/** Track points and waypoints from GPX text (regex-based; handles the common GPS-unit output). */
export function parseGpx(text: string): { track: GpxPoint[]; waypoints: GpxPoint[] } {
  const read = (tag: 'trkpt' | 'wpt'): GpxPoint[] => {
    const out: GpxPoint[] = [];
    const re = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const attrs = m[1];
      const lat = num(/\blat\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1]);
      const lon = num(/\blon\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const body = m[2] ?? '';
      const time = /<time>\s*([^<]+?)\s*<\/time>/.exec(body)?.[1];
      const name = /<name>\s*([^<]*?)\s*<\/name>/.exec(body)?.[1] ?? null;
      const ms = time ? Date.parse(time) : NaN;
      out.push({ lat, lon, time: Number.isFinite(ms) ? ms : null, name });
    }
    return out;
  };
  return { track: read('trkpt'), waypoints: read('wpt') };
}

/** Whether a waypoint marks an alert: named like one, or (if none are) every waypoint. */
export function alertWaypoints(wpts: GpxPoint[]): GpxPoint[] {
  const named = wpts.filter((w) => w.name && /alert|indicat|find|found|hit/i.test(w.name));
  return named.length > 0 ? named : wpts;
}

/** UTC ms -> local hour of day (e.g. 18.25), using the area's UTC offset. */
export function localHour(ms: number, utcOffsetSeconds: number): number {
  const d = new Date(ms + utcOffsetSeconds * 1000);
  return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
}

/** Thin a track to roughly one point per `stepM` metres (keeps the first and last). */
export function thinTrack<T extends { x: number; y: number }>(pts: T[], stepM: number): T[] {
  if (pts.length < 3) return pts.slice();
  const out = [pts[0]];
  let last = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    if (Math.hypot(pts[i].x - last.x, pts[i].y - last.y) >= stepM) {
      out.push(pts[i]);
      last = pts[i];
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
