/** Hand-built SVG diagrams for the site (paper-and-ink style, no stock art). */

const INK = '#1e2420';
const SAR = '#d4521c';
const PROB = '#23b5c4';
const TOPO = '#8a5a33';

function Contours() {
  return (
    <g stroke={TOPO} strokeWidth="1" fill="none" opacity="0.45">
      <path d="M-10 150 C40 120 80 135 120 110 S200 70 260 90" />
      <path d="M-10 175 C50 150 90 160 130 138 S210 100 260 118" />
      <path d="M-10 125 C30 95 70 112 110 84 S190 44 260 62" />
      <path d="M-10 100 C25 72 60 88 100 60 S180 22 260 36" />
    </g>
  );
}

/** Three panels: where they might be, where the air goes, where a dog can smell them. */
export function IdeaDiagram() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[
        {
          title: '1. Where the person might be',
          body: 'Distance from the last known point for this kind of person, pulled toward trails and streams, pushed away from cliffs and water.',
          art: (
            <>
              <Contours />
              <ellipse cx="110" cy="105" rx="70" ry="45" fill={PROB} opacity="0.18" />
              <ellipse cx="105" cy="102" rx="42" ry="27" fill={PROB} opacity="0.3" />
              <ellipse cx="100" cy="100" rx="18" ry="12" fill={PROB} opacity="0.5" />
              <circle cx="100" cy="100" r="5" fill={SAR} />
              <text x="108" y="94" fontSize="11" fill={INK} fontFamily="Barlow">last seen</text>
            </>
          ),
        },
        {
          title: '2. Where the air goes',
          body: 'WindNinja bends the forecast wind around the real terrain. In the evening, cooling air drains down the valleys.',
          art: (
            <>
              <Contours />
              {[
                [30, 60],
                [80, 50],
                [130, 45],
                [40, 115],
                [95, 105],
                [150, 100],
                [60, 160],
                [120, 150],
                [180, 140],
              ].map(([x, y], i) => (
                <g key={i} stroke={INK} strokeWidth="1.4" fill="none">
                  <path d={`M${x} ${y} l26 10`} />
                  <path d={`M${x + 26} ${y + 10} l-7 -6 M${x + 26} ${y + 10} l-9 1`} />
                </g>
              ))}
            </>
          ),
        },
        {
          title: '3. Where a dog can smell them',
          body: 'Simulated scent drifts downwind from every likely spot. Teams start downwind and work into the wind toward the source.',
          art: (
            <>
              <Contours />
              <path d="M70 100 L215 60 L225 150 Z" fill={SAR} opacity="0.12" />
              <path d="M70 100 L170 78 L175 125 Z" fill={SAR} opacity="0.2" />
              <circle cx="70" cy="100" r="5" fill={SAR} />
              <g transform="translate(205 108)">
                <circle r="9" fill="#fff" stroke={INK} strokeWidth="1.4" />
                <path d="M-4 1h6l1.5-3h2l1.5 1.5-1.5 1v3M-3 1v3M1 1v3" stroke={INK} strokeWidth="1.2" fill="none" />
              </g>
              <path d="M190 108 L120 101" stroke={INK} strokeWidth="1.4" strokeDasharray="4 3" />
              <path d="M120 101 l8 -4 M120 101 l7 5" stroke={INK} strokeWidth="1.4" />
              <text x="168" y="135" fontSize="11" fill={INK} fontFamily="Barlow">dog team</text>
            </>
          ),
        },
      ].map((p) => (
        <div key={p.title} className="rounded border border-rule bg-white/60">
          <svg viewBox="0 0 250 200" className="block w-full border-b border-rule">
            {p.art}
          </svg>
          <div className="p-4">
            <h3 className="font-semibold text-ink">{p.title}</h3>
            <p className="mt-1 text-[15px] leading-snug text-ink-2">{p.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Wind speed with height: log profile over open ground; marks 0.6 m and 2 m. */
export function WindProfileDiagram() {
  // u(z) ∝ ln(z / z0), z0 = 0.03 m, normalised to 1 at 2 m
  const z0 = 0.03;
  const pts: string[] = [];
  for (let z = 0.05; z <= 2.4; z += 0.05) {
    const u = Math.log(z / z0) / Math.log(2 / z0);
    pts.push(`${40 + u * 200},${190 - (z / 2.4) * 170}`);
  }
  const y = (z: number) => 190 - (z / 2.4) * 170;
  const x = (z: number) => 40 + (Math.log(z / z0) / Math.log(2 / z0)) * 200;
  return (
    <svg viewBox="0 0 300 215" className="w-full max-w-md" role="img" aria-label="Wind speed increases with height above ground">
      <path d="M40 20 V190 H280" stroke={INK} strokeWidth="1.2" fill="none" />
      <polyline points={pts.join(' ')} fill="none" stroke={SAR} strokeWidth="2" />
      <line x1="40" x2={x(2)} y1={y(2)} y2={y(2)} stroke={INK} strokeDasharray="3 3" />
      <line x1="40" x2={x(0.6)} y1={y(0.6)} y2={y(0.6)} stroke={INK} strokeDasharray="3 3" />
      <circle cx={x(2)} cy={y(2)} r="3.5" fill={INK} />
      <circle cx={x(0.6)} cy={y(0.6)} r="3.5" fill={SAR} />
      <text x={x(2) + 8} y={y(2) + 4} fontSize="11" fontFamily="Barlow" fill={INK}>2 m: model wind (100%)</text>
      <text x={x(0.6) + 8} y={y(0.6) + 4} fontSize="11" fontFamily="Barlow" fill={INK}>0.6 m: dog nose (~71%)</text>
      <text x="8" y="16" fontSize="11" fontFamily="Barlow" fill={INK}>height</text>
      <text x="236" y="206" fontSize="11" fontFamily="Barlow" fill={INK}>wind speed</text>
    </svg>
  );
}

/** Continuous release vs a single puff. */
export function PlumeDiagram() {
  return (
    <svg viewBox="0 0 520 150" className="w-full" role="img" aria-label="A continuous plume compared with a single puff">
      <g fontFamily="Barlow" fontSize="12" fill={INK}>
        <text x="10" y="18">Single puff (wrong): the heat ends up far downwind</text>
        <text x="10" y="92">Continuous release (used): strongest near the person, fading downwind</text>
      </g>
      <circle cx="20" cy="45" r="4" fill={SAR} />
      <ellipse cx="200" cy="45" rx="40" ry="14" fill={SAR} opacity="0.35" />
      <path d="M30 45 H150" stroke={INK} strokeDasharray="3 3" />
      <circle cx="20" cy="120" r="4" fill={SAR} />
      {Array.from({ length: 14 }, (_, i) => (
        <ellipse key={i} cx={32 + i * 16} cy="120" rx={4 + i * 1.6} ry={3 + i * 0.9} fill={SAR} opacity={0.45 - i * 0.028} />
      ))}
    </svg>
  );
}

/** Two alerts: back-traced zones overlap at the subject. */
export function TriangulationDiagram() {
  return (
    <svg viewBox="0 0 320 200" className="w-full max-w-md" role="img" aria-label="Two back-traced alert zones overlapping">
      <Contours />
      <path d="M260 150 L120 95 L105 120 Z" fill="#ff4fa3" opacity="0.25" />
      <path d="M210 30 L110 100 L135 110 Z" fill="#8a5cf6" opacity="0.25" />
      <circle cx="118" cy="104" r="7" fill="none" stroke={INK} strokeWidth="1.5" />
      <circle cx="118" cy="104" r="2.5" fill={SAR} />
      <g fontFamily="Barlow" fontSize="11" fill={INK}>
        <text x="236" y="166">alert 1, 15:15</text>
        <text x="200" y="24">alert 2, 17:45</text>
        <text x="60" y="130">overlap</text>
      </g>
      <path d="M262 150 l-6 -1 M262 150 l-3 -5" stroke={INK} />
      <circle cx="262" cy="150" r="3" fill="#ff4fa3" />
      <circle cx="210" cy="30" r="3" fill="#8a5cf6" />
    </svg>
  );
}
