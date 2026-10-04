/** Small line icons drawn for this app (24 px grid, 1.6 px strokes, currentColor). */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

/** Logo: a last known point and a faceted (low-poly) scent cone opening downwind. */
export function Logo({ size = 28, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden {...rest}>
      <circle cx="5.5" cy="16" r="2.8" fill="currentColor" />
      <path d="M10 16 L29 5.5 L23.5 16 Z" fill="#ff6b2c" />
      <path d="M10 16 L23.5 16 L29 26.5 Z" fill="#dc5014" />
      <path d="M23.5 16 L29 5.5 L29 26.5 Z" fill="#ffb547" />
    </svg>
  );
}

export const Icon = {
  Pin: (p: P) => (
    <Svg {...p}>
      <path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </Svg>
  ),
  Wind: (p: P) => (
    <Svg {...p}>
      <path d="M3 8h11a3 3 0 1 0-3-3" />
      <path d="M3 12h16a3 3 0 1 1-3 3" />
      <path d="M3 16h7" />
    </Svg>
  ),
  Play: (p: P) => (
    <Svg {...p}>
      <path d="M7 5v14l11-7Z" fill="currentColor" stroke="none" />
    </Svg>
  ),
  Pause: (p: P) => (
    <Svg {...p}>
      <path d="M8 5v14M16 5v14" strokeWidth={2.6} />
    </Svg>
  ),
  Dog: (p: P) => (
    <Svg {...p}>
      <path d="M4 13h9l2-4h3l2 2-2 1v5" />
      <path d="M6 13v5M10 13v5M17 17v1" />
      <path d="M4 13 3 9" />
    </Svg>
  ),
  Plume: (p: P) => (
    <Svg {...p}>
      <circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <path d="M8 10.5 20 6M8 13.5 20 18" />
      <path d="M13 9.5q2 2.5 0 5M17 8q3 4 0 8" />
    </Svg>
  ),
  Alert: (p: P) => (
    <Svg {...p}>
      <path d="M12 4 21 19H3Z" />
      <path d="M12 10v4M12 16.5v.5" />
    </Svg>
  ),
  Ring: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="7.5" strokeDasharray="3 2.5" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  ),
  Layers: (p: P) => (
    <Svg {...p}>
      <path d="m12 4 9 5-9 5-9-5Z" />
      <path d="m3 14 9 5 9-5" />
    </Svg>
  ),
  Search: (p: P) => (
    <Svg {...p}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </Svg>
  ),
  Clock: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  ),
  Sun: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </Svg>
  ),
  Thermo: (p: P) => (
    <Svg {...p}>
      <path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0Z" />
    </Svg>
  ),
  Brush: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </Svg>
  ),
  Minus: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M8.5 12h7" />
    </Svg>
  ),
  Locate: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="6" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </Svg>
  ),
  Square: (p: P) => (
    <Svg {...p}>
      <rect x="5" y="5" width="14" height="14" strokeDasharray="3 2" />
    </Svg>
  ),
  Close: (p: P) => (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  ),
  Chevron: (p: P) => (
    <Svg {...p}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  ),
  Map: (p: P) => (
    <Svg {...p}>
      <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20Z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </Svg>
  ),
  Cube: (p: P) => (
    <Svg {...p}>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </Svg>
  ),
  Info: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8v.5" />
    </Svg>
  ),
};
