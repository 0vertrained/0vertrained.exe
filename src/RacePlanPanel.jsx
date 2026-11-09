// src/RacePlanPanel.jsx
// Race plan — product-facing panel
//
// Set a race and the app builds the weeks between now and race day around
// your lifting. Same whitepaper/ruled layout as ProgramBuilderPanel: inputs,
// then a live preview of exactly what Save will store. It NEVER persists on
// its own — onSave(spec) / onEnd() are explicit user actions wired in
// MoreTab, which writes the spec into the program's `__raceBuild` marker.
//
// Props:
//   program   the athlete's raw program (lifting drives the leg-day hints)
//   todayKey  local YYYY-MM-DD (passed in; this module never reads the clock)
//   onSave(spec) → Promise<boolean>   onEnd() → Promise<boolean>   onCancel()

import { useMemo, useState } from "react";
import { useTheme } from "./theme";
import { DAYS } from "./constants";
import { useConfirm } from "./ui/ConfirmDialog";
import { RACE_DISTANCES, buildPaceZones, formatDuration, formatPace, parseDuration } from "./runPaces";
import {
  CROSS_TRAINING_OPTIONS,
  PLAN_DISTANCE_IDS,
  RUNS_PER_WEEK_OPTIONS,
  generateRunPlan,
  isRunPlanSpec,
  mondayOfKey,
  normalizeRunPlanSpec,
  planProgramWarnings,
  suggestQualityDay,
  summarizeRunPlan,
  validateRunPlanSpec,
} from "./runPlanGenerator";
import { formatPlanDate } from "./RaceWeekLine";

const RESULT_DISTANCE_IDS = ["5k", "10k", "half"];

function isoKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The Monday a new plan should start on: today if Monday, else next Monday. */
export function nextMondayKey(todayKey) {
  const monday = mondayOfKey(todayKey);
  if (!monday || monday === todayKey) return monday;
  const d = new Date(`${monday}T12:00:00`);
  d.setDate(d.getDate() + 7);
  return isoKey(d);
}

function initialDraft(program, todayKey) {
  if (isRunPlanSpec(program?.__raceBuild)) {
    const s = normalizeRunPlanSpec(program.__raceBuild);
    const testIsDate = s.benchmarkTest !== "auto" && s.benchmarkTest !== "none";
    return {
      raceName: s.raceName, distance: s.distance, raceDate: s.raceDate || "", startDate: s.startDate || nextMondayKey(todayKey),
      runsPerWeek: s.runsPerWeek, longRunDay: s.longRunDay, qualityDay: s.qualityDay, crossTraining: s.crossTraining,
      startLongRunMin: s.startLongRunMin,
      resultDistance: s.benchmark?.distance || "5k", resultTime: s.benchmark ? formatDuration(s.benchmark.seconds) : "",
      testMode: testIsDate ? "date" : s.benchmarkTest, testDate: testIsDate ? s.benchmarkTest : "",
    };
  }
  return {
    raceName: "", distance: "10k", raceDate: "", startDate: nextMondayKey(todayKey),
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

export function RacePlanPanel({ program, todayKey, onSave, onEnd, onCancel }) {
  const { C } = useTheme();
  const mono = C.fontFamily;
  const serif = C.serifFamily || mono;
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

  // Everything below derives from the normalized spec, so the preview is
  // exactly what Save stores.
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
    if (!(await confirm({ message: "End this race plan? Your runs go back to what your program says. Your lifting isn't affected.", confirmLabel: "End plan", destructive: true }))) return;
    setBusy(true);
    try { await onEnd?.(); } finally { setBusy(false); }
  };

  // ── styles (ProgramBuilderPanel's) ──
  const label = { fontFamily: mono, fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textDim, marginBottom: 8, fontWeight: 600 };
  const sectionWrap = { padding: "14px 16px", borderBottom: `1px solid ${C.line}` };
  const help = { fontSize: 11, color: C.textFaint, lineHeight: 1.6, marginTop: 8 };
  const input = { background: C.bg, border: `1px solid ${C.lineBright}`, color: C.text, fontFamily: mono, padding: "9px 10px", width: "100%", outline: "none", boxSizing: "border-box" };
  const zones = view.zones;
  const raceLabel = RACE_DISTANCES[draft.distance].label;

  return (
    <div style={{ fontFamily: mono, color: C.text }}>
      {confirmDialog}
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.line}`, background: C.panel, position: "sticky", top: 0, zIndex: 5 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: C.textFaint, marginBottom: 4 }}>Race plan</div>
            <div style={{ fontFamily: serif, fontSize: 20, fontWeight: 500, color: C.text, letterSpacing: "-0.01em" }}>{hasPlan ? "Your race plan" : "Train for a race"}</div>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="Close without saving"
            style={{ background: "none", border: `1px solid ${C.lineBright}`, color: C.textDim, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", cursor: busy ? "not-allowed" : "pointer", fontFamily: mono, padding: "6px 11px" }}>
            Cancel
          </button>
        </div>
      </div>

      {/* Race */}
      <div style={sectionWrap}>
        <div style={label}>Race</div>
        <Pills C={C} mono={mono} ariaLabel="Race distance"
          options={PLAN_DISTANCE_IDS.map((id) => ({ id, label: RACE_DISTANCES[id].label === "Half marathon" ? "Half" : RACE_DISTANCES[id].label }))}
          value={draft.distance} onChange={(v) => set("distance", v)} />
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <label style={{ display: "block" }}>
            <span style={{ ...help, display: "block", marginTop: 0, marginBottom: 4 }}>Race name</span>
            <input style={input} value={draft.raceName} maxLength={60} placeholder={`e.g. Chilly Willy ${raceLabel}`} onChange={(e) => set("raceName", e.target.value)} />
          </label>
          <label style={{ display: "block" }}>
            <span style={{ ...help, display: "block", marginTop: 0, marginBottom: 4 }}>Race date</span>
            <input style={input} type="date" value={draft.raceDate} min={todayKey} onChange={(e) => set("raceDate", e.target.value)} />
          </label>
        </div>
      </div>

      {/* Schedule */}
      <div style={sectionWrap}>
        <div style={label}>Runs per week</div>
        <Pills C={C} mono={mono} ariaLabel="Runs per week"
          options={RUNS_PER_WEEK_OPTIONS.map((n) => ({ id: n, label: String(n) }))}
          value={draft.runsPerWeek} onChange={(v) => set("runsPerWeek", v)} />
      </div>
      <div style={sectionWrap}>
        <div style={label}>Long run day</div>
        <Pills C={C} mono={mono} ariaLabel="Long run day"
          options={DAYS.map((d) => ({ id: d, label: d.slice(0, 3) }))}
          value={draft.longRunDay} onChange={setLongRunDay} />
      </div>
      <div style={sectionWrap}>
        <div style={label}>Hard run day</div>
        <Pills C={C} mono={mono} ariaLabel="Hard run day"
          options={DAYS.filter((d) => d !== draft.longRunDay).map((d) => ({ id: d, label: d.slice(0, 3) }))}
          value={view.spec.qualityDay} onChange={(v) => set("qualityDay", v)} />
        <div style={help}>
          {view.suggestedQuality === view.spec.qualityDay
            ? "Your heaviest leg day, if you have one. Hard days hard, easy days easy."
            : <>We'd suggest {view.suggestedQuality}: your heaviest leg day, so your easy days stay easy.{" "}
                <button type="button" onClick={() => set("qualityDay", view.suggestedQuality)} style={{ background: "none", border: "none", padding: 0, color: C.text, textDecoration: "underline", fontFamily: mono, fontSize: 11, cursor: "pointer" }}>Use {view.suggestedQuality.slice(0, 3)}</button></>}
        </div>
      </div>
      <div style={sectionWrap}>
        <div style={label}>Cross-training walk</div>
        <Pills C={C} mono={mono} ariaLabel="Cross-training walk"
          options={CROSS_TRAINING_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
          value={draft.crossTraining} onChange={(v) => set("crossTraining", v)} />
        <div style={help}>An easy incline walk the day after your hard run. Builds aerobic base without extra impact.</div>
      </div>
      <div style={sectionWrap}>
        <div style={label}>Start</div>
        <input style={input} type="date" value={draft.startDate || ""} aria-label="Plan start date" onChange={(e) => set("startDate", e.target.value)} />
        <div style={help}>{view.spec.startDate ? `Plans start on a Monday: ${formatPlanDate(view.spec.startDate)}.` : "Pick a start date."}</div>
      </div>

      {/* Where you are now */}
      <div style={sectionWrap}>
        <div style={label}>Longest comfortable run today</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StepButton C={C} mono={mono} label="−" aria="Decrease starting long run" onClick={() => set("startLongRunMin", Math.max(20, draft.startLongRunMin - 5))} />
          <span style={{ fontFamily: serif, fontSize: 20, minWidth: 80, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{draft.startLongRunMin} min</span>
          <StepButton C={C} mono={mono} label="+" aria="Increase starting long run" onClick={() => set("startLongRunMin", Math.min(120, draft.startLongRunMin + 5))} />
        </div>
        <div style={help}>The longest run you could finish today without stopping. Walk breaks count. Week 1 starts here.</div>
      </div>
      <div style={sectionWrap}>
        <div style={label}>Recent race or time trial <span style={{ color: C.textFaint, fontWeight: 400 }}>(optional)</span></div>
        <Pills C={C} mono={mono} ariaLabel="Result distance"
          options={RESULT_DISTANCE_IDS.map((id) => ({ id, label: id === "half" ? "Half" : RACE_DISTANCES[id].label }))}
          value={draft.resultDistance} onChange={(v) => set("resultDistance", v)} />
        <input style={{ ...input, marginTop: 10 }} inputMode="numeric" placeholder="Time, e.g. 27:30" aria-label="Result time" value={draft.resultTime} onChange={(e) => set("resultTime", e.target.value)} />
        {view.timeError && <div style={{ ...help, color: C.red }}>{view.timeError}</div>}
        {zones ? (
          <div style={{ marginTop: 10, borderTop: `1px solid ${C.line}` }}>
            <PaceRow C={C} mono={mono} name="Easy" value={`${formatPace(zones.easy.fast)}–${formatPace(zones.easy.slow)}/mi`} />
            <PaceRow C={C} mono={mono} name="Threshold" value={`${formatPace(zones.threshold)}/mi`} />
            <PaceRow C={C} mono={mono} name={`${raceLabel} pace`} value={`${formatPace(zones.race[draft.distance])}/mi`} />
            <PaceRow C={C} mono={mono} name={`${raceLabel} prediction`} value={formatDuration(zones.predictions[draft.distance])} />
          </div>
        ) : !view.timeError && (
          <div style={help}>No result yet? Leave it blank. Runs go by effort (talk test) until your first 5K test sets your paces.</div>
        )}
      </div>
      <div style={sectionWrap}>
        <div style={label}>5K test</div>
        <Pills C={C} mono={mono} ariaLabel="5K test"
          options={[{ id: "auto", label: "Start of build" }, { id: "date", label: "On a date" }, { id: "none", label: "None" }]}
          value={draft.testMode} onChange={(v) => set("testMode", v)} />
        {draft.testMode === "date" && (
          <input style={{ ...input, marginTop: 10 }} type="date" aria-label="5K test date" value={draft.testDate} onChange={(e) => set("testDate", e.target.value)} />
        )}
        <div style={help}>A Turkey Trot or a solo time trial. Enter the time here afterwards and every remaining pace updates.</div>
      </div>

      {/* ── Preview ── */}
      <div style={{ padding: "16px 16px 6px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontFamily: serif, fontSize: 17, fontWeight: 500, color: C.text }}>Plan preview</div>
          {view.plan && <div style={{ fontSize: 10.5, color: C.textDim, letterSpacing: "0.06em" }}>{view.plan.totalWeeks} weeks · race {formatPlanDate(view.plan.raceDate)}</div>}
        </div>
      </div>
      {view.check.errors.length > 0 && (
        <div style={{ ...sectionWrap, borderTop: `1px solid ${C.line}` }}>
          {view.check.errors.map((e) => <div key={e} style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>{e}</div>)}
        </div>
      )}
      {view.plan && (
        <div style={{ borderTop: `1px solid ${C.line}` }}>
          {view.rows.map((row) => (
            <div key={row.n} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "8px 16px", borderBottom: `1px solid ${C.line}`, background: row.cutback ? C.bg : C.block }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: C.text, fontWeight: 500 }}>{row.label}</div>
                <div style={{ fontSize: 10.5, color: C.textDim, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[row.quality, row.longMinutes ? `long ${row.longMinutes} min` : null].filter(Boolean).join(" · ")}</div>
              </div>
              <span style={{ fontSize: 11, color: C.textDim, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{row.totalRunMinutes} min</span>
            </div>
          ))}
        </div>
      )}
      {view.warnings.length > 0 && (
        <div style={sectionWrap}>
          <div style={label}>Heads up</div>
          <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 5 }}>
            {view.warnings.map((w) => <li key={w} style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.55 }}>{w}</li>)}
          </ul>
        </div>
      )}
      <div style={{ ...sectionWrap, borderBottom: "none" }}>
        <div style={help}>The plan sets your runs on Today each week and replaces your program's own runs while it's active. Your lifting stays exactly as written; walks stay too.</div>
      </div>

      {/* Footer — explicit Save / End / Cancel */}
      <div style={{ padding: "12px 16px calc(16px + env(safe-area-inset-bottom, 0px))", borderTop: `1px solid ${C.lineBright}`, background: C.panel, position: "sticky", bottom: 0, display: "flex", gap: 8 }}>
        {hasPlan ? (
          <button type="button" onClick={end} disabled={busy}
            style={{ flex: 1, background: "none", border: `1px solid ${C.lineBright}`, color: C.textDim, padding: "13px", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: mono, cursor: busy ? "not-allowed" : "pointer" }}>
            End plan
          </button>
        ) : (
          <button type="button" onClick={onCancel} disabled={busy}
            style={{ flex: 1, background: "none", border: `1px solid ${C.lineBright}`, color: C.textDim, padding: "13px", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: mono, cursor: busy ? "not-allowed" : "pointer" }}>
            Cancel
          </button>
        )}
        <button type="button" onClick={save} disabled={!canSave} aria-disabled={!canSave}
          style={{ flex: 2, background: C.bg, border: `1px solid ${canSave ? C.text : C.lineBright}`, color: canSave ? C.text : C.textFaint, padding: "13px", fontSize: 11.5, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: mono, fontWeight: 600, cursor: canSave ? "pointer" : "not-allowed" }}>
          {busy ? "Saving…" : hasPlan ? "Update plan →" : "Start plan →"}
        </button>
      </div>
    </div>
  );
}

function PaceRow({ C, mono, name, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0", borderBottom: `1px solid ${C.line}` }}>
      <span style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textDim }}>{name}</span>
      <span style={{ fontFamily: mono, fontSize: 13, color: C.text, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

function StepButton({ C, mono, label, aria, onClick }) {
  return (
    <button type="button" aria-label={aria} onClick={onClick}
      style={{ width: 44, height: 44, background: "none", border: `1px solid ${C.lineBright}`, color: C.text, fontFamily: mono, fontSize: 16, cursor: "pointer" }}>
      {label}
    </button>
  );
}

// ── Segmented pills (single-select) — same look as the Program Builder's ──
function Pills({ C, mono, options, value, onChange, ariaLabel }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.id)}
            style={{ padding: "9px 14px", border: `1px solid ${on ? C.text : C.lineBright}`, background: on ? C.text : "transparent", color: on ? C.bg : C.textDim, fontFamily: mono, fontSize: 11.5, letterSpacing: "0.06em", cursor: "pointer", fontWeight: on ? 600 : 500, minWidth: 44 }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default RacePlanPanel;
