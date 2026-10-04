import { useMemo } from 'react';
import * as THREE from 'three';
import type { AreaBundle } from '../api/types';
import { COLORS, VERT_EXAG } from '../config/constants';
import { toScene } from '../geo/heights';
import { fmtTime } from '../state/controller';
import { useStore } from '../state/store';
import type { DeploymentOut } from '../workers/protocol';
import { Beacon, DrapedLine, Label, MODEL_SCALE, circlePts } from './primitives';
import { useDog } from './assets';
import { useModel } from './useModel';

function PlaceholderDog({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, 0.55, 0]}>
        <boxGeometry args={[1.0, 0.38, 0.32]} />
        <meshStandardMaterial color="#9b6b3d" flatShading />
      </mesh>
      <mesh position={[0.58, 0.78, 0]}>
        <boxGeometry args={[0.3, 0.28, 0.26]} />
        <meshStandardMaterial color="#8a5c33" flatShading />
      </mesh>
      {[-0.38, 0.38].map((x) =>
        [-0.11, 0.11].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.2, z]}>
            <boxGeometry args={[0.1, 0.4, 0.1]} />
            <meshStandardMaterial color="#6e4a2a" />
          </mesh>
        )),
      )}
      <mesh position={[0, 0.76, 0]}>
        <boxGeometry args={[0.5, 0.06, 0.34]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
      </mesh>
    </group>
  );
}

function PlaceholderHandler({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, 0.95, 0]}>
        <capsuleGeometry args={[0.25, 1.0, 4, 10]} />
        <meshStandardMaterial color="#e8662c" flatShading />
      </mesh>
      <mesh position={[0, 1.75, 0]}>
        <sphereGeometry args={[0.17, 12, 12]} />
        <meshStandardMaterial color="#e6c2a0" />
      </mesh>
      <mesh position={[0, 1.05, 0]}>
        <cylinderGeometry args={[0.27, 0.27, 0.12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}

function Team({ bundle, d }: { bundle: AreaBundle; d: DeploymentOut }) {
  const color = COLORS.team[(d.team - 1) % COLORS.team.length];
  // animated rescue dog working the scent (falls back to the static model, then a primitive)
  const dogRig = useDog('sniff', { offset: (d.team * 0.37) % 1 });
  const dogGlb = useModel('dog.glb');
  const handlerGlb = useModel('handler.glb');
  const p = toScene(bundle, d.x, d.y);
  const arrowLen = 170;
  const tip: [number, number] = [d.x + d.upwind[0] * arrowLen, d.y + d.upwind[1] * arrowLen];
  const arrowPts = useMemo(() => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 12; i++) pts.push([d.x + (d.upwind[0] * arrowLen * i) / 12, d.y + (d.upwind[1] * arrowLen * i) / 12]);
    return pts;
  }, [d]);
  const tipP = toScene(bundle, tip[0], tip[1], 6);
  // cone axis is +Y; point it upwind (scene: east = +x, north = -z)
  const coneQuat = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(d.upwind[0], 0, -d.upwind[1]).normalize()),
    [d],
  );
  // models face +x; yaw so +x maps to the upwind direction
  const rotY = Math.atan2(d.upwind[1], d.upwind[0]);
  return (
    <group>
      <group position={p} rotation={[0, rotY, 0]}>
        <group position={[4, 0, 0]} scale={MODEL_SCALE}>
          {dogRig ? <primitive object={dogRig} scale={0.75} /> : dogGlb ? <primitive object={dogGlb} /> : <PlaceholderDog color={color} />}
        </group>
        <group position={[-8, 0, 6]} scale={MODEL_SCALE}>
          {handlerGlb ? <primitive object={handlerGlb} /> : <PlaceholderHandler color={color} />}
        </group>
      </group>
      <DrapedLine bundle={bundle} pts={arrowPts} color={color} lift={6} />
      <mesh position={tipP} quaternion={coneQuat} renderOrder={9}>
        <coneGeometry args={[12, 34, 12]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
      </mesh>
      <DrapedLine bundle={bundle} pts={circlePts(d.x, d.y, 60)} color={color} lift={4} opacity={0.7} />
      <Beacon position={p} color={color} height={70} radius={14} pulse={false} />
      <Label position={[p[0], p[1] + 95 * VERT_EXAG, p[2]]} tone="amber">
        Team {d.team}: best {fmtTime(d.bestWindow[0])} to {fmtTime(d.bestWindow[1])}, covers{' '}
        {(d.coveredProb * 100).toFixed(1)}%
      </Label>
    </group>
  );
}

export function DogTeams({ bundle }: { bundle: AreaBundle }) {
  const deps = useStore((s) => s.deployments);
  const visible = useStore((s) => s.layers.teams);
  if (!visible) return null;
  return (
    <group>
      {deps.map((d) => (
        <Team key={d.team} bundle={bundle} d={d} />
      ))}
    </group>
  );
}
