import { DETECTION, DISPERSION, ENSEMBLE, HOTSPOTS, NOSE, PROBABILITY, PROFILES, SCENT, SEARCH, SEGMENTS, TERRAIN, TRIANGULATION, TURBULENCE, WIND_CONFIDENCE, type ProfileId } from '../config/modelParams';
import { MISSIONS, visibleMissions, type SourceKind } from '../config/missions';
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
  ['missions', 'Kinds of search'],
  ['limits', 'Limitations'],
] as const;

const pct = (x: number) => `${Math.round(x * 100)}%`;

const SOURCE_TEXT: Record<SourceKind, string> = {
  lkp: 'distance from the last known point (profile)',
  hides: 'the hides you place',
  water: 'water near where they went in',
  habitat: 'habitat you choose',
  area: 'an area you draw',
};

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
            Each 30 m cell gets a weight from the straight-line distance <em>d</em> to the last known point, using a log-normal distribution fitted to published find distances: the
            median, and a spread from the quartiles (ln(Q75/Q25) / 1.349). Sources: Twardy, Koester &amp; Gatt (2006), <em>Missing Person Behaviour: An Australian Study</em> (children, hikers),
            and ISRID data for dementia (temperate flat terrain, 175 cases). The young-child median is the original estimate and has not been checked against a source. The density along
            the radius is divided by 2π<em>d</em> so it becomes a per-cell value.
          </p>
          <table>
            <thead>
              <tr>
                <th>Profile</th>
                <th>Median distance</th>
                <th>Spread (σ of ln d)</th>
                <th>Track offset</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(PROFILES) as ProfileId[]).map((id) => (
                <tr key={id}>
                  <td>{PROFILES[id].label}</td>
                  <td className="num">{(PROFILES[id].medianM / 1000).toFixed(1)} km</td>
                  <td className="num">{PROFILES[id].spread}</td>
                  <td className="num">{PROFILES[id].terrain ? `${PROFILES[id].terrain!.trackOffsetM} m` : `×(1 + ${PROFILES[id].featureA}·e^(−d/${PROFILES[id].featureL} m))`}</td>
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
              <strong>Terrain.</strong> Where real lost people were found (Jacobs 2015, about 2,200 ISRID find locations in the US): within the profile&apos;s track offset of a trail ×
              {TERRAIN.trail}, a road ×{TERRAIN.road}, a stream ×{TERRAIN.stream}, a lake shore ×{TERRAIN.lake}, where a trail meets a stream ×{TERRAIN.trailStream}; the lowest{' '}
              {pct(1 - TERRAIN.lowPct)} of the ground (valley bottoms) ×{TERRAIN.low} and the highest ×{TERRAIN.high}. Where several apply, the largest counts. Slope is neutral: the same
              data shows no fewer finds on steep ground.
            </li>
            <li>
              <strong>Heading when last seen</strong> (optional). Three in four lost people are found within 66° of the direction they set off in (ISRID, children and people with
              dementia): the weight is {DISPERSION.cdf[1][1] * 100}% within {DISPERSION.cdf[1][0]}°, {DISPERSION.cdf[2][1] * 100}% within {DISPERSION.cdf[2][0]}° and{' '}
              {DISPERSION.cdf[3][1] * 100}% within {DISPERSION.cdf[3][0]}°, fading in over the first {DISPERSION.fadeM} m.
            </li>
            <li>
              <strong>Time since missing.</strong> The distances above describe where people are eventually found. Early on, nobody can be that far, so the weight falls off softly
              beyond a generous top speed × the time since they went missing (child 1–6: {PROFILES.child16.maxSpeedKmh} km/h, child 7–12 and dementia: {PROFILES.child712.maxSpeedKmh} km/h,
              hiker: {PROFILES.hiker.maxSpeedKmh} km/h; at least {PROBABILITY.travelMinH * 60} minutes). Dragging the time bar early in an incident shows the area growing.
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
              meanders with gusts that sway the wind direction: a random sideways velocity with a spread of a·U that is remembered for about{' '}
              {TURBULENCE.lagrangianS / 60} minutes, plus a little small-scale mixing (K = {SCENT.turbK0} m²/s). The coefficient a comes from the
              Pasquill stability class (sun height, cloud cover and wind) and is set so plume widths match the standard Briggs curves: from{' '}
              {TURBULENCE.briggsA.F} on a calm, clear night (a narrow plume that follows drainages) to {TURBULENCE.briggsA.A} on a sunny afternoon (a wide,
              wandering one). The back-trace uses the same model;
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
            {ENSEMBLE.scaleMin}–{ENSEMBLE.scaleMax}, because forecast wind is never exact. When the forecast direction looks unreliable (below) and no wind has been measured, the turn
            widens to ±{ENSEMBLE.rotDegUncertain}°. Recent scent counts more (half-weight after {SCENT.accumHalfLifeS / 60} minutes).
          </p>
          <p>
            <strong>Wind confidence.</strong> The planner rates the forecast direction around the last known point: unreliable when the wind is under {WIND_CONFIDENCE.poorSpeed} m/s,
            when WindNinja and the simple slope model differ by {WIND_CONFIDENCE.poorDisagreeDeg}° or more, or when the wind turns {WIND_CONFIDENCE.poorTurnDeg}° or more within an hour
            either side (the evening switch to downslope flow); uncertain from {WIND_CONFIDENCE.fairSpeed} m/s, {WIND_CONFIDENCE.fairDisagreeDeg}° and {WIND_CONFIDENCE.fairTurnDeg}°.
            Simulated tests show scent-based placement loses its edge once the real wind is 20–30° off the forecast, so this rating decides how the plan hedges.
          </p>
          <Figure src={img('step-scent.jpg')} alt="Scent heatmap at 7 PM draining down the valley" caption="7 PM in the demo: cooling air drains scent down the notch toward the south-west." />

          <h2 id="detect">4. Detectability</h2>
          <p>
            Detection is worked out per possible location, as if the person were there: the scent that one spot alone sends to a team position, compared with a reference plume. The
            reference is one person upwind in a steady {DETECTION.refWind} m/s neutral wind, simulated the same way; the dog detects them half the time {DETECTION.d50M} m straight
            downwind, 90% of the time at half that distance and 10% at twice it. That distance is a heuristic default and the one number to tune from a dog&apos;s training record (see
            the field trials). Because detection is absolute, a hot, sunny afternoon really does lower it.
          </p>
          <p>
            Scent is tracked in 50 m blocks, but a plume a few hundred metres from a person is often only tens of metres wide. A dog crossing the block meets the plume&apos;s peak, not the
            block average, so each block total is converted to a peak using the plume width for that distance and stability class (the same Briggs curves the turbulence follows).
            Contributions are counted per release of scent, so a person&apos;s plume has the same strength wherever they are on the map. Close-range detection ({HOTSPOTS.nearDet} within{' '}
            {HOTSPOTS.nearRadiusM} m) is sized so that, with the {DETECTION.d50M} m range, a team passing a person has an effective sweep width of about 94 m in reference conditions:
            the field-measured value for air-scent dog teams is 95 m (Chiacchia et al. 2015).
          </p>
          <p>
            The heatmap shows all the scent together, weighted by probability. The time bar compares it with a neutral-conditions reference run ({pct(HOTSPOTS.detLoPct)}–
            {pct(HOTSPOTS.detHiPct)} percentile thresholds), which is what the scent-quality label and the searched-area recheck flag use.
          </p>

          <h2 id="deploy">5. Deploying teams</h2>
          <p>
            <strong>Segments (the default).</strong> Dog teams are normally given a search segment, not a point: an area one team can cover in a few hours, with edges a team can
            recognise on the ground, and the handler picks the pattern inside after checking the wind at the edge. Scentline cuts the focus square into segments of about{' '}
            {Math.round(SEGMENTS.targetM2 / 4046.86)} acres (about {(SEGMENTS.targetM2 / SEGMENTS.teamRateM2PerH).toFixed(1)} team-hours at {(SEGMENTS.teamRateM2PerH / 1e6).toFixed(2)}{' '}
            km² an hour, the pace of NASAR area-search tests) whose edges follow trails, roads, streams and ridgelines, named like ICS assignments (A1, A2, … from the north). For a
            dog team at the planned time, each segment gets:
          </p>
          <ul>
            <li>
              <strong>POA</strong>, the share of the probability inside it;
            </li>
            <li>
              <strong>POD</strong> for a person in it: 1 − e<sup>−coverage</sup>, the search-theory form, with coverage scaled by how much scent is about compared with neutral conditions.
              It averages {pct(HOTSPOTS.dogPOD * (1 - Math.exp(-SEGMENTS.coverageRef)))} in neutral conditions, the working average NASAR uses for a dog team;
            </li>
            <li>
              <strong>Finds</strong>, what one team would find: POA × POD, plus people outside whose scent drifts in (single-person detection, as above);
            </li>
            <li>the entry point on its downwind edge, the heading into the wind, the hours one team needs and its best hour.</li>
          </ul>
          <p>
            Teams are given the segments that add the most finds, each discounting what the earlier teams cover. The segment table in the Plan tab lists every segment this way, with
            the cumulative POD from searches already logged, and flags a segment searched in the last {SEGMENTS.clearAirMin} minutes: a dog needs the air clear of other searchers
            first.
          </p>
          <p>
            <strong>Start points</strong> (the other option, for hasty searches) work as follows.
          </p>
          <p>
            While the scent runs, the model records which source areas (100 m blocks) send scent to which possible team positions (50 m blocks). Each candidate start gets a route: about{' '}
            {HOTSPOTS.routeM} m upwind, following the modelled wind as it bends (dogs work into the wind), stopping at water, cliffs or calm air. The team covers each possible location
            with the best detection anywhere along that route, and also the ground within {HOTSPOTS.nearRadiusM} m of it at a detectability of {HOTSPOTS.nearDet} (a dog finds a person
            it passes close to). A start scores the probability it covers. Teams are then placed greedily:
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
            <strong>The hedge.</strong> When the forecast direction is not rated reliable and no wind has been measured, with {HOTSPOTS.hedgeMinTeams} or more teams the last one goes on
            the most likely ground by close range alone, ignoring what the scent teams are thought to cover, and the plan uses the wider ±{ENSEMBLE.rotDegUncertain}° spread. In
            simulated tests that combination gives up about 4 points of coverage when the forecast is exact, but gains 4–6 points when the wind is 30–45° off, the best average over
            the error range. With a reliable or measured wind, every team is placed by scent.
          </p>
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
            <strong>Searched with no alert.</strong> For a circle, polygon, segment or imported GPS track (a corridor {HOTSPOTS.nearRadiusM} m either side) searched over a window,
            each source area&apos;s probability is multiplied by 1 − POD. Inside the area, POD is the search-theory value for those scent conditions. Outside it, POD comes from scent
            that should have drifted to the team, counted at only {pct(SEARCH.driftCredit)}: that inference depends on the modelled wind, and wrongly clearing ground is the costly
            mistake. Areas searched while detectability was under{' '}
            {SEARCH.recheckDet} are flagged for a recheck.
          </p>

          <h2 id="missions">Kinds of search</h2>
          <p>
            Three modes run the same wind and scent model: a live search for a missing person, planning a training problem, and recovery with human-remains dogs. What changes is
            where the target can be, how long its scent lasts, how easily it lifts away, how likely a dog is to detect it, and where teams can stand. The engine can also be set up for
            water, conservation, evidence, disaster and lost-pet searches; those are experimental and not shown.
          </p>
          <table>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Where the target can be</th>
                <th>Scent lasts</th>
                <th>Lofting</th>
                <th>Dog POD</th>
                <th>Team spacing</th>
              </tr>
            </thead>
            <tbody>
              {visibleMissions().map((m) => {
                const x = MISSIONS[m];
                return (
                  <tr key={m}>
                    <td className="font-medium">{x.label}</td>
                    <td>{SOURCE_TEXT[x.source]}{x.tuning.lowGroundBias ? ', favouring low ground' : ''}</td>
                    <td className="num">×{x.tuning.tauScale}</td>
                    <td className="num">×{x.tuning.liftScale}</td>
                    <td className="num">{pct(x.tuning.pod)}</td>
                    <td className="num">
                      {x.tuning.spacingM} m{x.tuning.deploy === 'waterAndShore' ? ', boats and shore' : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ul>
            {visibleMissions().map((m) => (
              <li key={m}>
                <strong>{MISSIONS[m].label}:</strong> {MISSIONS[m].caveat}
              </li>
            ))}
          </ul>

          <h2 id="limits">Limitations</h2>
          <ul>
            <li>None of the scent rules have been validated against dog trials. They are meant to be reasonable, visible and adjustable.</li>
            <li>Distance statistics for children 7–12 and for people with dementia in wilderness are placeholders.</li>
            <li>WindNinja started from one area-wide value per hour cannot see local weather such as a thunderstorm outflow.</li>
            <li>Scent is modelled in 2D at one height. Real plumes meander, lift and pool in three dimensions.</li>
            <li>A modelled window covers 8 hours from its start hour (it may run past midnight).</li>
          </ul>
          <p>
            Every parameter above lives in one config file. Data sources and credits are on the <Link to="/about">Project</Link> page.
          </p>
        </article>
      </div>
    </SitePage>
  );
}
