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
import { MISSIONS } from '../config/missions';
import { sectorCentroid, type SearchedSector as SectorShape } from '../models/searchUpdate';
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
  const mission = useStore((s) => s.mission);
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
        {MISSIONS[mission].lkpLabel}
        {mission === 'wilderness' || mission === 'pet' ? ` ${fmtTime(bundle.config.missingAt)}` : ''}
      </Label>
    </group>
  );
}

function ChildMarker({ bundle }: { bundle: AreaBundle }) {
  const mission = useStore((s) => s.mission);
  if (!bundle.config.truth || mission !== 'wilderness') return null;
  return <ChildMarkerAt bundle={bundle} truthXY={[bundle.config.truth.x, bundle.config.truth.y]} />;
}

function ChildMarkerAt({ bundle, truthXY }: { bundle: AreaBundle; truthXY: [number, number] }) {
  const revealed = useStore((s) => s.revealed);
  const glb = useModel('child_marker.glb');
  const group = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);
  const truth = toLocal(bundle.frame, truthXY[0], truthXY[1]);
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
        Found: inside the alert overlap
      </Label>
    </group>
  );
}

function outline(sector: SectorShape): [number, number][] {
  if (sector.kind === 'circle') return circlePts(sector.x, sector.y, sector.radius);
  const pts = sector.xs.map((x, i) => [x, sector.ys[i]] as [number, number]);
  return [...densify(pts), pts[0]];
}

/** Insert points every ~20 m so polygon edges follow the terrain. */
function densify(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 20));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

function SearchedSectors({ bundle }: { bundle: AreaBundle }) {
  const searched = useStore((s) => s.searched);
  const visible = useStore((s) => s.layers.searched);
  if (!visible) return null;
  return (
    <group>
      {searched.map((s) => {
        const color = s.recheck ? COLORS.recheck : COLORS.searched;
        const [cx, cy] = sectorCentroid(s.sector);
        const ring = outline(s.sector);
        return (
          <group key={s.id}>
            <DrapedLine bundle={bundle} pts={ring} color={color} lift={4} />
            <Label position={toScene(bundle, cx, cy, 10)} tone={s.recheck ? 'warn' : 'default'}>
              Searched {fmtTime(s.t0)} to {fmtTime(s.t1)}{s.recheck ? ', recheck: poor scent' : ''}
            </Label>
          </group>
        );
      })}
    </group>
  );
}

function SearchDraftPreview({ bundle }: { bundle: AreaBundle }) {
  const tool = useStore((s) => s.tool);
  const draft = useStore((s) => s.searchDraft);
  const hover = useStore((s) => s.hover);
  if ((tool !== 'searched' && tool !== 'area') || draft.shape !== 'polygon' || draft.pts.length === 0) return null;
  const pts: [number, number][] = hover ? [...draft.pts, hover] : draft.pts;
  const first = toScene(bundle, draft.pts[0][0], draft.pts[0][1]);
  return (
    <group>
      {pts.length >= 2 && <DrapedLine bundle={bundle} pts={densify(pts).concat([pts[pts.length - 1]])} color={COLORS.searched} lift={5} />}
      <Beacon position={first} color={COLORS.searched} height={30} radius={12} />
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
                Radio report: alert at {fmtTime(t)}. Click to log it
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
  const draft = useStore((s) => s.searchDraft);
  const drawing = tool === 'searched' || tool === 'area';
  const pts = useMemo(() => (hover ? circlePts(hover[0], hover[1], drawing ? draft.radius : PROBABILITY.brushRadiusM, 48) : null), [hover, drawing, draft.radius]);
  const circleSearch = drawing && draft.shape === 'circle';
  if (!pts || !(tool === 'brushUp' || tool === 'brushDown' || circleSearch)) return null;
  return <DrapedLine bundle={bundle} pts={pts} color={tool === 'brushDown' ? '#ff8a8a' : tool === 'area' ? COLORS.amber : tool === 'searched' ? COLORS.searched : '#7ef0ff'} lift={5} />;
}

/** Training hides: a person model with a label (only in the training mission). */
function Hides({ bundle }: { bundle: AreaBundle }) {
  const hides = useStore((s) => s.hides);
  const mission = useStore((s) => s.mission);
  const glb = useModel('child_marker.glb');
  if (mission !== 'training') return null;
  return (
    <group>
      {hides.map(([x, y], i) => {
        const p = toScene(bundle, x, y);
        return (
          <group key={i}>
            <group position={p} scale={MODEL_SCALE}>
              {glb ? (
                <primitive object={glb.clone(true)} />
              ) : (
                <mesh position={[0, 0.7, 0]}>
                  <capsuleGeometry args={[0.25, 0.9, 4, 10]} />
                  <meshStandardMaterial color={COLORS.child} />
                </mesh>
              )}
            </group>
            <Beacon position={p} color={COLORS.child} height={90} radius={16} />
            <Label position={[p[0], p[1] + 105 * VERT_EXAG, p[2]]} tone="amber">
              Hide {i + 1}
            </Label>
          </group>
        );
      })}
    </group>
  );
}

/** The drawn search area (evidence, disaster). */
function AreaOutline({ bundle }: { bundle: AreaBundle }) {
  const area = useStore((s) => s.area);
  const mission = useStore((s) => s.mission);
  if (!area || MISSIONS[mission].source !== 'area') return null;
  const [cx, cy] = sectorCentroid(area);
  return (
    <group>
      <DrapedLine bundle={bundle} pts={outline(area)} color={COLORS.amber} lift={5} />
      <Label position={toScene(bundle, cx, cy, 30)} tone="amber">
        {mission === 'disaster' ? 'Debris field' : 'Search area'}
      </Label>
    </group>
  );
}

export function Markers({ bundle }: { bundle: AreaBundle }) {
  return (
    <group>
      <LkpMarker bundle={bundle} />
      <ChildMarker bundle={bundle} />
      <Hides bundle={bundle} />
      <AreaOutline bundle={bundle} />
      <SearchedSectors bundle={bundle} />
      <SearchDraftPreview bundle={bundle} />
      <Suggestions bundle={bundle} />
      <BrushCursor bundle={bundle} />
    </group>
  );
}
