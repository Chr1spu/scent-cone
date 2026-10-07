/**
 * Every tunable model number lives here. These are heuristics for a demo, not
 * validated scent physics; the UI labels them as such.
 */

export type ProfileId = 'child16' | 'child712' | 'hiker' | 'dementia' | 'catIndoor' | 'catOutdoor' | 'dogSmall' | 'dogLarge';

export interface ProfileParams {
  label: string;
  /** median crow's-flight distance from LKP (m) */
  medianM: number;
  /** log-normal spread (sigma of ln d) */
  spread: number;
  /** linear-feature attraction amplitude and length scale (m) */
  featureA: number;
  featureL: number;
  /** optional preference by land-cover class (1 water … 6 wetland); missing classes = 1 */
  landcoverWeight?: Partial<Record<number, number>>;
  note: string;
}

export const PROFILES: Record<ProfileId, ProfileParams> = {
  child16: { label: 'Child (1–6)', medianM: 300, spread: 0.9, featureA: 1, featureL: 150, note: 'Lost Person Behavior, mountains' },
  child712: { label: 'Child (7–12)', medianM: 1000, spread: 0.9, featureA: 1, featureL: 150, note: 'placeholder, tune' },
  hiker: { label: 'Hiker', medianM: 3100, spread: 0.8, featureA: 3, featureL: 150, note: 'temperate mountains' },
  dementia: { label: 'Person with dementia', medianM: 1100, spread: 0.9, featureA: 1, featureL: 150, note: 'urban median; wilderness placeholder' },
  // lost pets: cats hide in cover close by (Huang et al. 2018: indoor-only cats median 39 m,
  // outdoor-access cats 315 m); dog figures are placeholders, dogs follow roads and trails
  catIndoor: { label: 'Cat (indoor-only)', medianM: 50, spread: 1.0, featureA: 0, featureL: 100, landcoverWeight: { 2: 0.5, 3: 1.6, 4: 1.3, 5: 1.4 }, note: 'Huang et al. 2018' },
  catOutdoor: { label: 'Cat (goes outdoors)', medianM: 315, spread: 1.0, featureA: 0, featureL: 100, landcoverWeight: { 2: 0.6, 3: 1.5, 4: 1.3, 5: 1.3 }, note: 'Huang et al. 2018' },
  dogSmall: { label: 'Dog (small)', medianM: 800, spread: 0.9, featureA: 2, featureL: 120, note: 'placeholder, tune' },
  dogLarge: { label: 'Dog (large)', medianM: 1600, spread: 0.9, featureA: 2.5, featureL: 150, note: 'placeholder, tune' },
};

export const PROBABILITY = {
  /** cells whose least-cost detour ratio exceeds these are "across a barrier" */
  barrierRatioLo: 1.25,
  barrierRatioHi: 1.6,
  barrierFactor: 0.2,
  /** cost multiplier for crossing water / cliff / river cells in the detour pass */
  barrierCost: 25,
  slopeScaleDeg: 25,
  brushRadiusM: 250,
  brushUp: 2,
  brushDown: 0.5,
  /** detail cells below this probability do not emit scent */
  minSourceProb: 1e-6,
};

/** Fallback slope-wind model; mirrors backend/app/config.py SLOPE_WIND. */
export const SLOPE_WIND = {
  k: 3.0,
  cap: 2.5,
  forecastTo2m: 0.7,
  nightSunElev: 5.0,
  daySunElev: 10.0,
  sunFacingDot: 0.2,
  calmForecast: 3.0,
  minSlopeWeight: 0.35,
  smoothPasses: 2,
  smoothRadius: 2,
};

export const ENSEMBLE = {
  members: 6,
  rotDeg: 20,
  scaleMin: 0.7,
  scaleMax: 1.3,
  particlesPerMember: 4500,
  windowMin: 60,
  /** simulated step for off-screen ensembles (s); visible sim uses SCENT.dt */
  dt: 12,
  /** cheap per-hour snapshots for best time windows */
  hourlyParticles: 3000,
  /**
   * Detectability thresholds are absolute: θ1/θ2 are the 70th/95th percentiles of a reference
   * run with the same wind but neutral scent conditions (no sun, no lofting, 1800 s decay).
   * Poor conditions (heat, sun, lofting) therefore really lower detectability.
   */
  referenceMembers: 2,
  referenceParticles: 3000,
};

/**
 * Plume meander: each particle carries a turbulent velocity that decorrelates over the Lagrangian
 * time scale (an Ornstein-Uhlenbeck process). Its strength σv = a·U is set so a plume's lateral
 * spread follows the Briggs (1973) open-country curves σy ≈ a·x·(1 + 0.0001x)^-0.5, with `a` from the
 * Pasquill stability class (sun, cloud and wind decide how turbulent the air is).
 */
export const TURBULENCE = {
  /** σy / downwind distance in the near field, by Pasquill class (Briggs, open country) */
  briggsA: { A: 0.22, B: 0.16, C: 0.11, D: 0.08, E: 0.06, F: 0.04 } as Record<string, number>,
  /** Lagrangian integral time scale (s): spread grows ∝ distance for travel times well below this */
  lagrangianS: 600,
  /** meander floor in near-calm air (m/s) */
  minSigmaV: 0.08,
  /** 1 = on (tests switch it off to check pure advection) */
  scale: 1,
};

export const SCENT = {
  visibleParticles: 15000,
  dt: 2,
  stepsPerFrame: 3,
  /** small-scale mixing on top of the meander (m²/s); was the whole turbulence model before */
  turbK0: 0.1,
  turbKPerWind: 0,
  /** below this nose-height wind a particle in a local hollow is "pooling" */
  calmWind: 0.3,
  calmDamp: 0.3,
  /** a cell is a local low if lower than at least this many of 8 neighbours */
  localLowNeighbours: 6,
  baseTauS: 1800,
  sunFactor: 0.7,
  sunHighElev: 20,
  /** lofting off sunlit slopes when the 2 m wind is below this (m/s) */
  liftWind: 2,
  liftPerS: 0.002,
  minStrength: 0.01,
  /**
   * Particles represent a continuous release: births are staggered over the first lifetime and a
   * particle is re-emitted at its source once older than this. Scent older than ~40 min is mostly
   * decayed or lofted anyway (see baseTauS / liftPerS).
   */
  lifetimeS: 2400,
  accumHalfLifeS: 600,
};

/**
 * Dogs smell at nose height (~0.6 m), but WindNinja and the fallback model give wind at 2 m.
 * Particles are moved by the 2 m wind scaled to nose height: a neutral log profile
 * u(z) ∝ ln(z / z0) over open ground, and a sub-canopy attenuation factor in forest
 * (WindNinja reports its output height above the vegetation, so in forest the 2 m wind is
 * effectively above the canopy).
 */
export const NOSE = {
  heightM: 0.6,
  refHeightM: 2,
  /** aerodynamic roughness length z0 (m) per land-cover class */
  z0: { water: 0.0002, open: 0.03, wetland: 0.05, shrub: 0.1, developed: 0.3 },
  /** wind under a closed canopy as a fraction of the model wind (typically 0.2–0.4) */
  forestFactor: 0.3,
};

export const HOTSPOTS = {
  detLoPct: 0.7,
  detHiPct: 0.95,
  /** receiver (dog position) blocks and source blocks for contribution tracking */
  recvBlockCells: 5, // 50 m on the 10 m detail grid
  srcBlockCells: 10, // 100 m
  /** a source "contributes" at a receiver if it supplies at least this share of its scent */
  contribShare: 0.02,
  maxSourcesPerRecv: 50,
  dogPOD: 0.7,
  suppressRadiusM: 300,
  maxSlopeDeg: 35,
  cliffBufferM: 20,
};

export const TRIANGULATION = {
  particles: 3000,
  backMinutes: 60,
  dt: 5,
  eps: 0.02,
  blurPasses: 2,
};

export const SEARCH = {
  defaultRadiusM: 150,
  windowMin: 60,
  recheckDet: 0.3,
};

export const TIME = {
  start: 14,
  end: 22,
  stepMin: 15,
  /** playback: simulated hours per real second */
  playRate: 0.25,
};
