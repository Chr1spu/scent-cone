import type { TrialScore } from '../models/validation';
import { create } from 'zustand';
import type { ProfileId } from '../config/modelParams';
import type { AreaBundle } from '../api/types';
import type { WindField } from '../models/wind';
import type { SearchedSector as SectorShape } from '../models/searchUpdate';
import { DEFAULT_HABITAT, type HabitatSpec, type MissionId } from '../config/missions';
import type { DeploymentOut, HeatResult, ProbResult, SegmentsResult } from '../workers/protocol';

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
  | 'searched'
  | 'segments';

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
  segments: 'Search segments',
};

export type Tool = 'none' | 'lkp' | 'alert' | 'searched' | 'brushUp' | 'brushDown' | 'focus' | 'hide' | 'area';

export interface Alert {
  id: number;
  x: number;
  y: number;
  t: number;
  zone: Float32Array;
}

export interface SearchedSector {
  id: number;
  sector: SectorShape;
  /** search window (local hours) */
  t0: number;
  t1: number;
  meanDet: number;
  recheck: boolean;
}

/** In-progress "mark searched" settings and polygon vertices. */
export interface SearchDraft {
  shape: 'circle' | 'polygon';
  radius: number;
  windowMin: number;
  pts: [number, number][];
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'error' | 'success';
}

export interface TrialResult {
  file: string;
  /** end of the scored window (local hours) */
  t: number;
  score: Omit<TrialScore, 'points'>;
  points: TrialScore['points'];
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
  /** what failed: the server (offer the demo) or the bundled data */
  errorKind: 'server' | 'data' | null;
  mode: 'offline' | 'live' | 'saved';
  backend: { ok: boolean; windninja: boolean };
  bundle: AreaBundle | null;
  windSource: 'windninja' | 'fallback';
  activeWind: WindField | null;
  windVersion: number;
  onsiteWind: OnsiteWind | null;
  profile: ProfileId;
  /** intended direction of travel from the last known point (degrees from north), if known */
  travelDir: number | null;
  mission: MissionId;
  /** training hides (local metres) */
  hides: [number, number][];
  /** a scored training run (Training mission, imported GPX) */
  trial: TrialResult | null;
  /** drawn search area (evidence, disaster) */
  area: SectorShape | null;
  habitat: HabitatSpec;
  /** bumped on mission change so workers re-read the scent tuning */
  missionVersion: number;
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
  /** how teams are assigned: whole search segments (default) or start points with routes */
  assignMode: 'segments' | 'points';
  /** segments scored for a dog team (with the time and data versions they were scored for) */
  segments: (SegmentsResult & { probVersion: number; windVersion: number }) | null;
  revealed: boolean;
  suggestions: [number, number, number][];
  scentRelease: number;
  busy: { label: string; frac: number } | null;
  workerBusy: number;
  toasts: Toast[];
  debug: boolean;
  camera: CameraShot | null;
  focusPreview: [number, number] | null;
  searchDraft: SearchDraft;
  /** the last live-mode request (location, date, focus) so reloads keep it */
  liveRequest: import('../api/loader').LiveRequest | null;
  hover: [number, number] | null;
  /** phone layout: which sheet covers the map */
  mobileSheet: 'none' | 'plan' | 'legend';
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
  errorKind: null,
  mode: 'offline',
  backend: { ok: false, windninja: false },
  bundle: null,
  windSource: 'fallback',
  activeWind: null,
  windVersion: 0,
  onsiteWind: null,
  profile: 'child712',
  travelDir: null,
  mission: 'wilderness',
  hides: [],
  trial: null,
  area: null,
  habitat: DEFAULT_HABITAT,
  missionVersion: 0,
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
    segments: true,
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
  assignMode: 'segments',
  segments: null,
  revealed: false,
  suggestions: [],
  scentRelease: 0,
  busy: null,
  workerBusy: 0,
  toasts: [],
  debug: false,
  camera: null,
  focusPreview: null,
  searchDraft: { shape: 'circle', radius: 150, windowMin: 60, pts: [] },
  liveRequest: null,
  hover: null,
  mobileSheet: 'none',
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
