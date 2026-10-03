import { useMemo } from 'react';
import type { AreaBundle } from '../api/types';
import { VERT_EXAG } from '../config/constants';
import { localBounds } from '../geo/grid';
import { toScene } from '../geo/heights';
import { useStore } from '../state/store';
import { Label, MODEL_SCALE } from './primitives';
import { useModel } from './useModel';

const JOIN_M = 40; // a trail end this close to a road is a trailhead
const SPACING_M = 250;
const MAX_TRAILHEADS = 8;

export interface Trailhead {
  x: number;
  y: number;
  name: string | null;
}

/** Trail ends that meet a road inside the focus square: where teams and hikers enter. */
export function findTrailheads(bundle: AreaBundle): Trailhead[] {
  const b = localBounds(bundle.detail.meta, bundle.frame);
  const inside = (x: number, y: number) => x > b.minX && x < b.maxX && y > b.minY && y < b.maxY;
  // road points every ~10 m
  const road: number[] = [];
  for (const f of bundle.features) {
    if (f.kind !== 'road') continue;
    for (let k = 0; k + 1 < f.xs.length; k++) {
      const dx = f.xs[k + 1] - f.xs[k];
      const dy = f.ys[k + 1] - f.ys[k];
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 10));
      for (let s = 0; s <= n; s++) road.push(f.xs[k] + (dx * s) / n, f.ys[k] + (dy * s) / n);
    }
  }
  const nearRoad = (x: number, y: number) => {
    for (let i = 0; i < road.length; i += 2) if (Math.abs(road[i] - x) < JOIN_M && Math.abs(road[i + 1] - y) < JOIN_M && Math.hypot(road[i] - x, road[i + 1] - y) < JOIN_M) return true;
    return false;
  };
  const out: Trailhead[] = [];
  for (const f of bundle.features) {
    if (f.kind !== 'trail' || f.xs.length < 2) continue;
    for (const k of [0, f.xs.length - 1]) {
      const x = f.xs[k];
      const y = f.ys[k];
      if (!inside(x, y) || !nearRoad(x, y)) continue;
      if (out.some((t) => Math.hypot(t.x - x, t.y - y) < SPACING_M)) continue;
      out.push({ x, y, name: f.name ?? null });
      if (out.length >= MAX_TRAILHEADS) return out;
    }
  }
  return out;
}

function Cairn({ position }: { position: [number, number, number] }) {
  const glb = useModel('landmark.glb');
  if (glb) return <primitive object={glb} position={position} scale={MODEL_SCALE * 0.4} />;
  return (
    <mesh position={[position[0], position[1] + 6, position[2]]}>
      <coneGeometry args={[5, 12, 5]} />
      <meshStandardMaterial color="#9a968e" flatShading />
    </mesh>
  );
}

/** Stone cairns at trailheads (scene view, with the trails layer). */
export function Landmarks({ bundle }: { bundle: AreaBundle }) {
  const visible = useStore((s) => s.layers.features);
  const view = useStore((s) => s.view);
  const heads = useMemo(() => findTrailheads(bundle), [bundle]);
  if (!visible || heads.length === 0) return null;
  return (
    <group>
      {heads.map((t, i) => {
        const p = toScene(bundle, t.x, t.y);
        return (
          <group key={i}>
            <Cairn position={p} />
            {view === 'scene' && (
              <Label position={[p[0], p[1] + 38 * VERT_EXAG, p[2]]}>{t.name ? `Trailhead: ${t.name}` : 'Trailhead'}</Label>
            )}
          </group>
        );
      })}
    </group>
  );
}
