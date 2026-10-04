/**
 * Where the backend lives. Order: a URL saved in this browser (so the public site can use a
 * server you run yourself), then the published server.json (written by scripts/start-server.ps1
 * when the server comes online), then the build-time VITE_API_BASE, then same-origin '/api'.
 */
const KEY = 'scentline.server';
let published = '';

/** Read the published server address (server.json next to the site), at most ~2 s. */
export async function loadPublishedServer(): Promise<void> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2000);
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}server.json`, { cache: 'no-store', signal: ctl.signal });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return;
    const j = (await r.json()) as { api?: string };
    if (typeof j.api === 'string') published = j.api.trim().replace(/\/+$/, '');
  } catch {
    /* offline or not published: fine */
  } finally {
    clearTimeout(timer);
  }
}

export function apiBase(): string {
  try {
    // fall back to the address saved before the rename to Scentline
    const saved = localStorage.getItem(KEY) ?? localStorage.getItem('scentcone.server');
    if (saved?.trim()) return saved.trim().replace(/\/+$/, '');
  } catch {
    /* storage unavailable */
  }
  if (published) return published;
  // tolerate stray whitespace / a trailing slash pasted into the hosting dashboard
  return ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').trim().replace(/\/+$/, '');
}

export function savedServer(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setServer(url: string) {
  try {
    if (url.trim()) localStorage.setItem(KEY, url.trim());
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
