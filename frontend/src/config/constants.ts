/** Rendering constants (never used inside models/). */
export const VERT_EXAG = 1.5;

export const CONTOUR_DETAIL_M = 10;
export const CONTOUR_OVERVIEW_M = 50;

/** forest density for instanced trees: 1 tree per this many m² of forest cell */
export const TREE_M2 = 150;
export const TREE_CAP = 14000;
export const TREE_SEED = 42;

export const WIND_STREAKS = 2600;
/** wind streak advection speed-up (simulated seconds per rendered frame) */
export const WIND_STREAK_DT = 4;

export const COLORS = {
  bg: '#0a0f14',
  fogScene: '#1a2530',
  fogMap: '#0a0f14',
  amber: '#ffb547',
  cyan: '#3fd0e0',
  alert: ['#ff4fa3', '#b48cff', '#4fe3c1', '#c6ff4f'],
  team: ['#ffd166', '#06d6a0', '#ef476f', '#118ab2', '#f78c6b', '#c77dff'],
  searched: '#7aa2c8',
  recheck: '#ff9f1c',
  lkp: '#ffffff',
  child: '#ffd23f',
};

/** Land-cover classes: label + tint colour */
export const LANDCOVER_CLASSES: { id: number; label: string; color: string }[] = [
  { id: 1, label: 'Water', color: '#2f7fd8' },
  { id: 2, label: 'Open / grass', color: '#c9b46a' },
  { id: 3, label: 'Shrub', color: '#8a9a3b' },
  { id: 4, label: 'Forest', color: '#2f6b3a' },
  { id: 5, label: 'Developed', color: '#9a9aa5' },
  { id: 6, label: 'Wetland', color: '#3aa69a' },
];

/** candidate times for the demo's radio-reported alerts (the best-triangulating pair is used) */
export const DEMO_ALERT_TIMES = [15.25, 15.75, 16.25, 16.75, 17.25, 17.75, 18.25, 18.75, 19.25, 19.75, 20.25, 20.75];
