// Generates the low-poly .glb models in public/models/ (original assets, no licence strings).
// Each model is one merged mesh with flat vertex colours, metres, facing +x, base at y = 0.
//   node scripts/make_models.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// GLTFExporter's binary path uses FileReader, which Node lacks.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = b;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:application/octet-stream;base64,${Buffer.from(b).toString('base64')}`;
      this.onloadend?.();
    });
  }
};

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');
mkdirSync(OUT, { recursive: true });

/** A coloured, transformed, non-indexed piece of a model. */
function part(geo, color, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
  g.applyMatrix4(m);
  g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r, h, s = 7) => new THREE.ConeGeometry(r, h, s);
const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
const sph = (r) => new THREE.SphereGeometry(r, 8, 6);

async function save(name, parts) {
  const geo = mergeGeometries(parts, false);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0 }));
  mesh.name = name.replace('.glb', '');
  const scene = new THREE.Scene();
  scene.add(mesh);
  const buf = await new GLTFExporter().parseAsync(scene, { binary: true });
  writeFileSync(join(OUT, name), Buffer.from(buf));
  console.log(`${name}: ${geo.attributes.position.count / 3} triangles, ${(buf.byteLength / 1024).toFixed(1)} kB`);
}

// ---- dog: a lab-type air-scent dog (~0.6 m at the shoulder) in an orange SAR harness
const COAT = '#b07a3e';
const COAT_D = '#8a5a2b';
await save('dog.glb', [
  part(box(0.72, 0.3, 0.3), COAT, { pos: [0, 0.52, 0] }),
  part(box(0.26, 0.34, 0.3), COAT, { pos: [0.3, 0.55, 0] }), // chest
  part(box(0.16, 0.26, 0.2), COAT, { pos: [0.44, 0.72, 0], rot: [0, 0, -0.5] }), // neck
  part(box(0.24, 0.2, 0.22), COAT, { pos: [0.56, 0.84, 0] }), // head
  part(box(0.16, 0.12, 0.14), COAT_D, { pos: [0.72, 0.8, 0] }), // muzzle
  part(box(0.04, 0.05, 0.08), '#1b1b1b', { pos: [0.8, 0.83, 0] }), // nose
  part(box(0.08, 0.16, 0.04), COAT_D, { pos: [0.52, 0.8, 0.13], rot: [0.2, 0, 0] }), // ears
  part(box(0.08, 0.16, 0.04), COAT_D, { pos: [0.52, 0.8, -0.13], rot: [-0.2, 0, 0] }),
  ...[
    [0.28, 0.1],
    [0.28, -0.1],
    [-0.28, 0.1],
    [-0.28, -0.1],
  ].map(([x, z]) => part(cyl(0.045, 0.04, 0.42, 6), COAT_D, { pos: [x, 0.21, z] })),
  part(cyl(0.025, 0.04, 0.34, 6), COAT, { pos: [-0.46, 0.66, 0], rot: [0, 0, 1.0] }), // tail, up and back
  part(box(0.42, 0.08, 0.34), '#ff7a1a', { pos: [0.02, 0.68, 0] }), // harness
  part(box(0.06, 0.32, 0.33), '#ff7a1a', { pos: [0.22, 0.56, 0] }),
  part(box(0.3, 0.025, 0.345), '#e9ff5a', { pos: [0.02, 0.725, 0] }), // reflective strip
]);

// ---- handler: SAR K9 handler (~1.8 m), orange jacket, hi-vis vest, red helmet, pack
const SKIN = '#d9a77f';
await save('handler.glb', [
  part(box(0.16, 0.86, 0.16), '#2e3540', { pos: [0, 0.43, 0.11] }), // legs
  part(box(0.16, 0.86, 0.16), '#2e3540', { pos: [0, 0.43, -0.11] }),
  part(box(0.24, 0.08, 0.16), '#3a2a1e', { pos: [0.04, 0.04, 0.11] }), // boots
  part(box(0.24, 0.08, 0.16), '#3a2a1e', { pos: [0.04, 0.04, -0.11] }),
  part(box(0.28, 0.62, 0.46), '#e8662c', { pos: [0, 1.18, 0] }), // torso
  part(box(0.3, 0.06, 0.47), '#e9ff5a', { pos: [0, 1.1, 0] }), // reflective bands
  part(box(0.3, 0.06, 0.47), '#e9ff5a', { pos: [0, 1.3, 0] }),
  part(box(0.24, 0.5, 0.36), '#3d4a3a', { pos: [-0.26, 1.2, 0] }), // backpack
  part(box(0.12, 0.6, 0.12), '#e8662c', { pos: [0.06, 1.12, 0.3], rot: [0.12, 0, 0.25] }), // arms
  part(box(0.12, 0.6, 0.12), '#e8662c', { pos: [0.06, 1.12, -0.3], rot: [-0.12, 0, 0.25] }),
  part(box(0.12, 0.12, 0.12), SKIN, { pos: [0.16, 0.82, 0.33] }), // hands
  part(box(0.12, 0.12, 0.12), SKIN, { pos: [0.16, 0.82, -0.33] }),
  part(box(0.1, 0.08, 0.1), SKIN, { pos: [0, 1.52, 0] }), // neck
  part(box(0.24, 0.26, 0.22), SKIN, { pos: [0.02, 1.68, 0] }), // head
  part(sph(0.15), '#d23a2a', { pos: [0, 1.79, 0], scale: [1.05, 0.7, 1] }), // helmet
  part(box(0.04, 0.05, 0.16), '#1b1b1b', { pos: [0.13, 1.71, 0] }), // eyes/brow
]);

// ---- conifer: trunk + three stacked cones (~12 m)
await save('tree_conifer.glb', [
  part(cyl(0.22, 0.3, 2.6, 6), '#5a3e28', { pos: [0, 1.3, 0] }),
  part(cone(2.6, 4.6), '#23472f', { pos: [0, 4.4, 0] }),
  part(cone(2.1, 4.0), '#2a5236', { pos: [0, 6.8, 0] }),
  part(cone(1.4, 3.6), '#31603e', { pos: [0, 9.2, 0], rot: [0, 0.4, 0] }),
  part(cone(0.7, 2.2), '#376a44', { pos: [0, 11.0, 0] }),
]);

// ---- broadleaf: trunk + clustered crowns (~11 m)
await save('tree_broadleaf.glb', [
  part(cyl(0.22, 0.32, 4.6, 6), '#5e4330', { pos: [0, 2.3, 0] }),
  part(cyl(0.1, 0.14, 2.2, 5), '#5e4330', { pos: [0.6, 4.6, 0.2], rot: [0.2, 0, -0.6] }),
  part(ico(2.6), '#3f6a33', { pos: [0, 7.4, 0], scale: [1, 0.85, 1] }),
  part(ico(1.9), '#4a7a3a', { pos: [1.5, 6.6, 0.8] }),
  part(ico(1.8), '#36602d', { pos: [-1.3, 6.8, -0.9] }),
  part(ico(1.5), '#4f8240', { pos: [0.3, 9.2, -0.4] }),
]);

// ---- shrub
await save('shrub.glb', [
  part(ico(0.9), '#56692f', { pos: [0, 0.75, 0], scale: [1.2, 0.8, 1.1] }),
  part(ico(0.7), '#617636', { pos: [0.7, 0.6, 0.3] }),
  part(ico(0.6), '#4b5d29', { pos: [-0.5, 0.55, -0.5] }),
]);

// ---- tent: orange A-frame with a dark door, ~1.4 m
// a 3-sided cylinder rotated -90° about x: ridge vertex up, long axis along z
await save('tent.glb', [
  part(cyl(1.25, 1.25, 2.6, 3), '#e8823a', { pos: [0, 0.62, 0], rot: [-Math.PI / 2, 0, 0] }),
  part(box(0.6, 0.8, 0.02), '#2a1d14', { pos: [0, 0.42, 1.31] }), // door on the front gable
  part(box(2.9, 0.05, 2.0), '#3d4a3a', { pos: [0, 0.025, 0] }), // groundsheet
]);

// ---- LKP marker: survey stake with a red/white flag
await save('lkp_marker.glb', [
  part(cyl(0.04, 0.05, 2.4, 6), '#d8d8d8', { pos: [0, 1.2, 0] }),
  part(box(0.7, 0.45, 0.02), '#e03030', { pos: [0.37, 2.1, 0] }),
  part(box(0.35, 0.45, 0.025), '#ffffff', { pos: [0.55, 2.1, 0] }),
  part(cone(0.18, 0.12, 6), '#9a9a9a', { pos: [0, 0.06, 0] }),
]);

// ---- child marker: 9-year-old in a yellow rain jacket (~1.35 m)
await save('child_marker.glb', [
  part(box(0.12, 0.6, 0.12), '#2f4f8f', { pos: [0, 0.3, 0.08] }),
  part(box(0.12, 0.6, 0.12), '#2f4f8f', { pos: [0, 0.3, -0.08] }),
  part(box(0.2, 0.46, 0.34), '#ffd23f', { pos: [0, 0.82, 0] }),
  part(box(0.09, 0.42, 0.09), '#ffd23f', { pos: [0.02, 0.8, 0.22], rot: [0.15, 0, 0] }),
  part(box(0.09, 0.42, 0.09), '#ffd23f', { pos: [0.02, 0.8, -0.22], rot: [-0.15, 0, 0] }),
  part(box(0.19, 0.2, 0.18), '#e8b48f', { pos: [0, 1.17, 0] }),
  part(sph(0.13), '#ffd23f', { pos: [-0.02, 1.25, 0], scale: [1.05, 0.8, 1.05] }), // hood
]);

// ---- landmark: stone cairn
await save('landmark.glb', [
  part(new THREE.DodecahedronGeometry(0.9), '#8d8a84', { pos: [0, 0.6, 0], scale: [1.2, 0.7, 1.1] }),
  part(new THREE.DodecahedronGeometry(0.7), '#a29f98', { pos: [0.1, 1.45, 0], scale: [1, 0.7, 1] }),
  part(new THREE.DodecahedronGeometry(0.5), '#7f7c76', { pos: [0, 2.1, 0.05], scale: [1, 0.75, 1] }),
  part(new THREE.DodecahedronGeometry(0.3), '#b3b0a9', { pos: [0.05, 2.55, 0] }),
]);
