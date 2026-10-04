import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { TIME, PROFILES, type ProfileId } from '../config/modelParams';
import { isMission } from '../config/missions';
import { SceneRoot } from '../scene/SceneRoot';
import { boot, finishPolygon, flyTo, scheduleHeat, setTime, setView, type BootOptions } from '../state/controller';
import { useStore } from '../state/store';
import { useIsMobile } from '../ui/useIsMobile';
import { ControlPanel } from './ControlPanel';
import { InfoPanel } from './InfoPanel';
import { BusyIndicator, DebugOverlay, LoadingScreen, Toasts } from './Overlays';
import { PlannerBar } from './PlannerBar';
import { TimeBar } from './TimeBar';

/** URL → boot options: ?demo, or ?lat&lon[&now=1|&date&start][&profile][&teams]. */
export function bootOptionsFrom(q: URLSearchParams): BootOptions {
  const lat = Number(q.get('lat'));
  const lon = Number(q.get('lon'));
  const profile = q.get('profile') as ProfileId | null;
  const teams = Number(q.get('teams')) || undefined;
  const m = q.get('mission');
  const opts: BootOptions = { teams, profile: profile && PROFILES[profile] ? profile : undefined, mission: isMission(m) ? m : undefined };
  if (q.has('lat') && q.has('lon') && Number.isFinite(lat) && Number.isFinite(lon)) {
    opts.live = {
      lat,
      lon,
      now: q.get('now') === '1',
      date: q.get('date') ?? undefined,
      startHour: q.has('start') ? Number(q.get('start')) : undefined,
      detailCenter: null,
    };
  }
  return opts;
}

function usePlayback() {
  const playing = useStore((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const s = useStore.getState();
      const dt = (now - last) / 1000;
      last = now;
      const end = s.bundle?.config.endHour ?? TIME.end;
      const next = s.time + dt * TIME.playRate;
      if (next >= end) {
        setTime(end);
        s.set({ playing: false });
        return;
      }
      setTime(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      const s = useStore.getState();
      if (e.key >= '1' && e.key <= '7') flyTo(Number(e.key));
      else if (e.key === 'd' || e.key === 'D') s.set({ debug: !s.debug });
      else if (e.key === 'm' || e.key === 'M') setView(s.view === 'map' ? 'scene' : 'map');
      else if (e.key === 'Escape') s.set({ tool: 'none', hover: null, focusPreview: null, searchDraft: { ...s.searchDraft, pts: [] }, mobileSheet: 'none' });
      else if (e.key === 'Enter' && s.tool === 'searched' && s.searchDraft.shape === 'polygon') finishPolygon();
      else if (e.key === ' ') {
        e.preventDefault();
        s.set({ playing: !s.playing });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function Planner({ query }: { query: URLSearchParams }) {
  const bundle = useStore((s) => s.bundle);
  const status = useStore((s) => s.status);
  const tool = useStore((s) => s.tool);
  const sheet = useStore((s) => s.mobileSheet);
  const mobile = useIsMobile();
  usePlayback();
  useKeyboard();
  const qs = query.toString();
  useEffect(() => {
    useStore.getState().set({ bundle: null, status: 'loading', mobileSheet: 'none' });
    boot(bootOptionsFrom(new URLSearchParams(qs)));
  }, [qs]);
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if ((s.layers.heatmap && !prev.layers.heatmap) || (s.layers.hotspots && !prev.layers.hotspots)) scheduleHeat(0);
      }),
    [],
  );
  const ready = status === 'ready' && !!bundle;
  return (
    <div className="theme-dark flex h-full flex-col overflow-hidden bg-paper text-ink">
      <PlannerBar />
      <div className="relative flex min-h-0 flex-1">
        {!mobile && (
          <aside className="sheet w-[300px] shrink-0 border-r" aria-label="Planning controls">
            {ready && <ControlPanel />}
          </aside>
        )}
        <div className="relative min-w-0 flex-1 bg-ink-950" style={{ cursor: tool !== 'none' ? 'crosshair' : undefined }}>
          <Canvas camera={{ position: [0, 4000, 4500], fov: 45, near: 5, far: 80000 }} gl={{ antialias: true, powerPreference: 'high-performance' }} dpr={[1, 2]}>
            <color attach="background" args={['#08110e']} />
            {bundle && <SceneRoot key={bundle.config.areaId + bundle.mode} bundle={bundle} />}
          </Canvas>
          <BusyIndicator />
          <Toasts />
          <DebugOverlay />
          {mobile && sheet !== 'none' && ready && (
            <div className="sheet absolute inset-x-0 bottom-0 top-0 z-20 overflow-hidden border-t">{sheet === 'plan' ? <ControlPanel /> : <InfoPanel />}</div>
          )}
        </div>
        {!mobile && (
          <aside className="sheet w-[280px] shrink-0 border-l" aria-label="Plan, legend and notes">
            {ready && <InfoPanel />}
          </aside>
        )}
        <LoadingScreen />
      </div>
      {ready && <TimeBar />}
    </div>
  );
}
