// src/BlockScreen.jsx
// The Block, under Train: where this week sits in the training block, what
// the week is for, one suggestion, and the block's own settings. It plans and
// suggests only. Nothing here rewrites a program or a workout; the settings
// are kept on this device (see periodizationSettings.js).

import { useState } from "react";
import { DEFAULT_PROGRAM, getTodayKey, getDayName } from "./constants";
import { calcRecoveryScore } from "./recovery";
import { buildDailyLoads, computeRollingLoads } from "./loadModel";
import { buildDecisionContext, getDailyRecommendation } from "./decisionEngine";
import { buildPeriodizationPlan, suggestPeriodizationAction } from "./periodizationPlanner";
import {
  PERIODIZATION_GOAL_PRESETS,
  RUN_EMPHASIS_OPTIONS,
  STRENGTH_EMPHASIS_OPTIONS,
  MIN_BLOCK_WEEKS,
  MAX_BLOCK_WEEKS,
  normalizePeriodizationSettings,
  describePeriodizationPreview,
  periodizationSettingsChanged,
  buildPeriodizationStoragePatch,
  buildNextBlockSettings,
  buildBlockSnapshot,
  appendBlockHistory,
  readStoredPeriodization,
  writeStoredPeriodization,
  readStoredPeriodizationHistory,
  writeStoredPeriodizationHistory,
} from "./periodizationSettings";
import { RaceBlockSection } from "./RaceBlockSection";
import { FoldRow, Icon, Seg } from "./ui/ledger";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";

const NBSP = "\u00a0";
const column = (gap) => ({ display: "flex", flexDirection: "column", gap });
const sentence = (text) => (typeof text === "string" && text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text);
const shortDate = (dateKey) => (dateKey ? new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const RISK = { high: "High risk", medium: "Some risk", low: "Low risk" };

// Where the deload sits against the week it is now.
function deloadLine(plan) {
  if (plan.currentWeekNumber === plan.deloadWeek) return "This is the deload week.";
  if (plan.currentWeekNumber > plan.deloadWeek) return `The deload was week ${plan.deloadWeek}.`;
  return `Deload in week ${plan.deloadWeek}.`;
}

// A whole number with a button either side.
function Count({ label, value, min, max, less, more, onChange }) {
  return (
    <div className="field">
      <span className="lbl">{label}</span>
      <div className="step" role="group" aria-label={`${label}, ${min} to ${max}`} style={{ gridTemplateColumns: "48px minmax(0, 1fr) 48px", gap: 4 }}>
        <button type="button" aria-label={less} aria-disabled={value <= min || undefined} onClick={() => value > min && onChange(value - 1)} style={{ height: 48 }}><Icon name="minus" /></button>
        <span className="stepv"><span className="n" aria-live="polite">{value}</span></span>
        <button type="button" aria-label={more} aria-disabled={value >= max || undefined} onClick={() => value < max && onChange(value + 1)} style={{ height: 48 }}><Icon name="plus" /></button>
      </div>
    </div>
  );
}

export function BlockScreen({ data, settings, program, onOpenProgram }) {
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY);
  const [saved, setSaved] = useState(() => normalizePeriodizationSettings(readStoredPeriodization() || {}));
  const [draft, setDraft] = useState(saved);
  const [history, setHistory] = useState(() => readStoredPeriodizationHistory());

  const today = getTodayKey();
  const firstEntry = Object.keys(data || {}).sort()[0];
  const plan = buildPeriodizationPlan({
    startDate: draft.startDate || firstEntry || today,
    todayKey: today,
    program,
    entries: data,
    blockLengthWeeks: draft.blockLengthWeeks,
    blockName: draft.name,
    goal: draft.goal,
    deloadWeek: draft.deloadWeek,
    runEmphasis: draft.runEmphasis,
    strengthEmphasis: draft.strengthEmphasis,
  });

  // The suggestion reads today's recommendation and load; it changes neither.
  const yesterday = new Date(`${today}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  const todayName = getDayName(new Date(`${today}T12:00:00`));
  const trainingLoad = computeRollingLoads(buildDailyLoads(data, 28));
  const recommendation = getDailyRecommendation(buildDecisionContext({
    todayProgram: program?.[todayName] || DEFAULT_PROGRAM[todayName],
    entries: data,
    settings,
    trainingLoad,
    todayKey: today,
    recovery: calcRecoveryScore(data?.[yesterdayKey], data, yesterdayKey),
  }));
  const action = suggestPeriodizationAction({ plan, todayKey: today, recommendation, entries: data, trainingLoad });
  const current = action.currentWeek;
  const thisWeek = plan.weeks.find((week) => week.status === "current") || null;

  // Block settings: a draft until saved. Saving never touches a program or a workout.
  const dirty = periodizationSettingsChanged(saved, draft);
  const previewLines = describePeriodizationPreview(saved, draft);
  const ended = Boolean(plan.endDate) && today > plan.endDate;
  const set = (patch) => setDraft((value) => ({ ...value, ...patch }));
  const commit = (next, nextHistory = null) => {
    const patch = buildPeriodizationStoragePatch({ ...next, savedAt: new Date().toISOString() });
    writeStoredPeriodization(patch);
    const normalized = normalizePeriodizationSettings(patch);
    setSaved(normalized);
    setDraft(normalized);
    if (nextHistory) {
      writeStoredPeriodizationHistory(nextHistory);
      setHistory(nextHistory);
    }
  };
  const startNextBlock = () => commit(buildNextBlockSettings(plan), appendBlockHistory(history, buildBlockSnapshot(plan, today)));

  const strip = (week) => (week.status === "completed" ? "Done" : week.status === "current" ? "Now" : sentence(week.focus || week.label));

  const lead = (
    <>
      <header className="kv" style={{ gap: 4 }}>
        <h2 className="t-xl">{plan.name}</h2>
        <p className="t-s c2">Week {plan.currentWeekNumber} of {plan.blockLengthWeeks}. {deloadLine(plan)}</p>
        <p className="t-s c2">{plan.goal}</p>
        <p className="t-s c2">{shortDate(plan.startDate)} to {shortDate(plan.endDate)}. Running: {plan.emphasis.run}. Strength: {plan.emphasis.strength}.</p>
      </header>

      {ended && (
        <div className="banner" style={{ flexDirection: "column", gap: 6 }}>
          <p><b>This block has ended.</b> Starting the next one keeps this block under Past blocks.</p>
          <button type="button" className="btn btn-p btn-sm" onClick={startNextBlock} style={{ alignSelf: "flex-start" }}>Start next block</button>
        </div>
      )}

      <ol className="wkp" aria-label="Block weeks" style={{ gridTemplateColumns: `repeat(${plan.weeks.length}, minmax(0, 1fr))` }}>
        {plan.weeks.map((week) => (
          <li key={week.weekNumber} aria-current={week.status === "current" ? "step" : undefined}>
            <span style={week.status === "current" ? { border: "2px solid var(--ink)", fontWeight: 700 } : week.focus === "deload" ? { borderStyle: "dashed", borderColor: "var(--edge)" } : undefined}>
              <b style={week.status === "current" ? { color: "var(--ink)" } : undefined}>{week.weekNumber}</b>{strip(week)}
            </span>
          </li>
        ))}
      </ol>

      <section className="card" aria-labelledby="block-week" style={column(6)}>
        <h3 id="block-week" className="t-h">This week: {String(current?.focus || thisWeek?.focus || "the plan").toLowerCase()}</h3>
        {thisWeek?.guidance && <p className="t-b">{thisWeek.guidance}</p>}
        <p className="t-s c2">Last 7 days: {action.density.trainingDays} training day{action.density.trainingDays === 1 ? "" : "s"}, {action.density.miles}{NBSP}mi.</p>
        <p className="t-s c2">Your program: {plan.programAnalysis.liftingDays} lifting, {plan.programAnalysis.runDays} running and {plan.programAnalysis.hardDays} hard day{plan.programAnalysis.hardDays === 1 ? "" : "s"} a week, {plan.programAnalysis.weeklyMiles}{NBSP}mi.</p>
      </section>

      <section className="banner" aria-labelledby="block-suggestion" style={{ flexDirection: "column", gap: 6 }}>
        <div className="sec"><h3 id="block-suggestion" className="t-ss">One suggestion</h3><span className="tag">{RISK[action.risk] || sentence(action.risk)}</span></div>
        <p><b>{action.title || sentence(String(action.action).replace(/_/g, " "))}.</b> {action.rationale}</p>
        {action.suggestedChanges.length > 0 && <ul className="lst">{action.suggestedChanges.map((change) => <li key={`${change.type}-${change.label}`}>{change.label}</li>)}</ul>}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {typeof onOpenProgram === "function" && <button type="button" className="btn btn-s btn-sm" onClick={onOpenProgram}>Open the program</button>}
          <span className="t-s c2">Suggestions never edit your program.</span>
        </div>
      </section>

      <RaceBlockSection program={program} />
    </>
  );

  const weeks = (
    <table className="tbl" aria-label="The weeks of this block">
      <thead><tr><th scope="col">Week</th><th scope="col">What it is for</th><th scope="col" style={{ textAlign: "right", paddingRight: 0 }}>Volume</th></tr></thead>
      <tbody>
        {plan.weeks.map((week) => (
          <tr key={week.weekNumber} aria-current={week.status === "current" ? "step" : undefined}>
            <th scope="row" style={{ whiteSpace: "nowrap" }}>
              <span className="kv" style={{ gap: 2 }}>
                <span className="n-s" style={{ fontWeight: week.status === "current" ? 700 : undefined }}>{week.weekNumber}</span>
                <span className={week.status === "current" ? "t-s" : "t-s c2"} style={{ fontWeight: week.status === "current" ? 700 : undefined }}>{strip(week)}</span>
              </span>
            </th>
            <td style={{ whiteSpace: "normal" }}>
              <span className="kv" style={{ gap: 2 }}>
                <span className="t-s">{week.label}. {week.guidance}</span>
                <span className="t-s c2">{shortDate(week.startDate)} to {shortDate(week.endDate)}{week.targetMiles ? `, about ${week.targetMiles}${NBSP}mi` : ""}</span>
              </span>
            </td>
            <td className="n-s" style={{ verticalAlign: "top" }}>{Math.round(week.volumeMultiplier * 100)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const form = (
    <>
      <label className="field"><span className="lbl">Block name</span><input className="input" value={draft.name} onChange={(event) => set({ name: event.target.value })} /></label>
      <div style={column(6)}>
        <span id="block-goal" className="lbl">Goal</span>
        <div className="chips" role="radiogroup" aria-labelledby="block-goal">
          {Object.entries(PERIODIZATION_GOAL_PRESETS).map(([key, preset]) => (
            <button key={key} type="button" className="chip" role="radio" aria-checked={draft.goalPreset === key} onClick={() => set({ goalPreset: key, goal: key === "custom" ? draft.goal : (preset.goal || draft.goal) })}>{preset.label}</button>
          ))}
        </div>
      </div>
      <label className="field"><span className="lbl">Goal, in your words</span><textarea className="input area" rows={2} value={draft.goal} onChange={(event) => set({ goal: event.target.value })} /></label>
      <label className="field"><span className="lbl">Start date</span><input className="input" type="date" value={draft.startDate || plan.startDate} onChange={(event) => set({ startDate: event.target.value })} /></label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
        <Count label="Length (weeks)" value={draft.blockLengthWeeks} min={MIN_BLOCK_WEEKS} max={MAX_BLOCK_WEEKS} less="One week shorter" more="One week longer" onChange={(value) => set({ blockLengthWeeks: value, deloadWeek: Math.min(value, draft.deloadWeek || value) })} />
        <Count label="Deload week" value={draft.deloadWeek} min={1} max={draft.blockLengthWeeks} less="Earlier" more="Later" onChange={(value) => set({ deloadWeek: value })} />
      </div>
      <div className="field">
        <span id="block-running" className="lbl">Running</span>
        <Seg labelledBy="block-running" options={RUN_EMPHASIS_OPTIONS.map((value) => ({ value, label: sentence(value) }))} value={draft.runEmphasis} onChange={(value) => set({ runEmphasis: value })} />
      </div>
      <div className="field">
        <span id="block-strength" className="lbl">Strength</span>
        <Seg labelledBy="block-strength" options={STRENGTH_EMPHASIS_OPTIONS.map((value) => ({ value, label: sentence(value) }))} value={draft.strengthEmphasis} onChange={(value) => set({ strengthEmphasis: value })} />
      </div>
      {dirty && previewLines.length > 0 && (
        <div className="banner" style={{ flexDirection: "column", gap: 4 }}>
          <p className="t-ss">Not saved yet</p>
          <ul className="lst">{previewLines.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-p" aria-disabled={!dirty || undefined} onClick={() => dirty && commit(draft)} style={{ flex: "1 1 0", minWidth: 0 }}>Save block</button>
        {dirty && <button type="button" className="btn btn-s" onClick={() => setDraft(saved)}>Reset</button>}
      </div>
      <p className="t-s c2">Kept on this device. Saving changes the plan you read here. It never rewrites your program or a workout.</p>
    </>
  );

  const past = history.length > 0 && (
    <FoldRow title="Past blocks" sub={`${history.length} kept on this device`}>
      <ul className="rows">
        {history.map((block, index) => (
          <li key={block.id || `${block.name}-${index}`} className="row" style={{ minHeight: 48 }}>
            <span className="t-bs grow">{block.name}</span>
            <span className="t-s c2">Ended {shortDate(String(block.endDate || block.completedAt || "").slice(0, 10)) || "date not known"}</span>
          </li>
        ))}
      </ul>
    </FoldRow>
  );

  const folds = (
    <ul className="rows" style={{ borderTop: "1px solid var(--line)" }}>
      {!isBroadsheet && <FoldRow title="All weeks" sub="What each week of the block is for">{weeks}</FoldRow>}
      <FoldRow title="Block settings" sub="Name, goal, length, deload week and emphasis" tag={dirty ? "Not saved" : null}>{form}</FoldRow>
      {past}
    </ul>
  );

  if (isBroadsheet) {
    return (
      <div className="shell" data-screen="train-block" style={{ maxWidth: "var(--ovt-shell-width, var(--ovt-content-width))" }}>
        <div className="main" style={{ display: "grid", gridTemplateColumns: "var(--ovt-rail-m) minmax(0, 1fr)", gap: 48, alignItems: "start" }}>
          <section data-section="prog-rail" style={{ ...column(16), minWidth: 0 }}>{lead}</section>
          <section data-section="prog-table" style={{ ...column(16), minWidth: 0, maxWidth: "var(--ovt-content-width)" }}>
            <h3 className="t-h">All weeks</h3>
            {weeks}
            {folds}
          </section>
        </div>
      </div>
    );
  }
  return (
    <div className="shell" data-screen="train-block">
      <div className="main" style={{ gap: 16 }}>
        {lead}
        {folds}
      </div>
    </div>
  );
}

export default BlockScreen;
