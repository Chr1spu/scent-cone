import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** A GLTF loader that reads meshopt-compressed files (all models in public/models are). */
export function gltfLoader(): GLTFLoader {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}

/**
 * Copy of a geometry with every attribute as plain Float32 (meshopt stores quantized integers,
 * which would clamp if a transform were baked into them).
 */
export function floatGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.clone();
  for (const [name, a] of Object.entries(g.attributes)) {
    const attr = a as THREE.BufferAttribute;
    if (attr.array instanceof Float32Array && !attr.normalized) continue;
    const out = new Float32Array(attr.count * attr.itemSize);
    for (let i = 0; i < attr.count; i++) for (let k = 0; k < attr.itemSize; k++) out[i * attr.itemSize + k] = attr.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
  }
  return g;
}

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

/** Real-world height (m) each model is normalised to, whatever units the file uses. */
const TARGET_HEIGHT_M: Record<ModelName, number> = {
  'dog.glb': 0.7,
  'handler.glb': 1.8,
  'tree_conifer.glb': 18, // matches the ×1.5-exaggerated primitive trees
  'tree_broadleaf.glb': 16,
  'shrub.glb': 2.2,
  'tent.glb': 1.6,
  'lkp_marker.glb': 2.5,
  'child_marker.glb': 1.4,
  'landmark.glb': 6,
};

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
        const r = await fetch(`${import.meta.env.BASE_URL}models/${name}`);
        if (!r.ok) return null;
        const buf = await r.arrayBuffer();
        const magic = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(4, buf.byteLength)));
        if (magic !== 'glTF') return null;
        const gltf = await gltfLoader().parseAsync(buf, `${import.meta.env.BASE_URL}models/`);
        const scene = gltf.scene;
        // normalise: real-world height, base at y = 0
        const box = new THREE.Box3().setFromObject(scene);
        const h = Math.max(box.max.y - box.min.y, 1e-6);
        const k = TARGET_HEIGHT_M[name] / h;
        scene.scale.multiplyScalar(k);
        scene.position.y = -box.min.y * k;
        const g = new THREE.Group();
        g.add(scene);
        g.userData.height = TARGET_HEIGHT_M[name];
        g.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = false;
          m.frustumCulled = false;
          // Synty atlases are flat colour swatches: keep them crisp and matte
          const mat = m.material as THREE.MeshStandardMaterial;
          if (mat.map) mat.map.magFilter = THREE.NearestFilter;
          if ('roughness' in mat) {
            mat.roughness = 1;
            mat.metalness = 0;
          }
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
    // SkeletonUtils.clone keeps skinned meshes bound to their own cloned skeleton
    loadModel(name).then((m) => alive && setModel(m ? (SkeletonUtils.clone(m) as THREE.Group) : null));
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
  const geo = floatGeometry(m.geometry).applyMatrix4(m.matrixWorld);
  const mat = Array.isArray(m.material) ? m.material[0] : m.material;
  return { geometry: geo, material: mat };
}
