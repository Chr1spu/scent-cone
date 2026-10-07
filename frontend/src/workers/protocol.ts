import type { ProfileId } from '../config/modelParams';
import type { GridLevel } from '../api/types';
import type { Place, Weather } from '../models/env';
import type { Feature2D } from '../models/probability';
import type { WindField } from '../models/wind';
import type { Frame } from '../geo/grid';
import type { SearchedSector } from '../models/searchUpdate';
import type { HabitatSpec, MissionId } from '../config/missions';

export interface InitMsg {
  frame: Frame;
  overview: GridLevel;
  detail: GridLevel;
  features: Feature2D[];
  weather: Weather;
  place: Place;
  wind: WindField;
}

/** Where the target can be, for the current mission. */
export type SourceSpec =
  | { kind: 'lkp' }
  | { kind: 'hides'; hides: [number, number][] }
  | { kind: 'water' }
  | { kind: 'habitat'; habitat: HabitatSpec }
  | { kind: 'area'; area: SearchedSector | null };

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

/** One search segment scored for a dog team at a time (models/segments.ts). */
export interface SegmentInfo {
  index: number;
  name: string;
  areaM2: number;
  /** shares of the total probability */
  poa: number;
  value: number;
  fromOutside: number;
  /** chance a team searching it finds a person who is in it */
  podInside: number;
  /** cumulative POD from searches logged so far (no alert) */
  podSearched: number;
  entry: [number, number];
  upwind: [number, number];
  windSpeed: number;
  hours: number;
  bestWindow: [number, number];
  windowScores: { hour: number; score: number }[];
}

export interface SegmentsResult {
  t: number;
  /** segment per detail cell (-1 = none) */
  id: Int32Array;
  names: string[];
  rings: [number, number][][][];
  centroid: [number, number][];
  segs: SegmentInfo[];
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
  /** 'ground': hedge team on the most likely ground (wind not confirmed on site) */
  kind?: 'scent' | 'ground';
  /** the route the team works, upwind from the start (local metres) */
  route?: [number, number][];
  /** segment assignment: the team searches this whole segment, entering at (x, y) */
  segment?: { index: number; name: string; areaM2: number; poa: number; podInside: number; hours: number; ring: [number, number][] };
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
  /** model detection of the hides at each point, for scoring a training run */
  | { type: 'trial'; pts: [number, number][]; t: number }
  /** planning ensemble spread (±degrees), from the wind confidence */
  | { type: 'setSpread'; rotDeg: number }
  | { type: 'probability'; profile: ProfileId; lkp: [number, number]; elapsedH?: number; travelDir?: number | null }
  | { type: 'brush'; x: number; y: number; factor: number }
  | { type: 'heat'; t: number }
  | { type: 'deploy'; t: number; teams: number; hedge?: boolean; mode?: 'segments' | 'points' }
  | { type: 'segments'; t: number }
  | { type: 'alert'; x: number; y: number; t: number }
  | { type: 'searched'; sector: SearchedSector; t0: number; t1: number }
  | { type: 'resetSearch' }
  | { type: 'mission'; mission: MissionId; source: SourceSpec }
  | { type: 'source'; source: SourceSpec }
  | { type: 'suggestAlerts'; truth: [number, number]; times: number[] };

export type Envelope = { id: number; req: Request };

export type Reply =
  | { id: number; kind: 'progress'; frac: number; label: string }
  | { id: number; kind: 'ok'; result: unknown }
  | { id: number; kind: 'error'; error: string };
