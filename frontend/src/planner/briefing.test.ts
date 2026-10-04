import { describe, expect, it } from 'vitest';
import { briefingText, spokenTime } from './briefing';
import type { DeploymentOut } from '../workers/protocol';

const team = (over: Partial<DeploymentOut>): DeploymentOut => ({
  team: 1,
  x: 0,
  y: 0,
  upwind: [0, 1],
  windSpeed: 1.4,
  coveredProb: 0.102,
  bestWindow: [17, 18],
  windowScores: [],
  ...over,
});

describe('spokenTime', () => {
  it('reads hours the way people say them, including past midnight', () => {
    expect(spokenTime(17)).toBe('5 PM');
    expect(spokenTime(18.5)).toBe('6:30 PM');
    expect(spokenTime(9.25)).toBe('9:15 AM');
    expect(spokenTime(12)).toBe('noon');
    expect(spokenTime(24)).toBe('midnight');
    expect(spokenTime(25)).toBe('1 AM');
  });
});

describe('briefingText', () => {
  it('describes each team from the deployment numbers only', () => {
    const text = briefingText({
      area: 'Devil’s Tombstone',
      time: 19,
      lkp: [0, 0],
      deployments: [
        // 650 m south-west of the LKP, working north-east
        team({ x: -460, y: -460, upwind: [Math.SQRT1_2, Math.SQRT1_2] }),
        team({ team: 2, x: 2000, y: 0, upwind: [0, -1], windSpeed: 2.04, coveredProb: 0.004, bestWindow: [18.5, 19.5] }),
      ],
    });
    expect(text).toContain('2 teams, planned for 7 PM');
    expect(text).toContain('Team 1. Start 650 metres south-west of the last known point. Work north-east, into a 1.4 metre per second wind.');
    expect(text).toContain('Best window 5 PM to 6 PM. This start covers 10 percent');
    expect(text).toContain('Team 2. Start 2.0 kilometres east of the last known point. Work south, into a 2.0 metre per second wind.');
    expect(text).toContain('Best window 6:30 PM to 7:30 PM. This start covers under 1 percent');
    expect(text).toContain('Confirm the wind on site');
  });

  it('says "at the last known point" for a team starting there', () => {
    expect(briefingText({ area: 'A', time: 16, lkp: [10, 10], deployments: [team({ x: 40, y: 20 })] })).toContain('Start at the last known point.');
  });
});
