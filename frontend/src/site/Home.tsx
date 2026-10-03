import { Link } from '../router';
import { MISSIONS, MISSION_ORDER } from '../config/missions';
import { IdeaDiagram } from './Diagrams';
import { Figure, SitePage, img } from './SiteLayout';

const STEPS = [
  {
    n: '01',
    title: 'Probability from the last known point',
    body: 'Pick a subject profile (young child, older child, hiker, person with dementia). Distances follow lost-person statistics, adjusted for trails, streams, water, cliffs and slope. You can paint local knowledge on top.',
    image: 'step-probability.jpg',
  },
  {
    n: '02',
    title: 'Wind over the real terrain',
    body: 'The US Forest Service WindNinja model takes the weather forecast (NOAA HRRR when it is available) and works out the wind hour by hour across the ridges and valleys of the search area.',
    image: 'step-wind.jpg',
  },
  {
    n: '03',
    title: 'Scent at dog-nose height',
    body: 'Scent is released from every likely location and carried by the wind 0.6 m above the ground. It spreads, pools in calm hollows, fades in heat and sun, and lifts off sun-warmed slopes. Drag the clock and watch it drain into the drainages at dusk.',
    image: 'step-scent.jpg',
  },
  {
    n: '04',
    title: 'Where to put the teams, and when',
    body: 'Teams are placed downwind of the most likely ground, on slopes they can work, 300 m apart, each with an upwind heading and its best hour. When a dog alerts, the scent is traced backwards and the map updates.',
    image: 'step-deploy.jpg',
  },
];

export function Home() {
  return (
    <SitePage>
      <section className="border-b border-rule">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 md:grid-cols-[1fr_1.25fr] md:px-6 md:py-20">
          <div>
            <p className="eyebrow">Air-scent dog deployment planner</p>
            <h1 className="mt-3 font-display text-5xl font-bold leading-[0.95] tracking-tight text-ink md:text-6xl">Send the dogs where the scent is.</h1>
            <p className="mt-5 max-w-md font-serif text-lg leading-relaxed text-ink-2">
              Scent Cone models how wind carries a missing person&apos;s scent across real terrain, then suggests where air-scent dog teams should start and at what hour.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/new" className="btn btn-primary px-5 py-2.5 text-base">
                Plan a search
              </Link>
              <Link to="/planner?demo" className="btn px-5 py-2.5 text-base">
                Open the demo
              </Link>
            </div>
            <p className="mt-4 text-sm text-ink-3">The demo runs entirely in your browser. Planning your own area needs the Scent Cone server.</p>
          </div>
          <Figure
            src={img('hero.jpg')}
            alt="The planner showing a scent heatmap draining down a valley at dusk, with three dog teams placed"
            caption="Demo scenario: a 9-year-old missing from Devil's Tombstone Campground in the Catskills at 4 PM. Scent at 7 PM and three recommended teams."
          />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 md:px-6">
        <div className="max-w-2xl">
          <p className="eyebrow">The idea</p>
          <h2 className="mt-2 font-display text-4xl font-bold text-ink">A dog finds the scent, not the person.</h2>
          <p className="mt-4 font-serif text-lg leading-relaxed text-ink-2">
            Search planners usually map where someone is likely to be. An air-scent dog works the air downwind of that spot, and the air moves with the terrain and the time of day. Scent Cone turns the first map into the second.
          </p>
        </div>
        <div className="mt-10">
          <IdeaDiagram />
        </div>
      </section>

      <section className="border-y border-rule bg-paper-2">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-6">
          <p className="eyebrow">What it does</p>
          <h2 className="mt-2 font-display text-4xl font-bold text-ink">Four layers, one plan.</h2>
          <div className="mt-10 space-y-14">
            {STEPS.map((s, i) => (
              <div key={s.n} className={`grid items-center gap-8 md:grid-cols-2 ${i % 2 ? 'md:[&>*:first-child]:order-2' : ''}`}>
                <div>
                  <div className="num text-sm text-sar-dark">{s.n}</div>
                  <h3 className="mt-1 font-display text-3xl font-bold leading-tight text-ink">{s.title}</h3>
                  <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-2">{s.body}</p>
                </div>
                <Figure src={img(s.image)} alt={s.title} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-16 md:px-6">
        <p className="eyebrow">Beyond lost hikers</p>
        <h2 className="mt-2 font-display text-4xl font-bold text-ink">Eight kinds of dog search.</h2>
        <p className="mt-3 max-w-2xl font-serif text-[17px] leading-relaxed text-ink-2">
          The same wind and scent engine plans any search where a dog works the air. Each kind changes where the target can be, how its scent behaves, and where teams can stand.
        </p>
        <div className="mt-8 grid gap-px overflow-hidden rounded border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
          {MISSION_ORDER.map((m, i) => (
            <Link key={m} to={`/planner?demo&mission=${m}`} className="group bg-paper p-4 text-ink no-underline hover:bg-white hover:text-ink">
              <div className="num text-xs text-sar-dark">{String(i + 1).padStart(2, '0')}</div>
              <div className="mt-1 font-display text-xl font-bold leading-tight">{MISSIONS[m].label}</div>
              <p className="mt-1 text-[14px] leading-snug text-ink-2">{MISSIONS[m].short}</p>
              <span className="mt-2 inline-block text-[13px] text-sar-dark underline-offset-2 group-hover:underline">Try it in the demo</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 md:px-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded border border-rule bg-white/60 p-6">
            <p className="eyebrow">No setup</p>
            <h3 className="mt-1 font-display text-2xl font-bold">The Catskills demo</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
              Real terrain, land cover, trails and WindNinja winds for one September evening, bundled with the site. Works offline. Seven keyboard steps walk through the whole scenario.
            </p>
            <Link to="/planner?demo" className="btn mt-4">
              Open the demo
            </Link>
          </div>
          <div className="rounded border border-ink bg-ink-900 p-6 text-paper">
            <p className="eyebrow !text-paper/60">Your own area</p>
            <h3 className="mt-1 font-display text-2xl font-bold">Plan a search anywhere</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-paper/80">
              Choose the last known point on a map, the date and time (or right now), and the subject. The server downloads terrain and weather and runs WindNinja, about a minute for a new area.
            </p>
            <Link to="/new" className="btn btn-primary mt-4">
              Plan a search
            </Link>
          </div>
        </div>
        <p className="mt-8 max-w-3xl text-sm leading-relaxed text-ink-3">
          Scent Cone is a research prototype. Its scent physics are simplified, tunable rules of thumb, documented on <Link to="/how-it-works">How it works</Link>. Use it to support a
          discussion with experienced K9 handlers, not to replace one.
        </p>
      </section>
    </SitePage>
  );
}
