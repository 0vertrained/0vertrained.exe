// src/sections/RunningProgress.jsx
// Progress → Running, below the weekly miles: cardio fitness from the watch,
// your races and best times, the race times your fitness points to, how
// easy pace is moving, and how much ground each heartbeat covers on easy
// runs. Read-only.
import { useMemo } from "react";
import { formatDuration, formatPace } from "../runPaces";
import { isRunPlanSpec } from "../runPlanGenerator";
import { currentFitness, personalBests, raceLabel, raceResults } from "../raceResults";
import { easyPaceTrend, heartRateTrend, loggedRuns } from "../runProgress";
import { dayDate } from "./charts";
import { CardioFitness } from "./CardioFitness";

const NBSP = " ";
const column = (gap) => ({ display: "flex", flexDirection: "column", gap });
const PREDICTED = ["5k", "10k", "half", "marathon"];

function paceChange(recent, earlier) {
  if (!earlier?.pace || !recent?.pace) return "";
  const delta = earlier.pace - recent.pace;
  if (Math.abs(delta) < 3) return ", level with the four weeks before";
  return `, ${Math.abs(delta)}${NBSP}sec ${delta > 0 ? "faster" : "slower"} than the four weeks before`;
}

/** Races, predicted times, easy pace and heart rate, from the logged runs. */
export function RunningProgress({ owner, data = {}, program = null, todayKey }) {
  const runs = useMemo(() => loggedRuns(data, program, { todayKey, days: 56 }), [data, program, todayKey]);
  const results = useMemo(() => raceResults(data), [data]);
  const bests = personalBests(results);
  const spec = isRunPlanSpec(program?.__raceBuild) ? program.__raceBuild : null;
  const fitness = currentFitness({ results, spec });
  const easy = easyPaceTrend(runs, { todayKey });
  const heart = heartRateTrend(runs, { todayKey });

  return (
    <>
      <CardioFitness key={owner} owner={owner} />
      {(easy || heart) && (
        <section aria-labelledby="easy-title" style={column(8)}>
          <h2 id="easy-title" className="t-h">Easy runs</h2>
          {easy && (
            <div className="kv">
              <span className="n-md">{formatPace(easy.recent.pace)}/mi</span>
              <span className="t-s c2">Average easy pace over the last four weeks, {easy.recent.runs} run{easy.recent.runs === 1 ? "" : "s"}{paceChange(easy.recent, easy.earlier)}.</span>
            </div>
          )}
          {heart && (
            <p className="t-s">
              Each heartbeat carries you {heart.recent.reach.toFixed(2)}{NBSP}m on easy runs lately
              {heart.change != null ? (Math.abs(heart.change) < 0.01 ? ", the same as the three weeks before." : `, ${Math.round(Math.abs(heart.change) * 100)}% ${heart.change > 0 ? "farther" : "less far"} than the three weeks before.`) : "."}
              {" "}More ground per beat means your aerobic fitness is building.
            </p>
          )}
          <p className="t-s c2">Easy runs are the ones your plan had as easy, long or zone 2 that day. Intervals and races are left out.</p>
        </section>
      )}

      {fitness && (
        <section aria-labelledby="predict-title" style={column(8)}>
          <h2 id="predict-title" className="t-h">Race times you’re ready for</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px 16px" }}>
            {PREDICTED.map((distance) => (
              <div key={distance} className="kv">
                <span className="t-c c2">{raceLabel(distance)}</span>
                <span className="n-md">{formatDuration(fitness.zones.predictions[distance])}</span>
              </div>
            ))}
          </div>
          <p className="t-s c2">
            Predicted from {fitness.source === "race"
              ? `your ${fitness.name ? `${fitness.name} ` : ""}${raceLabel(fitness.benchmark.distance)} on ${dayDate(fitness.benchmark.date)}`
              : `your race plan’s ${raceLabel(fitness.benchmark.distance)} time`}
            , assuming you train for the distance. Longer races depend most on long-run mileage.
          </p>
        </section>
      )}

      {results.length > 0 && (
        <section aria-labelledby="races-title" style={column(4)}>
          <h2 id="races-title" className="t-h">Races</h2>
          <ul className="rows">
            {results.slice(0, 8).map((result) => {
              const best = bests[result.distance];
              const isBest = best && best.dateKey === result.dateKey && best.seconds === result.seconds;
              return (
                <li key={`${result.dateKey}-${result.distance}-${result.seconds}`} className="row" style={{ minHeight: 56 }}>
                  <span className="kv grow">
                    <span className="t-bs clip">{result.name || `${raceLabel(result.distance)} race`}</span>
                    <span className="n-s c2">{dayDate(result.dateKey)} · {raceLabel(result.distance)} in {formatDuration(result.seconds)} · {formatPace(result.pace)}/mi</span>
                  </span>
                  {isBest && <span className="tag tag-e">PR</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!results.length && (
        <p className="t-s c2">Mark a run as a race on Today, under its miles and time, to keep your results and best times here.</p>
      )}
    </>
  );
}

export default RunningProgress;
