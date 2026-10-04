/**
 * Mission types. Each one changes three things: where the target can be (the source model),
 * how its scent behaves (tuning), and how teams are placed. All numbers are heuristics.
 */
import type { ProfileId } from './modelParams';

export type MissionId = 'wilderness' | 'cadaver' | 'training' | 'water' | 'conservation' | 'evidence' | 'disaster' | 'pet';

/** Where the target can be. */
export type SourceKind = 'lkp' | 'hides' | 'water' | 'habitat' | 'area';

export interface MissionTuning {
  /** scent decay time constant × this (persistent sources > 1) */
  tauScale: number;
  /** lofting off sunlit slopes × this */
  liftScale: number;
  /** chance a dog detects what it covers */
  pod: number;
  /** minimum distance between teams (m) */
  spacingM: number;
  /** steepest ground a team works on (degrees) */
  maxSlopeDeg: number;
  /** where teams can stand */
  deploy: 'land' | 'waterAndShore';
  /** probability prior: weight low ground (drainages, hollows) by e^(lowGroundBias · TPI) */
  lowGroundBias: number;
  /**
   * teams must start within this distance (m) of the ground holding 90% of the probability;
   * null = anywhere downwind (searchers travel to good scent)
   */
  reachM: number | null;
}

export interface Mission {
  id: MissionId;
  label: string;
  /** one line for menus */
  short: string;
  /** two or three sentences for the site and the panel */
  about: string;
  source: SourceKind;
  profiles?: ProfileId[];
  defaultProfile?: ProfileId;
  teams: number;
  tuning: MissionTuning;
  /** what the target is called in the interface */
  target: string;
  /** the last-known-point marker's label */
  lkpLabel: string;
  /** short how-to shown in the planner */
  steps: string[];
  /** honest limits shown with the mission */
  caveat: string;
}

const BASE: MissionTuning = { tauScale: 1, liftScale: 1, pod: 0.7, spacingM: 300, maxSlopeDeg: 35, deploy: 'land', lowGroundBias: 0, reachM: null };

export const MISSIONS: Record<MissionId, Mission> = {
  wilderness: {
    id: 'wilderness',
    label: 'Missing person',
    short: 'Air-scent dogs searching for a lost person',
    about: 'A person is missing in open country. Probability comes from how far people of this kind travel from their last known point; teams start downwind of the likely ground.',
    source: 'lkp',
    profiles: ['child16', 'child712', 'hiker', 'dementia'],
    defaultProfile: 'child712',
    teams: 3,
    tuning: BASE,
    target: 'missing person',
    lkpLabel: 'Last seen',
    steps: ['Choose the subject profile', 'Check the heatmap at the time teams can start', 'Deploy teams, then log alerts and searched areas'],
    caveat: 'Distances for children 7–12 and people with dementia in wilderness are placeholders.',
  },
  cadaver: {
    id: 'cadaver',
    label: 'Recovery (cadaver dogs)',
    short: 'Human-remains detection dogs',
    about: 'A missing person is presumed deceased. Remains do not move, their scent lasts much longer and pools in low ground, and probability leans toward drainages and hollows where people who fall or shelter tend to end up.',
    source: 'lkp',
    profiles: ['child712', 'hiker', 'dementia'],
    defaultProfile: 'hiker',
    teams: 3,
    tuning: { ...BASE, tauScale: 2.5, liftScale: 0.5, pod: 0.6, spacingM: 250, lowGroundBias: 0.7 },
    target: 'remains',
    lkpLabel: 'Last known point',
    steps: ['Choose who is missing', 'Use the evening and early morning, when scent pools', 'Deploy, then log alerts; recheck areas searched in poor conditions'],
    caveat: 'Decomposition stage, burial and temperature change the scent a lot; the model uses one setting.',
  },
  training: {
    id: 'training',
    label: 'Training problem',
    short: 'Plan where to hide a volunteer for a training search',
    about: 'Place one or more hides. The planner shows where their scent will go hour by hour, which start points give the dog a fair problem, and when conditions are good, before anyone goes into the woods.',
    source: 'hides',
    teams: 2,
    tuning: { ...BASE, spacingM: 200, reachM: 400 },
    target: 'hide',
    lkpLabel: 'Staging area',
    steps: ['Place hides with the Hide tool', 'Scrub the time bar to see where the scent cone goes', 'Deploy to get start points; compare hours in the Plan tab'],
    caveat: 'A training hide is one person in one place, so the scent here is much more concentrated than in a real search.',
  },
  water: {
    id: 'water',
    label: 'Water search',
    short: 'Dogs working from boats and shorelines for a drowning victim',
    about: 'Someone went into the water near a known point. Probability is on the water, falling off with distance from where they were last seen; scent rises off the surface and the wind carries it to boats and shorelines.',
    source: 'water',
    teams: 2,
    tuning: { ...BASE, liftScale: 0.3, pod: 0.6, spacingM: 120, deploy: 'waterAndShore' },
    target: 'victim',
    lkpLabel: 'Last seen at the water',
    steps: ['Move the last-seen point to where the person went in', 'Deploy: teams are placed on boats or the shore, downwind of the likely water', 'Log alerts from the boat; alerts trace back across the water'],
    caveat: 'Currents, water temperature and depth are not modelled; in rivers the victim moves.',
  },
  conservation: {
    id: 'conservation',
    label: 'Conservation detection',
    short: 'Dogs that find scat, dens or invasive species',
    about: 'Detection dogs survey habitat for a target species. Probability comes from habitat you choose (land cover, slope, closeness to streams) instead of a last known point, and teams are placed to sweep the most habitat with the wind in their favour.',
    source: 'habitat',
    teams: 3,
    tuning: { ...BASE, tauScale: 1.5, liftScale: 0.7, pod: 0.5, spacingM: 250 },
    target: 'target species',
    lkpLabel: 'Survey base',
    steps: ['Choose the habitat: land cover, slope, near streams', 'Deploy to get survey start points with headings', 'Log finds as alerts and covered ground as searched'],
    caveat: 'Habitat is from 30 m land cover only; species-specific habitat models would do much better.',
  },
  evidence: {
    id: 'evidence',
    label: 'Evidence search',
    short: 'Police dogs searching a small area for an item',
    about: 'A dog searches a defined area for an item with human scent (a weapon, a phone, a discarded item). Probability is spread over the area you draw; item scent is weak and fades quickly, so teams work close together.',
    source: 'area',
    teams: 2,
    tuning: { ...BASE, tauScale: 0.4, liftScale: 1, pod: 0.5, spacingM: 60, reachM: 40 },
    target: 'item',
    lkpLabel: 'Incident point',
    steps: ['Draw the search area (circle or polygon)', 'Deploy: start points are close together, downwind of the area', 'Mark cleared sectors as searched'],
    caveat: 'Small items in a 10 m grid: the model gives a direction to work, not exact positions.',
  },
  disaster: {
    id: 'disaster',
    label: 'Disaster (outdoor)',
    short: 'Landslides, debris flows, wreckage sites',
    about: 'People may be buried or trapped in a debris field. Draw the field; probability is spread across it with more weight toward its lower end, where debris and people tend to end up. Teams work from the stable edge.',
    source: 'area',
    teams: 3,
    tuning: { ...BASE, tauScale: 1.5, liftScale: 0.6, pod: 0.5, spacingM: 120, lowGroundBias: 0.5, reachM: 150 },
    target: 'victims',
    lkpLabel: 'Incident point',
    steps: ['Draw the debris field', 'Deploy: teams start at the downwind edge', 'Log alerts; traced zones cross where victims are likely'],
    caveat: 'Scent rising through debris and collapsed structures is not modelled; this only handles the open-air part.',
  },
  pet: {
    id: 'pet',
    label: 'Lost pet',
    short: 'Pet-detective dogs finding a missing cat or dog',
    about: 'A pet escaped from home. Indoor cats usually hide very close by, in cover; dogs travel further and follow roads and trails. Probability uses those distances, and teams start downwind.',
    source: 'lkp',
    profiles: ['catIndoor', 'catOutdoor', 'dogSmall', 'dogLarge'],
    defaultProfile: 'catOutdoor',
    teams: 2,
    tuning: { ...BASE, pod: 0.6, spacingM: 120, reachM: 200 },
    target: 'pet',
    lkpLabel: 'Escaped from',
    steps: ['Choose cat or dog', 'Search close and in cover first for cats', 'Deploy, then mark searched yards and sightings'],
    caveat: 'Cat distances are from one study (Huang et al. 2018); dog distances are placeholders.',
  },
};

export const MISSION_ORDER: MissionId[] = ['wilderness', 'cadaver', 'training', 'water', 'conservation', 'evidence', 'disaster', 'pet'];

/** The supported kinds of search; the others are experimental and hidden. */
export const CORE_MISSIONS: MissionId[] = ['wilderness', 'training', 'cadaver'];

/** Missions to offer in menus. Add ?experimental=1 to any page once to show all eight. */
export function visibleMissions(): MissionId[] {
  try {
    const q = new URLSearchParams(location.search).get('experimental');
    if (q === '1') localStorage.setItem('scentcone.experimental', '1');
    if (q === '0') localStorage.removeItem('scentcone.experimental');
    if (localStorage.getItem('scentcone.experimental') === '1') return MISSION_ORDER;
  } catch {
    /* no storage */
  }
  return CORE_MISSIONS;
}

export function isMission(x: string | null | undefined): x is MissionId {
  return !!x && x in MISSIONS;
}

/** Land-cover classes offered for habitat (ids from the land-cover table). */
export const HABITAT_CLASSES: { id: number; label: string }[] = [
  { id: 4, label: 'Forest' },
  { id: 3, label: 'Shrub' },
  { id: 2, label: 'Open, grass' },
  { id: 6, label: 'Wetland' },
];

export interface HabitatSpec {
  classes: number[];
  maxSlopeDeg: number;
  /** only within this distance of a stream (m); 0 = anywhere */
  nearStreamM: number;
}

export const DEFAULT_HABITAT: HabitatSpec = { classes: [4, 6], maxSlopeDeg: 30, nearStreamM: 150 };
