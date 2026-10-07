# Evaluating Scentline

This page covers how far the model has been checked, what the checks found, and what they can't tell us.

Short version:
- The scent physics matches standard plume-spread curves.
- The person-location model now uses published lost-person statistics.
- Detection is calibrated so the model's sweep width matches the field-measured 95 m for air-scent dog teams. That check exposed and fixed two errors in how detection was computed.
- Teams are assigned to whole search segments by default, as real dog teams are. In simulation that is far more robust to wind error than points and routes. Using scent to choose and time segments adds about 4–8 points over choosing the most likely segments, unless the wind is badly wrong.
- The planner rates its confidence in the wind and hedges when that confidence is low.
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

## 2. Calibration against a field measurement, and two fixes it exposed

**Sweep width** (`scripts/sweepwidth.ts`). Effective sweep width (ESW) is ∫ P(detect | team passes at lateral range x) dx: roughly the strip a team effectively clears as it goes by. Four air-scent dog teams in field trials had a mean ESW of **95 m** (95% CI 44–145; Chiacchia, Houlahan & Hostetter 2015). The script walks a team past one person at every offset, at directions spread around the wind, in reference conditions, and integrates the model's detection (× 0.7).

Checking this found two real problems in how detection was computed:

1. **Block resolution.** Scent is tracked in 50 m blocks, but a plume a few hundred metres from a person is only tens of metres wide. So the block total hardly fell with distance: the reference plume was flat from 75 m to 325 m. That turned detection into a noisy on/off switch. Each block total is now converted to the peak a dog meets when it crosses the plume, using the Briggs plume width for that distance and stability class (`peakFactor`).
2. **Normalization.** Contributions were scaled per simulated particle. That made them depend on how long particles stay on the grid: the small calibration grid recycled particles quickly and read about 2× stronger. They are now scaled per release of scent (`normalizeContrib`), so a person's plume has the same strength wherever they are.

Results after the fixes (d50 = 200 m):

| Close-range setting | Model ESW |
| --- | --- |
| None (scent alone) | 78 m |
| 150 m at 0.6 (the previous default) | 147 m: above the measured range |
| **60 m at 0.6 (new default)** | **~94 m** |

The truth worlds in section 3 use the corrected detection, so the earlier route-plan numbers are superseded.

## 3. Does the plan beat simpler plans? (`scripts/evaluate.ts`)

**Setup:**
- The demo area at 19:00, with three teams and the "child 7–12" profile. This hour rates "fair" for wind confidence (1.6 m/s, models 17° apart).
- The planner works from the forecast wind. Each true world rotates it by the error angle (random sign), scales its speed by 0.7–1.3, and re-runs the scent as one realization. There are 8 worlds per angle.
- **Route plans:** each team works about 600 m upwind from its start in the true wind, with close range along the route.
- **Segment plans:** each team searches its whole segment. It finds people inside at the search-theory POD, and people outside through scent drifting in under the true wind.
- **Success** = Σ P(person there) × P(found), as a percentage of the probability in the focus square. Figures are means across worlds; ± is the standard deviation where it matters.

| Plan | 0° | 15° | 30° | 45° | 90° | Mean |
| --- | --- | --- | --- | --- | --- | --- |
| **Segments, app rule** (~2.3 h each) | **56.1 ± 2.0** | **54.8 ± 1.1** | **50.1 ± 1.7** | **45.4 ± 3.3** | 30.3 ± 1.8 | **47.3** |
| Segments, most likely 3 (no scent) | 48.1 | 47.9 | 43.5 | 41.7 | **35.0** | 43.2 |
| 1-hour segments, by scent | 47.5 ± 2.8 | 45.6 ± 1.3 | 40.1 ± 4.5 | 33.5 ± 7.0 | 21.5 ± 3.5 | 37.6 |
| 1-hour segments, most likely 3 | 40.5 | 40.4 | 38.8 | 36.4 | 27.6 | 36.7 |
| Routes, app rule (±35° + hedge) | 40.8 ± 2.7 | 28.0 ± 10.4 | 11.6 ± 2.8 | 8.7 | 5.8 | 19.0 |
| Routes, all by scent ±20° | 41.8 ± 3.5 | 28.7 ± 9.9 | 9.5 ± 4.2 | 6.4 | 3.6 | 18.0 |
| Routes, all by scent ±35° | 40.1 | 26.9 | 11.4 | 10.0 | 6.6 | 19.0 |
| Routes, 2 by scent + 1 hedge ±20° | 44.2 | 29.4 | 8.8 | 6.2 | 3.6 | 18.4 |
| Most-likely points (no scent) | 9.2 | 9.3 | 7.8 | 11.4 | 8.9 | 9.3 |
| Straight downwind of the LKP | 8.4 | 7.2 | 9.0 | 11.9 | 8.1 | 8.9 |
| Ring at 400 m around the LKP | 3.1 | 4.9 | 7.3 | 7.4 | 6.8 | 5.9 |
| Random within 1.5 km | 3.0 | 3.0 | 2.9 | 2.4 | 2.4 | 2.7 |
| Oracle route plan (true wind) | 40.8 | 42.3 | 37.4 | 30.2 | 15.9 | 33.3 |

**Reading it:**
- **Assigning whole segments, as real dog teams are tasked, is far more robust to wind error than points and routes.** A team that searches its segment finds people inside it whatever the wind. At 45° of error segments still cover 45% where route plans cover under 10%. Segments are also more effort (about 2.3 team-hours against 1). But even 1-hour segments, which match a route's effort, beat routes and hold up far better.
- **Scent's main value is in choosing and timing segments, not in finding a magic point.** Choosing segments with scent adds 6–8 points over choosing the most likely segments when the wind is within about 30°, and 4 points at 45°, but costs 5 points at 90°. On average it gains 4 points (47.3% vs 43.2%). Classic planning by POA is already a strong baseline; scent refines it. The per-segment entry edge, heading and best hour come on top and aren't scored here.
- **The app rule** (±35° spread and one hedge team when the wind isn't reliable) picked the same segments as all-by-scent here, D2, E3 and D3; the hedge team's choice, D3, is also a scent pick.
- **The scores scale with assumptions that aren't measured yet:** the 50% average segment POD in neutral conditions (NASAR's working figure), d50 = 200 m and 0.7 for acting on a detection. Read the table for comparisons between plans.

**Planning ensemble width** (route plans): ±20° gives a mean of 18.0%, ±35° 19.0%, ±50° 18.3%. With a wind that isn't reliable the planner uses ±35°.

**Sensitivity** (route plan, 15° error, ±20°, base 31.3%): changing any single assumption moves starts by at most about 170 m and success by at most 1 point.

| Assumption changed | Start points move | Success |
| --- | --- | --- |
| Scent decay time 15 / 60 min | 90 / 66 m | 31.6 / 30.2% |
| Plume spread ×0.5 / ×2 | 143 / 31 m | 31.8 / 30.4% |
| Turbulence memory 300 / 1200 s | 56 / 109 m | 31.3 / 30.7% |
| Acting on a detection 50% / 90% | 0 / 162 m | 31.3 / 30.7% |
| Dog range d50 120 / 320 m | 32 / 60 m | 31.8 / 30.3% |
| Route length 300 / 1000 m | 32 / 0 m | 31.8 / 31.3% |
| Close-range detectability 0.3 / 0.9 | 0 / 0 m | 31.3 / 31.3% |
| Team spacing 150 / 500 m | 18 / 173 m | 31.5 / 31.3% |

## 4. Where the person might be (probability map)

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

## 5. Limitations: what this can't show

- **Circularity:** the true worlds use the same physics as the planner, with the wind changed. This tests robustness to wind error, not whether the physics is right. Only field data can, which is what the trial tool is for.
- **Dog range and acting on a detection** (d50 = 200 m, 0.7) are assumptions, and the absolute success figures scale with them.
- **Inside a segment, POD is search theory** calibrated to NASAR's 50% average, scaled with scent conditions. Vegetation and terrain don't change it yet, and responsive and unresponsive subjects aren't separated. Ground scent and trailing dogs aren't modelled.
- **Drift credit:** a no-alert search lowers upwind ground at half weight. That's a judgement made to avoid clearing ground on the strength of a wrong wind.
- **Block resolution:** detection is at 50 m receiver blocks with 100 m source blocks, so a source means "someone in this 100 m square". The peak-concentration correction assumes the dog crosses the plume within the block.
- **Wind confidence thresholds** (1 and 2 m/s, 25/45° model disagreement, 30/60° turning) are reasoned, not fitted. WindNinja hasn't been compared with weather stations here.
- **Distance data:** the child figures cover all ages under 13 together, and the dementia figures are for flat terrain. ISRID has finer tables (by age band and terrain) in *Lost Person Behavior* (Koester 2008), which should replace these when available.
- **Injured vs uninjured:** the terrain multipliers are for uninjured subjects. Injured people are found even more often near trails (×7) and streams (×3.5).

## 6. Next steps, in order of value

1. **Field trials with a K9 unit** ([FIELD_TRIALS.md](FIELD_TRIALS.md)): 20–30 training runs scored with the planner's GPX import. They test the physics and set the dog's range.
2. **Wind validation:** compare WindNinja and the fallback against RAWS / MesoWest stations near past incidents, and fit the confidence thresholds to the real direction errors.
3. **Finer ISRID tables:** age bands, terrain types and the injured/uninjured split, from *Lost Person Behavior*.
4. **Expert review** of the hedge rule and defaults by K9 handlers and an incident planner.
5. **Segment effort allocation over time:** several operational periods, cumulative POD and when to re-search a segment (rather than one assignment at a time).
6. **Alert-pattern clues:** looping-plume alert lines and night alerts at one elevation (fanning plumes) as extra evidence in the back-trace.
