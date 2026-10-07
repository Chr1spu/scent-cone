import { useMemo } from 'react';
import type { AreaBundle } from '../api/types';
import { COLORS } from '../config/constants';
import { toScene } from '../geo/heights';
import { useStore } from '../state/store';
import { DrapedLine, Label } from './primitives';

/** Densify a ring every ~20 m so it hugs the terrain. */
function densify(ring: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 20));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  if (ring.length) out.push(ring[ring.length - 1]);
  return out;
}

/** Search segment outlines; assigned segments in their team's colour, with the segment name. */
export function SegmentsLayer({ bundle }: { bundle: AreaBundle }) {
  const seg = useStore((s) => s.segments);
  const visible = useStore((s) => s.layers.segments);
  const mode = useStore((s) => s.assignMode);
  const deployments = useStore((s) => s.deployments);
  const outlines = useMemo(() => (seg ? seg.rings.map((rs) => (rs[0] ? densify(rs[0]) : [])) : []), [seg]);
  if (!seg || !visible || mode !== 'segments') return null;
  const assigned = new Map<number, number>();
  for (const d of deployments) if (d.segment) assigned.set(d.segment.index, d.team);
  return (
    <group>
      {outlines.map((pts, k) => {
        const team = assigned.get(k);
        if (pts.length < 3) return null;
        const color = team ? COLORS.team[(team - 1) % COLORS.team.length] : '#d8dde3';
        return <DrapedLine key={k} bundle={bundle} pts={pts} color={color} lift={team ? 5 : 3} opacity={team ? 0.95 : 0.35} />;
      })}
      {seg.centroid.map(([x, y], k) => {
        const team = assigned.get(k);
        return (
          <Label key={k} position={toScene(bundle, x, y, team ? 40 : 15)} tone={team ? 'amber' : 'default'}>
            {seg.names[k]}
            {team ? ` · Team ${team}` : ''}
          </Label>
        );
      })}
    </group>
  );
}
