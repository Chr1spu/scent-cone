import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { AreaBundle, GridLevel } from '../api/types';
import { CONTOUR_DETAIL_M, CONTOUR_OVERVIEW_M, VERT_EXAG } from '../config/constants';
import { gridMap, insideGrid, localBounds, type Frame } from '../geo/grid';
import { sunAt } from '../models/env';
import { addAlert, addHide, brush, searchClick, setLkp } from '../state/controller';
import { useStore } from '../state/store';
import { byteTexture, createTerrainMaterial } from './ContourMaterial';

function buildGeometry(level: GridLevel, frame: Frame, step = 1): THREE.BufferGeometry {
  const { meta, elev } = level;
  const b = localBounds(meta, frame);
  const cs = meta.cellSize;
  const cols = Math.floor((meta.cols - 1) / step) + 1;
  const rows = Math.floor((meta.rows - 1) / step) + 1;
  const g = new THREE.PlaneGeometry((cols - 1) * cs * step, (rows - 1) * cs * step, cols - 1, rows - 1);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const cx = b.minX + cs / 2 + ((cols - 1) * cs * step) / 2;
  const cz = -(b.maxY - cs / 2) + ((rows - 1) * cs * step) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      pos.setX(k, pos.getX(k) + cx);
      pos.setZ(k, pos.getZ(k) + cz);
      pos.setY(k, elev[r * step * meta.cols + c * step] * VERT_EXAG);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function overlayBounds(level: GridLevel, frame: Frame): THREE.Vector4 {
  const b = localBounds(level.meta, frame);
  return new THREE.Vector4(b.minX, -b.maxY, b.w, b.h);
}

function rectOf(level: GridLevel, frame: Frame): THREE.Vector4 {
  const b = localBounds(level.meta, frame);
  return new THREE.Vector4(b.minX, -b.maxY, b.maxX, -b.minY);
}

export function Terrain({ bundle }: { bundle: AreaBundle }) {
  const { frame, overview, detail } = bundle;
  const detailGeo = useMemo(() => buildGeometry(detail, frame), [detail, frame]);
  const detailMap = useMemo(() => gridMap(detail.meta, frame), [detail, frame]);
  const overviewGeo = useMemo(() => buildGeometry(overview, frame), [overview, frame]);
  const range = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of overview.elev) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return { lo, hi };
  }, [overview]);
  const detailMat = useMemo(() => {
    const m = createTerrainMaterial({ exag: VERT_EXAG, min: range.lo, max: range.hi, interval: CONTOUR_DETAIL_M });
    m.uniforms.uBounds.value = overlayBounds(detail, frame);
    m.uniforms.uLC.value = byteTexture(detail.landcover.slice(), detail.meta.cols, detail.meta.rows, THREE.RedFormat, false);
    return m;
  }, [detail, frame, range]);
  const overviewMat = useMemo(() => {
    const m = createTerrainMaterial({ exag: VERT_EXAG, min: range.lo, max: range.hi, interval: CONTOUR_OVERVIEW_M });
    m.uniforms.uBounds.value = overlayBounds(overview, frame);
    m.uniforms.uLC.value = byteTexture(overview.landcover.slice(), overview.meta.cols, overview.meta.rows, THREE.RedFormat, false);
    const inset = detail.meta.cellSize; // detail vertices sit at cell centres: keep a thin overlap
    m.uniforms.uHole.value = rectOf(detail, frame).add(new THREE.Vector4(inset, inset, -inset, -inset));
    m.uniforms.uHoleOn.value = 1;
    m.uniforms.uFocus.value = rectOf(detail, frame);
    m.uniforms.uFocusOn.value = 1;
    return m;
  }, [overview, detail, frame, range]);

  // ---- overlay textures from store
  const prob = useStore((s) => s.prob);
  const heat = useStore((s) => s.heat);
  const alerts = useStore((s) => s.alerts);
  const layers = useStore((s) => s.layers);
  const view = useStore((s) => s.view);
  const focusPreview = useStore((s) => s.focusPreview);

  useEffect(() => {
    if (!prob) return;
    const ovArea = overview.meta.cellSize ** 2;
    const dArea = detail.meta.cellSize ** 2;
    let mx = 0;
    for (const v of prob.overview) mx = Math.max(mx, v / ovArea);
    for (const v of prob.detail) mx = Math.max(mx, (v * prob.segmentFraction) / dArea);
    const toBytes = (a: Float32Array, scale: number) => {
      const out = new Uint8Array(a.length);
      for (let i = 0; i < a.length; i++) out[i] = Math.min(255, Math.round(((a[i] * scale) / mx) * 255));
      return out;
    };
    const oT = byteTexture(toBytes(prob.overview, 1 / ovArea), overview.meta.cols, overview.meta.rows, THREE.RedFormat, true);
    const dT = byteTexture(toBytes(prob.detail, prob.segmentFraction / dArea), detail.meta.cols, detail.meta.rows, THREE.RedFormat, true);
    const old = [overviewMat.uniforms.uProb.value, detailMat.uniforms.uProb.value];
    overviewMat.uniforms.uProb.value = oT;
    detailMat.uniforms.uProb.value = dT;
    old.forEach((t: THREE.Texture) => t.dispose());
  }, [prob, overview, detail, overviewMat, detailMat]);

  useEffect(() => {
    if (!heat) return;
    const out = new Uint8Array(heat.heat.length);
    const hi = heat.hi || 1;
    for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.pow(Math.min(1, heat.heat[i] / (hi * 1.1)), 0.7) * 255);
    const old = detailMat.uniforms.uHeat.value as THREE.Texture;
    detailMat.uniforms.uHeat.value = byteTexture(out, detail.meta.cols, detail.meta.rows, THREE.RedFormat, true);
    old.dispose();
  }, [heat, detail, detailMat]);

  useEffect(() => {
    const n = detail.elev.length;
    const out = new Uint8Array(n * 4);
    alerts.slice(0, 4).forEach((a, k) => {
      for (let i = 0; i < n; i++) out[i * 4 + k] = Math.round(a.zone[i] * 255);
    });
    const old = detailMat.uniforms.uZones.value as THREE.Texture;
    detailMat.uniforms.uZones.value = byteTexture(out, detail.meta.cols, detail.meta.rows, THREE.RGBAFormat, true);
    old.dispose();
  }, [alerts, detail, detailMat]);

  useEffect(() => {
    for (const m of [detailMat, overviewMat]) {
      m.uniforms.uContoursOn.value = layers.contours ? 1 : 0;
      m.uniforms.uLCOn.value = layers.landcover ? 1 : 0;
      m.uniforms.uProbOn.value = layers.probability ? 1 : 0;
      m.uniforms.uFogColor.value.set(view === 'map' ? '#0a0f14' : '#1b2733');
      m.uniforms.uFogNear.value = view === 'map' ? 14000 : 7000;
      m.uniforms.uFogFar.value = view === 'map' ? 40000 : 22000;
    }
    detailMat.uniforms.uHeatOn.value = layers.heatmap ? 1 : 0;
    detailMat.uniforms.uZonesOn.value = layers.alertZones ? 1 : 0;
  }, [layers, view, detailMat, overviewMat]);

  useEffect(() => {
    if (focusPreview) {
      const h = (detail.meta.cols * detail.meta.cellSize) / 2;
      overviewMat.uniforms.uPreview.value.set(focusPreview[0] - h, -focusPreview[1] - h, focusPreview[0] + h, -focusPreview[1] + h);
      overviewMat.uniforms.uPreviewOn.value = 1;
    } else overviewMat.uniforms.uPreviewOn.value = 0;
  }, [focusPreview, detail, overviewMat]);

  // dusk dimming in scene view
  const lastT = useRef(-1);
  useFrame(() => {
    const s = useStore.getState();
    if (s.time === lastT.current && s.view === (detailMat.userData.view as string)) return;
    lastT.current = s.time;
    detailMat.userData.view = s.view;
    const c = bundle.config;
    const sun = sunAt({ date: c.date, lat: c.lat, lon: c.lon, utcOffsetSeconds: c.utcOffsetSeconds }, s.time);
    const dim = s.view === 'scene' ? 0.5 + 0.5 * THREE.MathUtils.smoothstep(sun.elevation, -8, 8) : 1;
    const light = new THREE.Vector3(sun.dir[0], Math.max(sun.dir[2], 0.25), -sun.dir[1]).normalize();
    for (const m of [detailMat, overviewMat]) {
      m.uniforms.uDim.value = dim;
      if (s.view === 'scene') m.uniforms.uLight.value.copy(light);
      else m.uniforms.uLight.value.set(-0.5, 0.75, -0.45).normalize();
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return;
    e.stopPropagation();
    const s = useStore.getState();
    const lx = e.point.x;
    const ly = -e.point.z;
    // Inside the focus square is decided by position, not by which mesh was hit: the overview
    // surface under the square is only hidden by its shader, so it can still catch the click.
    const inDetail = insideGrid(detailMap, lx, ly);
    switch (s.tool) {
      case 'lkp':
        setLkp(lx, ly);
        break;
      case 'alert':
        if (!inDetail) return s.toast('Alerts must be inside the focus segment', 'warn');
        addAlert(lx, ly);
        break;
      case 'hide':
        if (!inDetail) return s.toast('Hides must be inside the focus square', 'warn');
        addHide(lx, ly);
        break;
      case 'area':
        if (!inDetail) return s.toast('The search area must be inside the focus square', 'warn');
        searchClick(lx, ly);
        break;
      case 'searched':
        if (!inDetail) return s.toast('Searched sectors must be inside the focus segment', 'warn');
        searchClick(lx, ly);
        break;
      case 'brushUp':
      case 'brushDown':
        brush(lx, ly, s.tool === 'brushUp');
        break;
      default:
        break;
    }
  };

  // focus tool: press and drag the 3 km square (orbit controls are paused while the tool is on)
  const dragging = useRef(false);
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    const s = useStore.getState();
    if (s.tool !== 'focus' || e.button !== 0) return;
    e.stopPropagation();
    dragging.current = true;
    s.set({ focusPreview: [e.point.x, -e.point.z] });
  };
  const onUp = () => {
    dragging.current = false;
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const s = useStore.getState();
    if (s.tool === 'none') return;
    if (s.tool === 'focus') {
      if (dragging.current && e.buttons & 1) s.set({ focusPreview: [e.point.x, -e.point.z] });
      else dragging.current = false;
      return;
    }
    s.set({ hover: [e.point.x, -e.point.z] });
  };

  return (
    <group>
      <mesh geometry={overviewGeo} material={overviewMat} onClick={onClick} onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} />
      <mesh geometry={detailGeo} material={detailMat} onClick={onClick} onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} />
    </group>
  );
}
