/**
 * Mission-dependent scent tuning, set once per mission in each worker. Defaults (1, 1) are
 * the person-search values the rest of the model is calibrated for.
 */
export const TUNING = {
  /** decay time constant × this */
  tauScale: 1,
  /** lofting off sunlit slopes × this */
  liftScale: 1,
};

export function setTuning(t: { tauScale: number; liftScale: number }) {
  TUNING.tauScale = t.tauScale;
  TUNING.liftScale = t.liftScale;
}
