import { describe, expect, it } from 'vitest';
import { latLonToUtm } from '../geo/utm';
import type { DeploymentOut } from '../workers/protocol';
import { planGeometry, toGpx, toKml } from './exportPlan';

// frame centred on the demo campsite (UTM 18N), so local (0, 0) = 42.1589 N, 74.2047 W
const c = latLonToUtm(42.1589, -74.2047, { zone: 18, north: true });
const base = {
  area: 'Test & <area>',
  date: '2026-09-24',
  time: 19,
  crs: 'EPSG:32618',
  frame: { cx: c.e, cy: c.n },
  lkp: [0, 0] as [number, number],
  lkpLabel: 'Last known point',
  deployments: [
    { team: 1, x: 1000, y: 0, upwind: [0, 1], windSpeed: 1.4, coveredProb: 0.102, bestWindow: [17, 18], windowScores: [] } as DeploymentOut,
  ],
};

describe('plan export', () => {
  it('places points at the right latitude/longitude and USNG', () => {
    const g = planGeometry(base)!;
    expect(g.points[0].lat).toBeCloseTo(42.1589, 6);
    expect(g.points[0].lon).toBeCloseTo(-74.2047, 6);
    expect(g.points[0].usng).toBe('18T WM 65700 67725');
    // 1 km east: same latitude to ~0.001°, ~0.0121° further east at 42° N
    expect(g.points[1].lat).toBeCloseTo(42.1589, 2);
    expect(g.points[1].lon - g.points[0].lon).toBeCloseTo(1000 / (111320 * Math.cos((42.1589 * Math.PI) / 180)), 3);
    expect(g.points[1].desc).toContain('Work toward 0° (N)');
    // heading line runs north from the start
    expect(g.lines[0].pts[1].lat).toBeGreaterThan(g.lines[0].pts[0].lat);
  });
  it('writes well-formed, escaped GPX and KML', () => {
    const gpx = toGpx(base)!;
    const kml = toKml(base)!;
    for (const doc of [gpx, kml]) {
      expect(doc).toContain('Test &amp; &lt;area&gt;');
      expect(doc).not.toContain('Test & <area>');
      expect(doc).toContain('Team 1 start');
    }
    expect(gpx).toMatch(/<wpt lat="42\.15890\d*" lon="-74\.20470\d*">/);
    expect(kml).toContain('-74.2047000,42.1589000,0');
  });
  it('declines a grid that is not UTM', () => {
    expect(planGeometry({ ...base, crs: 'EPSG:3857' })).toBeNull();
  });
});
