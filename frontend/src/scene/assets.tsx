/**
 * Low-poly asset kit (Synty POLYGON Adventure / Kids / Dog, converted by scripts/synty/).
 * - kit.glb: every prop and posed character as a named top-level mesh (metres, facing +x, base at y = 0)
 * - dog.glb + dog_clips.json: the skinned rescue dog and its animation clips
 * Everything fails soft: callers get null and draw primitives instead.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { floatGeometry, gltfLoader } from './useModel';

const BASE = `${import.meta.env.BASE_URL}models/`;

export interface KitPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** bounding size (m) */
  size: THREE.Vector3;
}
export type Kit = Map<string, KitPart>;

async function fetchGlb(name: string) {
  const r = await fetch(BASE + name);
  if (!r.ok) return null;
  const buf = await r.arrayBuffer();
  if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== 'glTF') return null;
  return gltfLoader().parseAsync(buf, BASE);
}

/** Shared tweak so every Synty atlas reads as flat, matte, crisp colour swatches. */
function matte(m: THREE.Material): THREE.Material {
  const s = m as THREE.MeshStandardMaterial;
  if (s.map) {
    s.map.magFilter = THREE.NearestFilter;
    s.map.minFilter = THREE.NearestMipmapLinearFilter;
    s.map.colorSpace = THREE.SRGBColorSpace;
  }
  if ('roughness' in s) {
    s.roughness = 1;
    s.metalness = 0;
  }
  s.flatShading = true;
  s.needsUpdate = true;
  return m;
}

let kitP: Promise<Kit | null> | null = null;
export function loadKit(): Promise<Kit | null> {
  kitP ??= (async () => {
    try {
      const gltf = await fetchGlb('kit.glb');
      if (!gltf) return null;
      const kit: Kit = new Map();
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const geometry = floatGeometry(m.geometry).applyMatrix4(m.matrixWorld);
        geometry.computeBoundingBox();
        const size = geometry.boundingBox!.getSize(new THREE.Vector3());
        kit.set(m.name, { geometry, material: matte(Array.isArray(m.material) ? m.material[0] : m.material), size });
      });
      return kit;
    } catch {
      return null;
    }
  })();
  return kitP;
}

export function useKit(): Kit | null {
  const [kit, setKit] = useState<Kit | null>(null);
  useEffect(() => {
    let alive = true;
    loadKit().then((k) => alive && setKit(k));
    return () => {
      alive = false;
    };
  }, []);
  return kit;
}

/** A single kit mesh as a JSX-ready object (shares geometry and material). */
export function KitMesh({ kit, name, ...props }: { kit: Kit | null; name: string } & JSX.IntrinsicElements['group']) {
  const part = kit?.get(name);
  if (!part) return null;
  return (
    <group {...props}>
      <mesh geometry={part.geometry} material={part.material} castShadow receiveShadow />
    </group>
  );
}

// ---------------------------------------------------------------- dog

export type DogClip = 'idle' | 'sniff' | 'walk' | 'run' | 'bark' | 'sit' | 'wag';
interface DogAssets {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}

let dogP: Promise<DogAssets | null> | null = null;
export function loadDog(): Promise<DogAssets | null> {
  dogP ??= (async () => {
    try {
      const [gltf, clipJson] = await Promise.all([
        fetchGlb('dog.glb'),
        fetch(BASE + 'dog_clips.json')
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
      ]);
      if (!gltf) return null;
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          matte(m.material as THREE.Material);
          m.castShadow = true;
          m.frustumCulled = false;
        }
      });
      const clips = (clipJson as unknown[]).map((c) => THREE.AnimationClip.parse(c as Parameters<typeof THREE.AnimationClip.parse>[0]));
      return { scene: gltf.scene, clips };
    } catch {
      return null;
    }
  })();
  return dogP;
}

/**
 * An animated dog: its own skeleton clone and mixer. `clip` cross-fades when it changes.
 * Returns the object to mount (or null while loading / if the model is missing).
 */
export function useDog(clip: DogClip, { speed = 1, offset = 0 }: { speed?: number; offset?: number } = {}) {
  const [assets, setAssets] = useState<DogAssets | null>(null);
  useEffect(() => {
    let alive = true;
    loadDog().then((a) => alive && setAssets(a));
    return () => {
      alive = false;
    };
  }, []);
  const rig = useMemo(() => {
    if (!assets) return null;
    const obj = SkeletonUtils.clone(assets.scene) as THREE.Group;
    const mixer = new THREE.AnimationMixer(obj);
    return { obj, mixer, clips: assets.clips };
  }, [assets]);
  const current = useRef<THREE.AnimationAction | null>(null);
  useEffect(() => {
    if (!rig) return;
    const c = rig.clips.find((x) => x.name === clip);
    if (!c) return;
    const next = rig.mixer.clipAction(c);
    next.reset();
    next.time = offset * c.duration;
    next.setEffectiveTimeScale(speed);
    next.setEffectiveWeight(1);
    if (clip === 'sit') {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    }
    next.play();
    if (current.current && current.current !== next) next.crossFadeFrom(current.current, 0.35, false);
    current.current = next;
  }, [rig, clip, speed, offset]);
  useFrame((_, dt) => rig?.mixer.update(Math.min(dt, 0.1)));
  useEffect(
    () => () => {
      rig?.mixer.stopAllAction();
    },
    [rig],
  );
  return rig?.obj ?? null;
}
