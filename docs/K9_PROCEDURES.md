# How search-dog teams are used, and where Scentline fits

This page summarises current practice for wilderness search dogs, from callout to debrief, from the sources listed at the end. It is the reference for how Scentline's output should look to a search manager and a handler. Each section ends with what Scentline does at that stage.

## Two kinds of dog

- **Air-scent (area) dogs** detect any human scent carried on the air and work toward its source. They don't need a scent article, and they react to any person, including searchers.
- **Trailing dogs** follow one person's scent from the last known point (LKP), starting from a scent article. They can work contaminated areas and trails a day or more old.

Most dogs are trained for one or the other. Scentline models air scent.

## Readiness and certification

- Certification (NASAR, SWGDOG, FEMA 508-8) is valid for about a year. SWGDOG asks for at least 16 hours of training a month and records of each session.
- NASAR area-search tests:

| Level | Area | Time limit | Subjects |
| --- | --- | --- | --- |
| SARTECH III | 40–60 acres | 1.5 h | one hidden subject, no LKP given |
| SARTECH II | ~80 acres | 1.5 h | one subject |
| SARTECH I, day | 140–160 acres | 4 h | at least two moving subjects |
| SARTECH I, night | 80–90 acres | 2 h | one subject |

- In every test the handler gets 15 minutes to plan, must state their strategy and explain any change, describe the dog's final response, and mark finds and alerts on the map. Any false indication fails.

**Scentline:** segment sizes and the team pace (0.13 km² an hour) come from these tests. The Training mode and the trial record ([FIELD_TRIALS.md](FIELD_TRIALS.md)) match what SWGDOG asks handlers to log.

## Callout

- The incident commander or a search manager requests dog teams through the incident command system (ICS). A unit or state coordinator picks teams by certification and recent training.
- Dogs cover ground with few people, so they are treated as early resources. Use them around the LKP, especially when the direction of travel is unknown, but don't hold back trackers while a dog is on its way.
- Handlers need basic ICS training (ICS 100/200, IS-700).

## Protecting the scene

- Flag off the LKP. Keep people and running engines away.
- **Scent articles** (for trailing dogs, or to start an air-scent dog):
  - use skin-contact clothing;
  - pick it up with tongs or an inside-out bag and keep it in a zip bag or paper bag, labelled with date, time and name;
  - anyone who touched it lets the dog sniff them.
- A contaminated scent article is the most common reason a trailing dog fails.

**Scentline:** a trailing dog's direction from the LKP can go into **Heading when last seen**.

## Planning and the assignment

- **Each dog team gets a segment of its own**, with a requested thoroughness (hasty, efficient or thorough). Segments are about 40–160 acres, with edges a team can recognise on the ground: trails, streams, roads, ridgelines. They are named and tracked per operational period (CalTopo/SARTopo segments, ICS 204 assignments).
- **The manager assigns the area; the handler picks the pattern.** Search managers are told to consult the handler, and to invite handlers into planning, because handlers know how wind and terrain affect their own dog.
- **Clean air:** an air-scent dog should go in at least 15–30 minutes after other searchers have left.
- **Timing:** early morning, late afternoon, evening and night are best; midday summer convection is worst. At night the chance of detection is much higher, and handler safety is the only reason to hold dogs back.
- **Team:** the handler plus one or two people for navigation and radio.
- **Capacity:** about half a square mile (1.3 km²) per team per day.

**Scentline:** **Deploy** assigns whole segments by default:
- Segments are cut along trails, roads, streams and ridgelines, about 75 acres each, and named A1, A2, …
- For a dog team at the planned time, each segment gets its share of the probability (POA), its POD, its expected finds (including scent drifting in from outside), the entry point on its downwind edge, the heading into the wind, the hours one team needs and the best hour. The handler chooses the pattern.
- The segment table flags segments searched in the last 30 minutes.
- **Start points** (point plus upwind route) remains as an option for hasty searches.
- KML export draws assigned segments as polygons for CalTopo.

## In the field

- Walk the segment edge first: learn the boundaries, check the wind, cut for sign.
- **Patterns:**
  - on small areas, zig-zag into the wind;
  - on larger areas, make parallel sweeps across the wind, moving upwind with each turn;
  - in daytime upslope flow, work ridges and downhill;
  - in morning and evening shadow, when air drains downhill, work up canyons from the bottom.
- **Terrain:**
  - eddies form behind ridges, at canyon bends, at the mouths of side drainages and at meadow edges;
  - saddles concentrate wind;
  - scent pools in hollows at night;
  - forest cuts the wind sharply (20 mph in the open to about 4 mph under trees).
- **Reading the plume:**
  - **Coning plumes** (overcast days) are the easiest to work.
  - **Looping plumes** (clear midday) give brief repeated alerts. A mapped line of them, sometimes from several dogs, points toward the person.
  - **Fanning plumes** (stable nights) hold scent at one elevation: a string of night alerts at one elevation is a clue.
- **Alert vocabulary** (NASAR): interest, then change of behaviour, then alert, then trained final response. Handlers report alerts with the time.

**Scentline:**
- The scent model reproduces the main effects: evening drainage into valleys, pooling in calm hollows, lofting off sunlit slopes, and convection weakening scent.
- Wind confidence flags light or turning wind, and tells teams to measure the wind at the start points.
- Not modelled: fanning-plume elevation clues and looping-plume alert lines. The back-trace follows the modelled wind instead.

## Debrief and POD

- **Handlers report:**
  - the route taken and areas left uncovered;
  - alerts with time and wind;
  - clues and hazards;
  - a coverage map;
  - an estimated POD per segment, separately for a responsive and an unresponsive subject (ICS 204 SAR Supplement B);
  - the activity log (ICS 214).
- Segments searched unevenly are split. GPS tracks are uploaded to CalTopo/SARTopo and checked against the assignment.
- **Estimating dog POD is hard.** Hill tells managers to question PODs of 70% or more, especially when a team returns early, and to lower PODs from handlers who can't describe the wind.
- **Rule-of-thumb numbers:**
  - dog POD runs from 5% to 95% depending on weather, at sweeps 100 m apart;
  - NASAR uses 50% as a working average;
  - at noon on a calm clear day a dog 100 m away gets about 2% of the scent it would on a clear night.
- **Measured:** the mean effective sweep width of four air-scent dog teams was 95 m (95% CI 44–145). More convection meant less.

**Scentline:**
- **Import team track (GPX)** marks the walked corridor searched over the track's times and logs ALERT waypoints as alerts.
- The segment table keeps a cumulative POD per segment ("Done").
- Inside a segment, POD follows search theory, 1 − e^(−coverage), calibrated to NASAR's 50% average in neutral conditions and scaled with scent conditions.
- Close-range detection is sized so the model's sweep width matches the measured 95 m.
- No-alert credit for scent that should have drifted to a team is halved, because it depends on the modelled wind.
- Not done: separate responsive and unresponsive PODs (scent doesn't depend on responsiveness, but the form asks for both).

## Sources

- SWGDOG SC9, *Non-specific Human Scent Wilderness Area Search (Air scent)*, 2010 (nist.gov).
- NASAR, *Canine Certification Program, 2018 Criteria*.
- K. Hill, *Using Dogs as Ground Search Resources* (SARBC).
- M. Doyle (ed.), *Search Dog Handbook: Facts and Figures for the Search Manager*, 1992, incl. H. Graham, *77 Facts about Search Dogs* (SARBC).
- *Search and Rescue Debriefing Form, ICS 204 SAR Supplement B*.
- CalTopo training, *Using Segments and Assignments*.
- K. Chiacchia, H. Houlahan, R. Hostetter, *Deriving Effective Sweep Width for Air-scent Dog Teams*, Wilderness & Environmental Medicine, 2015.
- R. Koester et al., *Sweep Width Estimation for Ground Search and Rescue*, 2004.
- FEMA 508-8, *Typed Resource Definitions: Search and Rescue Resources*.
