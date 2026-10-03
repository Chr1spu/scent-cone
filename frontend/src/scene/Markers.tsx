import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { AreaBundle } from '../api/types';
import { COLORS, VERT_EXAG } from '../config/constants';
import { PROBABILITY } from '../config/modelParams';
import { toLocal } from '../geo/grid';
import { toScene } from '../geo/heights';
import { fmtTime } from '../state/controller';
import { useStore } from '../state/store';
import { Beacon, DrapedLine, Label, MODEL_SCALE, circlePts } from './primitives';
import { useModel } from './useModel';

function Tent() {
  const glb = useModel('tent.glb');
  if (glb) return <primitive object={glb} scale={MODEL_SCALE * 0.6} />;
  return (
    <group scale={MODEL_SCALE * 0.6}>
      <mesh position={[0, 0.9, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[1.6, 1.8, 4]} />
        <meshStandardMaterial color="#e9823a" flatShading />
      </mesh>
    </group>
  );
}

function LkpMarker({ bundle }: { bundle: AreaBundle }) {
  const lkp = useStore((s) => s.lkp);
  const glb = useModel('lkp_marker.glb');
  const p = toScene(bundle, lkp[0], lkp[1]);
  return (
    <group>
      <group position={p}>
        <Tent />
        {glb && <primitive object={glb} position={[25, 0, 0]} scale={MODEL_SCALE} />}
      </group>
      <Beacon position={p} color={COLORS.lkp} height={110} radius={18} />
      <Label position={[p[0], p[1] + 125 * VERT_EXAG, p[2]]}>
        <span className="text-white">⛺ LKP · campsite · {fmtTime(bundle.config.missingAt)}</span>
      </Label>
    </group>
  );
}

function ChildMarker({ bundle }: { bundle: AreaBundle }) {
  const revealed = useStore((s) => s.revealed);
  const glb = useModel('child_marker.glb');
  const group = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);
  const truth = toLocal(bundle.frame, bundle.config.truth.x, bundle.config.truth.y);
  const p = toScene(bundle, truth[0], truth[1]);
  useFrame(({ clock }) => {
    if (!group.current) return;
    if (!revealed) {
      start.current = null;
      return;
    }
    if (start.current === null) start.current = clock.elapsedTime;
    const k = Math.min(1, (clock.elapsedTime - start.current) / 1.4);
    const e = 1 - Math.pow(1 - k, 3);
    group.current.position.y = p[1] - 40 * (1 - e);
    group.current.scale.setScalar(Math.max(0.001, e));
  });
  if (!revealed) return null;
  return (
    <group>
      <group ref={group} position={p}>
        {glb ? (
          <primitive object={glb} scale={MODEL_SCALE} />
        ) : (
          <group scale={MODEL_SCALE}>
            <mesh position={[0, 0.65, 0]}>
              <capsuleGeometry args={[0.22, 0.75, 4, 10]} />
              <meshStandardMaterial color={COLORS.child} emissive={COLORS.child} emissiveIntensity={0.6} />
            </mesh>
            <mesh position={[0, 1.38, 0]}>
              <sphereGeometry args={[0.17, 12, 12]} />
              <meshStandardMaterial color="#f1c9a5" />
            </mesh>
          </group>
        )}
      </group>
      <Beacon position={p} color={COLORS.child} height={220} radius={30} />
      <Label position={[p[0], p[1] + 240 * VERT_EXAG, p[2]]} tone="amber">
        ★ Found: 9-year-old · inside alert overlap
      </Label>
    </group>
  );
}

function SearchedSectors({ bundle }: { bundle: AreaBundle }) {
  const searched = useStore((s) => s.searched);
  const visible = useStore((s) => s.layers.searched);
  if (!visible) return null;
  return (
    <group>
      {searched.map((s) => {
        const color = s.recheck ? COLORS.recheck : COLORS.searched;
        const p = toScene(bundle, s.x, s.y, 10);
        return (
          <group key={s.id}>
            <DrapedLine bundle={bundle} pts={circlePts(s.x, s.y, s.radius)} color={color} lift={4} />
            <DrapedLine bundle={bundle} pts={circlePts(s.x, s.y, s.radius * 0.97)} color={color} lift={4} opacity={0.4} />
            <Label position={p} tone={s.recheck ? 'warn' : 'default'}>
              Searched {fmtTime(s.t - 1)}–{fmtTime(s.t)} · no alert{s.recheck ? ' · ⚠ recheck (poor scent)' : ''}
            </Label>
          </group>
        );
      })}
    </group>
  );
}

function Suggestions({ bundle }: { bundle: AreaBundle }) {
  const tool = useStore((s) => s.tool);
  const suggestions = useStore((s) => s.suggestions);
  const alerts = useStore((s) => s.alerts);
  if (tool !== 'alert') return null;
  return (
    <group>
      {suggestions
        .filter(([x, y]) => !alerts.some((a) => Math.hypot(a.x - x, a.y - y) < 60))
        .map(([x, y, t], i) => {
          const p = toScene(bundle, x, y);
          return (
            <group key={i}>
              <Beacon position={p} color={COLORS.alert[i % 4]} height={90} radius={26} />
              <Label position={[p[0], p[1] + 105 * VERT_EXAG, p[2]]} tone="pink">
                Radio: dog alerted here at {fmtTime(t)} — click to add
              </Label>
            </group>
          );
        })}
    </group>
  );
}

function BrushCursor({ bundle }: { bundle: AreaBundle }) {
  const tool = useStore((s) => s.tool);
  const hover = useStore((s) => s.hover);
  const pts = useMemo(() => (hover ? circlePts(hover[0], hover[1], tool === 'searched' ? 150 : PROBABILITY.brushRadiusM, 48) : null), [hover, tool]);
  if (!pts || !(tool === 'brushUp' || tool === 'brushDown' || tool === 'searched')) return null;
  return <DrapedLine bundle={bundle} pts={pts} color={tool === 'brushDown' ? '#ff8a8a' : tool === 'searched' ? COLORS.searched : '#7ef0ff'} lift={5} />;
}

export function Markers({ bundle }: { bundle: AreaBundle }) {
  return (
    <group>
      <LkpMarker bundle={bundle} />
      <ChildMarker bundle={bundle} />
      <SearchedSectors bundle={bundle} />
      <Suggestions bundle={bundle} />
      <BrushCursor bundle={bundle} />
    </group>
  );
}
