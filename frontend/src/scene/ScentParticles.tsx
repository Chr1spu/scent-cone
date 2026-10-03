import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { AreaBundle } from '../api/types';
import { VERT_EXAG } from '../config/constants';
import { SCENT } from '../config/modelParams';
import { sampleLocal } from '../geo/grid';
import { createSim, makeStepEnv, step, type Sim, type StepEnv } from '../models/scent';
import { buildTerrainInfo } from '../models/terrainInfo';
import { timeSlot } from '../models/wind';
import { useStore } from '../state/store';

const vert = /* glsl */ `
attribute float aStrength;
varying float vS;
uniform float uScale;
void main() {
  vS = aStrength;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(uScale * (0.6 + 0.9 * sqrt(aStrength)) / -mv.z, 1.5, 18.0);
  gl_Position = projectionMatrix * mv;
}
`;
const frag = /* glsl */ `
varying float vS;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  if (r > 1.0) discard;
  float a = (1.0 - r) * (1.0 - r) * (0.18 + 0.6 * vS);
  vec3 c = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.82, 0.45), vS);
  gl_FragColor = vec4(c * a, a);
}
`;

/**
 * Visible scent simulation (15k particles) on the main thread — a few ms per frame with typed
 * arrays and in-place buffer updates. Ensembles for the heatmap run in the worker.
 */
export function ScentParticles({ bundle }: { bundle: AreaBundle }) {
  const visible = useStore((s) => s.layers.scent);
  const release = useStore((s) => s.scentRelease);
  const prob = useStore((s) => s.prob);
  const ti = useMemo(() => buildTerrainInfo(bundle.detail.meta, bundle.frame, bundle.detail.elev, bundle.detail.landcover), [bundle]);
  const n = SCENT.visibleParticles;
  const positions = useMemo(() => new Float32Array(n * 3), [n]);
  const strength = useMemo(() => new Float32Array(n), [n]);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aStrength', new THREE.BufferAttribute(strength, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, [positions, strength]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: { uScale: { value: 9000 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const sim = useRef<Sim | null>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const env = useRef<{ se: StepEnv; t: number; windVersion: number } | null>(null);
  const sunBuf = useMemo(() => new Uint8Array(ti.elev.length), [ti]);

  useEffect(() => {
    if (!prob || !visible) return;
    sim.current = createSim({ ti, prob: prob.detail, n, seed: 99 + release });
    env.current = null;
    useStore.getState().set({ particleCount: n });
  }, [ti, prob, release, visible, n]);

  useFrame(() => {
    if (pointsRef.current) pointsRef.current.visible = visible && !!sim.current;
    if (!visible || !sim.current) return;
    const s = useStore.getState();
    const field = s.activeWind;
    if (!field) return;
    const dt = SCENT.dt;
    const c = bundle.config;
    if (!env.current || Math.abs(env.current.t - s.time) > 1 / 60 || env.current.windVersion !== s.windVersion) {
      const place = { date: c.date, lat: c.lat, lon: c.lon, utcOffsetSeconds: c.utcOffsetSeconds };
      env.current = { se: makeStepEnv(ti, field, place, bundle.weather, s.time, dt, undefined, sunBuf), t: s.time, windVersion: s.windVersion };
    } else env.current.se.slot = timeSlot(field, s.time);
    const p = sim.current;
    for (let k = 0; k < SCENT.stepsPerFrame; k++) step(p, field, env.current.se, dt);
    const lift = SCENT.drawHeightM;
    for (let i = 0; i < p.n; i++) {
      const x = p.x[i];
      const y = p.y[i];
      positions[i * 3] = x;
      positions[i * 3 + 1] = (sampleLocal(ti.elev, ti.map, x, y) + lift) * VERT_EXAG;
      positions[i * 3 + 2] = -y;
      // fade in freshly emitted particles so recycling doesn't pop
      strength[i] = p.strength[i] * Math.min(1, p.age[i] / 20);
    }
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aStrength as THREE.BufferAttribute).needsUpdate = true;
  });

  return <points ref={pointsRef} geometry={geo} material={mat} visible={false} frustumCulled={false} renderOrder={6} />;
}
