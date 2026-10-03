import { create } from 'zustand';
import type { ProfileId } from '../config/modelParams';
import type { AreaBundle } from '../api/types';
import type { WindField } from '../models/wind';
import type { DeploymentOut, HeatResult, ProbResult } from '../workers/protocol';

export type LayerId =
  | 'contours'
  | 'landcover'
  | 'vegetation'
  | 'features'
  | 'probability'
  | 'wind'
  | 'scent'
  | 'heatmap'
  | 'hotspots'
  | 'teams'
  | 'alertZones'
  | 'searched';

export const LAYER_LABELS: Record<LayerId, string> = {
  contours: 'Contour lines',
  landcover: 'Land-cover tint',
  vegetation: 'Vegetation models',
  features: 'Trails & streams',
  probability: 'Probability map',
  wind: 'Wind streaks',
  scent: 'Scent particles',
  heatmap: 'Scent heatmap',
  hotspots: 'Hotspots',
  teams: 'Dog teams',
  alertZones: 'Alert zones',
  searched: 'Searched sectors',
};

export type Tool = 'none' | 'lkp' | 'alert' | 'searched' | 'brushUp' | 'brushDown' | 'focus';

export interface Alert {
  id: number;
  x: number;
  y: number;
  t: number;
  zone: Float32Array;
}

export interface SearchedSector {
  id: number;
  x: number;
  y: number;
  radius: number;
  t: number;
  meanDet: number;
  recheck: boolean;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'error' | 'success';
}

export interface OnsiteWind {
  hour: number;
  dir: number;
  speed: number;
}

export interface CameraShot {
  position: [number, number, number];
  target: [number, number, number];
  nonce: number;
}

export interface State {
  status: 'loading' | 'ready' | 'error';
  loadFrac: number;
  loadLabel: string;
  error: string | null;
  mode: 'offline' | 'live';
  backend: { ok: boolean; windninja: boolean };
  bundle: AreaBundle | null;
  windSource: 'windninja' | 'fallback';
  activeWind: WindField | null;
  windVersion: number;
  onsiteWind: OnsiteWind | null;
  profile: ProfileId;
  /** LKP in local metres */
  lkp: [number, number];
  time: number;
  playing: boolean;
  layers: Record<LayerId, boolean>;
  view: 'map' | 'scene';
  tool: Tool;
  prob: ProbResult | null;
  probVersion: number;
  heat: HeatResult | null;
  teams: number;
  deployments: DeploymentOut[];
  alerts: Alert[];
  searched: SearchedSector[];
  revealed: boolean;
  suggestions: [number, number, number][];
  scentRelease: number;
  busy: { label: string; frac: number } | null;
  workerBusy: number;
  toasts: Toast[];
  debug: boolean;
  camera: CameraShot | null;
  focusPreview: [number, number] | null;
  hover: [number, number] | null;
  fps: number;
  particleCount: number;
  set: (p: Partial<State>) => void;
  toggleLayer: (id: LayerId) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
}

let toastId = 1;

export const useStore = create<State>((set, get) => ({
  status: 'loading',
  loadFrac: 0,
  loadLabel: 'Starting',
  error: null,
  mode: 'offline',
  backend: { ok: false, windninja: false },
  bundle: null,
  windSource: 'fallback',
  activeWind: null,
  windVersion: 0,
  onsiteWind: null,
  profile: 'child712',
  lkp: [0, 0],
  time: 16,
  playing: false,
  layers: {
    contours: true,
    landcover: false,
    vegetation: true,
    features: true,
    probability: true,
    wind: false,
    scent: false,
    heatmap: false,
    hotspots: false,
    teams: true,
    alertZones: true,
    searched: true,
  },
  view: 'scene',
  tool: 'none',
  prob: null,
  probVersion: 0,
  heat: null,
  teams: 3,
  deployments: [],
  alerts: [],
  searched: [],
  revealed: false,
  suggestions: [],
  scentRelease: 0,
  busy: null,
  workerBusy: 0,
  toasts: [],
  debug: false,
  camera: null,
  focusPreview: null,
  hover: null,
  fps: 0,
  particleCount: 0,
  set: (p) => set(p),
  toggleLayer: (id) => set({ layers: { ...get().layers, [id]: !get().layers[id] } }),
  toast: (text, tone = 'info') => {
    const id = toastId++;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), tone === 'error' ? 7000 : 4500);
  },
}));
