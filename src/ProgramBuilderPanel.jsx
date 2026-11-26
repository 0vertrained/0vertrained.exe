// src/ProgramBuilderPanel.jsx
// Program Builder V2 — product-facing panel
//
// Mobile-first, whitepaper/ruled builder UI. Collects goal + constraints, shows
// a live weekly preview, rationale/warnings and a 4-week variation preview, then
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
import { Seg } from "./ui/ledger";
import {
  PROGRAM_BUILDER_GOALS,
  PROGRAM_BUILDER_GOAL_IDS,
  TRAINING_DAY_OPTIONS,
  EQUIPMENT_OPTIONS,
  EXPERIENCE_LEVELS,
  SESSION_LENGTH_OPTIONS,
  CARDIO_PREFERENCES,
  DAYS,
  goalUsesRunning,
  recommendTrainingDaysForGoal,
  recommendCardioPreference,
  normalizeProgramBuilderInput,
  buildProgramPlan,
  buildMultiWeekProgram,
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
    trainingDaysPerWeek: saved.trainingDaysPerWeek || recommendTrainingDaysForGoal(goal),
    restDays: Array.isArray(saved.restDays) ? saved.restDays : [],
    longRunDay: saved.longRunDay || "Saturday",
    equipment: saved.equipment || "full_gym",
    experience: saved.experience || "intermediate",
    sessionLength: saved.sessionLength || 60,
    cardioPreference: saved.cardioPreference || recommendCardioPreference(goal),
  };
}

// One choice of several, each with a line of explanation. One Tab stop;
// the arrow keys move the choice.
function Options({ id, label, options, value, onChange }) {
  const onKeyDown = (event) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = Math.max(0, options.findIndex((o) => o.id === value));
    const next = options[(index + step + options.length) % options.length];
    onChange(next.id);
    event.currentTarget.querySelector(`[data-id="${next.id}"]`)?.focus();
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span id={id} className="lbl">{label}</span>
      <div role="radiogroup" aria-labelledby={id} onKeyDown={onKeyDown} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {options.map((o) => (
          <button key={o.id} data-id={o.id} type="button" className="opt" role="radio" aria-checked={value === o.id} tabIndex={value === o.id ? 0 : -1} onClick={() => onChange(o.id)}>
            <span className="rad" aria-hidden="true" />
            <span className="kv grow"><span className="t-bs">{o.label}</span>{o.desc && <span className="t-s c2">{o.desc}</span>}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const STEPS = ["Goal and time", "Your week", "Cardio and preview"];

// Build a program in three steps. Every answer has a default, the preview
// follows the answers, and nothing changes until "Use this program".
// Train's top bar goes back (and so cancels); nothing is saved until Apply.
export function ProgramBuilderPanel({ settings, onApply, initialGoal }) {
  const [draft, setDraft] = useState(() => initialDraft(settings, initialGoal));
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const usesRunning = goalUsesRunning(draft.goal);

  const setGoal = (goal) => {
    setDraft((d) => ({
      ...d,
      goal,
      trainingDaysPerWeek: recommendTrainingDaysForGoal(goal),
      cardioPreference: recommendCardioPreference(goal),
    }));
  };
  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const toggleRestDay = (day) => {
    setDraft((d) => {
      const has = d.restDays.includes(day);
      const next = has ? d.restDays.filter((x) => x !== day) : [...d.restDays, day];
      return { ...d, restDays: next };
    });
  };

  const { plan, norm, summary, weeks } = useMemo(() => {
    const p = buildProgramPlan(draft);
    return {
      plan: p,
      norm: p.input,
      summary: summarizeGeneratedPlan(p),
      weeks: buildMultiWeekProgram(draft, 4),
    };
  }, [draft]);

  const apply = async () => {
    if (busy) return;
    setBusy(true);
    const stampedInput = normalizeProgramBuilderInput({ ...norm, generatedAt: new Date().toISOString() });
    const stampedPlan = buildProgramPlan(stampedInput);
    const preferences = buildProgramBuilderSettingsPatch(stampedPlan.input, stampedPlan).programBuilder;
    try {
      await onApply({ program: stampedPlan.program, preferences, plan: stampedPlan });
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
            <Options id="pb-goal" label="What are you training for?" options={PROGRAM_BUILDER_GOALS} value={draft.goal} onChange={setGoal} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span id="pb-days" className="lbl">Training days per week</span>
              <Seg labelledBy="pb-days" options={TRAINING_DAY_OPTIONS.map((n) => ({ value: n, label: String(n) }))} value={draft.trainingDaysPerWeek} onChange={(v) => set("trainingDaysPerWeek", v)} />
              <p className="t-s c2">{restDays} rest day{restDays === 1 ? "" : "s"} a week.</p>
            </div>
            <Options id="pb-exp" label="Experience" options={EXPERIENCE_LEVELS} value={draft.experience} onChange={(v) => set("experience", v)} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span id="pb-len" className="lbl">Session length (min)</span>
              <Seg labelledBy="pb-len" options={SESSION_LENGTH_OPTIONS.map((n) => ({ value: n, label: String(n) }))} value={draft.sessionLength} onChange={(v) => set("sessionLength", v)} />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span id="pb-rest" className="lbl">Preferred rest days (optional)</span>
              <div className="chips" role="group" aria-labelledby="pb-rest">
                {DAYS.map((day) => (
                  <button key={day} type="button" className="chip" aria-pressed={norm.restDays.includes(day)} onClick={() => toggleRestDay(day)}>{day.slice(0, 3)}</button>
                ))}
              </div>
              <p className="t-s c2">The plan keeps exactly {restDays}. Extra picks are dropped; too few, and it fills the rest.</p>
            </div>
            {usesRunning && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span id="pb-long" className="lbl">Long run day</span>
                <Seg labelledBy="pb-long" options={DAYS.map((d) => ({ value: d, label: <><span aria-hidden="true">{d.charAt(0)}</span><span className="sr">{d}</span></> }))} value={norm.longRunDay} onChange={(v) => set("longRunDay", v)} />
                <p className="t-s c2">{norm.longRunDay}. Heavy lower-body work is kept away from it.</p>
              </div>
            )}
            <Options id="pb-equip" label="Equipment" options={EQUIPMENT_OPTIONS} value={draft.equipment} onChange={(v) => set("equipment", v)} />
          </>
        )}

        {step === 2 && (
          <>
            <Options id="pb-cardio" label="Cardio" options={CARDIO_PREFERENCES} value={draft.cardioPreference} onChange={(v) => set("cardioPreference", v)} />
            <section aria-labelledby="pb-preview" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div className="sec"><h2 id="pb-preview" className="t-h">Your week</h2></div>
              <p className="t-s c2">{summary.headline}</p>
              <ol className="rows">
                {summary.days.map((d) => (
                  <li key={d.day} className="row" style={{ minHeight: 48 }}>
                    <span className="n-s c2" style={{ width: 40, flex: "none" }}>{d.day.slice(0, 3)}</span>
                    <span className="kv grow"><span className="t-bs clip">{d.isRest ? "Rest" : d.type}</span>{!d.isRest && d.label && <span className="t-s c2">{d.label}</span>}</span>
                  </li>
                ))}
              </ol>
            </section>
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
            <section aria-labelledby="pb-weeks" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <h2 id="pb-weeks" className="t-h">The first four weeks</h2>
              <ol className="rows">
                {weeks.map((w) => (
                  <li key={w.weekIndex} className="row" style={{ minHeight: 48 }}>
                    <span className="t-bs" style={{ width: 72, flex: "none" }}>{w.weekLabel}</span>
                    <span className="t-s c2 grow">{w.focus}</span>
                  </li>
                ))}
              </ol>
            </section>
            <p className="t-s c2">Using it replaces your program. A race plan stays.</p>
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
