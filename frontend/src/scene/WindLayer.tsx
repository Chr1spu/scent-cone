import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { AreaBundle } from '../api/types';
import { VERT_EXAG, WIND_STREAKS, WIND_STREAK_DT } from '../config/constants';
import { gridMap, localBounds, sampleLocal } from '../geo/grid';
import { Rng } from '../models/rng';
import { sampleUVFrac, timeSlot } from '../models/wind';
import { useStore } from '../state/store';

const TAIL_S = 14;
const LIFT_M = 14;

/** Thin animated streaks advected by the active wind field over the detail segment. */
export function WindLayer({ bundle }: { bundle: AreaBundle }) {
  const visible = useStore((s) => s.layers.wind);
  const { detail, frame } = bundle;
  const map = useMemo(() => gridMap(detail.meta, frame), [detail, frame]);
  const b = useMemo(() => localBounds(detail.meta, frame), [detail, frame]);
  const st = useMemo(() => {
    const rng = new Rng(7);
    const n = WIND_STREAKS;
    const s = {
      rng,
      x: new Float32Array(n),
      y: new Float32Array(n),
      age: new Float32Array(n),
      life: new Float32Array(n),
      pos: new Float32Array(n * 6),
      col: new Float32Array(n * 8),
    };
    for (let i = 0; i < n; i++) {
      s.x[i] = rng.uniform(b.minX, b.maxX);
      s.y[i] = rng.uniform(b.minY, b.maxY);
      s.life[i] = rng.uniform(40, 110);
      s.age[i] = rng.uniform(0, s.life[i]);
    }
    return s;
  }, [b]);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(st.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(st.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, [st]);
  const mat = useMemo(
    () => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    [],
  );
  const uv = useRef(new Float32Array(2));

  useFrame(() => {
    if (!visible) return;
    const s = useStore.getState();
    const field = s.activeWind;
    if (!field) return;
    const slot = timeSlot(field, s.time);
    const { x, y, age, life, pos, col, rng } = st;
    const out = uv.current;
    for (let i = 0; i < x.length; i++) {
      const fc = x[i] * map.inv + map.ox;
      const fr = -y[i] * map.inv + map.oy;
      sampleUVFrac(field, slot, map.cols, map.rows, fc, fr, out);
      const u = out[0];
      const v = out[1];
      x[i] += u * WIND_STREAK_DT;
      y[i] += v * WIND_STREAK_DT;
      age[i] += 1;
      if (age[i] > life[i] || x[i] < b.minX || x[i] > b.maxX || y[i] < b.minY || y[i] > b.maxY) {
        x[i] = rng.uniform(b.minX, b.maxX);
        y[i] = rng.uniform(b.minY, b.maxY);
        age[i] = 0;
        life[i] = rng.uniform(40, 110);
      }
      const tx = x[i] - u * TAIL_S;
      const ty = y[i] - v * TAIL_S;
      const k = i * 6;
      pos[k] = x[i];
      pos[k + 1] = (sampleLocal(detail.elev, map, x[i], y[i]) + LIFT_M) * VERT_EXAG;
      pos[k + 2] = -y[i];
      pos[k + 3] = tx;
      pos[k + 4] = (sampleLocal(detail.elev, map, tx, ty) + LIFT_M) * VERT_EXAG;
      pos[k + 5] = -ty;
      const f = age[i] / life[i];
      const fade = Math.min(f * 6, 1, (1 - f) * 4);
      const speed = Math.sqrt(u * u + v * v);
      const a = fade * Math.min(0.25 + speed / 3, 1) * 0.6;
      const c = i * 8;
      col[c] = 0.75;
      col[c + 1] = 0.9;
      col[c + 2] = 1;
      col[c + 3] = a;
      col[c + 4] = 0.75;
      col[c + 5] = 0.9;
      col[c + 6] = 1;
      col[c + 7] = 0;
    }
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  });

  return <lineSegments geometry={geo} material={mat} visible={visible} frustumCulled={false} renderOrder={5} />;
}
