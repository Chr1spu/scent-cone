/**
 * Where the backend lives. Order: a URL saved in this browser (so the public site can use a
 * server you run yourself), then the build-time VITE_API_BASE, then same-origin '/api'.
 */
const KEY = 'scentcone.server';

export function apiBase(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved?.trim()) return saved.trim().replace(/\/+$/, '');
  } catch {
    /* storage unavailable */
  }
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
