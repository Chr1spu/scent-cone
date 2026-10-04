/**
 * The landing diorama. Everything is driven by `story.p` (scroll progress in chapters), read per
 * frame, so scrolling never re-renders React. Models are Synty POLYGON assets (scene/assets.tsx).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { KitMesh, useDog, useKit, type DogClip, type Kit } from '../../scene/assets';
import { BASE_Y, CAMP, HIDE, R, buildIsland, downhill, duskAt, height, scatter, smoothstep, valleyX, windFromGrad } from './island';
import { ALERT_TEAM, BACKTRACE, CH, CHAPTERS, KID_PATH, TEAMS, hourAt, story, type TeamSpot } from './story';

/** characters are drawn a bit larger than life so they read in a 220 m diorama */
const CHAR = 2.4;
const ease = (t: number) => t * t * (3 - 2 * t);
/** 0→1 as progress p crosses [a, b] */
const ramp = (p: number, a: number, b: number) => smoothstep(a, b, p);
/** visible inside [a, b] with soft edges */
const win = (p: number, a: number, b: number, e = 0.25) => ramp(p, a - e, a) * (1 - ramp(p, b, b + e));
const yaw = (dx: number, dz: number) => Math.atan2(-dz, dx); // models face +x

// ------------------------------------------------------------ time of day

interface Look {
  top: string;
  bottom: string;
  sun: string;
  sunI: number;
  hemi: number;
  hemiC: string;
  fog: string;
}
const LOOKS: [number, Look][] = [
  [16.0, { top: '#6fb7dc', bottom: '#dff0ea', sun: '#fff1d6', sunI: 2.6, hemi: 1.05, hemiC: '#d4ecff', fog: '#cfe5e4' }],
  [18.0, { top: '#7ea6d6', bottom: '#ffd9ae', sun: '#ffcf8f', sunI: 2.5, hemi: 1.0, hemiC: '#ffe6c4', fog: '#efdcc0' }],
  [18.8, { top: '#3a3a78', bottom: '#f39a78', sun: '#ff9a66', sunI: 2.0, hemi: 1.0, hemiC: '#e3b2c0', fog: '#a07a90' }],
  [19.6, { top: '#111a46', bottom: '#3a4488', sun: '#a9bcff', sunI: 1.25, hemi: 1.05, hemiC: '#8a9ae8', fog: '#2a3266' }],
];
const cA = new THREE.Color();
const cB = new THREE.Color();
function lookAt(hour: number, key: 'top' | 'bottom' | 'sun' | 'fog' | 'hemiC', out: THREE.Color) {
  let i = 0;
  while (i < LOOKS.length - 2 && hour > LOOKS[i + 1][0]) i++;
  const [h0, a] = LOOKS[i];
  const [h1, b] = LOOKS[i + 1];
  const t = ease(Math.max(0, Math.min(1, (hour - h0) / (h1 - h0))));
  return out.copy(cA.set(a[key])).lerp(cB.set(b[key]), t);
}
function lookNum(hour: number, key: 'sunI' | 'hemi') {
  let i = 0;
  while (i < LOOKS.length - 2 && hour > LOOKS[i + 1][0]) i++;
  const [h0, a] = LOOKS[i];
  const [h1, b] = LOOKS[i + 1];
  const t = ease(Math.max(0, Math.min(1, (hour - h0) / (h1 - h0))));
  return a[key] + (b[key] - a[key]) * t;
}
const nightAt = (hour: number) => smoothstep(18.9, 19.6, hour);

function Sky() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() } },
        vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uTop; uniform vec3 uBottom; varying vec3 vP;
          void main(){ float t = smoothstep(-0.15, 0.55, vP.y); gl_FragColor = vec4(mix(uBottom, uTop, t), 1.0); }`,
      }),
    [],
  );
  const stars = useMemo(() => {
    const n = 700;
    const p = new Float32Array(n * 3);
    const r = Math.random;
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const e = 0.08 + r() * 1.4;
      p.set([Math.cos(a) * Math.cos(e) * 650, Math.sin(e) * 650, Math.sin(a) * Math.cos(e) * 650], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    return g;
  }, []);
  const starMat = useMemo(() => new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }), []);
  useFrame(({ camera }) => {
    const h = hourAt(story.p);
    lookAt(h, 'top', mat.uniforms.uTop.value);
    lookAt(h, 'bottom', mat.uniforms.uBottom.value);
    starMat.opacity = nightAt(h) * 0.9;
    mesh.current?.position.copy(camera.position);
    pts.current?.position.copy(camera.position);
  });
  const mesh = useRef<THREE.Mesh>(null);
  const pts = useRef<THREE.Points>(null);
  return (
    <>
      <mesh ref={mesh} material={mat} renderOrder={-10}>
        <sphereGeometry args={[700, 32, 16]} />
      </mesh>
      <points ref={pts} geometry={stars} material={starMat} renderOrder={-9} />
    </>
  );
}

function Lights() {
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const { scene } = useThree();
  const fog = useMemo(() => new THREE.Fog('#cfe5e4', 260, 720), []);
  useEffect(() => {
    scene.fog = fog;
    return () => {
      scene.fog = null;
    };
  }, [scene, fog]);
  useFrame(() => {
    const h = hourAt(story.p);
    // the sun sets in the west-south-west; after sunset the key light becomes a high, cool moon
    const n = nightAt(h);
    const elev = THREE.MathUtils.degToRad(Math.max(14, 44 - (h - 16) * 10) * (1 - n) + 48 * n);
    const az = THREE.MathUtils.degToRad((205 + (h - 16) * 14) * (1 - n) + 140 * n);
    if (sun.current) {
      sun.current.position.set(Math.sin(az) * Math.cos(elev) * 220, Math.sin(elev) * 220, -Math.cos(az) * Math.cos(elev) * 220);
      lookAt(h, 'sun', sun.current.color);
      sun.current.intensity = lookNum(h, 'sunI');
    }
    if (hemi.current) {
      hemi.current.intensity = lookNum(h, 'hemi');
      lookAt(h, 'hemiC', hemi.current.color);
    }
    lookAt(h, 'fog', fog.color);
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={['#bfe3f2', '#3d4a2c', 1]} />
      <directionalLight
        ref={sun}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-150}
        shadow-camera-right={150}
        shadow-camera-top={150}
        shadow-camera-bottom={-150}
        shadow-camera-near={10}
        shadow-camera-far={600}
        shadow-bias={-0.0006}
        shadow-normalBias={0.6}
      />
    </>
  );
}

// ------------------------------------------------------------ camera

const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
function CameraRig({ reduced }: { reduced: boolean }) {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3());
  useFrame((st, dt) => {
    // ease progress toward the scroll goal
    const k = reduced ? 1 : 1 - Math.exp(-dt * 4.5);
    story.p += (story.goal - story.p) * k;
    const p = Math.max(0, Math.min(CHAPTERS.length - 1, story.p));
    const i = Math.min(CHAPTERS.length - 2, Math.floor(p));
    const t = ease(p - i);
    vA.set(...CHAPTERS[i].cam);
    vB.set(...CHAPTERS[i + 1].cam);
    tA.set(...CHAPTERS[i].target);
    tB.set(...CHAPTERS[i + 1].target);
    vA.lerp(vB, t);
    tA.lerp(tB, t);
    // narrow screens: pull back
    const aspect = size.width / size.height;
    if (aspect < 1) vA.sub(tA).multiplyScalar(1 + (1 - aspect) * 0.9).add(tA);
    // slow idle drift in the hero + pointer parallax
    if (!reduced) {
      const hero = 1 - ramp(p, 0, 0.8);
      const a = st.clock.elapsedTime * 0.05 * hero;
      vA.sub(tA).applyAxisAngle(THREE.Object3D.DEFAULT_UP, Math.sin(a) * 0.35 * hero + story.mx * 0.06).add(tA);
      vA.y += story.my * -6;
    }
    camera.position.copy(vA);
    look.current.lerp(tA, 1);
    camera.lookAt(look.current);
    // keep the action opposite the chapter card (wide screens only)
    const shift = aspect > 1.1 ? CHAPTERS[i].shift + (CHAPTERS[i + 1].shift - CHAPTERS[i].shift) * t : 0;
    const cam = camera as THREE.PerspectiveCamera;
    if (Math.abs(shift) > 1e-3) cam.setViewOffset(size.width, size.height, shift * size.width * 0.5, 0, size.width, size.height);
    else if (cam.view) cam.clearViewOffset();
  });
  return null;
}

// ------------------------------------------------------------ terrain + scatter

function Island() {
  const geo = useMemo(() => {
    const { positions, colors } = buildIsland();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <mesh geometry={geo} receiveShadow castShadow>
      <meshStandardMaterial vertexColors flatShading roughness={1} metalness={0} />
    </mesh>
  );
}

function Scatter({ kit }: { kit: Kit }) {
  const groups = useMemo(() => {
    const by = new Map<string, ReturnType<typeof scatter>>();
    for (const pl of scatter()) {
      if (!kit.has(pl.kind)) continue;
      const arr = by.get(pl.kind) ?? [];
      arr.push(pl);
      by.set(pl.kind, arr);
    }
    return [...by.entries()];
  }, [kit]);
  return (
    <group>
      {groups.map(([kind, items]) => (
        <Instances key={kind} kit={kit} kind={kind} items={items} />
      ))}
    </group>
  );
}

function Instances({ kit, kind, items }: { kit: Kit; kind: string; items: ReturnType<typeof scatter> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const part = kit.get(kind)!;
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
  return <instancedMesh ref={ref} args={[part.geometry, part.material, items.length]} castShadow receiveShadow />;
}

function Clouds({ kit }: { kit: Kit }) {
  const ref = useRef<THREE.Group>(null);
  const clouds = useMemo(
    () => [
      { n: 'cloud_1', x: -70, y: 62, z: -60, s: 3.2 },
      { n: 'cloud_2', x: 60, y: 70, z: -90, s: 3.8 },
      { n: 'cloud_3', x: 95, y: 55, z: 30, s: 2.6 },
      { n: 'cloud_1', x: -110, y: 74, z: 60, s: 2.8 },
      { n: 'cloud_2', x: 10, y: 80, z: -140, s: 4.2 },
    ],
    [],
  );
  useFrame((st) => {
    const g = ref.current;
    if (!g) return;
    g.children.forEach((c, i) => {
      c.position.x = clouds[i].x + Math.sin(st.clock.elapsedTime * 0.03 + i) * 12;
    });
  });
  return (
    <group ref={ref}>
      {clouds.map((c, i) => (
        <KitMesh key={i} kit={kit} name={c.n} position={[c.x, c.y, c.z]} scale={c.s} rotation={[0, i, 0]} />
      ))}
    </group>
  );
}

// ------------------------------------------------------------ campsite and the child

const atY = (x: number, z: number, lift = 0): [number, number, number] => [x, height(x, z) + lift, z];

function Campfire() {
  const light = useRef<THREE.PointLight>(null);
  const embers = useMemo(() => {
    const n = 40;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    return { g, n, seed: Array.from({ length: n }, () => Math.random()) };
  }, []);
  const emberMat = useMemo(() => new THREE.PointsMaterial({ color: '#ffb547', size: 0.35, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), []);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    const night = smoothstep(17.8, 19.4, hourAt(story.p));
    if (light.current) light.current.intensity = (25 + 150 * night) * (0.85 + 0.15 * Math.sin(t * 13) * Math.sin(t * 7.3));
    emberMat.opacity = 0.25 + 0.75 * night;
    const pos = embers.g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < embers.n; i++) {
      const s = embers.seed[i];
      const life = (t * (0.3 + s * 0.4) + s * 10) % 1;
      pos.setXYZ(i, Math.sin(s * 50 + t) * 0.6 * life, life * 5, Math.cos(s * 31 + t) * 0.6 * life);
    }
    pos.needsUpdate = true;
  });
  return (
    <group>
      <pointLight ref={light} color="#ff9a4a" distance={24} decay={1.8} position={[0, 1.6, 0]} />
      <points geometry={embers.g} material={emberMat} />
    </group>
  );
}

function Beacon({ color, height: h = 26, pulse = true, opacity = 1 }: { color: string; height?: number; pulse?: boolean; opacity?: number }) {
  const ring = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.MeshBasicMaterial>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((st) => {
    const t = (st.clock.elapsedTime * 0.6) % 1;
    if (ring.current && pulse) ring.current.scale.setScalar(1 + t * 3.5);
    if (ringMat.current) ringMat.current.opacity = (pulse ? 1 - t : 1) * 0.9 * opacity;
    if (beam.current) beam.current.opacity = 0.16 * opacity;
  });
  return (
    <group>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.4, 0]}>
        <ringGeometry args={[1.6, 2.1, 6]} />
        <meshBasicMaterial ref={ringMat} color={color} transparent depthWrite={false} />
      </mesh>
      <mesh position={[0, h / 2, 0]}>
        <cylinderGeometry args={[0.25, 0.9, h, 6, 1, true]} />
        <meshBasicMaterial ref={beam} color={color} transparent blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Tag({ position, children, tone = 'dark', show }: { position: [number, number, number]; children: ReactNode; tone?: 'dark' | 'orange' | 'yellow' | 'pink'; show: () => number }) {
  const ref = useRef<HTMLDivElement>(null);
  useFrame(() => {
    if (ref.current) {
      const o = show();
      ref.current.style.opacity = String(o);
      ref.current.style.transform = `translateY(${(1 - o) * 8}px)`;
    }
  });
  const cls = {
    dark: 'bg-ink-900/85 text-white',
    orange: 'bg-sar text-white',
    yellow: 'bg-raincoat text-ink-900',
    pink: 'bg-[#ff4fa3] text-white',
  }[tone];
  return (
    <Html position={position} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div ref={ref} className={`whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[11px] font-medium shadow-float transition-none ${cls}`} style={{ opacity: 0 }}>
        {children}
      </div>
    </Html>
  );
}

function Campsite({ kit }: { kit: Kit }) {
  const c = CAMP;
  const beacon = useRef<THREE.Group>(null);
  useFrame(() => {
    if (beacon.current) beacon.current.visible = win(story.p, 0.6, 1.8) > 0.01;
  });
  return (
    <group>
      <KitMesh kit={kit} name="tent" position={atY(c.x + 3, c.z - 4, -0.1)} rotation={[0, yaw(-1, 0.6), 0]} scale={2.6} />
      <KitMesh kit={kit} name="tent" position={atY(c.x + 8, c.z + 3, -0.1)} rotation={[0, yaw(-1, -0.2), 0]} scale={2.3} />
      <group position={atY(c.x - 3, c.z + 2, -0.05)}>
        <KitMesh kit={kit} name="campfire" scale={2.2} />
        <Campfire />
      </group>
      <KitMesh kit={kit} name="log" position={atY(c.x - 3, c.z + 6.5, -0.1)} rotation={[0, 0.2, 0]} scale={2} />
      <KitMesh kit={kit} name="stump" position={atY(c.x - 8, c.z + 1, -0.1)} scale={1.6} />
      <KitMesh kit={kit} name="lantern" position={atY(c.x - 7.6, c.z + 1, 1.4)} scale={2.4} />
      <group ref={beacon} position={atY(c.x - 3, c.z - 2)}>
        <Beacon color="#ff6b2c" />
      </group>
      <Tag position={atY(c.x - 3, c.z - 2, 30)} tone="orange" show={() => win(story.p, 0.6, 1.8)}>
        Last seen · 16:00
      </Tag>
    </group>
  );
}

/** The child walks from the tent to the hiding place during the "last seen" chapter. */
function Kid({ kit }: { kit: Kit }) {
  const curve = useMemo(() => new THREE.CatmullRomCurve3(KID_PATH.map(([x, z]) => new THREE.Vector3(x, height(x, z), z))), []);
  const walker = useRef<THREE.Group>(null);
  const prints = useRef<THREE.InstancedMesh>(null);
  const N = 70;
  const steps = useMemo(() => {
    const out: { p: THREE.Vector3; yaw: number }[] = [];
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N;
      const p = curve.getPointAt(u);
      const tng = curve.getTangentAt(u);
      const side = i % 2 ? 0.45 : -0.45;
      p.x += -tng.z * side;
      p.z += tng.x * side;
      p.y = height(p.x, p.z) + 0.12;
      out.push({ p, yaw: yaw(tng.x, tng.z) });
    }
    return out;
  }, [curve]);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffd76a', transparent: true, opacity: 0.85, depthWrite: false }), []);
  const o = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    const p = story.p;
    const u = ramp(p, 0.55, 1.75);
    if (walker.current) {
      const pt = curve.getPointAt(Math.min(0.999, u));
      const tg = curve.getTangentAt(Math.min(0.999, u));
      walker.current.position.set(pt.x, height(pt.x, pt.z), pt.z);
      walker.current.rotation.y = yaw(tg.x, tg.z);
      walker.current.position.y += Math.abs(Math.sin(u * 90)) * 0.25;
      walker.current.visible = p > 0.35 && p < 1.95;
      walker.current.scale.setScalar(CHAR * (1 - ramp(p, 1.75, 1.95)));
    }
    const m = prints.current;
    if (m) {
      const shown = Math.floor(u * N);
      for (let i = 0; i < N; i++) {
        const s = steps[i];
        o.position.copy(s.p);
        o.rotation.set(-Math.PI / 2, 0, s.yaw);
        o.scale.setScalar(i < shown ? 1 : 0);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
      mat.opacity = 0.85 * (1 - ramp(p, 2.6, 3.2));
    }
  });
  return (
    <group>
      <group ref={walker}>
        <KitMesh kit={kit} name="kid_walk" />
      </group>
      <instancedMesh ref={prints} args={[undefined, mat, N]} frustumCulled={false}>
        <circleGeometry args={[0.32, 5]} />
      </instancedMesh>
    </group>
  );
}

/** Where the child is sitting; revealed when the back-trace lands. */
function Hideout({ kit }: { kit: Kit }) {
  const kid = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Group>(null);
  useFrame((st) => {
    const r = ramp(story.p, 4.85, 5.1);
    if (kid.current) {
      kid.current.visible = r > 0.001;
      kid.current.scale.setScalar(CHAR * (0.6 + 0.4 * r));
      kid.current.position.y = height(HIDE.x, HIDE.z) + 1.5 + Math.sin(st.clock.elapsedTime * 3) * 0.05;
    }
    if (beacon.current) beacon.current.visible = r > 0.01;
  });
  const hx = HIDE.x;
  const hz = HIDE.z;
  return (
    <group>
      <KitMesh kit={kit} name="log" position={atY(hx, hz, -0.3)} rotation={[0, 0.5, 0]} scale={2.2} />
      <KitMesh kit={kit} name="pine_3" position={atY(hx - 6, hz - 5, -0.3)} scale={1.2} />
      <KitMesh kit={kit} name="pine_1" position={atY(hx + 5, hz - 7, -0.3)} scale={1.05} />
      <KitMesh kit={kit} name="fern_2" position={atY(hx + 3, hz + 3, -0.1)} scale={1.4} />
      <group ref={kid} position={[hx + 0.2, 0, hz]} rotation={[0, yaw(1, 0.9), 0]}>
        <KitMesh kit={kit} name="kid_sit" />
      </group>
      <group ref={beacon} position={atY(hx, hz)}>
        <Beacon color="#f2c14e" height={34} />
      </group>
      <Tag position={atY(hx, hz, 36)} tone="yellow" show={() => ramp(story.p, 4.95, 5.15) * (1 - ramp(story.p, 6.4, 6.6))}>
        Found · 19:14
      </Tag>
    </group>
  );
}

// ------------------------------------------------------------ wind + scent (same field as island.ts)

/** precomputed downhill field so per-particle wind is two bilinear lookups */
const FIELD = (() => {
  const step = 2;
  const n = Math.ceil((2 * R) / step) + 1;
  const gx = new Float32Array(n * n);
  const gz = new Float32Array(n * n);
  const hh = new Float32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = -R + i * step;
      const z = -R + j * step;
      const [a, b] = downhill(x, z);
      gx[j * n + i] = a;
      gz[j * n + i] = b;
      hh[j * n + i] = height(x, z);
    }
  const sample = (arr: Float32Array, x: number, z: number) => {
    const fx = Math.max(0, Math.min(n - 1.001, (x + R) / step));
    const fz = Math.max(0, Math.min(n - 1.001, (z + R) / step));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const k = j * n + i;
    return (arr[k] * (1 - tx) + arr[k + 1] * tx) * (1 - tz) + (arr[k + n] * (1 - tx) + arr[k + n + 1] * tx) * tz;
  };
  return { h: (x: number, z: number) => sample(hh, x, z), gx: (x: number, z: number) => sample(gx, x, z), gz: (x: number, z: number) => sample(gz, x, z) };
})();
function fastWind(x: number, z: number, u: number, out: [number, number]) {
  windFromGrad(x, z, FIELD.gx(x, z), FIELD.gz(x, z), u, out);
}

const POINT_VERT = `
attribute float aA; attribute float aS; varying float vA; uniform float uScale;
void main(){ vA = aA; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aS * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`;
const SCENT_FRAG = `
uniform vec3 uColor; uniform float uOpacity; varying float vA;
void main(){ float d = length(gl_PointCoord - 0.5); float a = (1.0 - smoothstep(0.15, 0.5, d)) * vA * uOpacity; if (a < 0.01) discard; gl_FragColor = vec4(uColor * (1.0 + 0.35 * (1.0 - d * 2.0)), a); }`;
const POINT_FRAG = `
uniform vec3 uColor; uniform float uOpacity; varying float vA;
void main(){ float d = length(gl_PointCoord - 0.5); float a = (1.0 - smoothstep(0.0, 0.5, d)) * vA * uOpacity; if (a < 0.01) discard; gl_FragColor = vec4(uColor * a, a); }`;

function WindStreaks({ reduced }: { reduced: boolean }) {
  const N = 650; // streaks
  const K = 7; // points per streak (a comet tail)
  const { gl } = useThree();
  const st = useMemo(() => {
    const pos = new Float32Array(N * K * 3);
    const a = new Float32Array(N * K);
    const sz = new Float32Array(N * K);
    for (let i = 0; i < N; i++) for (let k = 0; k < K; k++) sz[i * K + k] = 2.4 * (1 - k / K) + 0.6;
    const p = new Float32Array(N * 2);
    const age = new Float32Array(N);
    const life = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aA', new THREE.BufferAttribute(a, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aS', new THREE.BufferAttribute(sz, 1));
    return { pos, a, p, age, life, g };
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color('#d9f1ff') }, uOpacity: { value: 0 }, uScale: { value: 300 } },
        vertexShader: POINT_VERT,
        fragmentShader: POINT_FRAG,
      }),
    [],
  );
  const w: [number, number] = [0, 0];
  const spawn = (i: number) => {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R * 0.92;
    st.p[i * 2] = Math.cos(a) * r;
    st.p[i * 2 + 1] = Math.sin(a) * r;
    st.age[i] = 0;
    st.life[i] = 1.5 + Math.random() * 2.5;
  };
  useFrame((_, dtRaw) => {
    const vis = win(story.p, 1.6, 4.2, 0.45);
    mat.uniforms.uOpacity.value = vis;
    mat.uniforms.uScale.value = gl.domElement.height * 0.9;
    if (vis < 0.01) return;
    const dt = Math.min(dtRaw, 0.05) * (reduced ? 0.4 : 1);
    const u = duskAt(hourAt(story.p));
    for (let i = 0; i < N; i++) {
      if (st.age[i] >= st.life[i]) {
        spawn(i);
        st.age[i] = Math.random() * st.life[i] * 0.8;
      }
      st.age[i] += dt;
      let x = st.p[i * 2];
      let z = st.p[i * 2 + 1];
      fastWind(x, z, u, w);
      x += w[0] * dt * 6;
      z += w[1] * dt * 6;
      st.p[i * 2] = x;
      st.p[i * 2 + 1] = z;
      if (Math.hypot(x, z) > R * 0.96) st.age[i] = st.life[i];
      const f = Math.sin((st.age[i] / st.life[i]) * Math.PI);
      // trail: step back along the local wind
      for (let k = 0; k < K; k++) {
        const j = i * K + k;
        st.pos[j * 3] = x;
        st.pos[j * 3 + 1] = FIELD.h(x, z) + 2.4;
        st.pos[j * 3 + 2] = z;
        st.a[j] = f * (1 - k / K) * 0.9;
        fastWind(x, z, u, w);
        const sp = Math.hypot(w[0], w[1]) + 1e-6;
        x -= (w[0] / sp) * (0.5 + sp * 0.45);
        z -= (w[1] / sp) * (0.5 + sp * 0.45);
      }
    }
    st.g.attributes.position.needsUpdate = true;
    st.g.attributes.aA.needsUpdate = true;
  });
  return <points geometry={st.g} material={mat} frustumCulled={false} />;
}

function ScentPlume({ reduced }: { reduced: boolean }) {
  const N = 2600;
  const { gl } = useThree();
  const st = useMemo(() => {
    const pos = new Float32Array(N * 3);
    const a = new Float32Array(N);
    const s = new Float32Array(N);
    const xz = new Float32Array(N * 2);
    const age = new Float32Array(N);
    const life = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aA', new THREE.BufferAttribute(a, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aS', new THREE.BufferAttribute(s, 1));
    for (let i = 0; i < N; i++) {
      s[i] = 1.1 + Math.random() * 2.2;
      life[i] = 6 + Math.random() * 14;
      age[i] = Math.random() * life[i];
      xz[i * 2] = HIDE.x;
      xz[i * 2 + 1] = HIDE.z;
    }
    return { pos, a, s, xz, age, life, g };
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uColor: { value: new THREE.Color('#ffb02e') }, uOpacity: { value: 0 }, uScale: { value: 300 } },
        vertexShader: POINT_VERT,
        fragmentShader: SCENT_FRAG,
      }),
    [],
  );
  const w: [number, number] = [0, 0];
  const warm = useRef(false);
  const step = (dt: number, u: number) => {
    for (let i = 0; i < N; i++) {
      st.age[i] += dt;
      if (st.age[i] >= st.life[i]) {
        st.age[i] = 0;
        const r = Math.random() * 2.5;
        const a = Math.random() * Math.PI * 2;
        st.xz[i * 2] = HIDE.x + Math.cos(a) * r;
        st.xz[i * 2 + 1] = HIDE.z + Math.sin(a) * r;
      }
      const x = st.xz[i * 2];
      const z = st.xz[i * 2 + 1];
      fastWind(x, z, u, w);
      // turbulence (random walk) grows with wind speed
      const k = 0.6 + 0.35 * Math.hypot(w[0], w[1]);
      const nx = x + w[0] * dt * 2.2 + (Math.random() - 0.5) * k * Math.sqrt(dt) * 3;
      const nz = z + w[1] * dt * 2.2 + (Math.random() - 0.5) * k * Math.sqrt(dt) * 3;
      st.xz[i * 2] = nx;
      st.xz[i * 2 + 1] = nz;
      if (Math.hypot(nx, nz) > R * 0.95) st.age[i] = st.life[i];
    }
  };
  useFrame((_, dtRaw) => {
    const vis = win(story.p, 2.55, 5.6, 0.4);
    // dim during the alert so the back-trace reads
    mat.uniforms.uOpacity.value = vis * 0.5 * (1 - 0.65 * win(story.p, 4.55, 5.9, 0.25));
    mat.uniforms.uScale.value = gl.domElement.height * 0.9;
    if (vis < 0.01) {
      warm.current = false;
      return;
    }
    const u = duskAt(hourAt(story.p));
    if (!warm.current) {
      // pre-roll so the plume is already established when it fades in
      for (let k = 0; k < 120; k++) step(0.1, u);
      warm.current = true;
    }
    step(Math.min(dtRaw, 0.05) * (reduced ? 0.4 : 1), u);
    for (let i = 0; i < N; i++) {
      const x = st.xz[i * 2];
      const z = st.xz[i * 2 + 1];
      st.pos[i * 3] = x;
      st.pos[i * 3 + 1] = FIELD.h(x, z) + 1.1;
      st.pos[i * 3 + 2] = z;
      const t = st.age[i] / st.life[i];
      st.a[i] = Math.min(1, t * 6) * (1 - t);
    }
    st.g.attributes.position.needsUpdate = true;
    st.g.attributes.aA.needsUpdate = true;
  });
  return <points geometry={st.g} material={mat} frustumCulled={false} />;
}

// ------------------------------------------------------------ dog teams

const TEAM_COLORS = ['#ff6b2c', '#ffb547', '#7fd1c7'];
/** each team's K9 officer (Synty Police Station): cap, female officer, campaign hat */
const HANDLERS = ['handler', 'handler_f', 'handler_r'];

function Arrow({ color }: { color: string }) {
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.9);
    s.lineTo(9, 0.9);
    s.lineTo(9, 2.6);
    s.lineTo(14, 0);
    s.lineTo(9, -2.6);
    s.lineTo(9, -0.9);
    s.lineTo(0, -0.9);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  return (
    <mesh geometry={geo} castShadow>
      <meshStandardMaterial color={color} flatShading roughness={0.9} emissive={color} emissiveIntensity={0.35} />
    </mesh>
  );
}

function Team({ kit, t, reduced }: { kit: Kit; t: TeamSpot; reduced: boolean }) {
  const color = TEAM_COLORS[t.n - 1];
  const delay = (t.n - 1) * 0.12;
  const [clip, setClip] = useState<DogClip>('idle');
  const dog = useDog(clip, { offset: t.n * 0.31 });
  const dogG = useRef<THREE.Group>(null);
  const hand = useRef<THREE.Group>(null);
  const handPoint = useRef<THREE.Group>(null);
  const mark = useRef<THREE.Group>(null);
  const clipRef = useRef<DogClip>('idle');
  useFrame(() => {
    const p = story.p;
    // walk out from camp to the start point between 3.35 and 4.0
    const m = ease(ramp(p, 3.15 + delay * 0.6, 3.8 + delay * 0.6));
    const x = t.cx + (t.x - t.cx) * m;
    const z = t.cz + (t.z - t.cz) * m;
    const moving = m > 0.02 && m < 0.98;
    const heading = moving ? yaw(t.x - t.cx, t.z - t.cz) : m >= 0.98 ? yaw(t.ux, t.uz) : yaw(-1, -0.4);
    if (dogG.current) {
      dogG.current.position.set(x + t.ux * 3.2, height(x + t.ux * 3.2, z + t.uz * 3.2), z + t.uz * 3.2);
      dogG.current.rotation.y = heading;
    }
    for (const g of [hand.current, handPoint.current]) {
      if (!g) continue;
      g.position.set(x - t.uz * 2.6, height(x - t.uz * 2.6, z + t.ux * 2.6), z + t.ux * 2.6);
      g.rotation.y = heading;
    }
    const deployed = m >= 0.98;
    if (hand.current) hand.current.visible = !deployed;
    if (handPoint.current) handPoint.current.visible = deployed;
    if (mark.current) {
      const a = ramp(p, 3.7 + delay * 0.6, 3.95 + delay * 0.6) * (1 - ramp(p, 6.3, 6.6));
      mark.current.visible = a > 0.01;
      mark.current.scale.setScalar(Math.max(0.001, a));
    }
    const want: DogClip = !reduced && moving ? 'run' : t.n === ALERT_TEAM.n && p > 4.5 && p < 6.4 ? 'bark' : deployed ? 'sniff' : p < 0.9 ? 'sit' : 'idle';
    if (want !== clipRef.current) {
      clipRef.current = want;
      setClip(want);
    }
  });
  return (
    <group>
      <group ref={dogG}>{dog && <primitive object={dog} scale={CHAR * 0.85} />}</group>
      <group ref={hand} scale={CHAR}>
        <KitMesh kit={kit} name={HANDLERS[t.n - 1]} />
      </group>
      <group ref={handPoint} scale={CHAR} visible={false}>
        <KitMesh kit={kit} name={`${HANDLERS[t.n - 1]}_point`} />
      </group>
      <group ref={mark} position={atY(t.x, t.z, 0.3)}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[7, 8.2, 6]} />
          <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} />
        </mesh>
        <group position={[t.ux * 9, 0.4, t.uz * 9]} rotation={[0, yaw(t.ux, t.uz), 0]}>
          <Arrow color={color} />
        </group>
      </group>
      <Tag position={atY(t.x, t.z, 15)} tone="dark" show={() => ramp(story.p, 3.75 + delay * 0.5, 3.95 + delay * 0.5) * (1 - ramp(story.p, 4.45, 4.65))}>
        <span style={{ color }}>●</span> Team {t.n} · best {t.window} · covers {t.covers}
      </Tag>
    </group>
  );
}

function BackTrace() {
  const { geo, len } = useMemo(() => {
    const pts = [...BACKTRACE].reverse().map(([x, z]) => new THREE.Vector3(x, height(x, z) + 1.6, z));
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, 160, 0.9, 6, false);
    return { geo: g, len: g.index ? g.index.count : g.attributes.position.count };
  }, []);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const d = ramp(story.p, 4.55, 4.95);
    const fade = 1 - ramp(story.p, 6.2, 6.5);
    if (mesh.current) mesh.current.visible = d > 0.01 && fade > 0.01;
    geo.setDrawRange(0, Math.floor((len * d) / 3) * 3);
    if (mat.current) mat.current.opacity = 0.85 * fade;
  });
  return (
    <group>
      <mesh ref={mesh} geometry={geo}>
        <meshBasicMaterial ref={mat} color="#ff4fa3" transparent blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <Tag position={atY(ALERT_TEAM.x, ALERT_TEAM.z, 15)} tone="pink" show={() => ramp(story.p, 4.5, 4.7) * (1 - ramp(story.p, 5.35, 5.55))}>
        Team 1 alert · 19:08 · tracing back upwind
      </Tag>
    </group>
  );
}

// ------------------------------------------------------------ root

export function Diorama({ onReady, reduced }: { onReady?: () => void; reduced: boolean }) {
  const kit = useKit();
  useEffect(() => {
    if (kit) onReady?.();
  }, [kit, onReady]);
  return (
    <>
      <Sky />
      <Lights />
      <CameraRig reduced={reduced} />
      <Island />
      {/* the stream gets a soft glint so it reads as water */}
      <StreamGlint />
      {kit && (
        <>
          <Scatter kit={kit} />
          <Clouds kit={kit} />
          <Campsite kit={kit} />
          <Kid kit={kit} />
          <Hideout kit={kit} />
          {TEAMS.map((t) => (
            <Team key={t.n} kit={kit} t={t} reduced={reduced} />
          ))}
        </>
      )}
      <WindStreaks reduced={reduced} />
      <ScentPlume reduced={reduced} />
      <BackTrace />
      {/* the underside, so the island never shows a hole from low angles */}
      <mesh position={[0, BASE_Y, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[R, 6 * 34]} />
        <meshBasicMaterial color="#2a1f17" side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

function StreamGlint() {
  const geo = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let z = -R * 0.95; z <= R * 0.95; z += 3) {
      const x = valleyX(z);
      if (Math.hypot(x, z) > R * 0.95) continue;
      pts.push(new THREE.Vector3(x, height(x, z) + 0.15, z));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 200, 0.7, 4, false);
  }, []);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((st) => {
    if (mat.current) mat.current.emissiveIntensity = 0.25 + 0.08 * Math.sin(st.clock.elapsedTime * 2);
  });
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial ref={mat} color="#5fb6dd" emissive="#4aa6d6" emissiveIntensity={0.25} roughness={0.3} flatShading />
    </mesh>
  );
}

export { CH };
