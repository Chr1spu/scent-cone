import { useMemo } from 'react';
import * as THREE from 'three';
import type { AreaBundle } from '../api/types';
import { VERT_EXAG } from '../config/constants';
import { elevationAt } from '../geo/heights';
import type { FeatureKind } from '../models/probability';
import { useStore } from '../state/store';

export const FEATURE_COLORS: Record<FeatureKind, string> = {
  trail: '#f4dfb4',
  road: '#aab3bf',
  stream: '#59b7ff',
  river: '#3d8bff',
  lake: '#3d8bff',
  cliff: '#ff6b6b',
};

const STEP_M = 15;
const LIFT_M = 2.5;

/** Trails, roads, streams, rivers, lake shores and cliffs draped on the terrain. */
export function FeatureLines({ bundle }: { bundle: AreaBundle }) {
  const visible = useStore((s) => s.layers.features);
  const geo = useMemo(() => {
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    for (const f of bundle.features) {
      c.set(FEATURE_COLORS[f.kind]);
      const lift = f.kind === 'road' ? LIFT_M * 0.6 : LIFT_M;
      const n = f.xs.length;
      const segs = f.polygon ? n : n - 1;
      for (let k = 0; k < segs; k++) {
        const j = (k + 1) % n;
        const x0 = f.xs[k];
        const y0 = f.ys[k];
        const dx = f.xs[j] - x0;
        const dy = f.ys[j] - y0;
        const m = Math.max(1, Math.ceil(Math.hypot(dx, dy) / STEP_M));
        for (let s = 0; s < m; s++) {
          const ax = x0 + (dx * s) / m;
          const ay = y0 + (dy * s) / m;
          const bx = x0 + (dx * (s + 1)) / m;
          const by = y0 + (dy * (s + 1)) / m;
          pos.push(ax, (elevationAt(bundle, ax, ay) + lift) * VERT_EXAG, -ay, bx, (elevationAt(bundle, bx, by) + lift) * VERT_EXAG, -by);
          col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [bundle]);
  const mat = useMemo(() => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false }), []);
  return <lineSegments geometry={geo} material={mat} visible={visible} renderOrder={2} />;
}
