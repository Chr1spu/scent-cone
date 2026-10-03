import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { AreaBundle } from '../api/types';
import { SCENT } from '../config/modelParams';
import { useStore } from '../state/store';
import type { ParticleMsg, ParticleReply } from '../workers/particles.worker';

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
  if (vS <= 0.0) discard;
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  if (r > 1.0) discard;
  float a = (1.0 - r) * (1.0 - r) * (0.18 + 0.6 * vS);
  vec3 c = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.82, 0.45), vS);
  gl_FragColor = vec4(c * a, a);
}
`;

/**
 * Visible scent simulation (15k particles). The physics runs in particles.worker.ts; this
 * component only swaps the returned buffers into the geometry each frame (ping-pong transfer).
 */
export function ScentParticles({ bundle }: { bundle: AreaBundle }) {
  const visible = useStore((s) => s.layers.scent);
  const release = useStore((s) => s.scentRelease);
  const prob = useStore((s) => s.prob);
  const windVersion = useStore((s) => s.windVersion);
  const n = SCENT.visibleParticles;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aStrength', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, [n]);
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
  const pointsRef = useRef<THREE.Points>(null);
  const worker = useRef<Worker | null>(null);
  // the spare buffer pair travels to the worker; null while a tick is in flight
  const spare = useRef<{ pos: Float32Array; strength: Float32Array } | null>({ pos: new Float32Array(n * 3), strength: new Float32Array(n) });
  const active = useRef(false);

  useEffect(() => {
    const w = new Worker(new URL('../workers/particles.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (ev: MessageEvent<ParticleReply>) => {
      const r = ev.data;
      const posAttr = geo.attributes.position as THREE.BufferAttribute;
      const sAttr = geo.attributes.aStrength as THREE.BufferAttribute;
      // swap: the geometry's previous arrays (already uploaded to the GPU) become the spare pair
      spare.current = { pos: posAttr.array as Float32Array, strength: sAttr.array as Float32Array };
      posAttr.array = r.pos;
      sAttr.array = r.strength;
      posAttr.needsUpdate = true;
      sAttr.needsUpdate = true;
      active.current = r.active;
    };
    const c = bundle.config;
    const s = useStore.getState();
    const msg: ParticleMsg = {
      type: 'init',
      frame: bundle.frame,
      detail: bundle.detail,
      overview: bundle.overview,
      weather: bundle.weather,
      place: { date: c.date, lat: c.lat, lon: c.lon, utcOffsetSeconds: c.utcOffsetSeconds },
      wind: s.activeWind ?? bundle.fallback,
      n,
    };
    w.postMessage(msg);
    return () => {
      w.terminate();
      worker.current = null;
      // any in-flight buffers died with the worker
      spare.current = { pos: new Float32Array(n * 3), strength: new Float32Array(n) };
    };
  }, [bundle, geo, n]);

  useEffect(() => {
    const w = worker.current;
    const field = useStore.getState().activeWind;
    if (w && field) w.postMessage({ type: 'setWind', wind: field } satisfies ParticleMsg);
  }, [windVersion]);

  useEffect(() => {
    const w = worker.current;
    if (!w) return;
    if (!prob || !visible) {
      w.postMessage({ type: 'stop' } satisfies ParticleMsg);
      return;
    }
    w.postMessage({ type: 'release', prob: prob.detail, seed: 99 + release, t: useStore.getState().time } satisfies ParticleMsg);
    useStore.getState().set({ particleCount: n });
  }, [prob, release, visible, n, bundle]);

  useFrame(() => {
    if (pointsRef.current) pointsRef.current.visible = visible && active.current;
    const w = worker.current;
    const pair = spare.current;
    if (!visible || !w || !pair) return;
    spare.current = null;
    w.postMessage({ type: 'tick', t: useStore.getState().time, pos: pair.pos, strength: pair.strength } satisfies ParticleMsg, [pair.pos.buffer, pair.strength.buffer]);
  });

  return <points ref={pointsRef} geometry={geo} material={mat} visible={false} frustumCulled={false} renderOrder={6} />;
}
