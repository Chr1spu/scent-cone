import { describe, expect, it } from 'vitest';
import { alertWaypoints, auc, localHour, parseGpx, scoreTrial, thinTrack, type TrackPoint } from './validation';

const GPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="Garmin Alpha"><wpt lat="42.1601" lon="-74.2050"><time>2026-09-24T22:10:00Z</time><name>ALERT 1</name></wpt>
<wpt lat='42.1610' lon='-74.2060'><name>Truck</name></wpt>
<trk><name>Dog</name><trkseg>
<trkpt lat="42.1590" lon="-74.2040"><ele>500</ele><time>2026-09-24T22:00:00Z</time></trkpt>
<trkpt lat="42.1595" lon="-74.2045"><time>2026-09-24T22:05:00Z</time></trkpt>
<trkpt lat="42.1601" lon="-74.2050"/>
</trkseg></trk></gpx>`;

describe('field validation', () => {
  it('parses GPX tracks and waypoints, picking alert waypoints by name', () => {
    const g = parseGpx(GPX);
    expect(g.track.length).toBe(3);
    expect(g.track[0].lat).toBeCloseTo(42.159, 6);
    expect(g.track[0].time).toBe(Date.parse('2026-09-24T22:00:00Z'));
    expect(g.track[2].time).toBeNull();
    expect(g.waypoints.length).toBe(2);
    expect(alertWaypoints(g.waypoints).map((w) => w.name)).toEqual(['ALERT 1']);
    expect(alertWaypoints(g.waypoints.slice(1)).length).toBe(1); // none named: all count
  });
  it('converts to local time', () => {
    expect(localHour(Date.parse('2026-09-24T22:15:00Z'), -4 * 3600)).toBeCloseTo(18.25, 6);
  });
  it('computes the AUC (Mann–Whitney)', () => {
    expect(auc([0.9, 0.8], [0.1, 0.2, 0.3])).toBe(1);
    expect(auc([0.1], [0.9])).toBe(0);
    expect(auc([0.5], [0.5])).toBe(0.5);
    expect(auc([], [0.5])).toBeNull();
  });
  it('scores a trial and leaves out track points right next to an alert', () => {
    const pts: TrackPoint[] = [
      { x: 0, y: 0, t: null, alert: false },
      { x: 100, y: 0, t: null, alert: false },
      { x: 190, y: 0, t: null, alert: false }, // 10 m from the alert: excluded
      { x: 200, y: 0, t: null, alert: true },
    ];
    const s = scoreTrial(pts, (p) => p.x / 200);
    expect(s.nAlerts).toBe(1);
    expect(s.nOther).toBe(2);
    expect(s.auc).toBe(1);
    expect(s.meanDetAlert).toBeCloseTo(1, 6);
    expect(s.meanDetOther).toBeCloseTo(0.25, 6);
  });
  it('thins a dense track', () => {
    const pts = Array.from({ length: 101 }, (_, i) => ({ x: i, y: 0 }));
    expect(thinTrack(pts, 10).length).toBe(11);
  });
});
