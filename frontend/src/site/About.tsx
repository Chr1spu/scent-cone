import { Suspense, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Link } from '../router';
import { KitMesh, useDog, useKit, type DogClip } from '../scene/assets';
import { SitePage } from './SiteLayout';

const SOURCES: [string, string, string][] = [
  ['WindNinja', 'US Forest Service, Missoula Fire Sciences Laboratory', 'https://github.com/firelab/windninja'],
  ['HRRR forecast', 'NOAA, via NOMADS (downloaded by WindNinja)', 'https://rapidrefresh.noaa.gov/hrrr/'],
  ['Hourly weather', 'Open-Meteo', 'https://open-meteo.com'],
  ['Elevation, US', 'USGS 3D Elevation Program (3DEP), via py3dep', 'https://www.usgs.gov/3d-elevation-program'],
  ['Elevation, elsewhere', 'Copernicus GLO-30 DEM, ESA / Airbus', 'https://spacedata.copernicus.eu'],
  ['Land cover, US', 'NLCD 2021, USGS / MRLC', 'https://www.mrlc.gov'],
  ['Land cover, elsewhere', 'ESA WorldCover 2021', 'https://esa-worldcover.org'],
  ['Trails, roads, streams', '© OpenStreetMap contributors (ODbL), via the Overpass API', 'https://www.openstreetmap.org/copyright'],
  ['Place search', 'OpenStreetMap Nominatim', 'https://nominatim.org'],
  ['Base maps', 'OpenTopoMap (CC-BY-SA), USGS The National Map, OpenStreetMap', 'https://opentopomap.org'],
  ['Distance statistics', 'R. Koester, Lost Person Behavior', 'https://www.dbs-sar.com'],
  ['3D models', 'Synty Studios POLYGON Dog, Adventure and Kids packs (licensed)', 'https://syntystore.com'],
];

const CLIPS: { id: DogClip; label: string; note: string }[] = [
  { id: 'sniff', label: 'Sniff', note: 'Working the air. Air-scent dogs search with their heads up, catching scent carried on the wind rather than tracking footsteps.' },
  { id: 'walk', label: 'Walk', note: 'Quartering into the wind. Each team gets a start point downwind of likely ground and a heading into the wind.' },
  { id: 'run', label: 'Run', note: 'Following the scent cone. As the dog closes in, the cone narrows toward its source.' },
  { id: 'bark', label: 'Alert', note: 'Indicating. Scentline traces an alert backwards through the wind field to show where the scent came from.' },
  { id: 'sit', label: 'Rest', note: 'Scent conditions matter. Heat, sun and dry air shorten how long scent lasts, so timing is part of the plan.' },
];

/** A low-poly plinth (hex prism with a grass cap and soil layers) to stand the team on. */
function Plinth() {
  return (
    <group>
      <mesh position={[0, -0.12, 0]} receiveShadow>
        <cylinderGeometry args={[3.2, 3.2, 0.24, 6]} />
        <meshStandardMaterial color="#6e9a46" flatShading roughness={1} />
      </mesh>
      <mesh position={[0, -0.7, 0]}>
        <cylinderGeometry args={[3.2, 3.05, 0.92, 6]} />
        <meshStandardMaterial color="#6b4a2f" flatShading roughness={1} />
      </mesh>
      <mesh position={[0, -1.55, 0]}>
        <cylinderGeometry args={[3.05, 2.7, 0.8, 6]} />
        <meshStandardMaterial color="#5a5550" flatShading roughness={1} />
      </mesh>
    </group>
  );
}

function Stage({ clip }: { clip: DogClip }) {
  const dog = useDog(clip);
  const kit = useKit();
  return (
    <>
      <hemisphereLight args={['#dff0ff', '#4a3a2a', 1.1]} />
      <directionalLight position={[5, 9, 6]} intensity={2.4} color="#fff1d6" castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <group position={[0, -0.6, 0]}>
        <Plinth />
        {dog && <primitive object={dog} position={[0.3, 0, 0.4]} rotation={[0, -0.5, 0]} />}
        <KitMesh kit={kit} name="handler_point" position={[-1.3, 0, -0.6]} rotation={[0, -0.35, 0]} />
        <KitMesh kit={kit} name="fern_1" position={[1.9, 0, -1.4]} scale={0.9} />
        <KitMesh kit={kit} name="rock_3" position={[-2.1, 0, 1.3]} scale={0.6} />
        <KitMesh kit={kit} name="bush_3" position={[2.2, 0, 0.9]} scale={0.5} />
        <KitMesh kit={kit} name="pine_4" position={[-1.9, 0, -1.9]} scale={0.55} />
        <ContactShadows position={[0, 0.01, 0]} opacity={0.35} scale={8} blur={2.4} far={3} />
      </group>
      <OrbitControls enablePan={false} enableZoom={false} autoRotate autoRotateSpeed={0.8} minPolarAngle={0.9} maxPolarAngle={1.35} target={[0, 0.1, 0]} />
    </>
  );
}

function MeetTheTeam() {
  const [clip, setClip] = useState<DogClip>('sniff');
  const cur = CLIPS.find((c) => c.id === clip)!;
  return (
    <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-b from-[#bfe3f2] via-[#e6efe0] to-[#f6f1e7] shadow-float">
      <div className="h-[420px] md:h-[520px]">
        <Canvas shadows dpr={[1, 2]} camera={{ position: [8.2, 4.6, 9.6], fov: 30 }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}>
          <Suspense fallback={null}>
            <Stage clip={clip} />
          </Suspense>
        </Canvas>
      </div>
      <div className="absolute left-4 top-4 rounded-full bg-ink-900/80 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-white/80 backdrop-blur">Drag to look around</div>
      <div className="absolute inset-x-3 bottom-3 rounded-2xl border border-white/60 bg-white/75 p-4 backdrop-blur-xl md:inset-x-auto md:bottom-4 md:right-4 md:w-[340px]">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dog animation">
          {CLIPS.map((c) => (
            <button key={c.id} className={`btn btn-sm ${clip === c.id ? 'btn-primary' : ''}`} aria-pressed={clip === c.id} onClick={() => setClip(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[13.5px] leading-snug text-ink-2">{cur.note}</p>
      </div>
    </div>
  );
}

const STACK = [
  { k: 'Wind', v: 'USFS WindNinja (mass-conserving, diurnal) in Docker, initialised from NOAA HRRR; a slope-wind fallback runs in the browser.' },
  { k: 'Scent', v: '15,000 particles at 0.6 m, advected hour by hour, with decay, forest slow-down, calm-air pooling and sun lift. Ensembles in Web Workers.' },
  { k: 'Plan', v: 'Greedy team placement over scent-weighted probability; back-tracing for alerts and Bayesian updates for empty sectors.' },
  { k: 'Front end', v: 'React, three.js / React Three Fiber, zustand, Tailwind. Works fully offline with the bundled demo.' },
  { k: 'Back end', v: 'FastAPI, rasterio, py3dep, Open-Meteo; per-area caching, job queue and rate limits.' },
  { k: 'Art', v: 'Synty POLYGON Dog, Adventure and Kids packs, converted to glTF with Blender and three.js scripts; the dog keeps its real animation clips.' },
];

export function About() {
  return (
    <SitePage>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-14 md:grid-cols-[1fr_1.25fr] md:px-6">
        <div>
          <p className="eyebrow">The project</p>
          <h1 className="mt-3 font-display text-[46px] font-extrabold leading-[0.95] tracking-[-0.02em] md:text-[64px]">
            Dogs find scent, <span className="text-sar">not people.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-ink-2">
            Scentline started as a two-day hackathon question: if you know roughly where a missing person is, and you know the wind, where should the air-scent dogs go first?
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <span className="chip">48-hour hackathon build</span>
            <span className="chip">Runs offline</span>
            <span className="chip">Open source</span>
          </div>
        </div>
        <MeetTheTeam />
      </section>

      <section className="border-y border-rule bg-paper-2/60">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-6">
          <div className="grid gap-10 md:grid-cols-[1fr_1.4fr]">
            <div>
              <p className="eyebrow">The problem</p>
              <h2 className="mt-2 font-display text-[34px] font-bold leading-tight tracking-tight">Probability maps stop one step short.</h2>
            </div>
            <div className="space-y-4 text-[17px] leading-relaxed text-ink-2">
              <p>
                Searchers already map where a person is likely to be. Dogs, though, find scent, and scent is wherever the air carries it. In hill country that changes through the day as
                slopes warm and cool: up the sunny side in the afternoon, down the drainages at dusk.
              </p>
              <p>
                Scentline joins a lost-person probability map, the Forest Service&apos;s WindNinja wind model and a simple scent simulation, so a planner can see where a dog has the best
                chance, and when.
              </p>
            </div>
          </div>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-3">
            {STACK.map((s) => (
              <div key={s.k} className="bg-card p-6">
                <div className="font-display text-lg font-bold">{s.k}</div>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">{s.v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <article className="prose-site mx-auto max-w-prose px-4 py-12">
        <h2 className="!mt-0">Status</h2>
        <p>
          A working prototype. The terrain, land cover and wind come from real data and established models. The scent behaviour is a set of rules of thumb, chosen to be reasonable and
          documented in full on <Link to="/how-it-works">How it works</Link>. It has not been tested against field trials.
        </p>
        <div className="not-prose my-6 rounded-xl border border-sar/30 bg-sar/10 px-5 py-4 text-[15px] leading-relaxed text-ink">
          <strong>Not for operational use.</strong> Scentline is meant to support a conversation with experienced K9 handlers and search managers. It does not replace their judgement,
          an incident command structure, or local knowledge.
        </div>

        <h2>Data sources and credits</h2>
        <table>
          <thead>
            <tr>
              <th>What</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map(([what, who, url]) => (
              <tr key={what}>
                <td className="whitespace-nowrap font-medium">{what}</td>
                <td>
                  <a href={url}>{who}</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Source code</h2>
        <p>
          Everything, including the model parameters, the backend and the script that builds the demo data, is at{' '}
          <a href="https://github.com/Chr1spu/scentline">github.com/Chr1spu/scentline</a>.
        </p>
      </article>
    </SitePage>
  );
}

export function NotFound() {
  return (
    <SitePage>
      <div className="mx-auto max-w-prose px-4 py-24">
        <p className="eyebrow">404</p>
        <h1 className="mt-2 font-display text-4xl font-bold">This page is off the map.</h1>
        <p className="mt-3 text-ink-2">
          Try the <Link to="/">home page</Link> or <Link to="/planner?demo">open the demo</Link>.
        </p>
      </div>
    </SitePage>
  );
}
