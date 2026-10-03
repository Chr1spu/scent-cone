import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { backendHealthy } from '../api/loader';
import { apiBase, savedServer, setServer } from '../api/server';
import { PROFILES, type ProfileId } from '../config/modelParams';
import { Link, navigate } from '../router';
import { Icon } from '../ui/icons';
import { parseLatLon, reverseName, searchPlaces, type Place } from './geocode';
import { LocationMap, type LatLon } from './LocationMap';
import { SiteHeader } from './SiteLayout';

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="border-b border-rule px-5 py-5">
      <h2 className="flex items-baseline gap-2 font-display text-xl font-bold text-ink">
        <span className="num text-sm font-medium text-sar-dark">{n}</span>
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type ServerState = 'checking' | 'ok' | 'down';

/** Server status and an optional server address (e.g. a local docker compose on port 8000). */
function ServerBox({ state, windninja, onCheck }: { state: ServerState; windninja: boolean; onCheck: () => void }) {
  const [url, setUrl] = useState(savedServer());
  return (
    <div className="text-sm">
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${state === 'ok' ? 'bg-forest' : state === 'down' ? 'bg-sar' : 'bg-ink-3'}`} />
        <span className="font-medium">
          {state === 'checking' ? 'Checking the server…' : state === 'ok' ? `Server connected${windninja ? ', WindNinja ready' : ', WindNinja missing (fallback wind only)'}` : 'No server reachable'}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-3">Address: {apiBase() || 'this website'}</p>
      {state === 'down' && (
        <p className="mt-2 text-[13px] leading-snug text-ink-2">
          Planning a new area needs the Scent Cone server, which downloads terrain and weather and runs WindNinja. Start it with <code className="rounded-sm bg-paper-2 px-1 font-mono text-xs">docker compose up</code> and enter its
          address below (usually <code className="rounded-sm bg-paper-2 px-1 font-mono text-xs">http://localhost:8000</code>). See the <Link to="/guide#server">guide</Link>.
        </p>
      )}
      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          setServer(url);
          onCheck();
        }}
      >
        <input className="field !text-xs" placeholder="http://localhost:8000" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Server address" />
        <button className="btn btn-sm shrink-0" type="submit">
          Save and check
        </button>
      </form>
    </div>
  );
}

export function NewSearch() {
  const [point, setPoint] = useState<LatLon | null>(null);
  const [flyKey, setFlyKey] = useState(0);
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [now, setNow] = useState(true);
  const [date, setDate] = useState(todayLocal());
  const [start, setStart] = useState(14);
  const [profile, setProfile] = useState<ProfileId>('child712');
  const [teams, setTeams] = useState(3);
  const [server, setServerState] = useState<ServerState>('checking');
  const [wn, setWn] = useState(false);

  const check = () => {
    setServerState('checking');
    backendHealthy(3000).then((h) => {
      setServerState(h.ok ? 'ok' : 'down');
      setWn(h.windninja);
    });
  };
  useEffect(check, []);

  // name the chosen point (one reverse lookup per pick)
  useEffect(() => {
    if (!point) return;
    let alive = true;
    setPlaceName(null);
    const t = setTimeout(() => reverseName(point.lat, point.lon).then((n) => alive && setPlaceName(n)), 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [point]);

  const pickAndFly = (p: LatLon) => {
    setPoint(p);
    setFlyKey((k) => k + 1);
  };

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    const coords = parseLatLon(q);
    if (coords) {
      pickAndFly(coords);
      setResults(null);
      return;
    }
    if (q.trim().length < 3) return;
    setSearching(true);
    setSearchError(null);
    try {
      setResults(await searchPlaces(q));
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'search failed');
    } finally {
      setSearching(false);
    }
  };

  const plannerUrl = point
    ? `/planner?lat=${point.lat.toFixed(5)}&lon=${point.lon.toFixed(5)}${now ? '&now=1' : `&date=${date}&start=${start}`}&profile=${profile}&teams=${teams}`
    : null;
  const ready = !!plannerUrl && server === 'ok';

  return (
    <div className="flex h-full flex-col bg-paper">
      <SiteHeader />
      <div className="grid min-h-0 flex-1 md:grid-cols-[400px_1fr]">
        <div className="order-2 overflow-y-auto border-r border-rule md:order-1">
          <div className="border-b border-rule px-5 py-5">
            <h1 className="font-display text-3xl font-bold text-ink">Plan a search</h1>
            <p className="mt-1 text-[15px] leading-snug text-ink-2">Set the last known point, the time window and who is missing. The planner opens with this area loaded.</p>
          </div>

          <Step n={1} title="Last known point">
            <form onSubmit={onSearch} className="flex gap-1.5">
              <input className="field" placeholder="Trailhead, campground, town, or 42.16, -74.20" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search for a place" />
              <button className="btn shrink-0" type="submit" disabled={searching} aria-label="Search">
                <Icon.Search />
              </button>
            </form>
            {searchError && <p className="mt-1.5 text-xs text-sar-dark">{searchError}</p>}
            {results && (
              <ul className="mt-2 divide-y divide-rule rounded border border-rule bg-white">
                {results.length === 0 && <li className="px-3 py-2 text-sm text-ink-3">No places found.</li>}
                {results.map((r, i) => (
                  <li key={i}>
                    <button
                      className="w-full px-3 py-2 text-left hover:bg-paper-2"
                      onClick={() => {
                        pickAndFly({ lat: r.lat, lon: r.lon });
                        setResults(null);
                      }}
                    >
                      <div className="text-sm font-medium">{r.name}</div>
                      <div className="text-xs text-ink-3">{r.detail}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-center gap-2">
              <button
                className="btn btn-sm"
                onClick={() =>
                  navigator.geolocation?.getCurrentPosition(
                    (p) => pickAndFly({ lat: p.coords.latitude, lon: p.coords.longitude }),
                    () => setSearchError('Location not available'),
                  )
                }
              >
                <Icon.Locate size={14} /> Use my location
              </button>
              <span className="text-xs text-ink-3">or click the map; drag the marker to adjust.</span>
            </div>
            <div className="mt-3 rounded border border-rule bg-white px-3 py-2 text-sm">
              {point ? (
                <>
                  <div className="font-medium">{placeName ?? 'Selected point'}</div>
                  <div className="num text-xs text-ink-2">
                    {point.lat.toFixed(5)}, {point.lon.toFixed(5)}
                  </div>
                </>
              ) : (
                <span className="text-ink-3">No point selected yet.</span>
              )}
            </div>
            <p className="mt-2 text-xs leading-snug text-ink-3">
              Modelled: a 12 km area at 30 m (dashed) and a 3 km focus square at 10 m (orange), which you can move later. US terrain from USGS 3DEP; elsewhere Copernicus 30 m.
            </p>
          </Step>

          <Step n={2} title="Time window">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="when" checked={now} onChange={() => setNow(true)} className="accent-sar" />
              Starting now (current forecast, 8 hours)
            </label>
            <label className="mt-1.5 flex items-center gap-2 text-sm">
              <input type="radio" name="when" checked={!now} onChange={() => setNow(false)} className="accent-sar" />
              A specific day
            </label>
            {!now && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-xs text-ink-2">
                  Date
                  <input type="date" className="field mt-0.5" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
                <label className="text-xs text-ink-2">
                  From (local time)
                  <select className="field mt-0.5" value={start} onChange={(e) => setStart(Number(e.target.value))}>
                    {Array.from({ length: 23 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, '0')}:00 to {String(Math.min(23, h + 8)).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <p className="mt-2 text-xs leading-snug text-ink-3">Today and the next two days use NOAA&apos;s HRRR forecast through WindNinja where available. Past dates use archived hourly weather.</p>
          </Step>

          <Step n={3} title="Subject">
            <div className="grid gap-1.5">
              {(Object.keys(PROFILES) as ProfileId[]).map((id) => (
                <label key={id} className={`flex cursor-pointer items-center justify-between rounded border px-3 py-2 text-sm ${profile === id ? 'border-ink bg-white' : 'border-rule hover:border-ink-3'}`}>
                  <span className="flex items-center gap-2">
                    <input type="radio" name="profile" checked={profile === id} onChange={() => setProfile(id)} className="accent-sar" />
                    {PROFILES[id].label}
                  </span>
                  <span className="num text-xs text-ink-3">median {(PROFILES[id].medianM / 1000).toFixed(1)} km</span>
                </label>
              ))}
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              Dog teams available
              <input type="number" min={1} max={6} value={teams} onChange={(e) => setTeams(Math.min(6, Math.max(1, Number(e.target.value) || 1)))} className="field !w-16" />
            </label>
          </Step>

          <Step n={4} title="Server">
            <ServerBox state={server} windninja={wn} onCheck={check} />
          </Step>

          <div className="sticky bottom-0 flex gap-2 border-t border-rule bg-paper px-5 py-4">
            <button className="btn btn-primary flex-1 py-2.5 text-base" disabled={!ready} onClick={() => plannerUrl && navigate(plannerUrl)}>
              Open the planner
            </button>
            <button
              className="btn"
              disabled={!plannerUrl}
              title="Copy a link to this search"
              onClick={() => plannerUrl && navigator.clipboard?.writeText(`${location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}${plannerUrl}`)}
            >
              Copy link
            </button>
          </div>
          {!ready && (
            <p className="px-5 pb-5 text-xs text-ink-3">
              {!point ? 'Choose a last known point first.' : 'Waiting for a server.'} Without a server you can still <Link to="/planner?demo">open the demo</Link>.
            </p>
          )}
        </div>
        <div className="order-1 h-[45vh] md:order-2 md:h-auto">
          <LocationMap point={point} onPick={setPoint} flyKey={flyKey} />
        </div>
      </div>
    </div>
  );
}
