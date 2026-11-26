// src/DayZeroSpecimen.jsx
// Day zero: what an empty tab shows until real data exists. First the one
// thing to do and what happens next, then a sample of the tab at its best,
// labelled Sample and described as not your data.
//
// Rules (dayZeroEdition.test.jsx):
//   · One action per tab. Progress has none; it shows how many logged days
//     are left before it opens.
//   · The sample is labelled as a sample above and below, and screen readers
//     hear a one-line summary that says so. App renders this only on true
//     zero states (dayZero.js), so it never mixes with real data.
import { useEffect } from "react";
import { perfMark } from "./perf";
import { logFunnelEvent } from "./funnel";
import { describeCall } from "./recovery/verdictResolver";
import { LineChart } from "./sections/charts";
import { Icon, Meter } from "./ui/ledger";
import specimen from "./fixtures/specimenWeek.json";

const ACTIONS = {
  Today: {
    title: "Set up first.",
    body: "Pick your goal and your week, and Today shows your session, the daily call and what is left to eat.",
    label: "Start setup",
    next: "Takes about two minutes. The first session is ready the moment you finish.",
  },
  Recovery: {
    title: "Connect a wearable, or check in by hand.",
    body: "Recovery reads sleep, HRV and resting heart rate from Oura or Whoop. A morning check-in on Today works too.",
    label: "Connect a wearable",
    next: "Connecting takes about a minute. Your first read lands after tonight's sleep, and the trend opens after a week of mornings.",
  },
  Fuel: {
    title: "Set your targets first.",
    body: "With a calorie and protein target, Fuel can tell you what is left and what to eat next.",
    label: "Set your targets",
    next: "Two numbers to start: calories and protein. The app then learns your daily burn from what you eat and how your weight moves.",
  },
};

const SUMMARY = {
  Today: "Sample, not your data: a Push session, week 3 day 2, with four exercises and last time's numbers.",
  Recovery: "Sample, not your data: a Push call with a recovery score of 88 and a rising seven-day trend.",
  Fuel: "Sample, not your data: protein, calories and water against their targets, and three meals logged.",
  Progress: "Sample, not your data: weight down 1.8 lb this month with strength held.",
};

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

// The last seven days, ending today, for a sample line.
function lastWeek(values) {
  const today = new Date();
  return values.map((value, index) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (values.length - 1 - index));
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    return { date: key, value };
  });
}

function Plate({ tab }) {
  if (tab === "Today") {
    const t = specimen.today;
    return (
      <>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><span className="t-h grow">{t.title}</span><span className="t-s c2">{t.sub}</span></div>
        <ul className="rows" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {t.exercises.map((ex) => (
            <li key={ex.name} className="row">
              <span className="kv grow"><span className="t-bs">{ex.name}</span><span className="t-s c2">Last time: {ex.last}</span></span>
              <span className="n-s">{ex.target}</span>
              {ex.done ? <Icon name="done" size="s" /> : <span style={{ width: 16, flex: "none" }} />}
            </li>
          ))}
        </ul>
        <p className="t-s c2">{t.footer}</p>
      </>
    );
  }
  if (tab === "Recovery") {
    const r = specimen.recovery;
    const call = describeCall(r.call);
    return (
      <>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Meter level={call.level} />
          <span className="grow" style={{ display: "flex" }}><span className="stamp">{call.stamp}</span></span>
          <span className="n-md">{r.score}</span><span className="t-s c2">/100</span>
        </div>
        <p className="t-hl">{call.headline}</p>
        <p className="t-s c2">{r.evidence}</p>
        <p className="t-s c2">{r.context}</p>
        <LineChart label="Recovery, last seven days" points={lastWeek(r.spark)} height={96} />
      </>
    );
  }
  if (tab === "Fuel") {
    const f = specimen.fuel;
    return (
      <>
        <ul className="rows" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {f.rows.map((row) => (
            <li key={row.label} className="row">
              <span className="kv grow"><span className="t-bs">{row.label}</span>{row.note && <span className="t-s c2">{row.note}</span>}</span>
              <span className="n-s">{row.value}</span>
            </li>
          ))}
        </ul>
        <ul className="lst" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {f.meals.map((meal) => <li key={meal.time}><span className="n-s c2">{meal.time}</span> {meal.food}</li>)}
        </ul>
        <p className="t-s c2">{f.footer}</p>
      </>
    );
  }
  if (tab === "Progress") {
    const p = specimen.progress;
    return (
      <>
        <p className="t-h">{p.headline}</p>
        <LineChart label="Weight, last seven days" points={lastWeek(p.spark)} height={96} unit="lb" />
        <ul className="rows" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {p.rows.map((row) => (
            <li key={row.label} className="kv" style={{ padding: "4px 0" }}>
              <span className="t-s c2">{row.label}</span>
              <span className="t-bs">{row.value}</span>
            </li>
          ))}
        </ul>
      </>
    );
  }
  return null;
}

export function DayZeroSpecimen({ tab, onAction = null, progressInfo = null }) {
  useEffect(() => {
    perfMark("dayzero", `seen-${tab}`);
    logFunnelEvent(`dayzero_seen_${String(tab).toLowerCase()}`);
  }, [tab]);

  const action = ACTIONS[tab] || null;
  const total = progressInfo ? progressInfo.daysHave + progressInfo.daysNeeded : 0;
  const left = progressInfo ? progressInfo.daysNeeded : 0;
  const headingId = `dayzero-${String(tab).toLowerCase()}-title`;

  return (
    <section data-testid={`dayzero-${String(tab).toLowerCase()}`} aria-labelledby={headingId} style={{ display: "flex", flexDirection: "column", gap: 16, padding: "16px 16px 24px" }}>
      {action && (
        <div className="kv" style={{ gap: 8 }}>
          <h2 id={headingId} className="t-xl">{action.title}</h2>
          <p className="t-b c2">{action.body}</p>
        </div>
      )}
      {action && onAction && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            type="button"
            data-testid="dayzero-action"
            className="btn btn-p btn-lg btn-b"
            onClick={() => { perfMark("dayzero", `action-${tab}`); logFunnelEvent(`dayzero_action_${String(tab).toLowerCase()}`); onAction(); }}
          >
            {action.label}
          </button>
          <p className="t-s c2">{action.next}</p>
        </div>
      )}
      {tab === "Progress" && progressInfo && (
        <div className="kv" style={{ gap: 8 }}>
          <h2 id={headingId} className="t-xl">{left === 0 ? "Ready." : `${WORDS[left] || left} more ${left === 1 ? "day" : "days"}.`}</h2>
          <p className="t-b c2">Progress opens after {total} logged days, when there is enough to draw a trend. You have logged {progressInfo.daysHave}.</p>
          <span className="bar" role="img" aria-label={`${progressInfo.daysHave} of ${total} days logged`}><i style={{ width: `${total ? Math.min(100, (progressInfo.daysHave / total) * 100) : 0}%` }} /></span>
          <p className="t-s c2">Log a session, a meal or a weigh-in, and the day counts.</p>
        </div>
      )}
      <hr className="hr" />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="tag tag-f stamp" data-testid="specimen-stamp">Sample</span>
        <h3 className="t-s c2 grow">What {tab} looks like once you have data</h3>
      </div>
      <div className="card" role="img" aria-label={SUMMARY[tab]} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Plate tab={tab} />
      </div>
      <p className="t-s c2">This is a sample, not your data. Yours replaces it as soon as you log.</p>
    </section>
  );
}

export default DayZeroSpecimen;
