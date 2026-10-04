import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { Link } from '../router';
import { MISSIONS, visibleMissions } from '../config/missions';
import { Icon, Logo } from '../ui/icons';
import { Diorama } from './landing/Diorama';
import { CHAPTERS, fmtClock, hourAt, story } from './landing/story';
import { SiteFooter, SiteHeader, img } from './SiteLayout';

function useReducedMotion() {
  const [r, setR] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!m) return;
    const on = () => setR(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return r;
}

/** One chapter card over the 3D scene. */
function Chapter({ n, kicker, title, children, chips, side = 'left' }: { n: number; kicker: string; title: string; children: ReactNode; chips?: string[]; side?: 'left' | 'right' }) {
  return (
    <section className={`relative flex min-h-[100svh] items-end px-4 pb-10 md:items-center md:px-10 md:pb-0 ${side === 'right' ? 'md:justify-end md:pr-32' : ''}`} data-chapter={n}>
      <div className="glass w-full max-w-[440px] rounded-2xl p-6 md:p-7">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-sar font-mono text-[11px] font-semibold text-white">{n}</span>
          <span className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-white/60">{kicker}</span>
        </div>
        <h2 className="mt-3 font-display text-[30px] font-bold leading-[1.05] tracking-tight text-white md:text-[36px]">{title}</h2>
        <div className="mt-3 text-[15.5px] leading-relaxed text-white/80">{children}</div>
        {chips && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span key={c} className="rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[12px] font-semibold text-white/85">
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Clock, light and scent conditions for the moment the story is at (updated without re-rendering). */
function StoryHud({ active }: { active: boolean }) {
  const clock = useRef<HTMLSpanElement>(null);
  const cond = useRef<HTMLSpanElement>(null);
  const sun = useRef<HTMLSpanElement>(null);
  const [chapter, setChapter] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = -1;
    const tick = () => {
      const h = hourAt(story.p);
      if (clock.current) clock.current.textContent = fmtClock(h);
      if (cond.current) cond.current.textContent = h < 17.4 ? 'Fair · sun lifts scent' : h < 18.5 ? 'Improving · air cooling' : 'Good · cool, settling air';
      if (sun.current) sun.current.dataset.night = h > 19 ? '1' : '0';
      const c = Math.round(story.p);
      if (c !== last) {
        last = c;
        setChapter(c);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const go = (i: number) => window.scrollTo({ top: i * window.innerHeight, behavior: 'smooth' });
  return (
    <div className={`pointer-events-none fixed inset-0 z-30 transition-opacity duration-500 ${active ? 'opacity-100' : 'opacity-0'}`} aria-hidden={!active}>
      {/* clock */}
      <div className="glass pointer-events-auto absolute left-4 top-[84px] flex items-center gap-3 rounded-full py-1.5 pl-2 pr-4 md:left-6">
        <span ref={sun} className="grid h-8 w-8 place-items-center rounded-full bg-amber/90 text-ink-900 data-[night='1']:bg-[#8aa6ff]">
          <Icon.Sun size={16} />
        </span>
        <div className="leading-tight">
          <span ref={clock} className="num block text-[17px] font-medium text-white">
            16:00
          </span>
          <span className="block text-[11px] text-white/60">
            Scent: <span ref={cond}>Fair</span>
          </span>
        </div>
      </div>
      {/* chapter rail */}
      <nav className="pointer-events-auto absolute right-5 top-1/2 hidden -translate-y-1/2 flex-col gap-3 md:flex" aria-label="Story chapters">
        {CHAPTERS.map((c, i) => (
          <button key={c.id} onClick={() => go(i)} className="group flex items-center justify-end gap-2" aria-current={chapter === i}>
            <span className={`rounded-full px-2 py-0.5 font-mono text-[11px] transition ${chapter === i ? 'bg-white/15 text-white' : 'text-white/0 group-hover:text-white/70'}`}>
              {fmtClock(c.hour)} · {c.rail}
            </span>
            <span className={`block rounded-full transition-all ${chapter === i ? 'h-3 w-3 bg-sar ring-4 ring-sar/30' : 'h-2 w-2 bg-white/50 group-hover:bg-white'}`} />
          </button>
        ))}
      </nav>
      {/* scroll cue */}
      <div className={`absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-1 text-white/80 transition-opacity md:flex ${chapter === 0 ? 'opacity-100' : 'opacity-0'}`}>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em]">Scroll to follow the search</span>
        <span className="h-8 w-px animate-pulseDot bg-white/70" />
      </div>
    </div>
  );
}

const ENGINE = [
  { n: '01', title: 'Where they might be', body: 'Lost-person statistics by profile, bent by trails, streams, water, cliffs and slope. Paint local knowledge on top.', image: 'step-probability.jpg' },
  { n: '02', title: 'Wind over real terrain', body: "The Forest Service's WindNinja model, hour by hour, initialised from the NOAA forecast.", image: 'step-wind.jpg' },
  { n: '03', title: 'Scent at nose height', body: 'Released from every likely spot and carried at 0.6 m: it spreads, fades in sun, lifts off warm slopes and pools in calm hollows.', image: 'step-scent.jpg' },
  { n: '04', title: 'Teams, headings, hours', body: 'Start points downwind of likely ground, on workable slopes, with an upwind heading and the best hour for each team.', image: 'step-deploy.jpg' },
];

export function Home() {
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [inStory, setInStory] = useState(true);
  const storyEl = useRef<HTMLDivElement>(null);
  const onReady = useCallback(() => setReady(true), []);
  const last = CHAPTERS.length - 1;

  useEffect(() => {
    story.goal = 0;
    story.p = 0;
    // dev-only: ?story=3 pins the scene at a chapter (for screenshots)
    const jump = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('story')) : 0;
    const onScroll = () => {
      story.goal = jump || Math.max(0, Math.min(last, window.scrollY / window.innerHeight));
      const end = (storyEl.current?.offsetHeight ?? 0) - window.innerHeight * 0.5;
      setInStory(window.scrollY < end);
    };
    const onMove = (e: PointerEvent) => {
      story.mx = (e.clientX / window.innerWidth) * 2 - 1;
      story.my = (e.clientY / window.innerHeight) * 2 - 1;
    };
    if (jump) story.p = jump;
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointermove', onMove);
    };
  }, [last]);

  return (
    <div className="relative bg-ink-900">
      <SiteHeader overlay solidAfter={(typeof window === "undefined" ? 900 : window.innerHeight) * (CHAPTERS.length - 0.6)} />

      {/* the 3D diorama, fixed behind the story */}
      <div className="fixed inset-0 z-0" aria-hidden>
        <Canvas
          shadows
          dpr={[1, 1.75]}
          frameloop={inStory ? 'always' : 'never'}
          camera={{ fov: 38, near: 1, far: 2000, position: [150, 96, 168] }}
          gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.15 }}
          onCreated={({ gl }) => {
            gl.shadowMap.type = THREE.PCFSoftShadowMap;
          }}
        >
          <Suspense fallback={null}>
            <Diorama onReady={onReady} reduced={reduced} />
          </Suspense>
        </Canvas>
      </div>

      {/* loading veil */}
      <div className={`pointer-events-none fixed inset-0 z-20 grid place-items-center bg-ink-900 transition-opacity duration-700 ${ready ? 'opacity-0' : 'opacity-100'}`}>
        <div className="flex flex-col items-center gap-3 text-white/80">
          <Logo size={44} className="animate-pulseDot text-white" />
          <span className="font-mono text-xs uppercase tracking-[0.18em]">Growing the forest…</span>
        </div>
      </div>

      <StoryHud active={ready && inStory} />

      {/* story chapters scroll over the scene */}
      <div ref={storyEl} className="relative z-10">
        <section className="relative flex min-h-[100svh] flex-col justify-end px-4 pb-24 md:justify-center md:px-10 md:pb-0">
          {/* phones: a soft sky-coloured scrim so the headline reads over the island */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[75%] bg-gradient-to-t from-[#dff0ea] via-[#dff0ea]/85 to-transparent md:hidden" />
          <div className="relative max-w-[640px] animate-rise">
            <span className="inline-flex items-center gap-2 rounded-full bg-ink-900/70 px-3 py-1 font-mono text-[11.5px] uppercase tracking-[0.14em] text-white/80 backdrop-blur">
              <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-sar" /> Air-scent dog deployment planner
            </span>
            <h1 className="mt-5 font-display text-[52px] font-extrabold leading-[0.92] tracking-[-0.03em] text-ink-900 [text-shadow:0_1px_30px_rgb(255_255_255/0.45)] md:text-[88px]">
              Send the dogs where the <span className="text-sar">scent</span> is.
            </h1>
            <p className="mt-5 max-w-md text-lg font-medium leading-relaxed text-ink-900/80">
              Scentline models how wind carries a missing person&apos;s scent across real terrain, then tells you where each dog team should start, and when.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/planner?demo" className="btn btn-primary btn-lg">
                Open the live demo <span aria-hidden>→</span>
              </Link>
              <Link to="/new" className="btn btn-lg !border-ink-900/15 !bg-white/70 backdrop-blur">
                Plan your own search
              </Link>
            </div>
          </div>
        </section>

        <Chapter n={1} kicker="16:00 · campsite" title="A 9-year-old wanders off." chips={['Last known point', 'Child 7–12 profile', '3 dog teams', 'Sunset 19:00']}>
          Last seen by the tents at Devil&apos;s Tombstone, in the Catskills. A probability map can say where the child might be. It can&apos;t say where a dog could{' '}
          <em className="not-italic text-amber">smell</em> them.
        </Chapter>
        <Chapter n={2} side="right" kicker="17:00 · WindNinja" title="Wind bends around every ridge." chips={['USFS WindNinja', 'NOAA HRRR forecast', 'Hourly']}>
          Scentline runs the Forest Service&apos;s WindNinja model on real elevation data. In the afternoon, breezes climb sun-warmed slopes; ridges split the flow and valleys
          channel it.
        </Chapter>
        <Chapter n={3} kicker="18:30 · nose height" title="At dusk, scent drains like water." chips={['Particles at 0.6 m', 'Decay with sun and heat', 'Calm-air pooling']}>
          Scent is released from every likely spot and carried at dog-nose height. As the air cools it slides downhill and pools in drainages, so the best place to smell a
          hillside is often the valley below it.
        </Chapter>
        <Chapter n={4} side="right" kicker="19:00 · deploy" title="Start downwind. Work into the wind." chips={['Upwind headings', 'Best hour per team', '300 m spacing']}>
          Each team gets a start point downwind of the most likely ground, a heading into the wind and its best hour. Teams are spread so they don&apos;t work the same air.
        </Chapter>
        <Chapter n={5} side="right" kicker="19:08 · alert" title="An alert points back to the source." chips={['Back-tracing', 'Bayesian update', 'Searched areas count too']}>
          When a dog indicates, Scentline traces the scent backwards through the wind field. Overlapping alerts collapse the search to a few hundred metres, and empty sectors push
          probability elsewhere.
        </Chapter>
        <section className="relative flex min-h-[100svh] items-center justify-center px-4 text-center">
          <div className="max-w-2xl">
            <p className="font-mono text-[12px] uppercase tracking-[0.18em] text-white/60">Your turn</p>
            <h2 className="mt-3 font-display text-[44px] font-extrabold leading-[0.95] tracking-tight text-white md:text-[72px]">Plan the next search.</h2>
            <p className="mx-auto mt-4 max-w-md text-lg text-white/75">The full demo runs offline in your browser: real terrain, WindNinja winds and seven guided steps.</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link to="/planner?demo" className="btn btn-primary btn-lg">
                Open the live demo <span aria-hidden>→</span>
              </Link>
              <Link to="/new" className="btn btn-ghost btn-lg">
                Plan your own area
              </Link>
            </div>
          </div>
        </section>
      </div>

      {/* regular page content covers the scene */}
      <div className="relative z-10 rounded-t-[32px] bg-paper">
        <section id="engine" className="mx-auto max-w-6xl px-4 pb-6 pt-20 md:px-6">
          <p className="eyebrow">The engine</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <h2 className="max-w-xl font-display text-[40px] font-bold leading-[1.02] tracking-tight md:text-[52px]">Four models, one plan.</h2>
            <Link to="/how-it-works" className="btn">
              Every parameter, explained →
            </Link>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {ENGINE.map((s) => (
              <article key={s.n} className="group overflow-hidden rounded-2xl border border-rule bg-card shadow-lift transition hover:-translate-y-1">
                <div className="aspect-[4/3] overflow-hidden bg-ink-900">
                  <img src={img(s.image)} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                </div>
                <div className="p-5">
                  <div className="num text-xs text-sar-dark">{s.n}</div>
                  <h3 className="mt-1 font-display text-xl font-bold leading-tight">{s.title}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">{s.body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-20 md:px-6">
          <div className="grid gap-10 md:grid-cols-[1fr_1.4fr] md:items-end">
            <div>
              <p className="eyebrow">For the whole team</p>
              <h2 className="mt-2 font-display text-[40px] font-bold leading-[1.02] tracking-tight md:text-[52px]">Search, train, recover.</h2>
            </div>
            <p className="max-w-xl text-[17px] leading-relaxed text-ink-2">
              The same wind and scent engine serves a K9 unit before, during and after a search. Each mode changes where the target can be, how its scent behaves and where teams can
              stand.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {visibleMissions().map((m, i) => (
              <Link
                key={m}
                to={`/planner?demo&mission=${m}`}
                className="group relative overflow-hidden rounded-2xl border border-rule bg-card p-6 text-ink no-underline shadow-lift transition hover:-translate-y-1 hover:border-sar hover:text-ink"
              >
                <div className="num text-xs text-sar-dark">{String(i + 1).padStart(2, '0')}</div>
                <div className="mt-2 font-display text-2xl font-bold leading-tight">{MISSIONS[m].label}</div>
                <p className="mt-2 text-[14.5px] leading-snug text-ink-2">{MISSIONS[m].short}</p>
                <span className="mt-5 inline-flex items-center gap-1 text-[13px] font-semibold text-sar-dark">
                  Try it in the demo <span className="transition group-hover:translate-x-1">→</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="px-4 pb-24 md:px-6">
          <div className="relative mx-auto grid max-w-6xl gap-8 overflow-hidden rounded-[28px] bg-pine p-8 text-white md:grid-cols-[1.3fr_1fr] md:p-12">
            <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rotate-12 bg-gradient-to-br from-sar/50 to-amber/10 [clip-path:polygon(0_50%,100%_0,80%_50%,100%_100%)]" />
            <div className="relative">
              <p className="eyebrow !text-white/50">No setup</p>
              <h3 className="mt-2 font-display text-[34px] font-bold leading-tight">The Catskills demo, offline.</h3>
              <p className="mt-3 max-w-lg text-[16px] leading-relaxed text-white/75">
                Real terrain, land cover, trails and WindNinja winds for one September evening, bundled with the site. Press 1 to 7 to walk through the whole scenario.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link to="/planner?demo" className="btn btn-primary btn-lg">
                  Open the demo
                </Link>
                <Link to="/new" className="btn btn-ghost btn-lg">
                  Plan a search anywhere
                </Link>
              </div>
            </div>
            <div className="relative self-center rounded-2xl border border-white/10 bg-white/5 p-5 text-[14px] leading-relaxed text-white/75">
              <div className="font-semibold text-white">Your own area</div>
              Pick the last known point on a map, the date and time (or right now) and the subject. The server downloads terrain and weather and runs WindNinja, in about a minute.
              <p className="mt-3 text-[12.5px] text-white/50">Research prototype: simplified scent rules. Use it alongside experienced K9 handlers, never instead of them.</p>
            </div>
          </div>
        </section>
      </div>
      <SiteFooter />
    </div>
  );
}
