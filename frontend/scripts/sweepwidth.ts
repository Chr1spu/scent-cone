/**
 * Model sweep width vs the measured one.
 *   npx vite-node scripts/sweepwidth.ts [d50M] [nearRadiusM] [nearDet]
 *
 * Effective sweep width (ESW) is ∫ P(detect | team passes at lateral range x) dx. Field trials with
 * four air-scent dog teams gave a mean ESW of 95 m (95% CI 44–145; Chiacchia, Houlahan & Hostetter
 * 2015, Wilderness Environ Med 26:198). Here a team walks straight lines past one person at every
 * lateral offset, at directions spread evenly relative to the wind, in the model's reference
 * conditions (single real plume, steady 2 m/s, neutral), and P = POD × the best detection along the
 * line (scent, or close range). The result is the model's ESW for those settings.
 */
import { DETECTION, HOTSPOTS } from '../src/config/modelParams';
import { frameOf, gridMap, type GridMeta } from '../src/geo/grid';
import { calibrateDetection, receiverDetection } from '../src/models/detection';
import { blockIndex, normalizeContrib, runEnsemble } from '../src/models/scent';
import { buildTerrainInfo, LC } from '../src/models/terrainInfo';
import type { WindField } from '../src/models/wind';

export function modelSweepWidth(opts: { d50M?: number; nearRadiusM?: number; nearDet?: number; windMs?: number; cloud?: number; hour?: number } = {}) {
  const d50 = opts.d50M ?? DETECTION.d50M;
  const nearR = opts.nearRadiusM ?? HOTSPOTS.nearRadiusM;
  const nearDet = opts.nearDet ?? HOTSPOTS.nearDet;
  const n = 200;
  const cell = 10;
  const meta: GridMeta = { crs: 'EPSG:32618', originX: 500000, originY: 4600000, cellSize: cell, cols: n, rows: n, noData: -9999 };
  const map = gridMap(meta, frameOf(meta));
  const ti = buildTerrainInfo(meta, frameOf(meta), new Float32Array(n * n).fill(100), new Uint8Array(n * n).fill(LC.open));
  const wind = opts.windMs ?? DETECTION.refWind;
  const u = new Float32Array(n * n).fill(wind);
  const field: WindField = { hours: [0, 23], grids: [{ u, v: new Float32Array(n * n) }, { u, v: new Float32Array(n * n) }] };
  const weather = {
    utcOffsetSeconds: 0,
    hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, temperature: 10, humidity: 60, cloudCover: opts.cloud ?? 100, windSpeed: wind / 0.7, windDirection: 270 })),
  };
  const place = { date: '2026-06-21', lat: 45, lon: 0, utcOffsetSeconds: 0 };
  const blocks = blockIndex(n, n, HOTSPOTS.recvBlockCells, HOTSPOTS.srcBlockCells);
  // the person: one source block at the centre-west, so the plume has room to run east
  const prob = new Float32Array(n * n);
  const sr = n / 2 - 10; // aligned to a source block
  const sc = 50;
  for (let r = sr; r < sr + 10; r++) for (let c = sc; c < sc + 10; c++) prob[r * n + c] = 1 / 100;
  const src = blocks.srcOf[sr * n + sc];
  const { contrib } = normalizeContrib(runEnsemble({ ti, field, place, weather, prob, tEnd: opts.hour ?? 12, members: 1, particles: 6000, blocks, neutral: opts.cloud === undefined, seed: 11 }), 1, 6000);
  const q = new Float32Array(blocks.nSrc);
  q[src] = 1;
  const det = receiverDetection(contrib!, q, blocks, calibrateDetection({ d50M: d50, members: 1 }), 0);
  const detAt = new Float32Array(blocks.nRecv);
  for (let r = 0; r < blocks.nRecv; r++) for (let k = det.start[r]; k < det.start[r + 1]; k++) if (det.src[k] === src) detAt[r] = det.det[k];
  if (process.env.SW_DEBUG) {
    let mx = 0;
    for (const v of detAt) mx = Math.max(mx, v);
    const row = Math.floor((sr + 5) / blocks.recvBlock);
    const line = Array.from({ length: 12 }, (_, k) => detAt[row * blocks.recvCols + Math.floor((sc + 5) / blocks.recvBlock) + k * 2].toFixed(2)).join(' ');
    console.log('max det', mx.toFixed(3), '| every 100 m downwind:', line);
    const cur = calibrateDetection({ d50M: d50, members: 1 });
    let cmax = 0;
    for (let r = 0; r < blocks.nRecv; r++) cmax = Math.max(cmax, contrib![r * blocks.nSrc + src]);
    let tot = 0;
    for (let r = 0; r < blocks.nRecv; r++) tot += contrib![r * blocks.nSrc + src];
    console.log('calib c50', Math.exp(cur.lnC50).toExponential(3), 'profile', cur.profile.slice(0, 8).map((p) => p.d + ':' + p.c.toExponential(2)).join(' '));
    console.log('here max c', cmax.toExponential(3), 'total', tot.toExponential(3));
  }
  const px = (sc + 4.5 - map.ox) / map.inv;
  const py = -(sr + 4.5 - map.oy) / map.inv;
  const pod = HOTSPOTS.dogPOD;
  let total = 0;
  const angles = 12;
  for (let a = 0; a < angles; a++) {
    const phi = (Math.PI * (a + 0.5)) / angles; // line direction relative to the wind (0 = along it)
    const dx = Math.cos(phi);
    const dy = Math.sin(phi);
    let integral = 0;
    for (let off = -600; off <= 600; off += 10) {
      // line through (px, py) + off * normal, direction (dx, dy)
      const ox = px - dy * off;
      const oy = py + dx * off;
      let best = Math.abs(off) <= nearR ? nearDet : 0;
      for (let t = -700; t <= 700; t += 10) {
        const x = ox + dx * t;
        const y = oy + dy * t;
        const c = Math.round(x * map.inv + map.ox);
        const r = Math.round(-y * map.inv + map.oy);
        if (c < 0 || r < 0 || c >= n || r >= n) continue;
        best = Math.max(best, detAt[blocks.recvOf[r * n + c]]);
      }
      integral += pod * best * 10;
    }
    total += integral;
  }
  return total / angles;
}

{
  const [d50, nr, nd] = process.argv.slice(2).map(Number);
  const esw = modelSweepWidth({ d50M: d50 || undefined, nearRadiusM: Number.isFinite(nr) ? nr : undefined, nearDet: Number.isFinite(nd) ? nd : undefined });
  console.log(`model ESW ${esw.toFixed(0)} m (d50 ${d50 || DETECTION.d50M} m, close range ${Number.isFinite(nr) ? nr : HOTSPOTS.nearRadiusM} m at ${Number.isFinite(nd) ? nd : HOTSPOTS.nearDet}); measured 95 m (44–145)`);
}
