import { describe, expect, it } from 'vitest';
import { DETECTION } from '../config/modelParams';
import { calibrateDetection, detectFromConc } from './detection';

describe('absolute detection calibration', () => {
  const t0 = performance.now();
  const curve = calibrateDetection();
  const ms = performance.now() - t0;
  const at = (d: number) => {
    const p = curve.profile.filter((x) => x.d > 0);
    const near = p.reduce((a, b) => (Math.abs(b.d - d) < Math.abs(a.d - d) ? b : a));
    return detectFromConc(near.c, curve);
  };
  it('is cheap enough to run once per session', () => {
    expect(ms).toBeLessThan(4000);
  });
  it('the reference plume thins with distance', () => {
    const p = curve.profile.filter((x) => x.d > 50);
    for (let i = 2; i < p.length; i++) expect(p[i].c).toBeLessThan(p[i - 2].c);
  });
  it('detects one person half the time at d50, mostly closer, rarely far beyond', () => {
    expect(at(DETECTION.d50M)).toBeGreaterThan(0.4);
    expect(at(DETECTION.d50M)).toBeLessThan(0.6);
    expect(at(DETECTION.d50M / 2)).toBeGreaterThan(0.8);
    expect(at(DETECTION.d50M * 2)).toBeLessThan(0.2);
    expect(detectFromConc(0, curve)).toBe(0);
  });
  it('a longer-range dog gives higher detection at the same concentration', () => {
    const far = calibrateDetection({ d50M: 300 });
    const c = Math.exp(curve.lnC50);
    expect(detectFromConc(c, far)).toBeGreaterThan(0.5);
  });
});
