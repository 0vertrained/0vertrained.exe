// src/ProgressHistory.jsx
// History on Progress: every day you logged. Two ways in, a month calendar
// and a timeline of events, plus a search across dates, lifts, notes and
// totals. A day opens read-only; "Edit this day" hands it to Today, which is
// where a past day is changed. On a wide screen the day docks beside the list.

import { useMemo, useState } from "react";
import { DEFAULT_PROGRAM, defaultDay, getTodayKey, getDayName } from "./constants";
import { buildAthleteTimeline, filterTimelineEvents, groupTimelineByDate, summarizeTimeline } from "./athleteTimeline";
import { displaySet } from "./workoutLogging";
import { Icon, Seg } from "./ui/ledger";
import { dayDate } from "./sections/charts";

const NBSP = "\u00a0";
const column = (gap) => ({ display: "flex", flexDirection: "column", gap });
const sentence = (text) => (text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "");
const pad = (value) => String(value).padStart(2, "0");
const monthName = (monthKey) => new Date(`${monthKey}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
const shiftMonth = (monthKey, by) => { const d = new Date(`${monthKey}-01T12:00:00`); d.setMonth(d.getMonth() + by); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const EVENT_TYPES = [["all", "All"], ["training", "Training"], ["nutrition", "Fuel"], ["recovery", "Recovery"], ["intelligence", "Insights"], ["note", "Notes"]];
const TYPE_LABEL = { training: "Training", nutrition: "Fuel", recovery: "Recovery", intelligence: "Insight", note: "Note" };

const doneSets = (exercise) => (exercise?.sets || []).filter((set) => set.done);
const liftedSets = (day) => Object.values(day?.workout?.exercises || {}).reduce((total, exercise) => total + doneSets(exercise).length, 0);
const hasLift = (day) => Object.keys(day?.workout?.exercises || {}).length > 0;
const runMiles = (day) => { const miles = Number.parseFloat(day?.workout?.cardio?.miles); return miles > 0 ? miles : 0; };

// One line for a day: what was trained, run, eaten and weighed.
export function daySummary(day) {
  if (!day) return "Nothing logged";
  const parts = [];
  if (hasLift(day)) { const sets = liftedSets(day); parts.push(sets ? `lifting, ${sets} set${sets === 1 ? "" : "s"}` : "lifting planned, no sets logged"); }
  if (runMiles(day)) parts.push(`run, ${runMiles(day)}${NBSP}mi`);
  if (Number.parseFloat(day.nutrition?.calories) > 0) parts.push(`${day.nutrition.calories}${NBSP}kcal${day.nutrition?.protein ? `, ${day.nutrition.protein}${NBSP}g protein` : ""}`);
  if (day.body?.weight) parts.push(`${day.body.weight}${NBSP}lb`);
  return parts.length ? sentence(parts.join(" · ")) : "Nothing logged";
}

function matches(dateKey, day, query) {
  const q = query.toLowerCase();
  if (dateKey.includes(q) || dayDate(dateKey).toLowerCase().includes(q)) return true;
  if (Object.keys(day.workout?.exercises || {}).some((name) => name.toLowerCase().includes(q))) return true;
  if ((day.workout?.notes || "").toLowerCase().includes(q)) return true;
  return [day.workout?.cardio?.miles, day.nutrition?.calories, day.nutrition?.protein].some((value) => String(value || "").includes(q));
}

// A day, read-only.
export function DayDetail({ data, dateKey, program, goals = {}, onOpenDay, onClose }) {
  const [allLifts, setAllLifts] = useState(false);
  const day = data[dateKey] || defaultDay();
  const dayName = getDayName(new Date(`${dateKey}T12:00:00`));
  const planned = program?.[dayName] || DEFAULT_PROGRAM[dayName];
  const exercises = Object.entries(day.workout?.exercises || {});
  const shown = allLifts ? exercises : exercises.slice(0, 3);
  const cardio = day.workout?.cardio || {};
  const nutrition = day.nutrition || {};
  const body = day.body || {};
  const fuelLogged = Number.parseFloat(nutrition.calories) > 0 || Number.parseFloat(nutrition.protein) > 0 || Number.parseFloat(nutrition.water) > 0;
  const bodyRows = [["Weight", body.weight, "lb"], ["Sleep", body.sleep, "h"], ["Energy", body.energy, "of 10"], ["Soreness", body.soreness, "of 10"], ["Waist", body.waist, "in"]].filter(([, value]) => value);
  const against = (goal, unit) => (Number.parseFloat(goal) > 0 ? `of ${Number(goal).toLocaleString("en-US")}${NBSP}${unit}` : unit);
  const figure = (label, value, unit) => (
    <div key={label} className="kv"><span className="t-c c2">{label}</span><span><span className="n">{value}</span> <span className="t-s c2">{unit}</span></span></div>
  );
  const empty = exercises.length === 0 && !runMiles(day) && !fuelLogged && bodyRows.length === 0 && !day.workout?.notes;

  return (
    <div style={column(16)} data-section="day-detail">
      {onClose && (
        <div className="sec">
          <h2 className="t-title">{dayDate(dateKey)}</h2>
          <button type="button" className="btn btn-g btn-sm" onClick={onClose}>Close day</button>
        </div>
      )}
      {empty && <p className="t-b c2">Nothing was logged on this day.</p>}

      {exercises.length > 0 && (
        <section aria-label="Lifting" style={column(8)}>
          <div className="sec"><h3 className="t-h">{planned?.type || "Lifting"}</h3><span className="t-s c2">{liftedSets(day)} sets</span></div>
          <dl style={column(10)}>
            {shown.map(([name, exercise]) => (
              <div key={name} className="kv">
                <dt className="t-bs">{name}</dt>
                <dd className="n-s c2">{doneSets(exercise).length ? doneSets(exercise).map((set) => displaySet(set, exercise)).join(`${NBSP}${NBSP} `) : "No sets completed"}</dd>
              </div>
            ))}
          </dl>
          {exercises.length > 3 && (
            <button type="button" className="btn btn-g btn-sm" aria-expanded={allLifts} onClick={() => setAllLifts((value) => !value)} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>
              {allLifts ? "Show fewer exercises" : `Show ${exercises.length - 3} more exercise${exercises.length - 3 === 1 ? "" : "s"}`}
            </button>
          )}
        </section>
      )}

      {runMiles(day) > 0 && (
        <section aria-label="Run" style={{ ...column(4), borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <h3 className="t-h">Run</h3>
          <p className="n">{[`${cardio.miles}${NBSP}mi`, cardio.time, cardio.pace ? `${String(cardio.pace).replace(/\s*\/mi(le)?$/, "")}${NBSP}min/mi` : ""].filter(Boolean).join(" · ")}</p>
        </section>
      )}

      {day.workout?.notes && (
        <section aria-label="Notes" style={{ ...column(4), borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <h3 className="t-h">Notes</h3>
          <p className="t-b">{day.workout.notes}</p>
        </section>
      )}

      {fuelLogged && (
        <section aria-label="Fuel" style={{ ...column(8), borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <h3 className="t-h">Fuel</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px 16px" }}>
            {figure("Calories", nutrition.calories ? Number(nutrition.calories).toLocaleString("en-US") : "—", against(goals.calories, "kcal"))}
            {figure("Protein", nutrition.protein || "—", against(goals.protein, "g"))}
            {figure("Carbs · Fat", `${nutrition.carbs || "—"} · ${nutrition.fats || "—"}`, "g")}
            {figure("Water", nutrition.water || 0, against(goals.water, "oz"))}
          </div>
        </section>
      )}

      {bodyRows.length > 0 && (
        <section aria-label="Body" style={{ ...column(8), borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <h3 className="t-h">Body</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px 16px" }}>
            {bodyRows.map(([label, value, unit]) => figure(label, value, unit))}
          </div>
        </section>
      )}

      {onOpenDay && <button type="button" className="btn btn-s btn-b" onClick={() => onOpenDay(dateKey)}>Edit this day</button>}
    </div>
  );
}

function Calendar({ data, month, setMonth, picked, onPick, todayKey }) {
  const [year, monthNumber] = month.split("-").map(Number);
  const offset = new Date(year, monthNumber - 1, 1).getDay();
  const length = new Date(year, monthNumber, 0).getDate();
  const atCurrentMonth = month >= todayKey.slice(0, 7);
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" className="ibtn ibtn-o" aria-label={monthName(previous)} onClick={() => setMonth(previous)}><Icon name="back" /></button>
        <h2 className="t-h grow" style={{ textAlign: "center" }} aria-live="polite">{monthName(month)}</h2>
        <button type="button" className="ibtn ibtn-o" aria-label={monthName(next)} aria-disabled={atCurrentMonth || undefined} onClick={() => !atCurrentMonth && setMonth(next)} style={atCurrentMonth ? { color: "var(--ink-3)" } : undefined}><Icon name="next" /></button>
      </div>
      <div className="cal" aria-hidden="true">
        {["S", "M", "T", "W", "T", "F", "S"].map((letter, index) => <span key={index} className="t-c c2" style={{ textAlign: "center" }}>{letter}</span>)}
      </div>
      <div className="cal" role="group" aria-label={monthName(month)}>
        {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} />)}
        {Array.from({ length }, (_, index) => {
          const dateKey = `${month}-${pad(index + 1)}`;
          const day = data[dateKey];
          const lift = hasLift(day);
          const run = runMiles(day) > 0;
          const future = dateKey > todayKey;
          const what = future ? "not here yet" : [lift && "lifting", run && "run", day && !lift && !run && "logged"].filter(Boolean).join(", ") || "nothing logged";
          return (
            <button
              key={dateKey}
              type="button"
              className="dayc"
              aria-label={`${dayDate(dateKey)}: ${what}`}
              aria-current={dateKey === todayKey ? "date" : undefined}
              aria-pressed={dateKey === picked}
              aria-disabled={future || undefined}
              onClick={() => !future && onPick(dateKey)}
            >
              {index + 1}
              <span className="mk">{lift && <i className="mk-l" />}{run && <i className="mk-r" />}</span>
            </button>
          );
        })}
      </div>
      <p className="t-c c2" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <i className="mk-l" style={{ color: "var(--ink)" }} />Lift<i className="mk-r" style={{ color: "var(--ink)", marginLeft: 10 }} />Run<span style={{ marginLeft: 10 }}>A box marks today.</span>
      </p>
    </>
  );
}

function Timeline({ data, filter, setFilter, onOpen }) {
  const timeline = useMemo(() => buildAthleteTimeline(data, { limit: 100 }), [data]);
  const filtered = filterTimelineEvents(timeline, filter);
  const groups = groupTimelineByDate(filtered);
  const summary = summarizeTimeline(filtered);
  return (
    <>
      <div className="chips" role="group" aria-label="Show">
        {EVENT_TYPES.map(([key, label]) => <button key={key} type="button" className="chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
        <span className="kv"><span className="t-c c2">Training days</span><span className="n-md">{summary.recentTrainingDays}</span></span>
        <span className="kv"><span className="t-c c2">Miles</span><span className="n-md">{summary.recentMiles}</span></span>
        <span className="kv"><span className="t-c c2">Volume</span><span className="n-md">{Math.round(summary.recentVolume / 1000)}k<span className="t-s c2"> lb</span></span></span>
      </div>
      <p className="t-s c2" role="status">{summary.total} event{summary.total === 1 ? "" : "s"}, built from your workouts, fuel, recovery, notes and coach decisions. The figures above cover the last 7 training days shown.</p>
      {filtered.length === 0 && <p className="t-b c2">No events match.</p>}
      {groups.map((group) => (
        <section key={group.date} aria-label={group.dayLabel} style={column(0)}>
          <button type="button" className="row" onClick={() => onOpen(group.date)} style={{ borderBottom: "1px solid var(--edge)", minHeight: 48 }}>
            <span className="t-ss grow">{group.dayLabel}</span>
            <Icon name="next" size="s" className="c2" />
          </button>
          <ul className="rows">
            {group.events.map((event, index) => {
              // Only what the line above does not already say.
              const said = String(event.detail || "");
              const metrics = Object.entries(event.metrics || {})
                .filter(([, value]) => value !== null && value !== undefined && value !== 0 && value !== "" && !said.includes(String(value)))
                .slice(0, 4);
              return (
                <li key={`${event.id}-${index}`} className="row" style={{ alignItems: "flex-start", paddingTop: 10, paddingBottom: 10 }}>
                  <span className="kv grow">
                    <span className="t-bs">{event.title}</span>
                    <span className="t-s c2">{event.detail}</span>
                    {metrics.length > 0 && <span className="t-s c2">{metrics.map(([key, value]) => `${sentence(key)} ${Number(value).toLocaleString("en-US")}`).join(" · ")}</span>}
                  </span>
                  {(TYPE_LABEL[event.type] || sentence(event.type)) !== event.title && (
                    <span className={event.tone === "warning" ? "tag tag-x" : "tag tag-f"}>{TYPE_LABEL[event.type] || sentence(event.type)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

export function ProgressHistory({ data, program, goals, selectedDay, onSelectDay, isBroadsheet = false, onOpenDay }) {
  const todayKey = getTodayKey();
  const [view, setView] = useState("calendar");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [month, setMonth] = useState(() => todayKey.slice(0, 7));
  const [picked, setPicked] = useState(todayKey);

  const query = search.trim();
  const results = useMemo(
    () => (query ? Object.entries(data).filter(([dateKey, day]) => matches(dateKey, day, query)).sort((a, b) => b[0].localeCompare(a[0])) : []),
    [data, query]
  );
  // On a wide screen a picked day opens beside the list; on a phone it shows
  // its one-line summary first and opens from there.
  const pick = (dateKey) => { setPicked(dateKey); if (isBroadsheet) onSelectDay(dateKey); };
  const dayRow = (dateKey, style) => (
    <button type="button" className="row" onClick={() => onSelectDay(dateKey)} style={{ minHeight: 64, ...style }}>
      <span className="kv grow"><span className="t-bs">{dayDate(dateKey)}</span><span className="t-s c2">{daySummary(data[dateKey])}</span></span>
      <Icon name="next" size="s" className="c2" />
    </button>
  );
  const detail = selectedDay
    ? <DayDetail key={selectedDay} data={data} dateKey={selectedDay} program={program} goals={goals} onOpenDay={onOpenDay} onClose={isBroadsheet ? () => onSelectDay(null) : undefined} />
    : null;

  if (selectedDay && !isBroadsheet) return <div className="shell" data-screen="progress-day"><div className="main">{detail}</div></div>;

  const master = (
    <>
      <label className="field">
        <span className="lbl">Search your log</span>
        <input className="input" type="search" autoComplete="off" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      {query ? (
        <>
          <p className="t-s c2" role="status">{results.length} day{results.length === 1 ? "" : "s"} match{results.length === 1 ? "es" : ""} “{query}”.</p>
          {results.length === 0
            ? <p className="t-b c2">Try a lift name, a date like 2026-11 or Nov 21, or a word from your notes.</p>
            : <ul className="rows">{results.slice(0, 60).map(([dateKey]) => <li key={dateKey}>{dayRow(dateKey)}</li>)}</ul>}
        </>
      ) : (
        <>
          <Seg label="View" options={[{ value: "calendar", label: "Calendar" }, { value: "timeline", label: "Timeline" }]} value={view} onChange={setView} />
          {view === "calendar" ? (
            <>
              <Calendar data={data} month={month} setMonth={setMonth} picked={picked} onPick={pick} todayKey={todayKey} />
              {dayRow(picked, { borderTop: "1px solid var(--line)" })}
            </>
          ) : (
            <Timeline data={data} filter={filter} setFilter={setFilter} onOpen={onSelectDay} />
          )}
        </>
      )}
    </>
  );

  if (!isBroadsheet) return <div className="shell" data-screen="progress-history"><div className="main">{master}</div></div>;
  return (
    <div className="shell" data-screen="progress-history">
      <div className="main" style={{ display: "grid", gridTemplateColumns: "var(--ovt-rail-m) minmax(0, 1fr)", gap: 32, alignItems: "start" }}>
        <section data-section="hist-master" style={{ ...column(12), minWidth: 0 }}>{master}</section>
        <section data-section="hist-detail" style={{ minWidth: 0, maxWidth: "var(--ovt-content-width)" }}>
          {detail || (
            <div data-section="hist-detail-hint" style={column(4)}>
              <h2 className="t-title">Day detail</h2>
              <p className="t-s c2">Pick a day on the calendar or the timeline and it opens here.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
