/**
 * Every tunable model number lives here. These are heuristics for a demo, not
 * validated scent physics; the UI labels them as such.
 */

export type ProfileId = 'child16' | 'child712' | 'hiker' | 'dementia' | 'catIndoor' | 'catOutdoor' | 'dogSmall' | 'dogLarge';

export interface ProfileParams {
  label: string;
  /** median crow's-flight distance from LKP (m) */
  medianM: number;
  /** log-normal spread (sigma of ln d); from published quartiles, ln(Q75/Q25) / 1.349 */
  spread: number;
  /** linear-feature attraction amplitude and length scale (m), for profiles without `terrain` */
  featureA: number;
  featureL: number;
  /**
   * Evidence-based terrain model (TERRAIN below, from ISRID find locations): multipliers near
   * trails, roads, streams, lakes, low and high points, within this track offset (m); slope neutral.
   * Profiles without it use the simple featureA/featureL attraction and the slope penalty.
   */
  terrain?: { trackOffsetM: number };
  /** optional preference by land-cover class (1 water … 6 wetland); missing classes = 1 */
  landcoverWeight?: Partial<Record<number, number>>;
  /**
   * Upper bound on straight-line travel speed (km/h) while lost, for the time-since-missing limit.
   * Deliberately generous (only rules out distances nobody could cover); omitted = no limit.
   */
  maxSpeedKmh?: number;
  note: string;
}

export const PROFILES: Record<ProfileId, ProfileParams> = {
  // Distances: Twardy, Koester & Gatt (2006), Missing Person Behaviour: An Australian Study, Table 2.8
  // (km from LKP; child 0.6/1.1/2.0/5.0, n=34; hiker 1.5/3.2/8.1/17.4, n=72) and ISRID dementia,
  // temperate flat, n=175: 0.2/0.6/1.5/7.9 mi (NEWSAR SAR FTM Unit 3, 2020). Track offsets: ISRID
  // 50% distance from linear features (hiker 100 m, dementia 15 m; children not given, 100 m used).
  child16: { label: 'Child (1–6)', medianM: 300, spread: 0.9, featureA: 1, featureL: 150, maxSpeedKmh: 1.5, terrain: { trackOffsetM: 100 }, note: 'median as in the original spec (attributed to Lost Person Behavior, mountains); not verified against a source here' },
  child712: { label: 'Child (7–12)', medianM: 1100, spread: 0.89, featureA: 1, featureL: 150, maxSpeedKmh: 3, terrain: { trackOffsetM: 100 }, note: 'Australian study, all children (n=34)' },
  hiker: { label: 'Hiker', medianM: 3200, spread: 1.25, featureA: 3, featureL: 150, maxSpeedKmh: 4, terrain: { trackOffsetM: 100 }, note: 'Australian study (n=72); LPB temperate mountains median 3.1 km agrees' },
  dementia: { label: 'Person with dementia', medianM: 970, spread: 1.5, featureA: 1, featureL: 150, maxSpeedKmh: 3, terrain: { trackOffsetM: 15 }, note: 'ISRID temperate flat (n=175)' },
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
  /** slope penalty for profiles without `terrain` (ISRID finds show no lower density on steep ground) */
  slopeScaleDeg: 25,
  brushRadiusM: 250,
  brushUp: 2,
  brushDown: 0.5,
  /** detail cells below this probability do not emit scent */
  minSourceProb: 1e-6,
  /**
   * Time-since-missing limit: the profile distances describe where people are eventually found,
   * so early on, weight beyond maxSpeed × elapsed time falls off (logistic, width = softness × reach).
   * Elapsed time is floored so the map never collapses onto the last known point.
   */
  travelMinH: 0.25,
  travelSoftness: 0.2,
};

/**
 * Terrain multipliers (probability density relative to the area average) from Jacobs (2015),
 * Terrain Based Probability Models for SAR, Table 1: ~2,200 ISRID find locations in the US,
 * uninjured subjects. Applied within a profile's track offset of each feature (soft edge beyond);
 * where several apply, the largest counts (they are not independent). Low/high points: the top and
 * bottom 5% of topographic position in the area, with at least minReliefM of relief.
 */
export const TERRAIN = {
  trail: 5,
  road: 3,
  stream: 2,
  lake: 2,
  trailStream: 7,
  trailStreamM: 80,
  low: 2,
  high: 1.5,
  lowPct: 0.95,
  highPct: 0.05,
  minReliefM: 5,
};

/**
 * Direction of travel (ISRID dispersion angle, children 1–6 and dementia; NEWSAR SAR FTM Unit 3):
 * 50% are found within ~30° of the intended direction, 75% within 66°, 95% within ~140°.
 * Used for any profile when a direction is given; fades in over the first fadeM metres.
 */
export const DISPERSION = {
  cdf: [
    [0, 0],
    [30, 0.5],
    [66, 0.75],
    [140, 0.95],
    [180, 1],
  ] as [number, number][],
  fadeM: 150,
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
  /**
   * Spread used instead when the forecast direction is uncertain (wind confidence fair/poor and no
   * measured wind): docs/EVALUATION.md, a wider planning ensemble then covers more on average.
   */
  rotDegUncertain: 35,
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
  /**
   * Close range: a dog finds a person it passes near even when drifted scent is weak:
   * detectability at least nearDet within nearRadiusM of a team's route. Calibrated with
   * scripts/sweepwidth.ts so that, with d50 = 200 m, the model's effective sweep width in reference
   * conditions is ~94 m, matching the field-measured 95 m for air-scent dog teams (95% CI 44–145;
   * Chiacchia, Houlahan & Hostetter 2015). 150 m gave 147 m, above the measured range.
   */
  nearRadiusM: 60,
  nearDet: 0.6,
  /**
   * Hedge: until the wind is confirmed on site, with at least this many teams, the last team goes
   * on the most likely ground instead of a scent point. docs/EVALUATION.md: with a wind-direction
   * error of 30° or more this beats placing every team by scent; with a good forecast it costs ~1–2 points.
   */
  hedgeMinTeams: 3,
  /**
   * Each team works a route upwind from its start during its hour (dogs work into the wind toward
   * the source; quartering across the wind, a team typically advances a few hundred metres to
   * ~1 km an hour). Heuristic length; the route follows the local modelled wind.
   */
  routeM: 600,
  routeStepM: 50,
  /** below this wind (m/s) there is no upwind to follow; the route ends */
  routeCalmWind: 0.2,
  suppressRadiusM: 300,
  maxSlopeDeg: 35,
  cliffBufferM: 20,
};

/**
 * Wind confidence (models/windConfidence.ts): when to distrust the modelled direction. Heuristic
 * thresholds: light winds meander (horizontal direction spread grows sharply below ~2 m/s), two
 * independent models that disagree flag terrain the forecast handles badly, and a turning wind
 * (evening downslope transition) makes a one-hour plan stale. Speeds are the 2 m model wind.
 */
export const WIND_CONFIDENCE = {
  poorSpeed: 1.0,
  fairSpeed: 2.0,
  fairDisagreeDeg: 25,
  poorDisagreeDeg: 45,
  fairTurnDeg: 30,
  poorTurnDeg: 60,
  /** below this a model's direction is too weak to compare */
  minSpeedForDirection: 0.3,
  /** sample square half-width around the last known point (m) */
  radiusM: 800,
};

/**
 * Absolute detection (models/detection.ts): the distance straight downwind at which a dog detects
 * one person half the time, in a steady neutral wind of refWind m/s (2 m model wind, class D,
 * neutral scent decay). 0.9 at half that distance, 0.1 at twice it. Heuristic default: set it from
 * your dog's record; air-scent dogs are often reported alerting from roughly 100 to 300+ m downwind.
 */
export const DETECTION = {
  d50M: 200,
  refWind: 2,
  /** sources sampled by fewer particles than this share are treated as this likely (noise floor) */
  minQ: 5e-4,
};

/**
 * Search segments (models/segments.ts). Sizes follow dog-team practice: NASAR area-search tests use
 * 40–60 acres in 1.5 h (SARTECH III) up to 140–160 acres in 4 h (SARTECH I), and a team clears
 * about 1.3 km² in a day (Graham, "77 Facts about Search Dogs"); both give roughly 0.13 km² an hour.
 */
export const SEGMENTS = {
  /** target segment area (m²): ~75 acres, a little over two hours for one team */
  targetM2: 300_000,
  /** search pace of one dog team (m² per hour) */
  teamRateM2PerH: 130_000,
  /** crossing a trail, road, stream or ridgeline costs this many cells of travel: edges follow them */
  crossCost: 40,
  /** segments smaller than this share of the target are folded into a neighbour */
  minFraction: 0.3,
  /** outline simplification tolerance (cells) */
  simplifyCells: 1.2,
  /** ridgelines: cells this far (m) above the mean within ~150 m count as a boundary */
  ridgeReliefM: 12,
  /** dogs need the air clear of other searchers for this long before entering (Hill; Graham: 15–30 min) */
  clearAirMin: 30,
  /**
   * Search theory for a team that searches a whole segment: POD = 1 − e^(−coverage). Reference
   * coverage 1.25 gives 0.7 × (1 − e^−1.25) ≈ 50%, the average NASAR uses for a dog team (Graham:
   * "not a bad average" of a 21–96% range). Coverage scales with scent conditions (scent present
   * relative to neutral, from the ensemble), clamped to minCond–maxCond.
   */
  coverageRef: 1.25,
  minCond: 0.15,
  maxCond: 1.5,
};

export const TRIANGULATION = {
  particles: 3000,
  backMinutes: 60,
  dt: 5,
  eps: 0.02,
  blurPasses: 2,
};

export const SEARCH = {
  /**
   * A no-alert search also lowers places whose scent should have drifted to the team. That depends
   * on the modelled wind being right, and wrongly clearing ground is the costly mistake, so only
   * this share of that drift credit is applied.
   */
  driftCredit: 0.5,
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
