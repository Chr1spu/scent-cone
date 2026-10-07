# Evaluating Scentline

This page covers how far the model has been checked, what the checks found, and what they can't tell us.

Short version:
- The scent physics matches standard plume-spread curves.
- The person-location model now uses published lost-person statistics.
- In simulation, scent-aware placement covers about three times more probability than the best wind-blind plan when the forecast direction is right. Most of that edge is gone once the direction is 20–30° off.
- The planner therefore rates its confidence in the wind and hedges when that confidence is low.
- It has **not** been checked against real dogs. [FIELD_TRIALS.md](FIELD_TRIALS.md) gives the protocol and the planner has the tool to do it.

Run it yourself:

```
cd frontend
npx vitest run                          # unit, physics and model tests
npx vite-node scripts/evaluate.ts       # full evaluation (~1 min); --quick for a short run
```

Results go to `frontend/scripts/evaluation-results.json` and the log to `frontend/scripts/evaluation-log.txt`.

## 1. Physics and model checks (`src/models/*.test.ts`)

| Check | Method | Result |
| --- | --- | --- |
| Plume width by stability | Release from a point in uniform wind; measure the crosswind spread at 200, 500 and 1000 m; compare with Briggs open-country σy for the Pasquill class from sun, cloud and wind (Turner's method) | Within ±25% for a class F night and a class B afternoon; the daytime plume is more than 2.5× wider |
| Stability class table | Known sun, cloud and wind cases | Matches the Turner table |
| Still air / rotation | No wind; wind rotated 90° | Spreads evenly with no drift; the plume rotates with the wind |
| Profile distances | Distance prior on a large flat grid | The median share matches the log-normal (allowing for the tail the grid cuts off) |
| Detection calibration | Reference plume, one person upwind in a steady neutral 2 m/s wind | Detection 0.5 at 200 m, over 0.8 at 100 m, under 0.2 at 400 m |
| Team routes | Uniform wind; a wall of unusable ground; calm air | Routes run upwind for their length, stop at the wall, don't start in calm air |
| Terrain multipliers | Grid with a trail, stream and road | ×5 on the trail, ×3 on the road, ×7 where trail and stream cross, ~1 far from features |
| Heading when last seen | Probability with a heading given | 70–80% within 66° of the heading (ISRID: 75%) |
| Wind confidence | Steady, light, disagreeing and turning winds | Good, poor, poor, poor respectively |
| Placement | One source, steady wind | The first team lands downwind of it |
| Back-trace | Alert downwind of a source | The zone runs upwind along the wind axis |
| Field-trial scoring | GPX parsing, AUC, time zones | Matches hand-worked examples |
| Grid references | UTM and USNG against PROJ and an independent MGRS library | Under 1 cm; strings match exactly |

## 2. Does the plan beat simpler plans? (`scripts/evaluate.ts`)

**Setup:**
- The demo area at 19:00, with three teams and the "child 7–12" profile.
- The planner works from the forecast wind (WindNinja).
- Each "true world" rotates the wind by an error angle (random sign), scales its speed by 0.7–1.3, and re-runs the scent as a single realization with its own turbulence. There are 8 worlds per error angle.

**How a plan is scored in a true world:**
- Each team starts where the plan says and works about 600 m upwind in the **true** wind. A handler follows the wind they feel, not the forecast.
- It finds a person at each possible location with probability 0.7 × the best single-person detection along its route, or close-range detection within 150 m of it.
- Detection uses the physical (single-plume) calibration.
- **Success** = Σ P(person there) × P(at least one team finds them).
- Figures are the percentage of the probability inside the 3 km focus square: a mean ± the standard deviation across worlds.

| Plan | 0° error | 15° | 30° | 45° | 90° | Mean |
| --- | --- | --- | --- | --- | --- | --- |
| **Scentline, app rule** (this wind rates "fair": ±35° planning + 1 hedge team) | 35.8 ± 3.0 | 25.9 ± 9.8 | **17.7 ± 1.7** | 11.9 ± 0.5 | 9.1 | **20.1** |
| All teams by scent, ±20° planning | **39.5 ± 3.8** | 24.1 ± 1.3 | 12.1 | 8.7 | 7.6 | 18.4 |
| All teams by scent, ±35° planning | 37.7 ± 2.8 | **27.7 ± 8.0** | 13.6 ± 4.9 | 11.2 | 9.1 | 19.9 |
| 2 by scent + 1 hedge, ±20° planning | 35.1 ± 3.1 | 24.7 ± 1.2 | 14.2 ± 4.9 | 8.6 | 7.6 | 18.0 |
| All by scent, starts planned without routes | 38.4 ± 3.3 | 27.2 ± 1.9 | 12.7 | 10.1 | 9.1 | 19.5 |
| Most-likely ground (no scent) | 13.8 | 14.3 ± 1.2 | 17.3 ± 2.8 | **14.1 ± 2.9** | **10.8** | 14.1 |
| Straight downwind of the LKP | 9.6 | 8.9 | 10.7 ± 2.4 | 11.5 ± 3.4 | 10.8 ± 4.1 | 10.3 |
| Ring at 400 m around the LKP | 4.6 | 5.9 | 7.9 | 6.3 | 7.6 | 6.5 |
| Random within 1.5 km (30 draws) | 4.2 | 4.2 | 4.0 | 3.5 | 3.5 | 3.9 |
| Oracle (plans with the true wind) | 38.2 | 39.1 | 33.1 | 26.3 | 16.4 | 30.6 |

**Reading it:**
- **With the right wind direction, scent-based placement covers almost three times what the best wind-blind plan does** (39.5% vs 13.8%), and matches the oracle. The oracle scoring slightly lower at 0° is noise: it plans from a single noisy run.
- **The edge falls fast with direction error.** Real plumes at dusk are narrow (tens of metres wide at a few hundred metres), so a 15° error moves a plume about 130 m sideways at 500 m. At 30° and beyond, putting teams on the most likely ground does about as well or better. Measured wind matters more than anything else.
- **The app's rule does best on average.** It rates the wind (light, models disagreeing, or turning means not reliable). When the wind isn't reliable, it plans with a wider ±35° spread and puts one of three teams on the likely ground. It gives up about 4 points with a perfect forecast and gains 4–6 points at 30–45°. With a reliable or measured wind, it plans all teams by scent at ±20°.
- **Planning routes did not measurably help** compared with planning start points only and then walking upwind (19.5% vs 18.4% mean, within noise). Routes are still useful output: they show the team where the start leads. The ±9.8 standard deviation at 15° shows the all-or-nothing nature of narrow plumes: in some worlds a team sits in the plume, in others it misses.
- **The absolute percentages depend on the assumed dog range** (d50 = 200 m) and on 0.7 for acting on a detection. Neither is measured, so read the table for comparisons between plans, not as real-world find rates. Field trials set these numbers.

**Planning ensemble width** (all teams by scent): ±20° gives a mean of 18.4%, ±35° 19.9%, ±50° 19.7%. With absolute detection, a wider spread is a real hedge against direction error. (The earlier relative-detection model showed the opposite, an artifact of that model.)

**Sensitivity** (15° error, all by scent at ±20°, base 29.6%). Each assumption was changed, the plan rebuilt, and the result scored against the base truth:

| Assumption changed | Start points move | Success |
| --- | --- | --- |
| Scent decay time 15 / 60 min | 60 / 144 m | 28.2 / 27.0% |
| Plume spread ×0.5 / ×2 | 158 / 161 m | 26.5 / 26.6% |
| Turbulence memory 300 / 1200 s | 3 / 7 m | 29.5 / 29.5% |
| Acting on a detection 50% / 90% | 0 / 127 m | 29.6 / 28.4% |
| Dog range d50 120 / 320 m | 114 / 150 m | 28.5 / 27.7% |
| Route length 300 / 1000 m | 0 / 0 m | 29.6 / 29.6% |
| Close-range detectability 0.3 / 0.9 | 0 / 39 m | 29.6 / 28.0% |
| Team spacing 150 / 500 m | 31 / 168 m | 33.3 / 28.4% |

No single assumption moves a start more than about 170 m or costs more than about 3 points. Getting the plume width wrong (either way) costs the most, which is why it is calibrated to the Briggs curves. Tighter spacing (150 m) did better here; that is about how close teams can work without interfering, an operational call, and the default stays 300 m.

## 3. Where the person might be (probability map)

**Distances, now sourced.** Log-normals fitted to published quartiles; spread = ln(Q75/Q25) / 1.349.

| Profile | Source | 25 / 50 / 75 / 95% (km) | Median, spread |
| --- | --- | --- | --- |
| Child 7–12 | Twardy, Koester & Gatt 2006, *Missing Person Behaviour: An Australian Study*, Table 2.8 (all children, n = 34) | 0.6 / 1.1 / 2.0 / 5.0 | 1.1 km, 0.89 |
| Hiker | same, n = 72 (LPB temperate mountains median 3.1 km agrees) | 1.5 / 3.2 / 8.1 / 17.4 | 3.2 km, 1.25 |
| Dementia | ISRID, temperate flat, n = 175 (via NEWSAR SAR FTM Unit 3, 2020) | 0.32 / 0.97 / 2.4 / 12.7 | 0.97 km, 1.5 |
| Child 1–6 | original estimate, attributed to Lost Person Behavior, **not verified** | – | 0.3 km, 0.9 |

The hiker and dementia spreads are much wider than the earlier placeholders (0.8 and 0.9). For a hiker, about 27% of the distribution now lies beyond the 12 km map (it was 10–20%), and the planner says so.

**Terrain, now sourced.** Jacobs (2015), *Terrain Based Probability Models for SAR*, analysed about 2,200 ISRID find locations. Probability density relative to the area average, for uninjured subjects:

| Feature | Multiplier |
| --- | --- |
| Trails | ×5 |
| Roads | ×3 |
| Streams | ×2 |
| Lakes | ×2 |
| Where a trail meets a stream | ×7 |
| Low points | ×2 |
| High points | ×1.5 |

These replace the earlier invented "trail pull". They apply within each profile's ISRID track offset: half of hikers are found within 100 m of a linear feature, half of people with dementia within 15 m. The same study found **no lower density on steep ground** (higher, for off-trail rescues), so the slope penalty is gone for people. It remains for pets, where there is no data.

**Heading when last seen** (optional input). ISRID dispersion angles for children 1–6 and dementia: 50% are found within ~30° of the intended direction, 75% within 66°, 95% within ~140°.

**Time since missing.** The distances above describe where people are eventually found. Early on, the map is limited by a generous top speed × the elapsed time (child 1–6: 1.5 km/h; child 7–12 and dementia: 3 km/h; hiker: 4 km/h; at least 15 minutes). These speeds are judgement, not data.

**Coverage gaps.** The 3 km focus square holds 69–72% of the probability in the demo. The planner warns when it holds under half, and gives each profile's share beyond the modelled area.

## 4. Limitations: what this can't show

- **Circularity:** the true worlds use the same physics as the planner, with the wind changed. This tests robustness to wind error, not whether the physics is right. Only field data can, which is what the trial tool is for.
- **Dog range and acting on a detection** (d50 = 200 m, 0.7) are assumptions, and the absolute success figures scale with them.
- **Close range is a 150 m corridor along the route.** Sweep width, quartering pattern and time on task aren't modelled; neither are ground scent or trailing dogs.
- **Wind confidence thresholds** (1 and 2 m/s, 25/45° model disagreement, 30/60° turning) are reasoned, not fitted. WindNinja hasn't been compared with weather stations here.
- **Distance data:** the child figures cover all ages under 13 together, and the dementia figures are for flat terrain. ISRID has finer tables (by age band and terrain) in *Lost Person Behavior* (Koester 2008), which should replace these when available.
- **Injured vs uninjured:** the terrain multipliers are for uninjured subjects. Injured people are found even more often near trails (×7) and streams (×3.5).

## 5. Next steps, in order of value

1. **Field trials with a K9 unit** ([FIELD_TRIALS.md](FIELD_TRIALS.md)): 20–30 training runs scored with the planner's GPX import. They test the physics and set the dog's range.
2. **Wind validation:** compare WindNinja and the fallback against RAWS / MesoWest stations near past incidents, and fit the confidence thresholds to the real direction errors.
3. **Finer ISRID tables:** age bands, terrain types and the injured/uninjured split, from *Lost Person Behavior*.
4. **Expert review** of the hedge rule and defaults by K9 handlers and an incident planner.
5. **Search-theory effort allocation:** sectors, sweep width and probability of success per hour.
