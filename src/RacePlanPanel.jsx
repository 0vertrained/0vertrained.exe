// src/RacePlanPanel.jsx
// Race plan — product-facing panel
//
// Set a race and the app builds the weeks between now and race day around
// your lifting. Inputs,
// then a live preview of exactly what Save will store. It NEVER persists on
// its own — onSave(spec) / onEnd() are explicit user actions wired in
// Train, which writes the spec into the program's `__raceBuild` marker.
//
// Props:
//   program   the athlete's raw program (lifting drives the leg-day hints)
//   todayKey  local YYYY-MM-DD (passed in; this module never reads the clock)
//   onSave(spec) → Promise<boolean>   onEnd() → Promise<boolean>   onCancel()

import { useMemo, useState } from "react";
import { Icon, Seg } from "./ui/ledger";
import { DAYS } from "./constants";
import { useConfirm } from "./ui/ConfirmDialog";
import { RACE_DISTANCES, buildPaceZones, formatDuration, formatPace, parseDuration } from "./runPaces";
import {
  CROSS_TRAINING_OPTIONS,
  PLAN_DISTANCE_IDS,
  RUNS_PER_WEEK_OPTIONS,
  generateRunPlan,
  isRunPlanSpec,
  normalizeRunPlanSpec,
  planProgramWarnings,
  suggestQualityDay,
  summarizeRunPlan,
  validateRunPlanSpec,
} from "./runPlanGenerator";
import { formatPlanDate } from "./RaceWeekLine";

const RESULT_DISTANCE_IDS = ["5k", "10k", "15k", "half"];

function initialDraft(program, todayKey) {
  if (isRunPlanSpec(program?.__raceBuild)) {
    const s = normalizeRunPlanSpec(program.__raceBuild);
    const testIsDate = s.benchmarkTest !== "auto" && s.benchmarkTest !== "none";
    return {
      raceName: s.raceName, distance: s.distance, raceDate: s.raceDate || "", startDate: s.startDate || todayKey,
      runsPerWeek: s.runsPerWeek, longRunDay: s.longRunDay, qualityDay: s.qualityDay, crossTraining: s.crossTraining,
      startLongRunMin: s.startLongRunMin,
      resultDistance: s.benchmark?.distance || "5k", resultTime: s.benchmark ? formatDuration(s.benchmark.seconds) : "",
      testMode: testIsDate ? "date" : s.benchmarkTest, testDate: testIsDate ? s.benchmarkTest : "",
    };
  }
  return {
    raceName: "", distance: "10k", raceDate: "", startDate: todayKey,
    runsPerWeek: 4, longRunDay: "Saturday", qualityDay: suggestQualityDay(program, "Saturday"), crossTraining: "none",
    startLongRunMin: 35, resultDistance: "5k", resultTime: "", testMode: "auto", testDate: "",
  };
}

/** Panel draft → stored spec (unknown keys dropped by normalization). */
export function draftToSpec(draft) {
  const seconds = parseDuration(draft.resultTime || "");
  return normalizeRunPlanSpec({
    kind: "runPlan",
    raceName: draft.raceName,
    distance: draft.distance,
    raceDate: draft.raceDate,
    startDate: draft.startDate,
    runsPerWeek: draft.runsPerWeek,
    longRunDay: draft.longRunDay,
    qualityDay: draft.qualityDay,
    crossTraining: draft.crossTraining,
    startLongRunMin: draft.startLongRunMin,
    benchmark: seconds ? { distance: draft.resultDistance, seconds } : null,
    benchmarkTest: draft.testMode === "date" ? (draft.testDate || "auto") : draft.testMode,
  });
}

const column = (gap) => ({ display: "flex", flexDirection: "column", gap });
const dayLabel = (d) => <><span aria-hidden="true">{d.charAt(0)}</span><span className="sr">{d}</span></>;
const distanceLabel = (id) => (RACE_DISTANCES[id].label === "Half marathon" ? "Half" : RACE_DISTANCES[id].label);

function Choice({ id, label, children, hint = null }) {
  return (
    <div style={column(6)}>
      <span id={id} className="lbl">{label}</span>
      {children}
      {hint && <div className="t-s c2">{hint}</div>}
    </div>
  );
}

// Train › Race plan. Answers on one page, the plan previewed under them, and
// an explicit Start (or Update) to save. Train's Back leaves without saving.
export function RacePlanPanel({ program, todayKey, onSave, onEnd }) {
  const { confirm, confirmDialog } = useConfirm();
  const hasPlan = isRunPlanSpec(program?.__raceBuild);
  const [draft, setDraft] = useState(() => initialDraft(program, todayKey));
  const [busy, setBusy] = useState(false);

  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const setLongRunDay = (day) => setDraft((d) => ({
    ...d,
    longRunDay: day,
    qualityDay: d.qualityDay === day ? suggestQualityDay(program, day) : d.qualityDay,
  }));

  const view = useMemo(() => {
    const spec = draftToSpec(draft);
    const check = validateRunPlanSpec(spec);
    const plan = check.valid ? generateRunPlan(spec) : null;
    const typedTime = String(draft.resultTime || "").trim();
    const zones = buildPaceZones(spec.benchmark);
    const timeError = typedTime && !parseDuration(typedTime)
      ? "Use mm:ss or h:mm:ss."
      : typedTime && !zones ? `That doesn't look like a ${RACE_DISTANCES[draft.resultDistance].label} time.` : null;
    return {
      spec,
      check,
      plan,
      rows: summarizeRunPlan(plan),
      zones,
      timeError,
      suggestedQuality: suggestQualityDay(program, spec.longRunDay),
      warnings: [...(plan?.warnings || check.warnings), ...planProgramWarnings(program, spec)],
    };
  }, [draft, program]);

  const canSave = view.check.valid && !view.timeError && !busy;
  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try { await onSave?.(view.spec); } finally { setBusy(false); }
  };
  const end = async () => {
    if (busy) return;
    if (!(await confirm({ message: "End this race plan? Your runs go back to what your program says. Your lifting isn't affected.", confirmLabel: "End plan", destructive: true }))) return;
    setBusy(true);
    try { await onEnd?.(); } finally { setBusy(false); }
  };

  const zones = view.zones;
  const raceLabel = RACE_DISTANCES[draft.distance].label;
  const lengthMin = 20;
  const lengthMax = 120;

  return (
    <div className="shell" data-screen="train-race">
      {confirmDialog}
      <div className="main" style={{ gap: 20 }}>
        <h2 className="t-xl">{hasPlan ? "Your race plan" : "Train for a race"}</h2>
        {program?.__hybridBlock?.id === "roadTrailHybrid" && <p className="t-s c2">A dated race plan replaces the hybrid runs during its build. Your lifting still tapers in week 8 of Road &amp; Trail Hybrid.</p>}

        <section aria-labelledby="race-race" style={column(12)}>
          <h3 id="race-race" className="t-h">The race</h3>
          <Choice id="race-distance" label="Distance">
            <Seg labelledBy="race-distance" options={PLAN_DISTANCE_IDS.map((id) => ({ value: id, label: distanceLabel(id) }))} value={draft.distance} onChange={(v) => set("distance", v)} />
          </Choice>
          <label className="field"><span className="lbl">Race name</span><input className="input" value={draft.raceName} maxLength={60} placeholder={`e.g. Chilly Willy ${raceLabel}`} onChange={(e) => set("raceName", e.target.value)} /></label>
          <label className="field"><span className="lbl">Race date</span><input className="input" type="date" value={draft.raceDate} min={todayKey} onChange={(e) => set("raceDate", e.target.value)} /></label>
          <div className="field">
            <label className="lbl" htmlFor="race-start">Start date</label>
            <input id="race-start" className="input" type="date" value={draft.startDate || ""} aria-label="Plan start date" aria-describedby="race-start-hint" onChange={(e) => set("startDate", e.target.value)} />
            <span id="race-start-hint" className="hint">{view.spec.startDate ? `Running schedule starts ${formatPlanDate(view.spec.startDate)}.` : "Pick a start date."}</span>
          </div>
        </section>

        <hr className="hr" />
        <section aria-labelledby="race-week" style={column(12)}>
          <h3 id="race-week" className="t-h">Your week</h3>
          <Choice id="race-runs" label="Runs per week">
            <Seg labelledBy="race-runs" options={RUNS_PER_WEEK_OPTIONS.map((n) => ({ value: n, label: String(n) }))} value={draft.runsPerWeek} onChange={(v) => set("runsPerWeek", v)} />
          </Choice>
          <Choice id="race-long" label="Long run day">
            <Seg labelledBy="race-long" options={DAYS.map((d) => ({ value: d, label: dayLabel(d) }))} value={draft.longRunDay} onChange={setLongRunDay} />
          </Choice>
          <Choice
            id="race-hard"
            label="Hard run day"
            hint={view.suggestedQuality === view.spec.qualityDay
              ? "Your heaviest leg day, if you have one. Hard days hard, easy days easy."
              : <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>We suggest {view.suggestedQuality}: your heaviest leg day, so your easy days stay easy.<button type="button" className="btn btn-s btn-sm" onClick={() => set("qualityDay", view.suggestedQuality)}>Use {view.suggestedQuality}</button></span>}
          >
            <Seg labelledBy="race-hard" options={DAYS.filter((d) => d !== draft.longRunDay).map((d) => ({ value: d, label: dayLabel(d) }))} value={view.spec.qualityDay} onChange={(v) => set("qualityDay", v)} />
          </Choice>
          <Choice id="race-walk" label="Cross-training walk" hint="An easy incline walk the day after your hard run. It builds aerobic base without extra impact.">
            <Seg labelledBy="race-walk" options={CROSS_TRAINING_OPTIONS.map((o) => ({ value: o.id, label: o.label }))} value={draft.crossTraining} onChange={(v) => set("crossTraining", v)} />
          </Choice>
        </section>

        <hr className="hr" />
        <section aria-labelledby="race-fitness" style={column(12)}>
          <h3 id="race-fitness" className="t-h">Your fitness</h3>
          <div className="field">
            <span id="race-longest" className="lbl">Longest comfortable run today</span>
            <div className="step" role="group" aria-labelledby="race-longest" style={{ gridTemplateColumns: "48px minmax(0, 1fr) 48px", gap: 4 }}>
              <button type="button" aria-label="Decrease starting long run" aria-disabled={draft.startLongRunMin <= lengthMin || undefined} onClick={() => set("startLongRunMin", Math.max(lengthMin, draft.startLongRunMin - 5))} style={{ height: 48 }}><Icon name="minus" /></button>
              <span className="stepv"><span className="n" aria-live="polite">{draft.startLongRunMin}{"\u00a0"}min</span></span>
              <button type="button" aria-label="Increase starting long run" aria-disabled={draft.startLongRunMin >= lengthMax || undefined} onClick={() => set("startLongRunMin", Math.min(lengthMax, draft.startLongRunMin + 5))} style={{ height: 48 }}><Icon name="plus" /></button>
            </div>
            <span className="hint">The longest run you could finish today without stopping. Walk breaks count. Week 1 starts here.</span>
          </div>
          <Choice id="race-result" label="A recent race or time trial (optional)">
            <Seg labelledBy="race-result" options={RESULT_DISTANCE_IDS.map((id) => ({ value: id, label: distanceLabel(id) }))} value={draft.resultDistance} onChange={(v) => set("resultDistance", v)} />
            <input className="input n" inputMode="numeric" placeholder="Time, e.g. 27:30" aria-label="Result time" aria-invalid={view.timeError ? true : undefined} value={draft.resultTime} onChange={(e) => set("resultTime", e.target.value)} />
            {view.timeError && <p className="err" role="alert"><span>{view.timeError}</span></p>}
            {zones ? (
              <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 16px" }}>
                {[["Easy", `${formatPace(zones.easy.fast)}–${formatPace(zones.easy.slow)}/mi`], ["Threshold", `${formatPace(zones.threshold)}/mi`], [`${raceLabel} pace`, `${formatPace(zones.race[draft.distance])}/mi`], [`${raceLabel} prediction`, formatDuration(zones.predictions[draft.distance])]].map(([name, value]) => (
                  <div key={name} style={{ display: "contents" }}><dt className="t-s">{name}</dt><dd className="n-s">{value}</dd></div>
                ))}
              </dl>
            ) : !view.timeError && <p className="t-s c2">No result yet? Leave it blank. Runs go by effort (the talk test) until your first 5K test sets your paces.</p>}
          </Choice>
          <Choice id="race-test" label="5K test" hint="A Turkey Trot or a solo time trial. Enter the time here afterwards and every remaining pace updates.">
            <Seg labelledBy="race-test" options={[{ value: "auto", label: "Start of build" }, { value: "date", label: "On a date" }, { value: "none", label: "None" }]} value={draft.testMode} onChange={(v) => set("testMode", v)} />
            {draft.testMode === "date" && <input className="input" type="date" aria-label="5K test date" value={draft.testDate} onChange={(e) => set("testDate", e.target.value)} />}
          </Choice>
        </section>

        <hr className="hr" />
        <section aria-labelledby="race-preview" style={column(8)}>
          <div className="sec">
            <h3 id="race-preview" className="t-h">Plan preview</h3>
            {view.plan && <span className="t-s c2">{view.plan.totalWeeks} weeks · race {formatPlanDate(view.plan.raceDate)}</span>}
          </div>
          {view.check.errors.length > 0 && (
            <div style={column(4)}>{view.check.errors.map((e) => <p key={e} className="t-s caution">{e}</p>)}</div>
          )}
          {view.plan && (
            <ol className="rows">
              {view.rows.map((row) => (
                <li key={row.n} className="row" style={{ minHeight: 52 }}>
                  <span className="kv grow">
                    <span className="t-bs">{row.label}</span>
                    {(row.quality || row.longMinutes) && <span className="t-s c2">{[row.quality, row.longMinutes ? `long ${row.longMinutes} min` : null].filter(Boolean).join(" · ")}</span>}
                  </span>
                  <span className="n-s c2">{row.totalRunMinutes}{"\u00a0"}min</span>
                </li>
              ))}
            </ol>
          )}
          {view.warnings.length > 0 && (
            <div className="banner" style={{ flexDirection: "column", gap: 4 }}>
              <p className="t-ss">Heads up</p>
              <ul className="lst">{view.warnings.map((w) => <li key={w} className="t-s">{w}</li>)}</ul>
            </div>
          )}
          <p className="t-s c2">Today uses this plan’s running schedule during race training. {program?.__hybridBlock?.id === "roadTrailHybrid" ? "The hybrid program keeps its scheduled lifts, including on days without a race-plan run." : "Your program supplies the lifting except on the designated pre-race rest day and race day."}</p>
        </section>
      </div>
      <div className="foot foot-tab" style={{ flexDirection: "row", gap: 8 }}>
        {hasPlan && <button type="button" className="btn btn-s" aria-disabled={busy || undefined} onClick={end} style={{ flex: "1 1 0", minWidth: 0 }}>End plan</button>}
        <button type="button" className="btn btn-p" aria-disabled={!canSave || undefined} onClick={save} style={{ flex: "2 1 0", minWidth: 0 }}>{busy ? "Saving…" : hasPlan ? "Update plan" : "Start plan"}</button>
      </div>
    </div>
  );
}

export default RacePlanPanel;
