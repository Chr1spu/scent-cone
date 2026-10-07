import { describe, expect, it } from 'vitest';
import { latLonToUtm, usng, utmToLatLon, zoneFromCrs } from './utm';

// reference values from pyproj (PROJ), WGS84 / UTM
const REF: [number, number, number, number, number][] = [
  [38.8895, -77.0353, 18, 323478.063, 4306483.242], // Washington Monument
  [42.1589, -74.2047, 18, 565700.951, 4667725.017], // demo campsite, Catskills
  [46.247, -114.16, 11, 718923.404, 5125412.214], // Hamilton, Montana
  [39.6232, -105.8712, 13, 425226.953, 4386300.018],
  [61.2181, -149.9003, 6, 344247.206, 6790536.871],
  [25.7617, -80.1918, 17, 581046.942, 2849542.505],
  [47.6062, -122.3321, 10, 550200.213, 5272748.592],
  [-33.8688, 151.2093, 56, 334368.634, 6250948.345], // Sydney (southern hemisphere)
];

describe('UTM conversion (against PROJ)', () => {
  for (const [lat, lon, zone, e, n] of REF) {
    const z = { zone, north: lat >= 0 };
    it(`${lat}, ${lon} -> zone ${zone}`, () => {
      const f = latLonToUtm(lat, lon, z);
      expect(Math.abs(f.e - e)).toBeLessThan(0.01);
      expect(Math.abs(f.n - n)).toBeLessThan(0.01);
      const b = utmToLatLon(e, n, z);
      expect(Math.abs(b.lat - lat)).toBeLessThan(1e-7);
      expect(Math.abs(b.lon - lon)).toBeLessThan(1e-7);
    });
  }
  it('reads the zone from the area CRS', () => {
    expect(zoneFromCrs('EPSG:32618')).toEqual({ zone: 18, north: true });
    expect(zoneFromCrs('EPSG:32756')).toEqual({ zone: 56, north: false });
    expect(zoneFromCrs('EPSG:3857')).toBeNull();
  });
});

describe('USNG grid references', () => {
  it('Washington Monument is 18S UJ 23478 06483', () => {
    expect(usng(38.8895, -77.0353)).toBe('18S UJ 23478 06483');
    expect(usng(38.8895, -77.0353, 4)).toBe('18S UJ 2347 0648');
  });
  it('matches an independent MGRS implementation (python mgrs) in odd, even and southern zones', () => {
    expect(usng(46.247, -114.16)).toBe('11T QM 18923 25412'); // Hamilton, Montana
    expect(usng(47.6062, -122.3321)).toBe('10T ET 50200 72748'); // Seattle
    expect(usng(42.1589, -74.2047)).toBe('18T WM 65700 67725'); // demo campsite
    expect(usng(-33.8688, 151.2093)).toBe('56H LH 34368 50948'); // Sydney
    expect(usng(61.2181, -149.9003)).toBe('6V UN 44247 90536'); // Anchorage (USNG drops MGRS's leading zero)
  });
});
