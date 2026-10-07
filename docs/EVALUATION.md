# Evaluating Scentline

This page covers how far the model has been checked, what the checks found, and what they can't tell us. Short version: the physics now matches standard plume-spread curves. In simulation, scent-aware placement covers about 1.3 to 2 times more probability than placing teams without wind, as long as the forecast wind direction is within about 15–20°. It has **not** been checked against real dogs, which is the next step.

Run it yourself:

```
cd frontend
npx vitest run                          # unit and physics tests
npx vite-node scripts/evaluate.ts       # full evaluation (~45 s); --quick for a short run
```

Results go to `frontend/scripts/evaluation-results.json`.

## 1. Physics checks (`src/models/physics.test.ts`)

| Check | Method | Result |
| --- | --- | --- |
| Plume width by stability | Release from a point in uniform wind, measure the crosswind spread at 200, 500 and 1000 m, and compare with Briggs open-country σy for the Pasquill class from the sun, cloud and wind (Turner's method) | Within ±25% for a class F night and a class B afternoon; the daytime plume is more than 2.5× wider |
| Stability class table | Known sun, cloud and wind cases | Matches the Turner table |
| Still air | No wind | Spreads evenly, with no drift beyond 3 m |
| Rotation | Rotate the wind 90° | The plume rotates with it |
| Profile distances | Distance prior on a fine grid | Half the probability lies within each profile's median distance |
| Placement | One source with a steady wind | The first team lands downwind of it |
| Back-trace | Alert downwind of a source | The zone runs upwind along the wind axis, never downwind |
| Grid references | UTM and USNG against PROJ and an independent MGRS library | Under 1 cm; strings match exactly |

**The change this produced:** the old turbulence was a plain random walk (K = 0.5 + 0.3·U m²/s). It spread plumes far less than real air does, and the same at noon as at midnight. It is now a wind-meander model (Ornstein–Uhlenbeck, σv = a·U, Lagrangian time 600 s). The coefficient `a` is taken from the Briggs curves for the current stability class, so a calm clear night gives a narrow plume that follows the drainage, and a sunny afternoon gives a wide one. The back-trace uses the same model.

## 2. Does the plan beat simpler plans? (`scripts/evaluate.ts`)

**Setup:** the demo area at 19:00, with three teams and the "child 7–12" profile.

- The planner works from the forecast wind.
- Each "true world" rotates the wind by an error angle (±), with a different random seed. Eight worlds are run per error angle.
- A plan's **success** = Σ over source cells of P(person there) × P(a team detects them). Detection is 0.7 times the detectability of the scent that actually reaches each team in the true world, combined across teams.
- The figures are percentages of the total probability: a mean ± the standard deviation across worlds.

| Plan | 0° error | 15° | 30° | 45° | 90° |
| --- | --- | --- | --- | --- | --- |
| **Scentline** | **17.1 ± 1.2** | **15.6 ± 2.4** | 10.6 ± 1.3 | 10.6 ± 0.6 | 4.8 ± 3.0 |
| Most-likely ground (no scent) | 13.0 ± 1.5 | 10.6 ± 3.5 | 12.5 ± 2.8 | 11.1 ± 2.8 | 6.1 ± 1.8 |
| Ring at 400 m around the LKP | 3.5 | 4.7 | 4.4 | 5.4 | 5.5 |
| Straight downwind of the LKP | 5.5 | 4.5 | 7.3 | 11.3 ± 6.3 | 7.4 |
| Random within 1.5 km (30 draws) | 1.9 | 1.9 | 2.1 | 2.1 | 1.9 |
| Oracle (knows the true wind) | 18.9 | 18.9 | 20.3 | 20.1 | 19.7 |

**Reading it:**
- With a good wind direction, Scentline gets about 90% of the way to the oracle. It beats every simple rule, and covers 1.3–1.5 times what the most-likely-ground plan covers.
- Beyond about 20–30° of direction error, the advantage is gone. **Wind measured on site is the single most valuable input**, which is why the planner takes an on-site wind entry. The UI and the briefings say "confirm wind on site".
- 15–20% for three teams in one hour is low in absolute terms, but that is the right order for three teams in a 3 km square. The tool helps decide where to put limited dogs; it does not replace a full search.

**Planning ensemble width:** the planner averages 6 runs with the wind rotated ±20°. Wider spreads, meant to hedge against forecast error, made things worse on average (mean across error angles: ±20° 11.7%, ±35° 10.1%, ±50° 7.9%). Blurring the scent field spreads teams onto weaker spots. ±20° stays.

**Sensitivity** (forecast error 15°, base success 16.0%): each guessed parameter was halved or doubled, and the change in the plan recorded.

| Parameter changed | Start points move | Success |
| --- | --- | --- |
| Scent decay time 15 min / 60 min | 78 m / 44 m | 14.6% / 15.8% |
| Plume spread ×0.5 / ×2 | 104 m / 48 m | 16.2% / 16.3% |
| Turbulence memory 300 s / 1200 s | 107 m / 48 m | 14.4% / 16.3% |
| Dog detection 50% / 90% | 119 m / 22 m | 16.7% / 14.0% |
| Team spacing 150 m / 500 m | 0 m / 99 m | 16.0% / 16.2% |

No single guess moves a team more than about 120 m or changes success by more than about 2 points. The plan depends on the terrain and wind, not on any one tuned constant.

## 3. Coverage gaps found

**The focus square:** scent and placements are modelled only in the 3 km focus square. That square holds 69% of the probability in the demo. For the other profiles, this much of the lognormal distance distribution lies beyond 1.5 km (about the edge of the square):

| Profile | Beyond 1.5 km | Beyond 6 km | Beyond 8.5 km |
| --- | --- | --- | --- |
| Child 1–6 | 4% | 0% | 0% |
| Child 7–12 | 33% | 2% | 1% |
| Dementia | 37% | 3% | 1% |
| Hiker | **82%** | **20%** | 10% |

For a hiker, the focus square misses most of the search. And the 12 km area leaves out 10–20% that the map silently renormalizes away. **Now shown in the planner:**
- A caution when the focus square holds under half the probability.
- A note giving the profile's share that lies beyond the modelled area.

## 4. Limitations: what this evaluation can't show

- **Circularity:** the true worlds use the same particle physics as the planner, with only the wind changed. The evaluation tests robustness to wind error, not whether the physics is right. Only field data can show that.
- **No close-range or ground-scent detection:** a dog only "detects" scent that has drifted to it. A team walking right past the person gets no credit. That is why a hedged plan (two teams by scent and one on the most-likely ground) scored the same as Scentline: the third team got zero credit.
- **Search effort is a single point and an hour:** sweep width, track spacing and how long the team works aren't modelled.
- **Distance priors:**
  - The child 7–12 and dementia (wilderness) medians are placeholders.
  - The Lost Person Behavior quartile distances by terrain and ecoregion should replace the single median and spread. They need the source tables; I haven't added numbers I can't cite.
- **Wind:** WindNinja hasn't been compared with station observations in the demo area.

## 5. Next steps, in order of value

1. **Field trial with a K9 unit:** use the Training mode (hides, alerts and no-alerts logged with the time and wind), then compare predicted and actual alert locations. This is the only test that breaks the circularity.
2. **Wind validation:** compare WindNinja and the fallback against RAWS / MesoWest stations near past incidents.
3. **Expert review** of the profiles and of the 0.7 dog detection probability by SAR K9 handlers and an incident planner.
4. **Model close-range detection** (an air-scent radius around each team's route), so plans that walk the most likely ground get proper credit.
5. **Search-theory effort allocation:** sectors, sweep width and the probability of success per hour.
6. **Auto-place the focus square** on the highest-probability 3 km block, or run several squares for wide-ranging profiles.
