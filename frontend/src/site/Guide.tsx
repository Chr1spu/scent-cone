import { Link } from '../router';
import { Figure, SitePage, img } from './SiteLayout';

const WALK = [
  { key: '1', title: 'The campsite', text: 'The camera flies to the last known point: Devil’s Tombstone Campground, at the head of Stony Clove Notch. The time bar starts at 16:00, when the child went missing.', image: 'step-lkp.jpg' },
  { key: '2', title: 'Probability', text: 'The blue tint is where a 9-year-old is likely to be, concentrated along the trails and streams near camp. The panel shows how much of it falls inside the 3 km focus square.', image: 'step-probability.jpg' },
  { key: '3', title: 'Wind', text: 'Thin streaks show the WindNinja wind at this hour. Switch between WindNinja and the simpler fallback model in the top bar to compare them around the ridges.', image: 'step-wind.jpg' },
  { key: '4', title: 'Scent', text: 'Release scent: orange particles drift from every likely spot at dog-nose height. Press Play or drag the time bar and watch the flow turn downhill after sunset.', image: 'step-particles.jpg' },
  { key: '5', title: 'Heatmap', text: 'The heatmap is the scent of the last hour, averaged over several possible winds. Hotspots mark the strongest accumulations. The rating on the time bar compares scent with neutral conditions.', image: 'step-scent.jpg' },
  { key: '6', title: 'Deploy teams', text: 'Deploy gives each team a search segment (edges on trails, streams and ridges) with its entry point on the downwind edge, a heading into the wind and its best hour; the handler picks the pattern inside. The Plan tab lists every segment with its probability, POD and expected finds.', image: 'step-deploy.jpg' },
  { key: '7', title: 'Alerts', text: 'Choose Add alert and click the two radio markers: dogs alerted there at 15:15 and 17:45. Each alert traces the scent back an hour; the zones overlap where the child is, and the marker appears.', image: 'step-alerts.jpg' },
];

const CONTROLS: [string, string][] = [
  ['Subject', 'Choose the profile. It sets how far the person probably went (median 0.3 km for a young child, 3.1 km for a hiker).'],
  ['Place LKP', 'Then click the terrain to move the last known point.'],
  ['Raise / Lower', 'Click to double or halve the probability within 250 m, for local knowledge.'],
  ['Release scent', 'Starts the visible scent particles.'],
  ['Heatmap', 'Scent of the last hour and the hotspots. Recomputed when the time changes (about 2 s).'],
  ['Teams, Deploy', 'Number of teams (1 to 6) and the deployment itself. Segments (default) assigns whole search segments; Start points gives each team a start and an upwind route, for hasty searches.'],
  ['Segment table', 'Plan tab: every segment for a dog team at the time bar’s time, best first: POA, POD, expected finds, hours for one team, cumulative POD from searches logged, and a wait flag if it was searched in the last 30 minutes. “searched” marks a segment covered with no alert.'],
  ['Import team track', 'Search log: a team’s GPX track from a GPS unit, collar or CalTopo. The corridor walked counts as searched over the track’s times, and ALERT waypoints are logged as alerts at their times.'],
  ['Time bar', 'An 8-hour forecast window in the area’s local time, starting when the person went missing (▲). Dragging it changes wind, sun, temperature and scent to that hour; it is a planning clock and does not follow the real clock. For searches running today, a green NOW marker shows the current time: click it to jump there.'],
  ['Read briefing', 'In the Plan tab after Deploy: reads every team’s start point, heading, wind, best hour and coverage aloud, ready to relay by radio. Spoken by Grok Voice when the server has an xAI key, otherwise by the browser’s voice.'],
  ['Add alert', 'Click where a dog alerted, at the time on the time bar.'],
  ['Searched', 'Mark an area a team covered without an alert: a circle (choose the radius) or a polygon (click corners, then Finish), over a 30 to 120 minute window ending at the time bar.'],
  ['On-site wind', 'Enter the wind a team measured (direction it comes from, speed). It replaces the forecast for that hour in the fallback model.'],
  ['Move focus', 'Live mode: drag the 3 km square elsewhere in the 12 km area, then Compute detail.'],
  ['Layers', 'Turn individual map layers on and off.'],
];

const KEYS: [string, string][] = [
  ['1 to 7', 'Demo steps (camera and layers)'],
  ['Space', 'Play or pause the time bar'],
  ['M', 'Switch between map and 3D scene view'],
  ['D', 'Debug readout: frame rate, particles, wind source, background work'],
  ['Enter', 'Finish a searched polygon'],
  ['Esc', 'Cancel the current tool'],
];

export function Guide() {
  return (
    <SitePage>
      <article className="prose-site mx-auto max-w-4xl px-4 py-12 md:px-6">
        <p className="eyebrow !mb-1">Guide</p>
        <h1 className="font-display text-5xl font-bold leading-none text-ink">Using Scentline</h1>
        <p className="mt-5 max-w-prose !text-lg">
          The fastest way to learn it is the demo. <Link to="/planner?demo">Open it</Link> and press the keys 1 to 7 in order, or follow along below.
        </p>

        <h2>The demo, step by step</h2>
        <div className="not-prose space-y-10">
          {WALK.map((w) => (
            <div key={w.key} className="grid items-start gap-5 md:grid-cols-[1fr_1.3fr]">
              <div>
                <div className="flex items-center gap-2">
                  <kbd className="num inline-flex h-7 w-7 items-center justify-center rounded border border-ink bg-card text-sm font-medium">{w.key}</kbd>
                  <h3 className="!m-0 font-display text-2xl font-bold">{w.title}</h3>
                </div>
                <p className="mt-2 font-serif text-[16px] leading-relaxed text-ink-2">{w.text}</p>
              </div>
              <Figure src={img(w.image)} alt={w.title} />
            </div>
          ))}
        </div>

        <h2>Kinds of search</h2>
        <p>
          The menu at the top of the planner switches between three modes. <strong>Missing person</strong> is the live search. <strong>Training problem</strong> lets you place
          hides and see where their scent goes before the session, hour by hour, with start points for the dog. <strong>Recovery</strong> sets the model up for human-remains dogs:
          longer-lasting scent that pools in low ground. The first section of the left panel changes with the mode, and the Notes tab explains each one and its limits. All three
          work in the Catskills demo.
        </p>

        <h2>The planner screen</h2>
        <p>
          The left panel holds the planning controls in the order you use them. The map is in the middle; drag to rotate, right-drag to pan, scroll to zoom. The time bar along the bottom
          runs over the modelled hours. The right panel has the deployment plan, the legend and the model assumptions. On a phone, the panels open from the buttons at the top.
        </p>
        <table>
          <thead>
            <tr>
              <th>Control</th>
              <th>What it does</th>
            </tr>
          </thead>
          <tbody>
            {CONTROLS.map(([k, v]) => (
              <tr key={k}>
                <td className="whitespace-nowrap font-medium">{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Keyboard</h3>
        <table>
          <tbody>
            {KEYS.map(([k, v]) => (
              <tr key={k}>
                <td className="whitespace-nowrap">
                  <kbd className="num rounded border border-rule bg-card px-1.5 py-0.5 text-xs">{k}</kbd>
                </td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Planning your own area</h2>
        <p>
          On <Link to="/new">Plan a search</Link>, find the last known point (search for a trailhead or campground, type coordinates, use your location, or click the map), choose the time
          window and the subject, and open the planner. The server downloads terrain, land cover, trails and weather for the area and runs WindNinja for each hour; a new area takes about a
          minute, and the same area again is instant.
        </p>
        <Figure src={img('new-search.jpg')} alt="The Plan a search page with a point chosen on the map" caption="Choosing the last known point. The dashed square is the 12 km modelled area; the orange square is the 3 km focus." />

        <h2 id="server">Running the server</h2>
        <p>This public site has no server behind it, so it can only show the demo by itself. To plan real areas, run the server on your own computer with Docker (this needs access to the private repository):</p>
        <pre>{`git clone https://github.com/Chr1spu/scentline.git
cd scentline
docker compose up --build`}</pre>
        <p>
          The first build compiles WindNinja and takes a few minutes. Then, on <Link to="/new">Plan a search</Link>, enter <code>http://localhost:8000</code> as the server address and press
          Save and check. The address is remembered in this browser. You can also run the whole site locally (<code>cd frontend && npm install && npm run dev</code>, then open{' '}
          <code>http://localhost:5180</code>).
        </p>
        <h3>If something goes wrong</h3>
        <ul>
          <li>
            <strong>&quot;No server reachable&quot;:</strong> check that the container is running (<code>docker compose ps</code>) and that the address includes <code>http://</code> and the
            port.
          </li>
          <li>
            <strong>Fallback wind badge:</strong> WindNinja could not run or download the forecast; the simpler slope-wind model is used instead and labelled.
          </li>
          <li>
            <strong>Outside the US:</strong> terrain is the 30 m Copernicus surface model (it includes tree height), so the 10 m focus square is smoother.
          </li>
        </ul>
      </article>
    </SitePage>
  );
}
