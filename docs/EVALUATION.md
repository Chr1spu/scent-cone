# Evaluating Scentline

This page covers how far the model has been checked, what the checks found, and what they can't tell us. Short version: the physics now matches standard plume-spread curves. In simulation, scent-aware placement beats every simple placement rule when the forecast wind direction is within about 15–20°. A hedged plan (one team on the most likely ground until the wind is confirmed on site) costs little when the forecast is right and does better when it is wrong, so the planner now uses it. It has **not** been checked against real dogs, which is the next step.

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
- A plan's **success** = Σ over source cells of P(person there) × P(a team detects them). A team detects a person in two ways: through scent that actually reaches it in the true world (0.7 × detectability), and at close range, within 150 m of its start (0.7 × 0.6). Detection is combined across teams.
- The figures are percentages of the total probability: a mean ± the standard deviation across worlds.

| Plan | 0° error | 15° | 30° | 45° | 90° | Mean |
| --- | --- | --- | --- | --- | --- | --- |
| Scentline, all 3 teams by scent | **20.0 ± 0.9** | **18.6 ± 2.9** | 13.7 ± 1.8 | 12.6 ± 0.6 | 8.0 ± 2.3 | 14.6 |
| **Scentline, hedged** (2 by scent + 1 on likely ground) | 18.4 ± 1.0 | 18.4 ± 1.1 | **16.1 ± 1.2** | **15.6 ± 2.2** | 9.3 ± 1.0 | **15.6** |
| Naive hedge (2 by scent + the single most likely cell) | 18.3 ± 0.8 | 18.1 ± 1.0 | 15.6 ± 1.2 | 15.2 ± 2.7 | 9.5 ± 1.5 | 15.3 |
| Most-likely ground (no scent) | 16.2 ± 1.0 | 14.1 ± 2.8 | 15.4 ± 2.2 | 14.9 ± 2.3 | 10.0 ± 1.4 | 14.1 |
| Ring at 400 m around the LKP | 6.6 | 7.7 | 7.2 | 8.1 | 8.0 | 7.5 |
| Straight downwind of the LKP | 9.2 | 8.4 | 10.7 | 13.7 ± 5.3 | 9.9 | 10.4 |
| Random within 1.5 km (30 draws) | 3.1 | 3.1 | 3.4 | 3.3 | 3.1 | 3.2 |
| Oracle (knows the true wind) | 21.0 | 21.1 | 21.8 | 21.7 | 20.6 | 21.2 |

**Reading it:**
- With a good wind direction, all-scent placement gets to about 95% of the oracle and beats every simple rule.
- **Beyond about 20–30° of direction error, its advantage is gone.** Measured on-site wind is the most valuable single input.
- **The hedge is the better default.** One team covers the most likely ground (by close range, spaced from the others) and two go by scent. It gives up 1.6 points when the forecast is perfect and nothing measurable at 15°, and gains 2.4–3 points at 30–45°. The planner uses it automatically with three or more teams until a measured wind is entered (section 5); then every team is placed by scent. The hedge team's card is marked "most likely ground".
- **The hedge must ignore what the scent teams supposedly cover.** A first version discounted ground the scent teams "covered" in the forecast world. That pushed the ground team away from the LKP and scored worse (17.4% at 0°, 14.0% at 45°), because when the wind is wrong that coverage is exactly what fails.
- The scores are low in absolute terms: about 20% for three teams in one hour. That is the right order for three teams in a 3 km square. The tool helps decide where to put limited dogs; it does not replace a full search.
- **History:** before close-range detection was modelled, a dog only "detected" scent that drifted to it. The hedge team then got no credit, and the hedge looked useless (section 4 of the first version of this page). Adding close range changed that conclusion. **The structure of the detection model matters more than any tuned constant.**

**Planning ensemble width:** the planner averages 6 runs with the wind rotated ±20°. Wider spreads, meant to hedge against forecast error, made things worse on average (mean across error angles: ±20° 14.6%, ±35° 12.4%, ±50° 10.2%). Blurring the scent field spreads teams onto weaker spots. A team on the likely ground is a much better hedge than a blurrier scent forecast. ±20° stays.

**Sensitivity** (forecast error 15°, all teams by scent, base success 18.5%): each guessed parameter was halved or doubled, and the change in the plan recorded.

| Parameter changed | Start points move | Success |
| --- | --- | --- |
| Scent decay time 15 min / 60 min | 66 m / 74 m | 17.0% / 18.5% |
| Plume spread ×0.5 / ×2 | 86 m / 68 m | 18.7% / 17.8% |
| Turbulence memory 300 s / 1200 s | 93 m / 71 m | 17.1% / 19.0% |
| Dog detection 50% / 90% | 123 m / 22 m | 18.6% / 16.6% |
| Close-range detectability 0.3 / 0.9 | 17 m / 0 m | 18.6% / 18.5% |
| Team spacing 150 m / 500 m | 14 m / 82 m | 18.6% / 18.9% |

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

## 3b. Time since missing

The profile distances (Lost Person Behavior style) describe where people are eventually **found**, often many hours in. Early on, nobody can be that far. The map now applies a soft limit at maximum straight-line speed × time since missing. The speeds are deliberately generous upper bounds: child 1–6 at 1.5 km/h, child 7–12 and dementia at 3 km/h, hiker at 4 km/h; elapsed time is floored at 15 minutes. For a 7–12-year-old 30 minutes after going missing, over 97% of the probability now lies within 2 km (the soft limit is centred on 1.5 km). Before, about 22% lay beyond 2 km. By about 3 hours, the limit no longer changes the map. Dragging the time bar early in an incident now shows the area growing. The speeds are heuristics and should be checked with the LPB data.

## 4. Limitations: what this evaluation can't show

- **Circularity:** the true worlds use the same particle physics as the planner, with only the wind changed. The evaluation tests robustness to wind error, not whether the physics is right. Only field data can show that.
- **Close range is a disc, not a route:** a team is credited with the ground within 150 m of its start. Its actual track, its sweep width and the time it spends aren't modelled. Ground scent and trailing dogs aren't modelled either.
- **Search effort is a single point and an hour:** sweep width, track spacing and how long the team works aren't modelled.
- **Distance priors:**
  - The child 7–12 and dementia (wilderness) medians are placeholders.
  - The Lost Person Behavior quartile distances by terrain and ecoregion should replace the single median and spread. They need the source tables; I haven't added numbers I can't cite.
- **Wind:** WindNinja hasn't been compared with station observations in the demo area.

## 5. Next steps, in order of value

1. **Field trial with a K9 unit:** use the Training mode (hides, alerts and no-alerts logged with the time and wind), then compare predicted and actual alert locations. This is the only test that breaks the circularity.
2. **Wind validation:** compare WindNinja and the fallback against RAWS / MesoWest stations near past incidents.
3. **Expert review** of the profiles and of the 0.7 dog detection probability by SAR K9 handlers and an incident planner.
4. **Model each team's route:** the upwind track, how far it gets in the time available, and close-range detection along it, instead of a 150 m disc at the start.
5. **Search-theory effort allocation:** sectors, sweep width and the probability of success per hour.
6. **Auto-place the focus square** on the highest-probability 3 km block, or run several squares for wide-ranging profiles.
