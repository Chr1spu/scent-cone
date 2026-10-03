/**
 * Minimal client-side router (history API) that respects Vite's base path, so the same
 * build works at / locally and at /scent-cone/ on GitHub Pages (404.html serves the app).
 */
import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Path inside the app, without the base ('/', '/planner', ...). */
export function currentPath(): string {
  let p = location.pathname;
  if (BASE && p.startsWith(BASE)) p = p.slice(BASE.length);
  if (!p.startsWith('/')) p = `/${p}`;
  return p.replace(/\/+$/, '') || '/';
}

export function href(to: string): string {
  return `${BASE}${to}`;
}

export function navigate(to: string, replace = false) {
  const url = href(to);
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

export function useRoute(): { path: string; query: URLSearchParams } {
  const [state, setState] = useState(() => ({ path: currentPath(), query: new URLSearchParams(location.search) }));
  useEffect(() => {
    const on = () => setState({ path: currentPath(), query: new URLSearchParams(location.search) });
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return state;
}

/** In-app link: normal anchor for new tabs / modifiers, client navigation otherwise. */
export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      {...rest}
      href={href(to)}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
    />
  );
}
