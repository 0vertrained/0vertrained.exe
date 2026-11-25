// src/sections/RunningVolumeFigure.jsx
// Weekly miles on Progress › Running: the last eight Monday-anchored weeks,
// with manual logs and Strava runs counted once per day (runningVolume.js).
// Progress receives no Strava props, so the figure fetches its own rows when
// the connection exists and is a manual-only figure otherwise. Nothing here
// blocks paint: the manual weeks render at once and Strava layers in.
//
// Attribution: when Strava rows contribute, the figure carries the "Powered
// by Strava" mark per the API Agreement. Display only; this figure's data
// never feeds coach payloads.

import { useEffect, useMemo, useState } from "react";
import { isDemoMode } from "../demoData";
import { loadStravaActivities, groupStravaByDate } from "../strava/dataLoading";
import { buildWeeklyRunVolume } from "../runningVolume";
import { ColumnChart, DataTable, Glance, shortDate } from "./charts";

const NBSP = "\u00a0";

export function RunningVolumeFigure({ data, settings, glance = false }) {
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

  const anyMiles = volume.weeks.some((week) => week.miles > 0);
  if (!anyMiles && glance) return <Glance text="No runs in the last eight weeks." />;
  if (!anyMiles) {
    return (
      <section aria-labelledby="miles-title" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h2 id="miles-title" className="t-h">Weekly miles</h2>
        <p className="t-s c2">No runs in the last eight weeks. Log a run from Today or the Log button and your weekly miles appear here.</p>
      </section>
    );
  }

  const tidy = (miles) => Math.round(miles * 10) / 10;
  const thisWeek = tidy(volume.thisWeekMiles);
  const lastWeek = tidy(volume.lastWeekMiles);
  const compare = lastWeek > 0
    ? thisWeek > lastWeek ? `, up from ${lastWeek} last week` : thisWeek < lastWeek ? `, against ${lastWeek} last week` : ", level with last week"
    : "";
  const source = volume.stravaContributed
    ? "Manual and Strava runs are counted once."
    : "From your manual logs. Connect Strava in Profile to fill in missed runs.";
  const weeks = volume.weeks.map((week) => ({ ...week, miles: tidy(week.miles) }));
  const middle = Math.floor(weeks.length / 2);
  const chart = (
    <ColumnChart
      label={`Bar chart of weekly miles for ${weeks.length} weeks, from ${weeks[0].miles} miles to ${thisWeek} miles this week.`}
      columns={weeks.map((week, index) => ({
        key: week.weekStart,
        value: week.miles,
        x: index === 0 || index === middle || index === weeks.length - 1 ? shortDate(week.weekStart) : "",
      }))}
    />
  );
  if (glance) return <Glance text={`${thisWeek}${NBSP}mi since Monday${compare}. ${volume.stravaContributed ? "Manual and Strava runs are counted once." : "From your manual logs."}`}>{chart}</Glance>;

  return (
    <section aria-labelledby="miles-title" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 id="miles-title" className="t-h">Weekly miles</h2>
      <p className="t-s c2">{thisWeek}{NBSP}mi since Monday{compare}. {source}</p>
      {chart}
      <DataTable
        caption="Miles by week, newest first"
        head={["Week of", "Miles"]}
        rows={[...weeks].reverse().map((week) => [shortDate(week.weekStart), `${week.miles}${NBSP}mi`])}
      />
      {volume.stravaContributed && <p className="t-c c2">Powered by Strava</p>}
    </section>
  );
}
