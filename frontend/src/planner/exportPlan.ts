/**
 * Export the plan for field use: GPX (GPS units, CalTopo/SARTopo, Gaia) and KML (Google Earth,
 * CalTopo). Waypoints for the last known point and each team's start, with the USNG reference,
 * heading, wind, best window and coverage in the description, and a short line along each
 * team's upwind heading. Built only from the deployment results.
 */
import { localToLatLon, usng } from '../geo/utm';
import type { DeploymentOut } from '../workers/protocol';

export interface PlanExportInput {
  area: string;
  date: string;
  time: number;
  crs: string;
  frame: { cx: number; cy: number };
  lkp: [number, number];
  lkpLabel: string;
  deployments: DeploymentOut[];
  /** metres drawn along each team's heading */
  headingLineM?: number;
}

interface Pt {
  lat: number;
  lon: number;
}

export interface PlanPoint extends Pt {
  name: string;
  desc: string;
  usng: string;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const hhmm = (t: number) => {
  const m = Math.round(t * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The plan as geographic points and heading lines; null if the area grid is not UTM. */
export function planGeometry(inp: PlanExportInput): { points: PlanPoint[]; lines: { name: string; pts: Pt[] }[] } | null {
  const ll = (x: number, y: number) => localToLatLon(inp.crs, inp.frame, x, y);
  const l0 = ll(inp.lkp[0], inp.lkp[1]);
  if (!l0) return null;
  const points: PlanPoint[] = [{ ...l0, name: inp.lkpLabel, desc: `${inp.lkpLabel}. ${usng(l0.lat, l0.lon)}`, usng: usng(l0.lat, l0.lon) }];
  const lines: { name: string; pts: Pt[] }[] = [];
  const len = inp.headingLineM ?? 300;
  for (const d of inp.deployments) {
    const p = ll(d.x, d.y)!;
    const ref = usng(p.lat, p.lon);
    const deg = Math.round(((Math.atan2(d.upwind[0], d.upwind[1]) * 180) / Math.PI + 360) % 360);
    const desc =
      `Team ${d.team} start${d.kind === 'ground' ? ' (ground search of the most likely area)' : ''}. ${ref}. Work toward ${deg}° (${POINTS[Math.round(deg / 45) % 8]}) into a ${d.windSpeed.toFixed(1)} m/s wind. ` +
      `Best window ${hhmm(d.bestWindow[0])}-${hhmm(d.bestWindow[1])}. Covers ${(d.coveredProb * 100).toFixed(1)}% of the probability. ` +
      `Planned for ${hhmm(inp.time)} on ${inp.date}. Scentline: modelled, not observed; confirm wind on site.`;
    points.push({ ...p, name: `Team ${d.team} start`, desc, usng: ref });
    lines.push({ name: `Team ${d.team} heading`, pts: [p, ll(d.x + d.upwind[0] * len, d.y + d.upwind[1] * len)!] });
  }
  return { points, lines };
}

export function toGpx(inp: PlanExportInput): string | null {
  const g = planGeometry(inp);
  if (!g) return null;
  const f = (v: number) => v.toFixed(7);
  const wpts = g.points.map((p) => `  <wpt lat="${f(p.lat)}" lon="${f(p.lon)}">\n    <name>${esc(p.name)}</name>\n    <desc>${esc(p.desc)}</desc>\n  </wpt>`);
  const rtes = g.lines.map(
    (l) => `  <rte>\n    <name>${esc(l.name)}</name>\n${l.pts.map((p) => `    <rtept lat="${f(p.lat)}" lon="${f(p.lon)}"/>`).join('\n')}\n  </rte>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Scentline" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(`Scentline plan: ${inp.area}`)}</name><desc>${esc(`Dog team plan for ${hhmm(inp.time)}, ${inp.date}`)}</desc></metadata>
${[...wpts, ...rtes].join('\n')}
</gpx>
`;
}

export function toKml(inp: PlanExportInput): string | null {
  const g = planGeometry(inp);
  if (!g) return null;
  const c = (p: Pt) => `${p.lon.toFixed(7)},${p.lat.toFixed(7)},0`;
  const marks = g.points.map(
    (p, i) =>
      `    <Placemark><name>${esc(p.name)}</name><description>${esc(p.desc)}</description><styleUrl>#${i === 0 ? 'lkp' : 'team'}</styleUrl><Point><coordinates>${c(p)}</coordinates></Point></Placemark>`,
  );
  const lines = g.lines.map(
    (l) => `    <Placemark><name>${esc(l.name)}</name><styleUrl>#heading</styleUrl><LineString><coordinates>${l.pts.map(c).join(' ')}</coordinates></LineString></Placemark>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(`Scentline plan: ${inp.area}`)}</name>
    <Style id="lkp"><IconStyle><color>ff2c6bff</color></IconStyle></Style>
    <Style id="team"><IconStyle><color>ff47b5ff</color></IconStyle></Style>
    <Style id="heading"><LineStyle><color>ff2c6bff</color><width>3</width></LineStyle></Style>
${[...marks, ...lines].join('\n')}
  </Document>
</kml>
`;
}

/** Save text as a file in the browser. */
export function download(name: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
