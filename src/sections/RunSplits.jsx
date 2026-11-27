// src/sections/RunSplits.jsx
// A run's mile splits and effort, read from Apple Health with a run from
// the watch (src/watch/runSplits.js): pace and heart rate for each mile,
// behind one button so Today stays short.

import { useState } from "react";
import { effortWord } from "../effort";
import { formatRunPace } from "../watch/healthRuns";
import { splitPace } from "../watch/runSplits";
import { SplitReplay } from "./SplitReplay";

export function RunSplits({ cardio }) {
  const [open, setOpen] = useState(false);
  const splits = Array.isArray(cardio?.splits) ? cardio.splits.filter((split) => split && split.seconds > 0) : [];
  const score = Number.parseFloat(cardio?.effortScore);
  const effort = Number.isFinite(score) && score >= 1 && score <= 10
    ? `Effort ${Math.round(score)}, ${effortWord(score)}: ${cardio.effortEstimated === false ? "your rating in Fitness" : "Apple’s estimate"}.`
    : "";
  if (!splits.length && !effort) return null;
  return (
    <div data-testid="run-splits" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {effort && <p className="t-s c2">{effort}</p>}
      {splits.length > 0 && (
        <button type="button" className="btn btn-g btn-sm" aria-expanded={open} onClick={() => setOpen((value) => !value)} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>
          {open ? "Hide splits" : `Show ${splits.length} ${splits.length === 1 ? "split" : "splits"}`}
        </button>
      )}
      {open && splits.length > 0 && (<>
        <SplitReplay key={splits.map(({ miles, seconds }) => `${miles}/${seconds}`).join("|")} splits={splits} />
        <table className="tbl">
          <caption className="sr">Mile splits</caption>
          <thead><tr><th scope="col">Mile</th><th scope="col">Pace</th><th scope="col" style={{ paddingRight: 0 }}>Heart rate</th></tr></thead>
          <tbody>
            {splits.map((split) => (
              <tr key={split.n}>
                <th scope="row" className="n-s">{split.miles === 1 ? split.n : `${split.miles}\u00a0mi`}</th>
                <td className="n-s">{formatRunPace(splitPace(split))}/mi</td>
                <td className="n-s" style={{ paddingRight: 0 }}>{split.hr ? `${split.hr}\u00a0bpm` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>)}
    </div>
  );
}

export default RunSplits;
