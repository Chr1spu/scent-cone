import type { AreaBundle } from '../api/types';
import { COLORS } from '../config/constants';
import { toScene } from '../geo/heights';
import { useStore } from '../state/store';
import { Beacon, DrapedLine, Label } from './primitives';

/** An imported training run: the dog's track and its alerts, labelled with the model's detection there. */
export function TrialTrack({ bundle }: { bundle: AreaBundle }) {
  const trial = useStore((s) => s.trial);
  if (!trial) return null;
  const track = trial.points.filter((p) => !p.alert).map((p) => [p.x, p.y] as [number, number]);
  const alerts = trial.points.filter((p) => p.alert);
  return (
    <group>
      {track.length > 1 && <DrapedLine bundle={bundle} pts={track} color={COLORS.cyan} lift={3} opacity={0.85} />}
      {alerts.map((a, i) => {
        const p = toScene(bundle, a.x, a.y);
        return (
          <group key={i}>
            <Beacon position={p} color={COLORS.cyan} height={70} radius={12} pulse={false} />
            <Label position={[p[0], p[1] + 110, p[2]]} tone="cyan">
              Dog alert: model {Math.round(a.det * 100)}%
            </Label>
          </group>
        );
      })}
    </group>
  );
}
