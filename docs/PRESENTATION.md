# Scentline presentation rundown

A 2-minute presentation plus 2 minutes of Q&A. Start a live area early, tell the story on the
3D site while it computes, then show the result.

## Before the presentation

The live part of the demo depends on the server on your PC, so get it confirmed the night before or that morning.

- [ ] Leave the server running: PC on, plugged in, online, with sleep turned off in Windows power settings.
- [ ] Only restart the server if you must. If you do, run `scripts\start-server.ps1` at least 5 minutes before presenting: the tunnel address changes, and the site needs a couple of minutes to pick it up.
- [ ] Open [Plan a search](https://scent-cone-sp-1-n.vercel.app/new) and check it says **Server connected, WindNinja ready**.
- [ ] Rehearse the live pick once at a spot you won't use on stage. Time it on the venue Wi-Fi if you can; expect about 40 seconds.
- [ ] Choose the on-stage spot: hilly, in the lower 48 US states (Rockies, Sierra Nevada, Appalachians, White Mountains).
- [ ] Make sure the backups are on the laptop: the pitch deck and the video `pitch/video/scentline-demo.mp4`.

Avoid these spots on stage, because they're cached and load instantly, which hides the live computation:

- the Catskills demo campsite
- near Breckenridge, Colorado (39.62, −105.87)
- your rehearsal spot

## Setup at the venue

Two minutes before you start, open these tabs in order and hard-refresh each one with Ctrl+Shift+R.

| Tab | Page | State before you start |
| --- | --- | --- |
| 1 | [Home](https://scent-cone-sp-1-n.vercel.app) | Scrolled to the very top |
| 2 | [Plan a search](https://scent-cone-sp-1-n.vercel.app/new) | Map visible; server says connected |
| 3 (backup) | [Demo planner](https://scent-cone-sp-1-n.vercel.app/planner?demo) | Fully loaded |

- Mirror your screen at the laptop's normal resolution. Below about 768 px wide, the site switches to its phone layout.
- Set browser zoom to 100%, and close notifications and other apps.

## The 2-minute script

If you run long, cut the alert line.

**0:00 – Tab 1, the hero (15 s)**

> "When someone goes missing in the mountains, search teams map where the person probably *is*. But air-scent dogs don't search for people. They search for **scent**, and scent goes wherever the wind takes it. Scentline turns 'where they might be' into 'where a dog could smell them,' for anywhere in the US."

**0:15 – Tab 2, start a live area (15 s)**

Do: zoom into your chosen mountains, click a spot, leave "Today, from the current forecast" selected, click **Open the planner**.

> "Let's start a real search right now, somewhere we haven't prepared. It's downloading real elevation, land cover, trails and today's forecast, and running the US Forest Service's WindNinja wind model for the next 8 hours. While that runs, here's what it's doing."

**0:30 – Tab 1, scroll the story (50 s)**

Do: leave tab 2 loading. Scroll slowly and pause about a second at each card before speaking.

1. Campsite: "Our example: a 9-year-old wanders away from a campsite at 4 PM. Sunset is at 7."
2. Wind: "WindNinja works out the wind over the real terrain, hour by hour. It bends around every ridge."
3. Scent: "We release scent at dog-nose height from every likely spot. At dusk the air cools and the scent drains downhill like water, so the best place to smell a hillside is often the valley below it."
4. Deploy: "Each team gets a start point downwind of the likely ground, a heading into the wind and its best hour."
5. Alert: "When a dog alerts, we trace the scent backwards. Overlapping alerts narrow the search to a few hundred metres."

**1:20 – Tab 2, the live result (30 s)**

> "And it's done, in about 40 seconds, for a place we picked live."

Do: drag the view a little ("Real terrain, with today's forecast wind"), click **Release scent**, then **Deploy**, and point at the team cards on the right.

> "Scent and team placements, for this exact spot, right now."

Optional: in the Plan tab, click **Read briefing** for the spoken radio briefing.

**1:50 – Close (10 s)**

> "Scentline is a planning aid for search managers, not a replacement for a handler's judgement. It gets dogs into the right air, at the right hour. Thank you."

## If something goes wrong

| Problem | What to do |
| --- | --- |
| Tab 2 says "No server" or shows an error | Switch to tab 3: "Here's the same thing for our prepared Catskills scenario." Drag the time bar from 16:00 to 19:00, then click **Deploy**. |
| The live area is still loading at 1:20 | Keep talking (add the alert line or a Q&A answer), then switch over. |
| The 3D home page is slow or blank | Present from the pitch deck, or play `pitch/video/scentline-demo.mp4`. |
| No internet at all | Tab 3 still works if it's already loaded; otherwise play the video. |

## Q&A

Keep each answer to two or three sentences. If you don't know one, say: "Every parameter is on our How it works page; happy to walk through it after."

| Likely question | Answer |
| --- | --- |
| How accurate is it? Has it been validated? | Not yet, and the site says so. Terrain, land cover and wind are real data and an established Forest Service model; the scent behaviour is documented rules of thumb. Next step: compare with real searches and GPS-tracked training searches. |
| Why not a real fluid simulation? | Too slow for a browser or a live search. WindNinja's fast solver takes seconds per hour of wind, and particles give 15,000 bits of scent at interactive frame rates. |
| Where does the probability map come from? | Lost-person statistics from Robert Koester's *Lost Person Behavior*, by subject type, adjusted for trails, streams, slope, rivers and cliffs. Searchers can paint local knowledge on top. |
| How does it choose team positions? | It scores each spot by how much likely scent passes through it, picks the best, assumes that team detects 70% of what it covers, discounts it, keeps teams 300 m apart, and repeats. Each team gets an upwind heading and its best hour. |
| What if the forecast is wrong? | It averages six runs with the wind rotated up to 20° and its speed varied up to 30%. A handler can also enter the wind measured on site, which overrides the forecast. |
| Is that really live, or cached? | Live. A new area downloads data and runs WindNinja; the same area again is instant because it's cached. You can pick the spot. |
| Why only the US? | The best inputs are US-only: high-resolution USGS elevation and NOAA's 3 km HRRR forecast. It works elsewhere with coarser 30 m data. |
| Where's the AI? Did you use generative AI? | Grok Voice reads the team briefings aloud: text-to-speech built only from the model's results, so it never invents search details. The key stays on the server; the public demo uses the browser's voice to avoid API costs. |
| Who would use this? | Search managers and K9 unit leads at the planning table. It also has modes for training searches and cadaver-dog recoveries. |
| What's next? | Validation against real searches, updating the map from dogs' GPS tracks, and a phone view for team leaders in the field. |

## Afterwards

Keep your PC and server running until judging is over, so live mode keeps working for anyone who tries it.

- Site for judges: [scent-cone-sp-1-n.vercel.app](https://scent-cone-sp-1-n.vercel.app)
- Demo that works offline: [scent-cone-sp-1-n.vercel.app/planner?demo](https://scent-cone-sp-1-n.vercel.app/planner?demo)
