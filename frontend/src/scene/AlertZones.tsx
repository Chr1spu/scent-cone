import type { AreaBundle } from '../api/types';
import { COLORS, VERT_EXAG } from '../config/constants';
import { toScene } from '../geo/heights';
import { fmtTime } from '../state/controller';
import { useStore } from '../state/store';
import { Beacon, Label } from './primitives';

/** Alert pins (plumes are draped by the terrain shader) and the posterior peak. */
export function AlertZones({ bundle }: { bundle: AreaBundle }) {
  const alerts = useStore((s) => s.alerts);
  const visible = useStore((s) => s.layers.alertZones);
  const prob = useStore((s) => s.prob);
  if (!visible || alerts.length === 0) return null;
  const peak = prob?.peak;
  return (
    <group>
      {alerts.map((a, i) => {
        const p = toScene(bundle, a.x, a.y);
        const color = COLORS.alert[i % COLORS.alert.length];
        return (
          <group key={a.id}>
            <Beacon position={p} color={color} height={100} radius={18} />
            <Label position={[p[0], p[1] + 115 * VERT_EXAG, p[2]]} tone="pink">
              <span style={{ color }}>▲</span> Alert {i + 1} · {fmtTime(a.t)} · traced back 60 min
            </Label>
          </group>
        );
      })}
      {peak && alerts.length >= 1 && (
        <group>
          <Beacon position={toScene(bundle, peak[0], peak[1])} color={COLORS.cyan} height={160} radius={24} />
          <Label position={toScene(bundle, peak[0], peak[1], 175)} tone="cyan">
            Posterior peak{alerts.length >= 2 ? ' · zones overlap' : ''}
          </Label>
        </group>
      )}
    </group>
  );
}
