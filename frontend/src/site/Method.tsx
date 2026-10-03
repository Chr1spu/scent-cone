import { ENSEMBLE, HOTSPOTS, NOSE, PROBABILITY, PROFILES, SCENT, SEARCH, TRIANGULATION, type ProfileId } from '../config/modelParams';
import { noseWindFactor, LC } from '../models/terrainInfo';
import { Link } from '../router';
import { PlumeDiagram, TriangulationDiagram, WindProfileDiagram } from './Diagrams';
import { Figure, SitePage, img } from './SiteLayout';

const TOC = [
  ['overview', 'Overview'],
  ['probability', '1. Where the person might be'],
  ['wind', '2. Wind'],
  ['scent', '3. Scent'],
  ['detect', '4. Detectability'],
  ['deploy', '5. Deploying teams'],
  ['update', '6. Alerts and searched areas'],
  ['limits', 'Limitations'],
] as const;

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function Method() {
  return (
    <SitePage>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[220px_1fr] md:px-6">
        <aside className="hidden md:block">
          <nav className="sticky top-20 text-sm" aria-label="On this page">
            <div className="eyebrow mb-2">On this page</div>
            <ul className="space-y-1.5 border-l border-rule pl-3">
              {TOC.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`} className="text-ink-2 no-underline hover:text-ink">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <article className="prose-site max-w-prose">
          <p className="eyebrow !mb-1">Method</p>
          <h1 className="font-display text-5xl font-bold leading-none text-ink">How it works</h1>
          <p className="mt-5 !text-lg">
            Six steps, each a deliberately simple model whose numbers are listed here and live in one config file. They are rules of thumb chosen to be plausible and easy to explain, not a
            validated simulation of scent.
          </p>

          <h2 id="overview">Overview</h2>
          <ol>
            <li>Build a probability map of where the person could be.</li>
            <li>Compute hourly wind across the terrain with WindNinja.</li>
            <li>Release scent from every likely location and let the wind carry it.</li>
            <li>Turn scent concentration into how detectable the person is at each spot.</li>
            <li>Choose team positions that cover the most probability.</li>
            <li>Update the probability when dogs alert or search without alerting.</li>
          </ol>
          <p>
            The area is a 12 km square at 30 m resolution around the last known point, with a 3 km focus square at 10 m where scent is modelled in detail. Everything runs in the browser, in
            background threads, except terrain downloads and WindNinja, which run on the server.
          </p>

          <h2 id="probability">1. Where the person might be</h2>
          <p>
            Each 30 m cell gets a weight from the straight-line distance <em>d</em> to the last known point, using a log-normal distribution fitted to the profile&apos;s median distance (from
            <em> Lost Person Behavior</em>, R. Koester). The density along the radius is divided by 2π<em>d</em> so it becomes a per-cell value.
          </p>
          <table>
            <thead>
              <tr>
                <th>Profile</th>
                <th>Median distance</th>
                <th>Spread (σ of ln d)</th>
                <th>Trail/stream pull</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(PROFILES) as ProfileId[]).map((id) => (
                <tr key={id}>
                  <td>{PROFILES[id].label}</td>
                  <td className="num">{(PROFILES[id].medianM / 1000).toFixed(1)} km</td>
                  <td className="num">{PROFILES[id].spread}</td>
                  <td className="num">×(1 + {PROFILES[id].featureA}·e^(−d/{PROFILES[id].featureL} m))</td>
                  <td>{PROFILES[id].note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>Then:</p>
          <ul>
            <li>
              <strong>Barriers.</strong> A least-cost path from the last known point treats water and cliffs as {PROBABILITY.barrierCost}× more costly to cross. Where the detour is much longer
              than the straight line (ratio above {PROBABILITY.barrierRatioHi}), the weight drops to ×{PROBABILITY.barrierFactor}. A small pond you can walk around barely matters; a river
              does.
            </li>
            <li>
              <strong>Slope.</strong> ×e^(−slope/{PROBABILITY.slopeScaleDeg}°). Steep ground is less likely.
            </li>
            <li>
              <strong>Water</strong> cells get zero. The map is normalised to sum to one.
            </li>
            <li>
              <strong>Local knowledge.</strong> A brush doubles or halves the probability within {PROBABILITY.brushRadiusM} m.
            </li>
          </ul>

          <h2 id="wind">2. Wind</h2>
          <p>
            Scent goes where the air goes, and in mountains the air follows the terrain: up sun-warmed slopes in the afternoon, down the drainages after sunset. The US Forest Service&apos;s
            <strong> WindNinja</strong> (built for wildfire) computes this. We run its mass-conserving solver with diurnal (slope-flow) effects, hourly, on a 60 m mesh, and resample its 2 m
            wind to the 10 m grid.
          </p>
          <ul>
            <li>
              <strong>Today and the next couple of days:</strong> WindNinja is started from NOAA&apos;s HRRR 3 km forecast, which it downloads itself.
            </li>
            <li>
              <strong>Other dates:</strong> it is started from Open-Meteo&apos;s hourly wind, temperature and cloud cover for the area (one value for the whole area per hour; WindNinja adds
              the terrain).
            </li>
            <li>
              <strong>Fallback</strong> (no WindNinja): forecast wind ×0.7 plus a slope wind of up to 2.5 m/s, downhill at night and uphill on sunny slopes by day.
            </li>
          </ul>
          <h3>From 2 m to nose height</h3>
          <p>
            Weather models report wind at 2 m or 10 m, but a dog air-scents with its nose about {NOSE.heightM} m up, where the wind is slower. Over open ground we scale the 2 m wind with the
            standard logarithmic wind profile (roughness length {NOSE.z0.open} m), which gives about {pct(noseWindFactor(LC.open))}. Under a forest canopy the air near the ground is much more
            sheltered; we use {pct(NOSE.forestFactor)}.
          </p>
          <WindProfileDiagram />
          <table className="!mt-4">
            <thead>
              <tr>
                <th>Land cover</th>
                <th>Wind at nose height vs 2 m</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Water', LC.water],
                ['Open, grass', LC.open],
                ['Wetland', LC.wetland],
                ['Shrub', LC.shrub],
                ['Developed', LC.developed],
                ['Forest (under canopy)', LC.forest],
              ].map(([label, k]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="num">{pct(noseWindFactor(k as number))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 id="scent">3. Scent</h2>
          <p>
            A missing person sheds scent continuously, so the model releases simulated scent particles continuously from every likely cell, in proportion to its probability. Each particle
            lives up to {SCENT.lifetimeS / 60} minutes and is then re-released, which keeps a steady plume.
          </p>
          <PlumeDiagram />
          <p className="!mt-4">Every {SCENT.dt} seconds of simulated time, each particle:</p>
          <ul>
            <li>moves with the nose-height wind;</li>
            <li>
              spreads randomly (turbulent diffusion K = {SCENT.turbK0} + {SCENT.turbKPerWind}·U m²/s);
            </li>
            <li>
              barely moves if the wind is under {SCENT.calmWind} m/s and it sits in a hollow (scent pools);
            </li>
            <li>
              fades with a time constant of {SCENT.baseTauS / 60} minutes, longer in humid and cool air, {pct(1 - SCENT.sunFactor)} shorter on sunlit ground when the sun is above{' '}
              {SCENT.sunHighElev}°;
            </li>
            <li>
              loses {SCENT.liftPerS * 100}% of its strength per second on sunlit slopes in light wind: warm air lifts scent above the dog.
            </li>
          </ul>
          <p>
            &quot;Sunlit&quot; means the slope faces the sun <em>and</em> no ridge blocks it, found by tracing a line toward the sun over the terrain. In a deep notch near sunset that
            matters.
          </p>
          <p>
            The heatmap is an average of {ENSEMBLE.members} runs over the last {ENSEMBLE.windowMin} minutes, each with the wind turned by up to ±{ENSEMBLE.rotDeg}° and scaled by{' '}
            {ENSEMBLE.scaleMin}–{ENSEMBLE.scaleMax}, because forecast wind is never exact. Recent scent counts more (half-weight after {SCENT.accumHalfLifeS / 60} minutes).
          </p>
          <Figure src={img('step-scent.jpg')} alt="Scent heatmap at 7 PM draining down the valley" caption="7 PM in the demo: cooling air drains scent down the notch toward the south-west." />

          <h2 id="detect">4. Detectability</h2>
          <p>
            Scent concentration is turned into detectability with a smooth step between two thresholds. The thresholds are absolute: they come from a reference run with the same wind but
            neutral scent conditions (no sun, no lofting, base decay), at its {pct(HOTSPOTS.detLoPct)} and {pct(HOTSPOTS.detHiPct)} percentiles. So a hot, sunny afternoon really does lower
            detectability, and the time bar shows how much scent is present compared with that reference (59% at 3 PM and 107% at 7 PM in the demo).
          </p>

          <h2 id="deploy">5. Deploying teams</h2>
          <p>
            While the scent runs, the model records which source areas (100 m blocks) send scent to which possible team positions (50 m blocks). A position scores the probability of all the
            sources whose scent reaches it, times its detectability. Teams are then placed greedily:
          </p>
          <ol>
            <li>
              Only reachable ground counts: slope up to {HOTSPOTS.maxSlopeDeg}°, not water, at least {HOTSPOTS.cliffBufferM} m from a cliff.
            </li>
            <li>Pick the best-scoring position.</li>
            <li>
              Assume the dog finds what it covers {pct(HOTSPOTS.dogPOD)} of the time and reduce those sources accordingly, so the next team covers new ground.
            </li>
            <li>
              Block positions within {HOTSPOTS.suppressRadiusM} m. Repeat for each team.
            </li>
          </ol>
          <p>
            Each team gets an upwind heading (dogs work into the wind toward the source) and its best hour, from hourly snapshots of the scent. Hotspots, the amber beacons, are simply the
            strongest scent; teams are where the plan says to go.
          </p>

          <h2 id="update">6. Alerts and searched areas</h2>
          <p>
            <strong>Alert.</strong> Where a dog alerts, {TRIANGULATION.particles.toLocaleString()} particles are traced backwards through the wind for {TRIANGULATION.backMinutes} minutes: the
            scent must have come from somewhere along that path. Each alert multiplies the probability by (ε + zone) with ε = {TRIANGULATION.eps}. Two alerts from different wind directions
            cross where the person is.
          </p>
          <TriangulationDiagram />
          <p className="!mt-4">
            <strong>Searched with no alert.</strong> For a circle or polygon searched over a chosen window, each source area&apos;s probability is multiplied by 1 − POD, where POD ={' '}
            {pct(HOTSPOTS.dogPOD)} × the share of that source&apos;s scent that reached the searched area above the first threshold. Areas searched while detectability was under{' '}
            {SEARCH.recheckDet} are flagged for a recheck.
          </p>

          <h2 id="limits">Limitations</h2>
          <ul>
            <li>None of the scent rules have been validated against dog trials. They are meant to be reasonable, visible and adjustable.</li>
            <li>Distance statistics for children 7–12 and for people with dementia in wilderness are placeholders.</li>
            <li>WindNinja started from one area-wide value per hour cannot see local weather such as a thunderstorm outflow.</li>
            <li>Scent is modelled in 2D at one height. Real plumes meander, lift and pool in three dimensions.</li>
            <li>A modelled window stays within one calendar day (start hour plus 8 hours).</li>
          </ul>
          <p>
            Source code and all parameters: <a href="https://github.com/Chr1spu/scent-cone">github.com/Chr1spu/scent-cone</a>. Data sources and credits are on the{' '}
            <Link to="/about">About</Link> page.
          </p>
        </article>
      </div>
    </SitePage>
  );
}
