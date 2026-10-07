/**
 * UTM <-> WGS84 latitude/longitude and USNG/MGRS grid references, for handing positions to
 * search teams (GPS units, CalTopo, radio). Pure functions; Krüger series to n³ (sub-millimetre
 * inside a zone). Every area grid is in a UTM zone, named by its EPSG code (326zz north, 327zz south).
 */

const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const N = F / (2 - F);
const AA = (A / (1 + N)) * (1 + (N * N) / 4 + (N ** 4) / 64);
const ALPHA = [(N / 2) - (2 / 3) * N * N + (5 / 16) * N ** 3, (13 / 48) * N * N - (3 / 5) * N ** 3, (61 / 240) * N ** 3];
const BETA = [(N / 2) - (2 / 3) * N * N + (37 / 96) * N ** 3, (1 / 48) * N * N + (1 / 15) * N ** 3, (17 / 480) * N ** 3];
const DELTA = [2 * N - (2 / 3) * N * N - 2 * N ** 3, (7 / 3) * N * N - (8 / 5) * N ** 3, (56 / 15) * N ** 3];
const deg = Math.PI / 180;

export interface UtmZone {
  zone: number;
  north: boolean;
}

/** Zone from an EPSG code like "EPSG:32618" (WGS84 / UTM 18N) or "EPSG:32718" (18S). */
export function zoneFromCrs(crs: string): UtmZone | null {
  const m = /EPSG:(326|327)(\d{2})$/.exec(crs.trim());
  if (!m) return null;
  return { zone: Number(m[2]), north: m[1] === '326' };
}

export function latLonToUtm(lat: number, lon: number, z: UtmZone): { e: number; n: number } {
  const lon0 = ((z.zone - 1) * 6 - 180 + 3) * deg;
  const phi = lat * deg;
  const lam = lon * deg - lon0;
  const ec = (2 * Math.sqrt(N)) / (1 + N);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - ec * Math.atanh(ec * Math.sin(phi)));
  const xiP = Math.atan2(t, Math.cos(lam));
  const etaP = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let xi = xiP;
  let eta = etaP;
  for (let j = 1; j <= 3; j++) {
    xi += ALPHA[j - 1] * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
    eta += ALPHA[j - 1] * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
  }
  return { e: 500000 + K0 * AA * eta, n: (z.north ? 0 : 10000000) + K0 * AA * xi };
}

export function utmToLatLon(e: number, n: number, z: UtmZone): { lat: number; lon: number } {
  const xi = (n - (z.north ? 0 : 10000000)) / (K0 * AA);
  const eta = (e - 500000) / (K0 * AA);
  let xiP = xi;
  let etaP = eta;
  for (let j = 1; j <= 3; j++) {
    xiP -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += DELTA[j - 1] * Math.sin(2 * j * chi);
  const lon0 = (z.zone - 1) * 6 - 180 + 3;
  return { lat: phi / deg, lon: lon0 + Math.atan2(Math.sinh(etaP), Math.cos(xiP)) / deg };
}

const BANDS = 'CDEFGHJKLMNPQRSTUVWXX';
const COL_SETS = ['STUVWXYZ', 'ABCDEFGH', 'JKLMNPQR']; // by zone % 3
const ROWS = 'ABCDEFGHJKLMNPQRSTUV';

/**
 * USNG / MGRS grid reference, e.g. "18S UJ 23478 06483" (1 m) or "18S UJ 2347 0648" (10 m).
 * Uses the point's own zone and band (correct across zone edges); latitudes 80°S–84°N.
 */
export function usng(lat: number, lon: number, digits: 4 | 5 = 5): string {
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (zone > 60) zone = 60;
  // Norway / Svalbard exceptions
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) zone = 31;
    else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35;
    else if (lon >= 33 && lon < 42) zone = 37;
  }
  const band = BANDS[Math.max(0, Math.min(20, Math.floor((lat + 80) / 8)))];
  const { e, n } = latLonToUtm(lat, lon, { zone, north: lat >= 0 });
  const col = COL_SETS[zone % 3][Math.floor(e / 100000) - 1];
  const rowOffset = zone % 2 === 0 ? 5 : 0;
  const row = ROWS[(Math.floor(n / 100000) + rowOffset) % 20];
  const scale = 10 ** (5 - digits);
  const pad = (v: number) => String(Math.floor((v % 100000) / scale)).padStart(digits, '0');
  return `${zone}${band} ${col}${row} ${pad(e)} ${pad(n)}`;
}

/** "42.15890° N, 74.20470° W" */
export function formatLatLon(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
}

/** Local scene metres (east, north of the frame centre) in a UTM-zoned grid -> latitude/longitude. */
export function localToLatLon(crs: string, frame: { cx: number; cy: number }, x: number, y: number): { lat: number; lon: number } | null {
  const z = zoneFromCrs(crs);
  return z ? utmToLatLon(frame.cx + x, frame.cy + y, z) : null;
}

/** A grid reference read digit by digit, as on the radio: "18 T, W M, 6 5 7 0, 6 7 7 2". */
export function spokenGrid(ref: string): string {
  const [zb, sq, e, n] = ref.split(' ');
  const zone = zb.replace(/[A-Z]$/, '');
  const band = zb.slice(-1);
  return `${zone} ${band}, ${sq.split('').join(' ')}, ${e.split('').join(' ')}, ${n.split('').join(' ')}`;
}
