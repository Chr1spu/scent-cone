import { useState, type ReactNode } from 'react';
import { Link, useRoute } from '../router';
import { Logo, Icon } from '../ui/icons';

const NAV = [
  { to: '/how-it-works', label: 'How it works' },
  { to: '/guide', label: 'Guide' },
  { to: '/about', label: 'About' },
];

export function SiteHeader() {
  const { path } = useRoute();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-paper/95">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 md:px-6">
        <Link to="/" className="flex items-center gap-2 text-ink no-underline hover:text-ink">
          <Logo size={28} />
          <span className="font-display text-[22px] font-bold tracking-tight">Scentline</span>
        </Link>
        <nav className="hidden items-center gap-5 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={`text-[15px] font-medium no-underline ${path === n.to ? 'text-ink underline decoration-sar decoration-2 underline-offset-[6px]' : 'text-ink-2 hover:text-ink'}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Link to="/planner?demo" className="btn">
            Open the demo
          </Link>
          <Link to="/new" className="btn btn-primary">
            Plan a search
          </Link>
        </div>
        <button className="btn btn-sm ml-auto md:hidden" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Menu">
          {open ? <Icon.Close /> : 'Menu'}
        </button>
      </div>
      {open && (
        <nav className="border-t border-rule px-4 py-3 md:hidden" aria-label="Main">
          <div className="flex flex-col gap-3">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} className="text-base font-medium text-ink no-underline" onClick={() => setOpen(false)}>
                {n.label}
              </Link>
            ))}
            <div className="flex gap-2 pt-1">
              <Link to="/planner?demo" className="btn flex-1">
                Open the demo
              </Link>
              <Link to="/new" className="btn btn-primary flex-1">
                Plan a search
              </Link>
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-rule bg-paper-2">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm text-ink-2 md:grid-cols-[1.4fr_1fr_1fr] md:px-6">
        <div>
          <div className="flex items-center gap-2 text-ink">
            <Logo size={22} />
            <span className="font-display text-lg font-bold">Scentline</span>
          </div>
          <p className="mt-2 max-w-sm leading-relaxed">
            A planning aid for deploying air-scent dogs. A research prototype: the scent physics are simplified, and it does not replace a K9 handler&apos;s judgement.
          </p>
        </div>
        <div>
          <div className="eyebrow mb-2">Site</div>
          <ul className="space-y-1.5">
            <li>
              <Link to="/new">Plan a search</Link>
            </li>
            <li>
              <Link to="/planner?demo">Demo: Catskills campsite</Link>
            </li>
            <li>
              <Link to="/how-it-works">How it works</Link>
            </li>
            <li>
              <Link to="/guide">Guide</Link>
            </li>
            <li>
              <Link to="/about">About and data sources</Link>
            </li>
          </ul>
        </div>
        <div>
          <div className="eyebrow mb-2">Data</div>
          <p className="leading-relaxed">
            Wind: USFS WindNinja, NOAA HRRR, Open-Meteo. Terrain: USGS 3DEP, Copernicus. Land cover: NLCD, ESA WorldCover. Trails and streams: © OpenStreetMap contributors.
          </p>
          <p className="mt-2">
            <a href="https://github.com/Chr1spu/scentline">Source code on GitHub</a>
          </p>
        </div>
      </div>
    </footer>
  );
}

export function SitePage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full bg-paper">
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}

/** A figure with a ruled frame and a caption, used for screenshots and diagrams. */
export function Figure({ src, alt, caption, className = '' }: { src: string; alt: string; caption?: ReactNode; className?: string }) {
  return (
    <figure className={className}>
      <img src={src} alt={alt} loading="lazy" className="block w-full rounded border border-rule bg-ink-900" />
      {caption && <figcaption className="mt-2 text-sm leading-snug text-ink-2">{caption}</figcaption>}
    </figure>
  );
}

export const img = (name: string) => `${import.meta.env.BASE_URL}img/${name}`;
