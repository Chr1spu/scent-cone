import type { AreaBundle } from '../api/types';
import { COLORS, VERT_EXAG } from '../config/constants';
import { cellCenterLocal, gridMap } from '../geo/grid';
import { toScene } from '../geo/heights';
import { useStore } from '../state/store';
import { Beacon, Label } from './primitives';

/**
 * The heatmap itself is draped by the terrain shader (uHeat). This component draws the
 * hotspot beacons: strongest, well-separated scent accumulations in the last 60 minutes.
 */
export function Heatmap({ bundle }: { bundle: AreaBundle }) {
  const heat = useStore((s) => s.heat);
  const visible = useStore((s) => s.layers.hotspots);
  if (!visible || !heat) return null;
  const map = gridMap(bundle.detail.meta, bundle.frame);
  return (
    <group>
      {heat.hotspots.slice(0, 5).map((cell, i) => {
        const [x, y] = cellCenterLocal(map, cell);
        const p = toScene(bundle, x, y);
        return (
          <group key={cell}>
            <Beacon position={p} color={COLORS.amber} height={60 - i * 6} radius={16} pulse={i === 0} />
            {i < 3 && (
              <Label position={[p[0], p[1] + (75 - i * 6) * VERT_EXAG, p[2]]} tone="amber">
                Hotspot {i + 1}
              </Label>
            )}
          </group>
        );
      })}
    </group>
  );
}
