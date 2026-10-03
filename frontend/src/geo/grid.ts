/**
 * Grid conventions (CLAUDE.md §5): originX/originY = NW corner, row 0 = north,
 * index = row * cols + col. "Local" coordinates are metres relative to the frame
 * centre (the detail grid centre): lx = east, ly = north. Scene: x = lx, z = -ly.
 */

export interface GridMeta {
  crs: string;
  originX: number;
  originY: number;
  cellSize: number;
  cols: number;
  rows: number;
  noData: number;
}

export interface Frame {
  cx: number;
  cy: number;
}

export function frameOf(meta: GridMeta): Frame {
  return { cx: meta.originX + (meta.cols * meta.cellSize) / 2, cy: meta.originY - (meta.rows * meta.cellSize) / 2 };
}

/** Precomputed affine map local metres -> fractional (col, row) cell-centre coordinates. */
export interface GridMap {
  meta: GridMeta;
  inv: number;
  ox: number;
  oy: number;
  cols: number;
  rows: number;
}

export function gridMap(meta: GridMeta, frame: Frame): GridMap {
  const inv = 1 / meta.cellSize;
  return {
    meta,
    inv,
    ox: (frame.cx - meta.originX) * inv - 0.5,
    oy: (meta.originY - frame.cy) * inv - 0.5,
    cols: meta.cols,
    rows: meta.rows,
  };
}

export function fracCol(m: GridMap, lx: number): number {
  return lx * m.inv + m.ox;
}
export function fracRow(m: GridMap, ly: number): number {
  return -ly * m.inv + m.oy;
}

/** Nearest cell index for a local point, or -1 outside the grid. */
export function cellAt(m: GridMap, lx: number, ly: number): number {
  const c = Math.round(lx * m.inv + m.ox);
  const r = Math.round(-ly * m.inv + m.oy);
  if (c < 0 || r < 0 || c >= m.cols || r >= m.rows) return -1;
  return r * m.cols + c;
}

export function cellCenterLocal(m: GridMap, idx: number): [number, number] {
  const r = Math.floor(idx / m.cols);
  const c = idx - r * m.cols;
  return [(c - m.ox) / m.inv, -(r - m.oy) / m.inv];
}

export function insideGrid(m: GridMap, lx: number, ly: number): boolean {
  const c = lx * m.inv + m.ox;
  const r = -ly * m.inv + m.oy;
  return c >= -0.5 && r >= -0.5 && c <= m.cols - 0.5 && r <= m.rows - 0.5;
}

/** Bilinear sample at fractional cell coordinates, clamped at the edges. */
export function bilinear(arr: ArrayLike<number>, cols: number, rows: number, fc: number, fr: number): number {
  if (fc < 0) fc = 0;
  else if (fc > cols - 1) fc = cols - 1;
  if (fr < 0) fr = 0;
  else if (fr > rows - 1) fr = rows - 1;
  let c0 = fc | 0;
  let r0 = fr | 0;
  if (c0 >= cols - 1) c0 = cols - 2;
  if (r0 >= rows - 1) r0 = rows - 2;
  const tc = fc - c0;
  const tr = fr - r0;
  const i = r0 * cols + c0;
  const a = arr[i] * (1 - tc) + arr[i + 1] * tc;
  const b = arr[i + cols] * (1 - tc) + arr[i + cols + 1] * tc;
  return a * (1 - tr) + b * tr;
}

export function sampleLocal(arr: ArrayLike<number>, m: GridMap, lx: number, ly: number): number {
  return bilinear(arr, m.cols, m.rows, lx * m.inv + m.ox, -ly * m.inv + m.oy);
}

export function localBounds(meta: GridMeta, frame: Frame) {
  const minX = meta.originX - frame.cx;
  const maxY = meta.originY - frame.cy;
  const w = meta.cols * meta.cellSize;
  const h = meta.rows * meta.cellSize;
  return { minX, maxX: minX + w, minY: maxY - h, maxY, w, h };
}

export function toLocal(frame: Frame, x: number, y: number): [number, number] {
  return [x - frame.cx, y - frame.cy];
}
export function toWorld(frame: Frame, lx: number, ly: number): [number, number] {
  return [lx + frame.cx, ly + frame.cy];
}

/** Separable box blur (edge-clamped), radius in cells. Returns a new array. */
export function boxBlur(src: Float32Array, cols: number, rows: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const k = 2 * radius + 1;
  for (let r = 0; r < rows; r++) {
    const o = r * cols;
    let acc = 0;
    for (let d = -radius; d <= radius; d++) acc += src[o + Math.min(Math.max(d, 0), cols - 1)];
    for (let c = 0; c < cols; c++) {
      tmp[o + c] = acc / k;
      const add = Math.min(c + radius + 1, cols - 1);
      const sub = Math.max(c - radius, 0);
      acc += src[o + add] - src[o + sub];
    }
  }
  for (let c = 0; c < cols; c++) {
    let acc = 0;
    for (let d = -radius; d <= radius; d++) acc += tmp[Math.min(Math.max(d, 0), rows - 1) * cols + c];
    for (let r = 0; r < rows; r++) {
      out[r * cols + c] = acc / k;
      const add = Math.min(r + radius + 1, rows - 1);
      const sub = Math.max(r - radius, 0);
      acc += tmp[add * cols + c] - tmp[sub * cols + c];
    }
  }
  return out;
}

/** (dz/dx east, dz/dy north) by central differences; row 0 is north. */
export function gradients(elev: Float32Array, cols: number, rows: number, cell: number) {
  const gx = new Float32Array(elev.length);
  const gy = new Float32Array(elev.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const cl = c > 0 ? c - 1 : c;
      const cr = c < cols - 1 ? c + 1 : c;
      const ru = r > 0 ? r - 1 : r;
      const rd = r < rows - 1 ? r + 1 : r;
      gx[i] = (elev[r * cols + cr] - elev[r * cols + cl]) / ((cr - cl) * cell);
      // north is row-1, so dz/dnorth = (z[row-1] - z[row+1]) / dist
      gy[i] = (elev[ru * cols + c] - elev[rd * cols + c]) / ((rd - ru) * cell);
    }
  }
  return { gx, gy };
}

export function slopeDegrees(elev: Float32Array, cols: number, rows: number, cell: number): Float32Array {
  const { gx, gy } = gradients(elev, cols, rows, cell);
  const s = new Float32Array(elev.length);
  for (let i = 0; i < s.length; i++) s[i] = (Math.atan(Math.hypot(gx[i], gy[i])) * 180) / Math.PI;
  return s;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
