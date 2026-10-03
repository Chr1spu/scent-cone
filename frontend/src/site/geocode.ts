/**
 * Place search and reverse lookup via OpenStreetMap Nominatim (usage policy: light use,
 * one request per user action, attribution). Called only on submit / click, never per keystroke.
 */
export interface Place {
  name: string;
  detail: string;
  lat: number;
  lon: number;
}

const NOMINATIM = 'https://nominatim.openstreetmap.org';

export async function searchPlaces(q: string): Promise<Place[]> {
  const r = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`search failed (${r.status})`);
  const j = (await r.json()) as { display_name: string; name?: string; lat: string; lon: string }[];
  return j.map((p) => {
    const parts = p.display_name.split(', ');
    return { name: p.name || parts[0], detail: parts.slice(1, 4).join(', '), lat: Number(p.lat), lon: Number(p.lon) };
  });
}

export async function reverseName(lat: number, lon: number): Promise<string | null> {
  try {
    const r = await fetch(`${NOMINATIM}/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lon}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const j = (await r.json()) as { display_name?: string; name?: string };
    if (!j.display_name) return null;
    return j.display_name.split(', ').slice(0, 3).join(', ');
  } catch {
    return null;
  }
}

/** Parse "42.1589, -74.2047" style input. */
export function parseLatLon(s: string): { lat: number; lon: number } | null {
  const m = s.trim().match(/^(-?\d+(?:\.\d+)?)[\s,;]+(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}
