import type { AreaBundle } from '../api/types';
import { useStore } from '../state/store';
import { toScene } from '../geo/heights';
import { Label } from './primitives';

/**
 * The probability tint is draped by the terrain shader (uProb) on both grids. This adds a
 * label at the detail-segment's most likely cell before any alerts are in.
 */
export function ProbabilityLayer({ bundle }: { bundle: AreaBundle }) {
  const prob = useStore((s) => s.prob);
  const visible = useStore((s) => s.layers.probability);
  const alerts = useStore((s) => s.alerts.length);
  const view = useStore((s) => s.view);
  if (!visible || !prob || alerts > 0 || view !== 'map') return null;
  return (
    <Label position={toScene(bundle, prob.peak[0], prob.peak[1], 40)} tone="cyan">
      Most likely spot
    </Label>
  );
}
