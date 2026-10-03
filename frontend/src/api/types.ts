import type { ProfileId } from '../config/modelParams';
import type { Frame, GridMeta } from '../geo/grid';
import type { Weather } from '../models/env';
import type { Feature2D, FeatureKind } from '../models/probability';
import type { WindField } from '../models/wind';

export interface AreaConfig {
  name: string;
  scenario: string;
  areaId: string;
  lat: number;
  lon: number;
  epsg: number;
  timezone: string;
  utcOffsetSeconds: number;
  date: string;
  startHour: number;
  endHour: number;
  missingAt: number;
  overviewMeta: GridMeta;
  detailMeta: GridMeta;
  lkp: { x: number; y: number; lat: number; lon: number; label?: string };
  /** hidden subject location (demo only); null for user-chosen areas */
  truth: { x: number; y: number } | null;
  focus: { x: number; y: number; size: number };
  profile: ProfileId;
  teams: number;
  windSource: 'windninja' | 'fallback';
  windMethod?: string;
  windHours: number[];
  windNinjaHours?: number[];
  sources?: Record<string, string>;
  warnings?: string[];
}

export interface GridLevel {
  meta: GridMeta;
  elev: Float32Array;
  landcover: Uint8Array;
}

export interface GeoFeature {
  type: 'Feature';
  geometry: { type: 'LineString' | 'Polygon'; coordinates: number[][] | number[][][] };
  properties: { kind: FeatureKind; name?: string | null };
}

export interface AreaBundle {
  mode: 'offline' | 'live';
  config: AreaConfig;
  frame: Frame;
  overview: GridLevel;
  detail: GridLevel;
  features: Feature2D[];
  weather: Weather;
  windninja: WindField | null;
  fallback: WindField;
  warnings: string[];
}

export type Progress = (frac: number, label: string) => void;
