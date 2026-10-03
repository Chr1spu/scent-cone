import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { TIME } from './config/modelParams';
import { SceneRoot } from './scene/SceneRoot';
import { boot, finishPolygon, flyTo, scheduleHeat, setTime, setView } from './state/controller';
import { useStore } from './state/store';
import { ControlPanel } from './ui/ControlPanel';
import { Legend } from './ui/Legend';
import { BusyIndicator, DebugOverlay, HelpBar, LoadingScreen, Toasts } from './ui/Overlays';
import { TimeSlider } from './ui/TimeSlider';
import { TopBar } from './ui/TopBar';

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
      else if (e.key === 'Escape') s.set({ tool: 'none', hover: null, focusPreview: null, searchDraft: { ...s.searchDraft, pts: [] } });
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

export default function App() {
  const bundle = useStore((s) => s.bundle);
  const tool = useStore((s) => s.tool);
  usePlayback();
  useKeyboard();
  useEffect(() => {
    boot();
    // heat layers switched on -> compute
    return useStore.subscribe((s, prev) => {
      if ((s.layers.heatmap && !prev.layers.heatmap) || (s.layers.hotspots && !prev.layers.hotspots)) scheduleHeat(0);
    });
  }, []);
  return (
    <div className="relative h-full w-full overflow-hidden" style={{ cursor: tool !== 'none' ? 'crosshair' : undefined }}>
      <Canvas
        camera={{ position: [0, 4000, 4500], fov: 45, near: 5, far: 80000 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        onPointerMissed={() => undefined}
      >
        <color attach="background" args={['#0a0f14']} />
        {bundle && <SceneRoot key={bundle.config.areaId + bundle.mode} bundle={bundle} />}
      </Canvas>
      <div className="pointer-events-none absolute inset-0">
        <TopBar />
        <ControlPanel />
        <Legend />
        <TimeSlider />
        <BusyIndicator />
        <Toasts />
        <DebugOverlay />
        <HelpBar />
      </div>
      <LoadingScreen />
    </div>
  );
}
