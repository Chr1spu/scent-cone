import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useStore } from '../state/store';

const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Orbit controls + eased camera flights to store.camera shots (presets, view toggle). */
export function CameraRig() {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const shot = useStore((s) => s.camera);
  const view = useStore((s) => s.view);
  const anim = useRef<{ p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3; start: number; dur: number } | null>(null);

  useEffect(() => {
    if (!shot || !controls.current) return;
    const p1 = new THREE.Vector3(...shot.position);
    const t1 = new THREE.Vector3(...shot.target);
    if (reduceMotion) {
      camera.position.copy(p1);
      controls.current.target.copy(t1);
      controls.current.update();
      return;
    }
    anim.current = { p0: camera.position.clone(), t0: controls.current.target.clone(), p1, t1, start: performance.now(), dur: 1800 };
  }, [shot, camera]);

  useFrame(() => {
    const a = anim.current;
    const c = controls.current;
    if (!a || !c) return;
    const k = Math.min(1, (performance.now() - a.start) / a.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    camera.position.lerpVectors(a.p0, a.p1, e);
    // arc upward mid-flight for a smoother feel
    camera.position.y += Math.sin(Math.PI * e) * a.p0.distanceTo(a.p1) * 0.12;
    c.target.lerpVectors(a.t0, a.t1, e);
    c.update();
    if (k >= 1) anim.current = null;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={view === 'map' ? Math.PI * 0.32 : Math.PI * 0.47}
      minDistance={80}
      maxDistance={30000}
      onStart={() => (anim.current = null)}
    />
  );
}
