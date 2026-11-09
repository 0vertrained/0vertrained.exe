// src/sections/RunningVolumeFigure.jsx
// Fig · Running volume — weekly miles for the Progress charts view.
//
// One number that matters (this week's miles), a sparkline of the last eight
// Monday-anchored weeks, and honest provenance: manual logs and Strava runs
// counted once per day (runningVolume.js dedupe). Self-loading like
// RecoveryDashboard's wearable reads — Progress receives no Strava props, so
// the figure fetches its own rows when the connection exists and renders as a
// manual-only figure otherwise. Nothing here blocks paint: the manual weeks
// render immediately, Strava layers in when the query lands.
//
// Attribution: when Strava rows contribute, the figure carries the "Powered
// by Strava" mark per the API Agreement. Display only — this figure's data
// never feeds coach payloads.

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "../theme";
import { FigureSection, LeadMetric, Sparkline } from "../whitepaper";
import { isDemoMode } from "../demoData";
import { loadStravaActivities, groupStravaByDate } from "../strava/dataLoading";
import { buildWeeklyRunVolume } from "../runningVolume";

export function RunningVolumeFigure({ data, settings }) {
  const { C, S } = useTheme();
  const [stravaByDate, setStravaByDate] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (isDemoMode() || settings?.stravaConnected !== true) return;
      const acts = await loadStravaActivities(60).catch(() => []);
      if (alive) setStravaByDate(groupStravaByDate(acts));
    })();
    return () => { alive = false; };
  }, [settings?.stravaConnected]);

  const volume = useMemo(
    () => buildWeeklyRunVolume({ entries: data || {}, stravaByDate: stravaByDate || {}, weeks: 8 }),
    [data, stravaByDate]
  );

  const anyMiles = volume.weeks.some((w) => w.miles > 0);
  if (!anyMiles) return null; // Nothing to say — a lifter's Progress page stays quiet.

  const delta = Math.round((volume.thisWeekMiles - volume.lastWeekMiles) * 10) / 10;
  const points = volume.weeks.map((w) => ({ date: w.weekStart, value: w.miles }));

  return (
    <FigureSection title="Running volume" right="weekly · mi">
      <LeadMetric
        value={volume.thisWeekMiles}
        unit="mi"
        caption="This training week, Monday to today."
        note={volume.lastWeekMiles > 0 ? `${delta >= 0 ? "+" : ""}${delta} mi vs last week` : "first tracked week"}
      />
      <div style={{ marginTop: 12 }}>
        <Sparkline points={points} width={260} height={44} label="8 weeks" />
      </div>
      <div style={{ ...S.annotation, marginTop: 10 }}>
        {volume.stravaContributed
          ? "manual + Strava · each day counted once"
          : "manual logs · connect Strava to fill missed runs"}
      </div>
      {volume.stravaContributed && (
        <div style={{ fontFamily: C.monoFamily, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textFaint, marginTop: 6 }}>
          Powered by Strava
        </div>
      )}
    </FigureSection>
  );
}
