/** Static per-cell terrain attributes used by the scent and deployment models. */
import { SCENT } from '../config/modelParams';
import { gradients, gridMap, type Frame, type GridMap, type GridMeta } from '../geo/grid';

export const LC = { unknown: 0, water: 1, open: 2, shrub: 3, forest: 4, developed: 5, wetland: 6 } as const;

export interface TerrainInfo {
  meta: GridMeta;
  map: GridMap;
  elev: Float32Array;
  landcover: Uint8Array;
  /** unit surface normals (east, north, up) */
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
  slopeDeg: Float32Array;
  localLow: Uint8Array;
}

export function buildTerrainInfo(meta: GridMeta, frame: Frame, elev: Float32Array, landcover: Uint8Array): TerrainInfo {
  const { cols, rows, cellSize } = meta;
  const { gx, gy } = gradients(elev, cols, rows, cellSize);
  const n = elev.length;
  const nx = new Float32Array(n);
  const ny = new Float32Array(n);
  const nz = new Float32Array(n);
  const slopeDeg = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const l = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i] + 1);
    nx[i] = -gx[i] / l;
    ny[i] = -gy[i] / l;
    nz[i] = 1 / l;
    slopeDeg[i] = (Math.atan(Math.hypot(gx[i], gy[i])) * 180) / Math.PI;
  }
  const localLow = new Uint8Array(n);
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c;
      const z = elev[i];
      let lower = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (z < elev[i + dr * cols + dc]) lower++;
        }
      localLow[i] = lower >= SCENT.localLowNeighbours ? 1 : 0;
    }
  }
  return { meta, map: gridMap(meta, frame), elev, landcover, nx, ny, nz, slopeDeg, localLow };
}

/** Per-cell sunlit flag: sun above horizon and the slope faces it. */
export function sunlitMask(ti: TerrainInfo, sunDir: [number, number, number], out?: Uint8Array): Uint8Array {
  const n = ti.elev.length;
  const m = out ?? new Uint8Array(n);
  if (sunDir[2] <= 0) {
    m.fill(0);
    return m;
  }
  for (let i = 0; i < n; i++) {
    m[i] = ti.nx[i] * sunDir[0] + ti.ny[i] * sunDir[1] + ti.nz[i] * sunDir[2] > 0.05 ? 1 : 0;
  }
  return m;
}
