import { useEffect, useState, type ReactNode } from 'react';
import { Link, useRoute } from '../router';
import { Logo, Icon } from '../ui/icons';

const NAV = [
  { to: '/how-it-works', label: 'How it works' },
  { to: '/guide', label: 'Guide' },
  { to: '/about', label: 'Project' },
];

/**
 * Floating pill navigation. `overlay` = drawn over the 3D landing scene (glass, light text)
 * until the page scrolls past `solidAfter` px, then it turns solid.
 */
export function SiteHeader({ overlay = false, solidAfter = 0 }: { overlay?: boolean; solidAfter?: number }) {
  const { path } = useRoute();
  const [open, setOpen] = useState(false);
  const [solid, setSolid] = useState(!overlay);
  useEffect(() => {
    if (!overlay) return;
    const on = () => setSolid(window.scrollY > solidAfter);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [overlay, solidAfter]);
  const glass = overlay && !solid;
  const bar = glass ? 'glass' : 'border border-rule bg-card/90 text-ink shadow-lift backdrop-blur-xl';
  const link = (active: boolean) =>
    glass
      ? `rounded-full px-3 py-1.5 text-[14px] font-semibold no-underline transition ${active ? 'bg-white/20 text-white' : 'text-white/80 hover:bg-white/10 hover:text-white'}`
      : `rounded-full px-3 py-1.5 text-[14px] font-semibold no-underline transition ${active ? 'bg-ink text-paper hover:text-paper' : 'text-ink-2 hover:bg-paper-2 hover:text-ink'}`;
  return (
    <header className={`${overlay ? 'fixed' : 'sticky'} inset-x-0 top-0 z-40 px-3 pt-3 md:px-6`}>
      <div className={`mx-auto flex h-14 max-w-6xl items-center gap-3 rounded-2xl pl-4 pr-2 transition-colors duration-300 ${bar}`}>
        <Link to="/" className={`flex items-center gap-2 no-underline ${glass ? 'text-white hover:text-white' : 'text-ink hover:text-ink'}`}>
          <Logo size={28} />
          <span className="font-display text-[21px] font-bold tracking-tight">Scentline</span>
        </Link>
        <nav className="ml-3 hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className={link(path === n.to)}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Link to="/planner?demo" className={`btn ${glass ? 'btn-ghost' : ''}`}>
            Open the demo
          </Link>
          <Link to="/new" className="btn btn-primary">
            Plan a search
          </Link>
        </div>
        <button className={`btn btn-sm ml-auto md:hidden ${glass ? 'btn-ghost' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Menu">
          {open ? <Icon.Close /> : 'Menu'}
        </button>
      </div>
      {open && (
        <nav className="mx-auto mt-2 max-w-6xl rounded-2xl border border-rule bg-card p-4 shadow-float md:hidden" aria-label="Main">
          <div className="flex flex-col gap-1">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} className="rounded-lg px-2 py-2 text-base font-semibold text-ink no-underline hover:bg-paper-2" onClick={() => setOpen(false)}>
                {n.label}
              </Link>
            ))}
            <div className="flex gap-2 pt-2">
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
    <footer className="relative z-10 bg-ink-900 text-white/70">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 text-sm md:grid-cols-[1.5fr_1fr_1fr] md:px-6">
        <div>
          <div className="flex items-center gap-2 text-white">
            <Logo size={26} />
            <span className="font-display text-xl font-bold">Scentline</span>
          </div>
          <p className="mt-3 max-w-sm leading-relaxed">
            A planning aid for deploying air-scent dogs. A research prototype: the scent physics are simplified, and it does not replace a K9 handler&apos;s judgement.
          </p>
        </div>
        <div>
          <div className="eyebrow mb-3 !text-white/40">Site</div>
          <ul className="space-y-2">
            {[
              ['/new', 'Plan a search'],
              ['/planner?demo', 'Demo: Catskills campsite'],
              ['/how-it-works', 'How it works'],
              ['/guide', 'Guide'],
              ['/about', 'Project and credits'],
            ].map(([to, label]) => (
              <li key={to}>
                <Link to={to} className="text-white/80 no-underline hover:text-amber">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="eyebrow mb-3 !text-white/40">Data and art</div>
          <p className="leading-relaxed">
            Wind: USFS WindNinja, NOAA HRRR, Open-Meteo. Terrain: USGS 3DEP, Copernicus. Land cover: NLCD, ESA WorldCover. Trails and streams: © OpenStreetMap contributors. 3D models: Synty
            POLYGON packs.
          </p>
          <p className="mt-3">
            <a href="https://github.com/Chr1spu/scentline" className="text-amber no-underline hover:text-white">
              Source code on GitHub →
            </a>
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

/** A figure with a soft frame and a caption, used for screenshots and diagrams. */
export function Figure({ src, alt, caption, className = '' }: { src: string; alt: string; caption?: ReactNode; className?: string }) {
  return (
    <figure className={className}>
      <img src={src} alt={alt} loading="lazy" className="block w-full rounded-xl border border-rule bg-ink-900 shadow-lift" />
      {caption && <figcaption className="mt-2 text-sm leading-snug text-ink-3">{caption}</figcaption>}
    </figure>
  );
}

export const img = (name: string) => `${import.meta.env.BASE_URL}img/${name}`;
