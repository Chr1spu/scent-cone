/**
 * The landing-page diorama: a low-poly island with a valley, a stream, a campsite bench and a
 * hidden child upslope. Pure functions (no React / three imports) so the scene, the scatter and
 * the scent "physics" all agree on one height field and one wind field.
 * Units are metres-ish; x = east, z = south (three.js), y = up.
 */

export const R = 110; // island radius
export const RINGS = 34; // terrain rings (facet size ≈ R / RINGS)
export const BASE_Y = -18; // bottom of the earth skirt

export const CAMP = { x: 34, z: 30 };
export const HIDE = { x: -38, z: -26 };

/** The child's route from the tent to the hiding place (kept clear of trees). */
export const KID_PATH: [number, number][] = [
  [CAMP.x - 3, CAMP.z - 2],
  [CAMP.x - 14, CAMP.z - 9],
  [16, 10],
  [3, 0],
  [-12, -9],
  [-26, -17],
  [HIDE.x + 2.5, HIDE.z + 1.5],
];
function distToPath(x: number, z: number): number {
  let best = Infinity;
  for (let i = 1; i < KID_PATH.length; i++) {
    const [ax, az] = KID_PATH[i - 1];
    const [bx, bz] = KID_PATH[i];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}

// --------------------------------------------------------------- noise

function hash(ix: number, iz: number, seed = 0): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const fade = (t: number) => t * t * (3 - 2 * t);
function vnoise(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
export function fbm(x: number, z: number, seed = 0): number {
  return 0.55 * vnoise(x, z, seed) + 0.3 * vnoise(x * 2.03, z * 2.03, seed + 7) + 0.15 * vnoise(x * 4.1, z * 4.1, seed + 13);
}
export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Seeded RNG (mulberry32). */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --------------------------------------------------------------- height field

/** Valley centre line (x as a function of z): the stream runs from the back ridge to the front. */
export const valleyX = (z: number) => 16 * Math.sin(z / 36) - 0.2 * z + 6;

function baseHeight(x: number, z: number): number {
  const d = x - valleyX(z);
  let h = 6 - 0.1 * z; // the whole block tilts down toward the viewer
  h += 17 * (1 - Math.exp(-((d / 36) ** 2))); // valley walls
  h -= 5 * Math.exp(-((d / 8) ** 2)); // stream channel
  h += 11 * fbm(x / 44 + 3.1, z / 44 - 1.7) - 4;
  h += 9 * Math.max(0, fbm(x / 22, z / 22, 3) - 0.55) * 2; // crags on the ridges
  return h;
}
const CAMP_H = baseHeight(CAMP.x, CAMP.z) - 0.5;

export function height(x: number, z: number): number {
  let h = baseHeight(x, z);
  const w = smoothstep(17, 8, Math.hypot(x - CAMP.x, z - CAMP.z));
  h = h * (1 - w) + CAMP_H * w;
  // soften the rim so the skirt edge reads clean
  const r = Math.hypot(x, z) / R;
  h -= 4 * smoothstep(0.86, 1, r);
  return h;
}

/** Downhill vector (−∇h), not normalised. */
export function downhill(x: number, z: number): [number, number] {
  const e = 1.5;
  return [-(height(x + e, z) - height(x - e, z)) / (2 * e), -(height(x, z + e) - height(x, z - e)) / (2 * e)];
}

export const isStream = (x: number, z: number) => Math.abs(x - valleyX(z)) < 3.4 && Math.hypot(x, z) < R * 0.97;
export const inCamp = (x: number, z: number) => Math.hypot(x - CAMP.x, z - CAMP.z) < 10;

// --------------------------------------------------------------- wind (the same story the planner tells)

/**
 * Wind at (x, z) for a dusk factor u (0 = mid-afternoon, 1 = after sunset), given the downhill
 * vector there. Afternoon: a westerly breeze plus a weak upslope pull. Evening: the breeze dies,
 * cool air drains downhill and, once in the valley, flows down it toward the front of the island.
 */
export function windFromGrad(x: number, z: number, gx: number, gz: number, u: number, out: [number, number]): [number, number] {
  const g = Math.hypot(gx, gz) + 1e-6;
  const slope = Math.min(1, g * 2.2);
  const k = -0.9 * (1 - u) + 3.0 * u; // upslope by day, drainage at dusk
  // down-valley flow near the stream
  const d = x - valleyX(z);
  const ch = Math.exp(-((d / 16) ** 2)) * 1.8 * u;
  const dxdz = (16 / 36) * Math.cos(z / 36) - 0.2;
  const vl = Math.hypot(dxdz, 1);
  out[0] = 2.4 * (1 - u) + 0.15 * u + (k * slope * gx) / g + (ch * dxdz) / vl;
  out[1] = -0.5 * (1 - u) + 0.3 * u + (k * slope * gz) / g + ch / vl;
  return out;
}

export function wind(x: number, z: number, u: number): [number, number] {
  const [gx, gz] = downhill(x, z);
  return windFromGrad(x, z, gx, gz, u, [0, 0]);
}

/** Streamline from a point following the wind (or against it with dir = −1). */
export function streamline(x: number, z: number, u: number, steps: number, dt: number, dir = 1): [number, number][] {
  const pts: [number, number][] = [[x, z]];
  for (let i = 0; i < steps; i++) {
    const [wx, wz] = wind(x, z, u);
    x += dir * wx * dt;
    z += dir * wz * dt;
    if (Math.hypot(x, z) > R * 0.95) break;
    pts.push([x, z]);
  }
  return pts;
}

// --------------------------------------------------------------- mesh

const C = {
  meadow: [0.56, 0.66, 0.33],
  grass: [0.42, 0.58, 0.29],
  forest: [0.27, 0.43, 0.24],
  high: [0.36, 0.45, 0.3],
  rock: [0.55, 0.53, 0.49],
  rockDark: [0.42, 0.41, 0.39],
  stream: [0.3, 0.6, 0.78],
  bank: [0.66, 0.6, 0.44],
  camp: [0.71, 0.6, 0.41],
  lip: [0.3, 0.45, 0.24],
  soil: [0.42, 0.29, 0.19],
  soilDark: [0.3, 0.21, 0.15],
  stone: [0.36, 0.33, 0.31],
};

export interface IslandMesh {
  positions: Float32Array;
  colors: Float32Array;
}

function faceColor(cx: number, cy: number, cz: number, slope: number, j: number): number[] {
  let c: number[];
  if (isStream(cx, cz)) c = C.stream;
  else if (Math.abs(cx - valleyX(cz)) < 5.5) c = C.bank;
  else if (inCamp(cx, cz)) c = C.camp;
  else if (slope > 0.62) c = slope > 0.85 ? C.rockDark : C.rock;
  else if (cy > 20) c = C.high;
  else if (cy > 9) c = C.forest;
  else if (cy > 3) c = C.grass;
  else c = C.meadow;
  return c.map((v) => v * (0.93 + 0.14 * j));
}

/** Concentric-ring disk triangulation, displaced by the height field, with an earth skirt. */
export function buildIsland(seed = 7): IslandMesh {
  const rand = rng(seed);
  const rings: { x: number; z: number; a: number }[][] = [[{ x: 0, z: 0, a: 0 }]];
  for (let k = 1; k <= RINGS; k++) {
    const n = 6 * k;
    const ring: { x: number; z: number; a: number }[] = [];
    const off = rand() * 0.5;
    for (let i = 0; i < n; i++) {
      const edge = k === RINGS;
      const a = ((i + off + (edge ? 0 : (rand() - 0.5) * 0.45)) / n) * Math.PI * 2;
      const r = (k + (edge ? 0 : (rand() - 0.5) * 0.4)) * (R / RINGS);
      ring.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, a: a % (Math.PI * 2) });
    }
    rings.push(ring);
  }
  const pos: number[] = [];
  const col: number[] = [];
  const tri = (p: { x: number; z: number }, q: { x: number; z: number }, s: { x: number; z: number }) => {
    const ys = [height(p.x, p.z), height(q.x, q.z), height(s.x, s.z)];
    const v = [
      [p.x, ys[0], p.z],
      [q.x, ys[1], q.z],
      [s.x, ys[2], s.z],
    ];
    // normal (for winding + slope)
    const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2];
    const wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    if (ny < 0) {
      [v[1], v[2]] = [v[2], v[1]];
      nx = -nx; ny = -ny; nz = -nz;
    }
    const slope = 1 - ny / Math.hypot(nx, ny, nz);
    const cx = (v[0][0] + v[1][0] + v[2][0]) / 3;
    const cy = (v[0][1] + v[1][1] + v[2][1]) / 3;
    const cz = (v[0][2] + v[1][2] + v[2][2]) / 3;
    const c = faceColor(cx, cy, cz, slope * 2.2, rand());
    for (const p3 of v) {
      pos.push(p3[0], p3[1], p3[2]);
      col.push(c[0], c[1], c[2]);
    }
  };
  // centre fan
  const r1 = rings[1];
  for (let i = 0; i < r1.length; i++) tri(rings[0][0], r1[i], r1[(i + 1) % r1.length]);
  // stitch neighbouring rings by angle
  for (let k = 1; k < RINGS; k++) {
    const A = [...rings[k]].sort((p, q) => p.a - q.a);
    const B = [...rings[k + 1]].sort((p, q) => p.a - q.a);
    let i = 0;
    let j = 0;
    const n = A.length;
    const m = B.length;
    const ang = (arr: { a: number }[], idx: number, len: number) => arr[idx % len].a + Math.floor(idx / len) * Math.PI * 2;
    // align starts
    while (i < n || j < m) {
      const nextA = ang(A, i + 1, n);
      const nextB = ang(B, j + 1, m);
      if (j < m && (i >= n || nextB <= nextA)) {
        tri(A[i % n], B[j % m], B[(j + 1) % m]);
        j++;
      } else {
        tri(A[i % n], B[j % m], A[(i + 1) % n]);
        i++;
      }
    }
  }
  // skirt: grass lip, soil, stone bands down to BASE_Y
  const edge = [...rings[RINGS]].sort((p, q) => p.a - q.a);
  const quad = (a: number[], b: number[], c: number[], d: number[], color: number[]) => {
    for (const v of [a, c, b, a, d, c]) pos.push(v[0], v[1], v[2]);
    const j = 0.94 + 0.12 * rand();
    for (let t = 0; t < 6; t++) col.push(color[0] * j, color[1] * j, color[2] * j);
  };
  for (let i = 0; i < edge.length; i++) {
    const p = edge[i];
    const q = edge[(i + 1) % edge.length];
    const hp = height(p.x, p.z);
    const hq = height(q.x, q.z);
    const bands: [number, number, number[]][] = [
      [0, 1.4, C.lip],
      [1.4, 6, C.soil],
      [6, 11, C.soilDark],
    ];
    for (const [t0, t1, color] of bands) quad([p.x, hp - t0, p.z], [p.x, hp - t1, p.z], [q.x, hq - t1, q.z], [q.x, hq - t0, q.z], color);
    quad([p.x, hp - 11, p.z], [p.x, BASE_Y, p.z], [q.x, BASE_Y, q.z], [q.x, hq - 11, q.z], C.stone);
  }
  return { positions: new Float32Array(pos), colors: new Float32Array(col) };
}

// --------------------------------------------------------------- scatter

export interface Placement {
  kind: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  s: number;
}

/** Seeded vegetation and rocks; kinds are kit.glb node names. */
export function scatter(seed = 11): Placement[] {
  const rand = rng(seed);
  const out: Placement[] = [];
  const keepClear = (x: number, z: number) =>
    Math.hypot(x - CAMP.x, z - CAMP.z) < 15 || Math.hypot(x - HIDE.x, z - HIDE.z) < 7 || Math.abs(x - valleyX(z)) < 6 || distToPath(x, z) < 5;
  for (let n = 0; n < 2600 && out.length < 720; n++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * R * 0.95;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (keepClear(x, z)) continue;
    const y = height(x, z);
    const [gx, gz] = downhill(x, z);
    const slope = Math.hypot(gx, gz);
    const f = fbm(x / 26, z / 26, 21); // forest patches
    const pick = rand();
    let kind = '';
    let s = 0.8 + rand() * 0.5;
    if (slope > 0.7) {
      if (pick < 0.35) kind = `rock_${1 + Math.floor(rand() * 3)}`;
      else continue;
    } else if (f > 0.5) {
      if (y > 13) kind = pick < 0.8 ? `pine_${1 + Math.floor(rand() * 4)}` : `bush_${1 + Math.floor(rand() * 4)}`;
      else if (pick < 0.45) kind = `pine_${1 + Math.floor(rand() * 3)}`;
      else if (pick < 0.7) kind = `tree_${1 + Math.floor(rand() * 3)}`;
      else if (pick < 0.82) kind = `birch_${1 + Math.floor(rand() * 3)}`;
      else kind = `fern_${1 + Math.floor(rand() * 3)}`;
    } else {
      if (pick < 0.07) kind = `tree_${1 + Math.floor(rand() * 3)}`;
      else if (pick < 0.12) kind = `pine_${1 + Math.floor(rand() * 3)}`;
      else if (pick < 0.2) kind = `bush_${1 + Math.floor(rand() * 4)}`;
      else if (pick < 0.3) kind = `fern_${1 + Math.floor(rand() * 3)}`;
      else if (pick < 0.34) kind = `rock_${1 + Math.floor(rand() * 3)}`;
      else continue;
      s *= 0.9;
    }
    if (kind.startsWith('rock')) s *= 0.9 + rand() * 1.2;
    out.push({ kind, x, y: y - 0.25, z, rot: rand() * Math.PI * 2, s });
  }
  // the hiding spot: a log under pines
  return out;
}

/** Clock (hours) → dusk factor (0 at 16:00, 1 by 19:00). */
export const duskAt = (hour: number) => smoothstep(16.6, 19.0, hour);
