import { describe, expect, it } from 'vitest';
import { sunAt } from './env';

describe('sun position', () => {
  const place = { date: '2026-09-24', lat: 42.16, lon: -74.2, utcOffsetSeconds: -4 * 3600 };
  it('is high in the south-west mid-afternoon and below the horizon after sunset', () => {
    const s = sunAt(place, 15);
    expect(s.elevation).toBeGreaterThan(25);
    expect(s.elevation).toBeLessThan(50);
    expect(s.azimuth).toBeGreaterThan(190);
    expect(s.azimuth).toBeLessThan(260);
    expect(s.dir[0]).toBeLessThan(0); // west component
    expect(sunAt(place, 19.5).elevation).toBeLessThan(0);
  });
});
