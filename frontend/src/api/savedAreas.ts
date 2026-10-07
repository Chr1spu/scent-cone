/**
 * Areas saved on this device, for use without a network (no signal at the trailhead). Every live
 * area that loads is stored in IndexedDB (typed arrays are stored as-is); opening the same planner
 * link with the server unreachable falls back to the saved copy. Browser storage can be cleared or
 * unavailable (private windows), so every call fails soft.
 */
import type { AreaBundle } from './types';
import type { LiveRequest } from './loader';

const DB = 'scentline';
const STORE = 'areas';
/** keep the most recent few; each area is roughly 10–20 MB */
const MAX_SAVED = 6;

export interface SavedAreaMeta {
  id: string;
  name: string;
  /** the scenario date of the saved forecast */
  date: string;
  savedAt: number;
  lat: number;
  lon: number;
  req: LiveRequest;
}

interface Row extends SavedAreaMeta {
  bundle: AreaBundle;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Same place and focus square = same saved area (the date is not part of the key). */
export function areaKey(lat: number, lon: number, detailCenter?: [number, number] | null): string {
  const dc = detailCenter ? `${r4(detailCenter[0])},${r4(detailCenter[1])}` : '-';
  return `${r4(lat)},${r4(lon)}|${dc}`;
}

export async function saveArea(req: LiveRequest, bundle: AreaBundle): Promise<void> {
  try {
    const c = bundle.config;
    const row: Row = {
      id: areaKey(c.lat, c.lon, req.detailCenter),
      name: c.name,
      date: c.date,
      savedAt: Date.now(),
      lat: c.lat,
      lon: c.lon,
      req,
      bundle: { ...bundle, warnings: [] },
    };
    await tx('readwrite', (s) => s.put(row));
    const all = await listSavedAreas();
    for (const old of all.slice(MAX_SAVED)) await deleteSavedArea(old.id);
  } catch {
    // storage full, blocked or unavailable: the app works without it
  }
}

/** Saved areas, newest first. */
export async function listSavedAreas(): Promise<SavedAreaMeta[]> {
  try {
    const rows = await tx<Row[]>('readonly', (s) => s.getAll() as IDBRequest<Row[]>);
    return rows.map(({ bundle: _b, ...meta }) => meta).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function loadSavedArea(id: string): Promise<AreaBundle | null> {
  try {
    const row = await tx<Row | undefined>('readonly', (s) => s.get(id) as IDBRequest<Row | undefined>);
    if (!row) return null;
    const saved = new Date(row.savedAt).toLocaleString();
    return {
      ...row.bundle,
      mode: 'saved',
      warnings: [`Saved copy from ${saved}: terrain is current, but the wind is the forecast saved then. Measure the wind on site.`],
    };
  } catch {
    return null;
  }
}

/** The saved copy of the area a planner link asks for, if any. */
export async function findSaved(req: LiveRequest): Promise<SavedAreaMeta | null> {
  if (req.lat === undefined || req.lon === undefined) return null;
  const id = areaKey(req.lat, req.lon, req.detailCenter);
  return (await listSavedAreas()).find((a) => a.id === id) ?? null;
}

export async function deleteSavedArea(id: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(id));
  } catch {
    // nothing to do
  }
}
