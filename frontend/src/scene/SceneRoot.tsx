import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { AreaBundle } from '../api/types';
import { sunAt } from '../models/env';
import { useStore } from '../state/store';
import { AlertZones } from './AlertZones';
import { CameraRig } from './CameraRig';
import { DogTeams } from './DogTeams';
import { TrialTrack } from './TrialTrack';
import { FeatureLines } from './FeatureLines';
import { Heatmap } from './Heatmap';
import { Landmarks } from './Landmarks';
import { Markers } from './Markers';
import { ProbabilityLayer } from './ProbabilityLayer';
import { ScentParticles } from './ScentParticles';
import { Terrain } from './Terrain';
import { Vegetation } from './Vegetation';
import { WindLayer } from './WindLayer';

const DAY = new THREE.Color('#22323f');
const DUSK = new THREE.Color('#2a2033');
const NIGHT = new THREE.Color('#070b10');
const MAP = new THREE.Color('#0a0f14');

/** Background tint + sun light follow the slider time in scene view. */
function Atmosphere({ bundle }: { bundle: AreaBundle }) {
  const { scene } = useThree();
  const sunLight = useRef<THREE.DirectionalLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const bg = useMemo(() => new THREE.Color(), []);
  const frames = useRef({ n: 0, t: performance.now() });
  useFrame(() => {
    const s = useStore.getState();
    // fps for the debug overlay (sampled every 0.5 s)
    const f = frames.current;
    f.n++;
    const now = performance.now();
    if (now - f.t > 500) {
      s.set({ fps: Math.round((f.n * 1000) / (now - f.t)) });
      f.n = 0;
      f.t = now;
    }
    const c = bundle.config;
    const sun = sunAt({ date: c.date, lat: c.lat, lon: c.lon, utcOffsetSeconds: c.utcOffsetSeconds }, s.time);
    if (s.view === 'map') bg.copy(MAP);
    else {
      const e = sun.elevation;
      if (e > 6) bg.copy(DAY);
      else if (e > -4) bg.copy(DUSK).lerp(DAY, (e + 4) / 10);
      else bg.copy(NIGHT).lerp(DUSK, Math.max(0, (e + 12) / 8));
    }
    scene.background = bg;
    if (sunLight.current) {
      sunLight.current.position.set(sun.dir[0] * 5000, Math.max(sun.dir[2], 0.15) * 5000, -sun.dir[1] * 5000);
      sunLight.current.intensity = 0.4 + 1.6 * THREE.MathUtils.smoothstep(sun.elevation, -6, 12);
    }
    if (amb.current) amb.current.intensity = 0.55 + 0.35 * THREE.MathUtils.smoothstep(sun.elevation, -6, 12);
  });
  return (
    <>
      <ambientLight ref={amb} intensity={0.8} />
      <directionalLight ref={sunLight} intensity={1.6} color="#fff1d6" />
      <hemisphereLight args={['#bcd6ff', '#2a2a1a', 0.35]} />
    </>
  );
}

export function SceneRoot({ bundle }: { bundle: AreaBundle }) {
  return (
    <>
      <Atmosphere bundle={bundle} />
      <CameraRig />
      <Terrain bundle={bundle} />
      <FeatureLines bundle={bundle} />
      <Landmarks bundle={bundle} />
      <Vegetation bundle={bundle} />
      <WindLayer bundle={bundle} />
      <ScentParticles bundle={bundle} />
      <Heatmap bundle={bundle} />
      <ProbabilityLayer bundle={bundle} />
      <AlertZones bundle={bundle} />
      <DogTeams bundle={bundle} />
      <TrialTrack bundle={bundle} />
      <Markers bundle={bundle} />
    </>
  );
}
