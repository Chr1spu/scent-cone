import { useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { AreaBundle } from '../api/types';
import { VERT_EXAG } from '../config/constants';
import { elevationAt } from '../geo/heights';

/** Models are drawn larger than life so they read at kilometre scale. */
export const MODEL_SCALE = 9;

export function drapedPath(bundle: AreaBundle, pts: [number, number][], lift = 3): Float32Array {
  const out = new Float32Array(pts.length * 3);
  pts.forEach(([x, y], i) => {
    out[i * 3] = x;
    out[i * 3 + 1] = (elevationAt(bundle, x, y) + lift) * VERT_EXAG;
    out[i * 3 + 2] = -y;
  });
  return out;
}

export function circlePts(x: number, y: number, r: number, n = 72): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  return pts;
}

export function DrapedLine({ bundle, pts, color, opacity = 0.9, lift = 3, dashed = false }: { bundle: AreaBundle; pts: [number, number][]; color: string; opacity?: number; lift?: number; dashed?: boolean }) {
  const line = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(drapedPath(bundle, pts, lift), 3));
    const m = dashed
      ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 25, gapSize: 15, depthTest: false })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
    const l = new THREE.Line(g, m);
    if (dashed) l.computeLineDistances();
    l.renderOrder = 8;
    return l;
  }, [bundle, pts, color, opacity, lift, dashed]);
  return <primitive object={line} />;
}

/** Vertical light beam + pulsing ground ring. */
export function Beacon({ position, color, height = 140, radius = 22, pulse = true }: { position: [number, number, number]; color: string; height?: number; radius?: number; pulse?: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ring.current || !pulse) return;
    const t = (clock.elapsedTime % 2) / 2;
    ring.current.scale.setScalar(1 + t * 1.6);
    (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - t);
  });
  return (
    <group position={position}>
      <mesh position={[0, (height * VERT_EXAG) / 2, 0]} renderOrder={9}>
        <cylinderGeometry args={[2.2, 2.2, height * VERT_EXAG, 8, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.45} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 3, 0]} renderOrder={9}>
        <ringGeometry args={[radius * 0.8, radius, 40]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} depthWrite={false} depthTest={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export function Label({ position, children, tone = 'default' }: { position: [number, number, number]; children: ReactNode; tone?: 'default' | 'amber' | 'pink' | 'cyan' | 'warn' }) {
  const toneCls: Record<string, string> = {
    default: 'border-white/15 text-slate-100',
    amber: 'border-amber-300/50 text-amber-100',
    pink: 'border-pink-400/60 text-pink-100',
    cyan: 'border-cyan-300/50 text-cyan-100',
    warn: 'border-orange-400/70 text-orange-100',
  };
  return (
    <Html position={position} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`whitespace-nowrap rounded-md border bg-ink-900/85 px-2 py-1 text-[11px] font-medium shadow-lg backdrop-blur ${toneCls[tone]}`}>{children}</div>
    </Html>
  );
}
