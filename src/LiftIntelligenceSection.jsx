// src/LiftIntelligenceSection.jsx
// Two parts of Progress › Strength, both display only:
//   1. LiftIntelligenceSection: one lift at a time. Its estimated one-rep max
//      by session (adjusted for reps in reserve), whether it is progressing,
//      level or slipping, and what to do about a stall (e1rmTrend.js).
//   2. MuscleRecencyMap: which muscles are fresh today, from the days since
//      each was last trained (muscleVolume.buildMuscleRecency).

import { useMemo, useState } from "react";
import { buildLiftIntelligence } from "./e1rmTrend";
import { buildMuscleRecency } from "./muscleVolume";
import { getTodayKey } from "./constants";
import { Icon, Sheet, Method } from "./ui/ledger";
import { LineChart, DataTable, Glance, dayDate } from "./sections/charts";

const NBSP = "\u00a0";
const VERDICT = { progressing: "Progressing", stalled: "Level", regressing: "Slipping", building: "Building a baseline" };
const column = (gap) => ({ display: "flex", flexDirection: "column", gap });

export function LiftIntelligenceSection({ data, glance = false }) {
  const report = useMemo(() => buildLiftIntelligence(data), [data]);
  const [picked, setPicked] = useState(null);
  const [choosing, setChoosing] = useState(false);

  if (glance) {
    if (!report.ready) return <Glance text="Log the same lift in three sessions and its trend appears here." />;
    const lead = report.lifts[0];
    return (
      <Glance text={`${lead.name} estimated one-rep max: ${lead.current}${NBSP}lb. ${lead.verdict.note}`}>
        <LineChart
          label={`Line chart of ${lead.name} estimated one-rep max over ${lead.series.length} sessions, from ${lead.series[0].e1rm} to ${lead.current} pounds.`}
          points={lead.series.map((point) => ({ date: point.date, value: point.e1rm }))}
          unit="lb"
        />
      </Glance>
    );
  }

  if (!report.ready) {
    return (
      <section aria-labelledby="e1rm-title" style={column(6)}>
        <h2 id="e1rm-title" className="t-h">Estimated one-rep max</h2>
        <p className="t-s c2">Log the same lift in three sessions and its trend appears here, with a note if it stalls.</p>
      </section>
    );
  }

  const lift = report.lifts.find((item) => item.name === picked) || report.lifts[0];
  const first = lift.series[0];
  const change = lift.delta30 == null ? ""
    : lift.delta30 === 0 ? ", the same as 30 days ago"
    : `, ${Math.abs(lift.delta30)}${NBSP}lb ${lift.delta30 > 0 ? "higher" : "lower"} than 30 days ago`;
  const flagged = lift.verdict.status === "stalled" || lift.verdict.status === "regressing";

  return (
    <>
      <button type="button" className="btn btn-s btn-b" aria-haspopup="dialog" onClick={() => setChoosing(true)} style={{ justifyContent: "space-between", padding: "0 12px 0 16px" }}>
        <span className="clip"><span className="c2" style={{ fontWeight: 400 }}>Lift</span>{NBSP}{NBSP}{lift.name}</span>
        <Icon name="down" size="s" />
      </button>

      <section aria-labelledby="e1rm-title" style={column(8)}>
        <div className="sec"><h2 id="e1rm-title" className="t-h">Estimated one-rep max</h2><span className={flagged ? "tag" : "tag tag-f"}>{VERDICT[lift.verdict.status]}</span></div>
        <p className="t-s c2">{lift.current}{NBSP}lb at the last session{change}.</p>
        <LineChart
          label={`Line chart of ${lift.name} estimated one-rep max over ${lift.series.length} sessions, from ${first.e1rm} to ${lift.current} pounds.`}
          points={lift.series.map((point) => ({ date: point.date, value: point.e1rm }))}
          height={124}
          unit="lb"
        />
        {lift.verdict.note && <p className={flagged ? "banner" : "t-s"}>{flagged && <Icon name="info" size="s" />}<span>{lift.verdict.note}</span></p>}
        <DataTable
          caption={`${lift.name}: estimated one-rep max by session`}
          head={["Session", "Estimated max"]}
          rows={[...lift.series].reverse().map((point) => [dayDate(point.date), `${point.e1rm}${NBSP}lb`])}
        />
        <Method
          testId="method-e1rm"
          method="An estimate from your best set of each session, not a tested max."
          detail={<p>The Epley formula on the best straight set of the day, adjusted for reps in reserve when you log them, so 8 reps with 2 in reserve counts as a 10-rep set. Drop sets, rest-pause and other technique sets are left out.</p>}
        />
      </section>

      <Sheet open={choosing} title="Choose a lift" onClose={() => setChoosing(false)}>
        <p className="t-s c2">The lifts you have logged most.</p>
        <ul className="rows">
          {report.lifts.map((item) => (
            <li key={item.name}>
              <button type="button" className="row" aria-pressed={item.name === lift.name} onClick={() => { setPicked(item.name); setChoosing(false); }} style={{ minHeight: 56 }}>
                <span className="kv grow"><span className="t-bs">{item.name}</span><span className="t-s c2">{VERDICT[item.verdict.status]}</span></span>
                <span className="n">{item.current}{NBSP}lb</span>
                {item.name === lift.name ? <Icon name="done" size="s" /> : <span style={{ width: 20, flex: "none" }} />}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}

// Fresh today
export function MuscleRecencyMap({ data }) {
  const recency = useMemo(() => buildMuscleRecency(data, getTodayKey()), [data]);
  if (!recency) return null;
  const trained = recency.filter((row) => row.status !== "untrained").sort((a, b) => (b.daysSinceAny ?? 99) - (a.daysSinceAny ?? 99));
  if (trained.length === 0) return null;
  const names = (status) => trained.filter((row) => row.status === status);
  const fresh = names("fresh");
  const ready = names("ready");
  const worked = names("worked");
  const withDays = (rows) => rows.map((row) => `${row.label} (${row.daysSinceAny}d)`).join(", ");
  const sentence = (rows) => { const text = rows.map((row) => row.label.toLowerCase()).join(", "); return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`; };

  return (
    <section aria-labelledby="fresh-title" style={column(4)}>
      <h2 id="fresh-title" className="t-h">Fresh today</h2>
      <p className="t-b">{fresh.length ? sentence(fresh) : "Nothing has had four days off yet."}</p>
      {ready.length > 0 && <p className="t-s c2">Two or three days since: {withDays(ready)}.</p>}
      {worked.length > 0 && <p className="t-s c2">Recently loaded: {withDays(worked)}.</p>}
      <p className="t-s c2">Counted over the last 21 days, from any set where the muscle did the main or a supporting job. Fresh means four days or more.</p>
    </section>
  );
}
