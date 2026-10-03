import type { ProfileId } from '../config/modelParams';
import type { GridLevel } from '../api/types';
import type { Place, Weather } from '../models/env';
import type { Feature2D } from '../models/probability';
import type { WindField } from '../models/wind';
import type { Frame } from '../geo/grid';
import type { SearchedSector } from '../models/searchUpdate';

export interface InitMsg {
  frame: Frame;
  overview: GridLevel;
  detail: GridLevel;
  features: Feature2D[];
  weather: Weather;
  place: Place;
  wind: WindField;
}

export interface ProbResult {
  overview: Float32Array;
  detail: Float32Array;
  segmentFraction: number;
  /** local coords of the detail-grid probability peak */
  peak: [number, number];
}

export interface HeatResult {
  t: number;
  heat: Float32Array;
  lo: number;
  hi: number;
  /** reference (neutral-conditions) 95th percentile, for a time-independent display scale */
  refHi: number;
  /** total scent present relative to the neutral-conditions reference (≈1 neutral, <1 poor) */
  relStrength: number;
  /** top hotspot cells (detail indices), strongest first; only cells above θ1 */
  hotspots: number[];
}

export interface DeploymentOut {
  team: number;
  x: number;
  y: number;
  /** unit vector pointing upwind (direction the team should work) */
  upwind: [number, number];
  windSpeed: number;
  coveredProb: number;
  bestWindow: [number, number];
  windowScores: { hour: number; score: number }[];
}

export interface AlertResult {
  zone: Float32Array;
  prob: ProbResult;
}

export interface SearchResult {
  meanDet: number;
  recheck: boolean;
  prob: ProbResult;
}

export type Request =
  | { type: 'init'; data: InitMsg }
  | { type: 'setWind'; wind: WindField }
  | { type: 'probability'; profile: ProfileId; lkp: [number, number] }
  | { type: 'brush'; x: number; y: number; factor: number }
  | { type: 'heat'; t: number }
  | { type: 'deploy'; t: number; teams: number }
  | { type: 'alert'; x: number; y: number; t: number }
  | { type: 'searched'; sector: SearchedSector; t0: number; t1: number }
  | { type: 'resetSearch' }
  | { type: 'suggestAlerts'; truth: [number, number]; times: number[] };

export type Envelope = { id: number; req: Request };

export type Reply =
  | { id: number; kind: 'progress'; frac: number; label: string }
  | { id: number; kind: 'ok'; result: unknown }
  | { id: number; kind: 'error'; error: string };
