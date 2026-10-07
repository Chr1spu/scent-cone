# Field trials: checking Scentline against real dogs

Everything in [EVALUATION.md](EVALUATION.md) tests the model against itself. This protocol tests it against real dogs. It fits into normal air-scent training, needs nothing beyond a GPS collar or handler GPS, and each run takes about five minutes of extra work.

## What a trial measures

In a training run the hide location is known. Scentline predicts, for every point the dog passed, the chance a dog there would detect the hide. If the model is useful, the places where the dog **alerted** should have scored higher than the rest of its track.

- **AUC:** the chance that a random alert point scored higher than a random non-alert point on the same track. 0.5 means the model is no better than chance, 1.0 means alerts always fell where the model expected. Over many runs, an AUC that stays clearly above 0.5 (say 0.7 or more) is evidence the scent model points dogs to the right places.
- **Detection at alerts vs elsewhere:** the model's mean detection at alert points compared with the rest of the track. This shows whether the scale is right. With the default dog range (d50 = 200 m), alerts should mostly fall where the model says 0.3–0.9.

## Running one

1. **Before:** in the planner, choose the **Training** mission. Load or create the area, place the hide(s) with *Place hide*, and set the time bar to the run time.
2. **Wind:** measure the wind at the start (direction it comes **from**, and speed at about 2 m) and enter it under *Wind measured on site*. Measure again if it shifts; note the times.
3. **Run the dog** as you normally would. Record the dog's track (collar GPS, or the handler's if the dog stays close) with timestamps. At each change of behaviour that is a clear alert or indication, drop a waypoint named **ALERT** (any name containing "alert" works). Don't mark the final find as an alert; it is the hide itself.
4. **After:** export the GPX (Garmin, CalTopo, Gaia, etc.). In Training mode, press **Import GPX** under the hides. Scentline scores the run over the hour ending at the track's last timestamp.
5. **Save the trial record (JSON).** Keep every run, including bad ones; dropping inconvenient runs biases the result.

## What to record alongside (in the file name or a log)

- Dog and handler, the dog's experience level, and whether the dog is air-scent or trailing trained.
- Hide age (how long the subject was in place before the dog started) and whether the subject was a live person or training aid.
- Weather: temperature, humidity, cloud, and anything unusual (gusts, rain, an evening wind change).
- Terrain and cover at the hide.

## How many runs

One run tells you almost nothing; dogs have off days and wind shifts. Aim for **20–30 runs** across:

- different times of day, especially late afternoon into evening (the downslope transition);
- light and moderate winds;
- open ground and forest;
- several dogs.

With 20+ runs, look at the AUC across all of them, and separately by condition (light wind, evening, forest). Where it drops toward 0.5, the model is wrong in that condition, and that tells us what to fix.

## Tuning the dog's range

The model assumes a dog detects one person 200 m straight downwind half the time, in a steady 2 m/s wind (`DETECTION.d50M` in `frontend/src/config/modelParams.ts`). If a dog's alerts consistently fall where the model gives low detection (under 0.2), the dog works from further away than assumed: raise d50. If the model gives high detection along long stretches where the dog showed no interest, lower it. Change it per dog only after several runs.

## Sending the data

The trial records are plain JSON: hide position, wind, the scored track points with the model's predictions, and the summary. They contain GPS positions of the training ground, so share them only with people you trust with that. Send them to the Scentline maintainer to pool across teams; pooled records are what turn this from a plausible model into a tested one.
