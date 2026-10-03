import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { AreaBundle } from '../api/types';
import { TREE_CAP, TREE_M2, TREE_SEED, VERT_EXAG } from '../config/constants';
import { cellCenterLocal, gridMap, sampleLocal } from '../geo/grid';
import { Rng } from '../models/rng';
import { LC } from '../models/terrainInfo';
import { useStore } from '../state/store';
import { firstMesh, useModel } from './useModel';

interface Placement {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
}

function placeTrees(bundle: AreaBundle): { conifer: Placement[]; broadleaf: Placement[]; shrub: Placement[] } {
  const { detail, frame } = bundle;
  const map = gridMap(detail.meta, frame);
  const cellArea = detail.meta.cellSize ** 2;
  let forest = 0;
  for (const v of detail.landcover) if (v === LC.forest) forest++;
  const expected = (forest * cellArea) / TREE_M2;
  const thin = Math.min(1, TREE_CAP / Math.max(expected, 1));
  const pTree = (cellArea / TREE_M2) * thin;
  const rng = new Rng(TREE_SEED);
  const out = { conifer: [] as Placement[], broadleaf: [] as Placement[], shrub: [] as Placement[] };
  const cs = detail.meta.cellSize;
  for (let i = 0; i < detail.landcover.length; i++) {
    const lc = detail.landcover[i];
    const isForest = lc === LC.forest;
    const isShrub = lc === LC.shrub || lc === LC.wetland;
    if (!isForest && !isShrub) continue;
    const p = isForest ? pTree : pTree * 0.6;
    let k = Math.floor(p) + (rng.next() < p - Math.floor(p) ? 1 : 0);
    const [cx, cy] = cellCenterLocal(map, i);
    while (k-- > 0) {
      const x = cx + (rng.next() - 0.5) * cs;
      const y = cy + (rng.next() - 0.5) * cs;
      const elev = sampleLocal(detail.elev, map, x, y);
      const pl = { x, y: elev * VERT_EXAG, z: -y, s: rng.uniform(0.75, 1.35), rot: rng.uniform(0, Math.PI * 2) };
      if (isShrub) out.shrub.push(pl);
      else if (elev > 850 ? rng.next() < 0.75 : rng.next() < 0.35) out.conifer.push(pl);
      else out.broadleaf.push(pl);
    }
  }
  return out;
}

function Instanced({ items, geometry, material }: { items: Placement[]; geometry: THREE.BufferGeometry; material: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    items.forEach((p, i) => {
      o.position.set(p.x, p.y, p.z);
      o.rotation.set(0, p.rot, 0);
      o.scale.setScalar(p.s);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} frustumCulled={false} />;
}

/** Low-poly instanced trees from land cover (seeded), only in scene view. */
export function Vegetation({ bundle }: { bundle: AreaBundle }) {
  const visible = useStore((s) => s.layers.vegetation && s.view === 'scene');
  const placements = useMemo(() => placeTrees(bundle), [bundle]);
  const coniferGlb = firstMesh(useModel('tree_conifer.glb'));
  const broadGlb = firstMesh(useModel('tree_broadleaf.glb'));
  const shrubGlb = firstMesh(useModel('shrub.glb'));
  const prims = useMemo(() => {
    // tree heights ~12 m (×VERT_EXAG so they read against exaggerated terrain)
    const h = 12 * VERT_EXAG;
    const conifer = new THREE.ConeGeometry(2.4, h, 6);
    conifer.translate(0, h / 2, 0);
    const broad = new THREE.IcosahedronGeometry(3.2, 0);
    broad.scale(1, 1.3, 1);
    broad.translate(0, h * 0.62, 0);
    const shrub = new THREE.IcosahedronGeometry(1.8, 0);
    shrub.translate(0, 1.6, 0);
    return {
      conifer,
      broad,
      shrub,
      coniferMat: new THREE.MeshLambertMaterial({ color: '#24452f', flatShading: true }),
      broadMat: new THREE.MeshLambertMaterial({ color: '#3c5a30', flatShading: true }),
      shrubMat: new THREE.MeshLambertMaterial({ color: '#5b6533', flatShading: true }),
    };
  }, []);
  if (!visible) return null;
  return (
    <group>
      <Instanced items={placements.conifer} geometry={coniferGlb?.geometry ?? prims.conifer} material={coniferGlb?.material ?? prims.coniferMat} />
      <Instanced items={placements.broadleaf} geometry={broadGlb?.geometry ?? prims.broad} material={broadGlb?.material ?? prims.broadMat} />
      <Instanced items={placements.shrub} geometry={shrubGlb?.geometry ?? prims.shrub} material={shrubGlb?.material ?? prims.shrubMat} />
    </group>
  );
}
