import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type ModelName =
  | 'dog.glb'
  | 'handler.glb'
  | 'tree_conifer.glb'
  | 'tree_broadleaf.glb'
  | 'shrub.glb'
  | 'tent.glb'
  | 'lkp_marker.glb'
  | 'child_marker.glb'
  | 'landmark.glb';

const cache = new Map<string, Promise<THREE.Group | null>>();

/**
 * Loads /models/<name>. Resolves null (never throws) if the file is missing or not a GLB —
 * callers render placeholder primitives instead. Dev servers answer missing files with
 * index.html, so the GLB magic bytes are checked.
 */
export function loadModel(name: ModelName): Promise<THREE.Group | null> {
  let p = cache.get(name);
  if (!p) {
    p = (async () => {
      try {
        const r = await fetch(`/models/${name}`);
        if (!r.ok) return null;
        const buf = await r.arrayBuffer();
        const magic = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(4, buf.byteLength)));
        if (magic !== 'glTF') return null;
        const gltf = await new GLTFLoader().parseAsync(buf, '/models/');
        const scene = gltf.scene;
        // normalise: base at y = 0
        const box = new THREE.Box3().setFromObject(scene);
        scene.position.y -= box.min.y;
        const g = new THREE.Group();
        g.add(scene);
        g.userData.height = box.max.y - box.min.y;
        g.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = false;
        });
        return g;
      } catch {
        return null;
      }
    })();
    cache.set(name, p);
  }
  return p;
}

/** React hook: the loaded model (cloned per use) or null while loading / missing. */
export function useModel(name: ModelName): THREE.Group | null {
  const [model, setModel] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let alive = true;
    loadModel(name).then((m) => alive && setModel(m ? m.clone(true) : null));
    return () => {
      alive = false;
    };
  }, [name]);
  return model;
}

/** First mesh geometry + material inside a model (for instancing), if any. */
export function firstMesh(g: THREE.Group | null): { geometry: THREE.BufferGeometry; material: THREE.Material } | null {
  if (!g) return null;
  let found: THREE.Mesh | null = null;
  g.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
  });
  if (!found) return null;
  const m = found as THREE.Mesh;
  m.updateWorldMatrix(true, false);
  const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
  const mat = Array.isArray(m.material) ? m.material[0] : m.material;
  return { geometry: geo, material: mat };
}
