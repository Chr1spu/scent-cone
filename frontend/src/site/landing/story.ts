/** The scroll story: chapters, their camera shots and clock, and the derived scene layout. */
import { CAMP, HIDE, KID_PATH, R, downhill, height, streamline, wind } from './island';

export type V3 = [number, number, number];

export interface Chapter {
  id: string;
  /** clock (decimal hours) when this chapter is centred */
  hour: number;
  cam: V3;
  target: V3;
  /** short label for the progress rail */
  rail: string;
  /** horizontal framing: + pushes the scene left (card on the right), − pushes it right */
  shift: number;
}

/** Live values shared between the page (writes on scroll) and the scene (reads per frame). */
export const story = {
  /** target progress in chapters (0 = hero), written by scroll */
  goal: 0,
  /** smoothed progress, written by the scene */
  p: 0,
  /** pointer in [-1, 1] for parallax */
  mx: 0,
  my: 0,
};

const at = (x: number, z: number, lift = 0): V3 => [x, height(x, z) + lift, z];

// ------------------------------------------------------------- derived layout

/** The scent plume at dusk: where air from the hiding place drains to. */
export const PLUME = streamline(HIDE.x, HIDE.z, 1, 600, 0.35);

function alongPlume(dist: number): [number, number] {
  let acc = 0;
  for (let i = 1; i < PLUME.length; i++) {
    const [ax, az] = PLUME[i - 1];
    const [bx, bz] = PLUME[i];
    const d = Math.hypot(bx - ax, bz - az);
    if (acc + d >= dist) {
      const t = (dist - acc) / d;
      return [ax + (bx - ax) * t, az + (bz - az) * t];
    }
    acc += d;
  }
  return PLUME[PLUME.length - 1];
}

export interface TeamSpot {
  n: number;
  x: number;
  z: number;
  /** upwind heading (unit, x/z) */
  ux: number;
  uz: number;
  /** where the team waits at camp */
  cx: number;
  cz: number;
  window: string;
  covers: string;
}

/** Teams sit downwind of the hiding place, just off the plume axis, heading upwind. */
export const TEAMS: TeamSpot[] = [
  { d: 34, side: 7, window: '19:00–20:00', covers: '31%' },
  { d: 62, side: -8, window: '18:30–19:30', covers: '22%' },
  { d: 96, side: 8, window: '19:00–20:00', covers: '14%' },
].map((t, i) => {
  const [x0, z0] = alongPlume(t.d);
  const [wx, wz] = wind(x0, z0, 1);
  const m = Math.hypot(wx, wz) || 1;
  // step sideways off the drainage line so the team stands on the bank
  const x = x0 + (-wz / m) * t.side;
  const z = z0 + (wx / m) * t.side;
  return { n: i + 1, x, z, ux: -wx / m, uz: -wz / m, cx: CAMP.x - 6 + i * 4.5, cz: CAMP.z + 7 - i * 1.5, window: t.window, covers: t.covers };
});

/** The first team's dog alerts; the back-trace is the plume from the hiding place to that team. */
export const ALERT_TEAM = TEAMS[0];
export const BACKTRACE: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (const p of PLUME) {
    out.push(p);
    if (Math.hypot(p[0] - ALERT_TEAM.x, p[1] - ALERT_TEAM.z) < 9) break;
  }
  out.push([ALERT_TEAM.x, ALERT_TEAM.z]);
  return out;
})();

const tc = TEAMS.reduce((s, t) => [s[0] + t.x / 3, s[1] + t.z / 3], [0, 0]);
// frame the alert closer to the hiding place than to the team
const am: [number, number] = [HIDE.x * 0.6 + ALERT_TEAM.x * 0.4, HIDE.z * 0.6 + ALERT_TEAM.z * 0.4];

// ------------------------------------------------------------- chapters

export const CHAPTERS: Chapter[] = [
  { id: 'hero', hour: 16.0, cam: [150, 150, 250], target: [-62, -14, 22], rail: 'Overview', shift: 0 },
  { id: 'lkp', hour: 16.35, cam: [CAMP.x + 38, height(CAMP.x, CAMP.z) + 34, CAMP.z + 58], target: at(CAMP.x - 22, CAMP.z - 18, 0), rail: 'Last seen', shift: -0.16 },
  { id: 'wind', hour: 17.2, cam: [-158, 70, 70], target: [6, 6, -6], rail: 'Wind', shift: 0.14 },
  { id: 'scent', hour: 18.55, cam: [-66, 82, 128], target: at(-6, 6, 2), rail: 'Scent', shift: -0.14 },
  { id: 'teams', hour: 19.0, cam: [tc[0] + 52, height(tc[0], tc[1]) + 46, tc[1] + 70], target: at(tc[0], tc[1], 0), rail: 'Deploy', shift: 0.17 },
  { id: 'alert', hour: 19.25, cam: [am[0] + 30, height(am[0], am[1]) + 48, am[1] + 66], target: at(am[0], am[1], 1), rail: 'Alert', shift: 0.2 },
  { id: 'outro', hour: 19.75, cam: [10, 250, 215], target: [0, -6, 10], rail: 'Plan', shift: 0 },
];

export const CH = Object.fromEntries(CHAPTERS.map((c, i) => [c.id, i])) as Record<string, number>;

export function hourAt(p: number): number {
  const i = Math.max(0, Math.min(CHAPTERS.length - 2, Math.floor(p)));
  const t = Math.max(0, Math.min(1, p - i));
  return CHAPTERS[i].hour + (CHAPTERS[i + 1].hour - CHAPTERS[i].hour) * t;
}

export function fmtClock(h: number): string {
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const ISLAND_R = R;
export { CAMP, HIDE, KID_PATH, downhill };
