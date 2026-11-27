// src/ProgramBuilderPanel.jsx
// Program Builder V2 — product-facing panel
//
// Collects goals and constraints, shows the weekly prescriptions and rationale, then
// hands the caller an explicit Apply payload. It NEVER persists on its own —
// applying is an explicit user action wired in App.jsx. Cancel discards.
//
// Props:
//   settings        current settings (reads settings.programBuilder for defaults)
//   currentProgram  the athlete's current program (unused for generation; kept
//                   for parity / future "compare" affordances)
//   onApply({ program, preferences, plan })  called only when the user taps Apply
//   onCancel()      called when the user backs out — no writes happen
//   initialGoal     optional builder-goal id to preselect

import { useMemo, useState } from "react";
import { RadioRows, Seg, Switch } from "./ui/ledger";
import { AdaptiveLiftingChoice, BuilderEquipment, BuilderWeekPreview, TrainingWeekdays } from "./BuilderWeek";
import {
  PROGRAM_BUILDER_GOALS,
  PROGRAM_BUILDER_GOAL_IDS,
  TRAINING_DAY_OPTIONS,
  EQUIPMENT_COMBINATIONS,
  EXPERIENCE_LEVELS,
  SESSION_LENGTH_OPTIONS,
  CARDIO_PREFERENCES,
  CARDIO_MODALITIES,
  DAYS,
  goalUsesRunning,
  recommendTrainingDaysForGoal,
  recommendCardioPreference,
  normalizeProgramBuilderInput,
  buildProgramPlan,
  buildWeeklySchedule,
  summarizeGeneratedPlan,
  buildProgramBuilderSettingsPatch,
} from "./programBuilder";

// Build the initial draft from saved preferences (settings.programBuilder),
// falling back to goal-aware recommendations for anything missing.
function initialDraft(settings, initialGoal) {
  const saved = (settings && settings.programBuilder) || {};
  const goal =
    (PROGRAM_BUILDER_GOAL_IDS.includes(initialGoal) && initialGoal) ||
    (PROGRAM_BUILDER_GOAL_IDS.includes(saved.goal) && saved.goal) ||
    "hybrid";
  return {
    goal,
    scheduleChosen: Boolean(saved.trainingDaysPerWeek),
    adaptiveTraining: saved.adaptiveTraining !== false,
    cardioModality: saved.cardioModality || "mixed",
    includeIntervals: typeof saved.includeIntervals === "boolean" ? saved.includeIntervals : undefined,
    trainingDaysPerWeek: saved.trainingDaysPerWeek || recommendTrainingDaysForGoal(goal),
    restDays: Array.isArray(saved.restDays) ? saved.restDays : [],
    longRunDay: saved.longRunDay || "Saturday",
    equipment: saved.equipment || "full_gym",
    equipmentChoices: Array.isArray(saved.equipmentChoices) ? saved.equipmentChoices
      : saved.equipment === "mixed" ? EQUIPMENT_COMBINATIONS.map(item => item.id) : [],
    experience: saved.experience || "intermediate",
    sessionLength: saved.sessionLength || 60,
    cardioPreference: saved.cardioPreference || recommendCardioPreference(goal),
  };
}

const STEPS = ["Goal and time", "Your week", "Cardio and preview"];

// Build a program in three steps. Every answer has a default, the preview
// follows the answers, and nothing changes until "Use this program".
// Train's top bar goes back (and so cancels); nothing is saved until Apply.
export function ProgramBuilderPanel({ settings, onApply, initialGoal, hasRacePlan = false }) {
  const [draft, setDraft] = useState(() => initialDraft(settings, initialGoal));
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [keepExistingRace, setKeepExistingRace] = useState(true);
  const usesRunning = goalUsesRunning(draft.goal);

  const setGoal = (goal) => {
    setDraft((d) => d.goal === goal ? d : ({
      ...d,
      goal,
      trainingDaysPerWeek: d.scheduleChosen ? d.trainingDaysPerWeek : recommendTrainingDaysForGoal(goal),
      includeIntervals: undefined,
      cardioPreference: recommendCardioPreference(goal),
    }));
  };
  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const setSchedule = (fields) => setDraft(d => ({ ...d, ...fields, scheduleChosen: true }));
  const plan = useMemo(() => buildProgramPlan(draft), [draft]);
  const norm = plan.input;
  const summary = summarizeGeneratedPlan(plan);
  const trainingDays = DAYS.filter(day => !norm.restDays.includes(day));
  const cardioOnly = norm.goal === "cardio_only";
  const canScheduleQuality = (usesRunning || cardioOnly) && norm.experience !== "beginner" &&
    Object.values(buildWeeklySchedule({ ...norm, includeIntervals: true })).some(role => role === "quality_run" || role === "tempo_run");

  const apply = async () => {
    if (busy) return;
    setBusy(true);
    const stampedInput = normalizeProgramBuilderInput({ ...norm, generatedAt: new Date().toISOString() });
    const stampedPlan = buildProgramPlan(stampedInput);
    const preferences = buildProgramBuilderSettingsPatch(stampedPlan.input, stampedPlan).programBuilder;
    try {
      await onApply({ program: stampedPlan.program, preferences, plan: stampedPlan, keepExistingRace });
    } finally {
      setBusy(false);
    }
  };

  const restDays = 7 - norm.trainingDaysPerWeek;
  const go = (next) => {
    setStep(next);
    (document.scrollingElement || document.documentElement).scrollTop = 0;
  };

  return (
    <div className="shell" data-screen="train-builder">
      <div className="main" style={{ gap: 20 }}>
        <div className="kv" style={{ gap: 6 }}>
          <p className="t-s c2" aria-live="polite">Step {step + 1} of 3 · {STEPS[step]}.{step < 2 ? ` Then ${STEPS.slice(step + 1).map((name) => name.toLowerCase()).join(", then ")}.` : ""}</p>
          <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
            {STEPS.map((name, i) => <span key={name} style={{ height: 4, borderRadius: 2, background: i <= step ? "var(--ink)" : "var(--line)" }} />)}
          </div>
        </div>

        {step === 0 && (
          <>
            <RadioRows id="pb-goal" label="What are you training for?" options={PROGRAM_BUILDER_GOALS} value={draft.goal} onChange={setGoal} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span id="pb-days" className="lbl">Training days per week</span>
              <Seg labelledBy="pb-days" options={TRAINING_DAY_OPTIONS.map((n) => ({ value: n, label: String(n) }))} value={draft.trainingDaysPerWeek} onChange={(v) => setSchedule({ trainingDaysPerWeek: v })} />
              <p className="t-s c2">{restDays} rest day{restDays === 1 ? "" : "s"} a week.</p>
            </div>
            <RadioRows id="pb-exp" label="Experience" options={EXPERIENCE_LEVELS} value={draft.experience} onChange={(v) => set("experience", v)} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span id="pb-len" className="lbl">Session length (min)</span>
              <Seg labelledBy="pb-len" options={SESSION_LENGTH_OPTIONS.map((n) => ({ value: n, label: String(n) }))} value={draft.sessionLength} onChange={(v) => set("sessionLength", v)} />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <TrainingWeekdays input={norm} onChange={setSchedule} />
            {usesRunning && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span id="pb-long" className="lbl">Long run day</span>
                <Seg labelledBy="pb-long" options={trainingDays.map(day => ({ value: day, label: day.slice(0, 3) }))} value={norm.longRunDay} onChange={(v) => set("longRunDay", v)} />
              </div>
            )}
            {cardioOnly ? (
              <>
                <RadioRows id="pb-modality" label="Cardio activity" options={CARDIO_MODALITIES} value={norm.cardioModality} onChange={(v) => set("cardioModality", v)} />
                {norm.cardioModality === "mixed" && (
                  <RadioRows id="pb-cardio-equipment" label="Available cardio equipment"
                    options={[{ id: "full_gym", label: "Gym cardio machines" }, { id: "bodyweight", label: "Walking and running only" }]}
                    value={(["full_gym", "machines"].includes(norm.equipment) || (norm.equipment === "mixed" && norm.equipmentChoices?.includes("machines"))) ? "full_gym" : "bodyweight"} onChange={(v) => set("equipment", v)} />
                )}
              </>
            ) : <BuilderEquipment id="pb-equip" equipment={draft.equipment} choices={draft.equipmentChoices} onChange={fields => setDraft(d => ({ ...d, ...fields }))} />}
          </>
        )}

        {step === 2 && (
          <>
            {!cardioOnly && !usesRunning && (
              <RadioRows id="pb-cardio" label="Cardio" options={CARDIO_PREFERENCES} value={norm.cardioPreference} onChange={(v) => set("cardioPreference", v)} />
            )}
            {canScheduleQuality && (
              <div className="row" style={{ minHeight: 44 }}>
                <span className="t-bs grow">Include a harder cardio session</span>
                <Switch label="Include a harder cardio session" checked={norm.includeIntervals} onChange={(v) => set("includeIntervals", v)} />
              </div>
            )}
            {summary.liftingDays > 0 && <AdaptiveLiftingChoice enabled={norm.adaptiveTraining} onChange={(v) => set("adaptiveTraining", v)} />}
            <BuilderWeekPreview id="pb-preview" summary={summary} plan={plan} />
            {plan.rationale?.length > 0 && (
              <section aria-labelledby="pb-why" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <h2 id="pb-why" className="t-h">Why this plan</h2>
                <ul className="lst">{plan.rationale.map((r) => <li key={r} className="t-s">{r}</li>)}</ul>
              </section>
            )}
            {plan.warnings?.length > 0 && (
              <section className="banner" aria-label="Heads up" style={{ flexDirection: "column", gap: 4 }}>
                <p className="t-ss">Heads up</p>
                <ul className="lst">{plan.warnings.map((w) => <li key={w} className="t-s">{w}</li>)}</ul>
              </section>
            )}
            <a className="t-s" href={`/training-guide.html#${plan.metadata.guideId || "dose"}`} target="_blank" rel="noreferrer">Read the training evidence ↗</a>
            {hasRacePlan && <div className="kv" style={{ gap: 4 }}>
              <div className="row"><span className="t-bs grow">Keep my race plan</span>
                <Switch label="Keep my race plan" checked={keepExistingRace} onChange={setKeepExistingRace} /></div>
              <p className="t-s c2">{keepExistingRace
                ? "Your race schedule sets the running days. A race workout can fall on a rest day in this preview."
                : "Applying this week will replace your race schedule with the training days shown above."}</p>
            </div>}
            <p className="t-s c2">Applying this week replaces your current program.</p>
          </>
        )}
      </div>
      <div className="foot foot-tab" style={{ flexDirection: "row", gap: 8 }}>
        {step > 0 && <button type="button" className="btn btn-s" onClick={() => go(step - 1)} style={{ flex: "1 1 0", minWidth: 0 }}>Back</button>}
        {step < 2
          ? <button type="button" className="btn btn-p" onClick={() => go(step + 1)} style={{ flex: "2 1 0", minWidth: 0 }}>Next: {STEPS[step + 1].toLowerCase()}</button>
          : <button type="button" className="btn btn-p" aria-disabled={busy || undefined} onClick={apply} style={{ flex: "2 1 0", minWidth: 0 }}>{busy ? "Applying…" : "Use this program"}</button>}
      </div>
    </div>
  );
}

export default ProgramBuilderPanel;
