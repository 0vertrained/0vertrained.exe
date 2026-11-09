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
import { useTheme } from "./theme";
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

export function ProgramBuilderPanel({ settings, currentProgram, onApply, onCancel, initialGoal }) {
  const { C } = useTheme();
  const mono = C.fontFamily;
  const serif = C.serifFamily || mono;

  const [draft, setDraft] = useState(() => initialDraft(settings, initialGoal));
  const [busy, setBusy] = useState(false);

  const usesRunning = goalUsesRunning(draft.goal);

  // Changing the goal re-seeds training days + cardio recommendations so the
  // preview stays coherent, but keeps the athlete's explicit rest-day picks.
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

  // Everything downstream derives from the normalized input so the preview is
  // exactly what Apply will persist.
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
    setBusy(true);
    // Stamp the generation time only at the moment of applying (pure generator
    // never reads the clock).
    const stampedInput = normalizeProgramBuilderInput({ ...norm, generatedAt: new Date().toISOString() });
    const stampedPlan = buildProgramPlan(stampedInput);
    const preferences = buildProgramBuilderSettingsPatch(stampedPlan.input, stampedPlan).programBuilder;
    try {
      await onApply({ program: stampedPlan.program, preferences, plan: stampedPlan });
    } finally {
      setBusy(false);
    }
  };

  // ── styles ──
  const label = { fontFamily: mono, fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textDim, marginBottom: 8, fontWeight: 600 };
  const sectionWrap = { padding: "14px 16px", borderBottom: `1px solid ${C.line}` };
  const help = { fontSize: 11, color: C.textFaint, lineHeight: 1.6, marginTop: 8 };

  return (
    <div style={{ fontFamily: mono, color: C.text }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.line}`, background: C.panel, position: "sticky", top: 0, zIndex: 5 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: C.textFaint, marginBottom: 4 }}>Program Builder · V2.3</div>
            <div style={{ fontFamily: serif, fontSize: 20, fontWeight: 500, color: C.text, letterSpacing: "-0.01em" }}>Generate a plan</div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Cancel and keep current program"
            style={{ background: "none", border: `1px solid ${C.lineBright}`, color: C.textDim, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", cursor: busy ? "not-allowed" : "pointer", fontFamily: mono, padding: "6px 11px" }}
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Goal */}
      <div style={sectionWrap}>
        <div style={label}>Goal</div>
        <div role="radiogroup" aria-label="Training goal" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {PROGRAM_BUILDER_GOALS.map((g) => (
            <SelectRow key={g.id} C={C} mono={mono} serif={serif} selected={draft.goal === g.id} onClick={() => setGoal(g.id)} label={g.label} desc={g.desc} />
          ))}
        </div>
      </div>

      {/* Training days */}
      <div style={sectionWrap}>
        <div style={label}>Training days / week</div>
        <Pills C={C} mono={mono} ariaLabel="Training days per week"
          options={TRAINING_DAY_OPTIONS.map((n) => ({ id: n, label: String(n) }))}
          value={draft.trainingDaysPerWeek}
          onChange={(v) => set("trainingDaysPerWeek", v)} />
        <div style={help}>{7 - norm.trainingDaysPerWeek} rest day{7 - norm.trainingDaysPerWeek === 1 ? "" : "s"} per week.</div>
      </div>

      {/* Rest days */}
      <div style={sectionWrap}>
        <div style={label}>Preferred rest days <span style={{ color: C.textFaint, fontWeight: 400 }}>(optional)</span></div>
        <div role="group" aria-label="Preferred rest days" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {DAYS.map((day) => {
            const on = norm.restDays.includes(day);
            return (
              <button key={day} type="button" role="checkbox" aria-checked={on} onClick={() => toggleRestDay(day)}
                style={{ padding: "8px 10px", border: `1px solid ${on ? C.text : C.lineBright}`, background: on ? C.text : "transparent", color: on ? C.bg : C.textDim, fontFamily: mono, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontWeight: on ? 600 : 500 }}>
                {day.slice(0, 3)}
              </button>
            );
          })}
        </div>
        <div style={help}>We keep exactly {7 - norm.trainingDaysPerWeek}. Extra picks are trimmed; if you pick too few we fill the rest.</div>
      </div>

      {/* Long run day (running goals only) */}
      {usesRunning && (
        <div style={sectionWrap}>
          <div style={label}>Long run day</div>
          <Pills C={C} mono={mono} ariaLabel="Long run day"
            options={DAYS.map((d) => ({ id: d, label: d.slice(0, 3) }))}
            value={norm.longRunDay}
            onChange={(v) => set("longRunDay", v)} />
          <div style={help}>Heavy lower-body work is spaced away from this day automatically.</div>
        </div>
      )}

      {/* Equipment */}
      <div style={sectionWrap}>
        <div style={label}>Equipment</div>
        <div role="radiogroup" aria-label="Equipment" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {EQUIPMENT_OPTIONS.map((e) => (
            <SelectRow key={e.id} C={C} mono={mono} serif={serif} selected={draft.equipment === e.id} onClick={() => set("equipment", e.id)} label={e.label} desc={e.desc} compact />
          ))}
        </div>
      </div>

      {/* Experience */}
      <div style={sectionWrap}>
        <div style={label}>Experience</div>
        <div role="radiogroup" aria-label="Experience level" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {EXPERIENCE_LEVELS.map((e) => (
            <SelectRow key={e.id} C={C} mono={mono} serif={serif} selected={draft.experience === e.id} onClick={() => set("experience", e.id)} label={e.label} desc={e.desc} compact />
          ))}
        </div>
      </div>

      {/* Session length */}
      <div style={sectionWrap}>
        <div style={label}>Session length</div>
        <Pills C={C} mono={mono} ariaLabel="Session length in minutes"
          options={SESSION_LENGTH_OPTIONS.map((n) => ({ id: n, label: `${n} min` }))}
          value={draft.sessionLength}
          onChange={(v) => set("sessionLength", v)} />
      </div>

      {/* Cardio preference */}
      <div style={sectionWrap}>
        <div style={label}>Cardio</div>
        <div role="radiogroup" aria-label="Cardio preference" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {CARDIO_PREFERENCES.map((c) => (
            <SelectRow key={c.id} C={C} mono={mono} serif={serif} selected={draft.cardioPreference === c.id} onClick={() => set("cardioPreference", c.id)} label={c.label} desc={c.desc} compact />
          ))}
        </div>
      </div>

      {/* ── Weekly preview ── */}
      <div style={{ padding: "16px 16px 6px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontFamily: serif, fontSize: 17, fontWeight: 500, color: C.text }}>Weekly preview</div>
          <div style={{ fontSize: 10.5, color: C.textDim, letterSpacing: "0.06em" }}>{summary.headline}</div>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${C.line}` }}>
        {summary.days.map((d) => (
          <div key={d.day} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 16px", borderBottom: `1px solid ${C.line}`, background: d.isRest ? C.bg : C.block }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
              <span style={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint, width: 30, flexShrink: 0 }}>{d.day.slice(0, 3)}</span>
              <span style={{ fontSize: 13, color: d.isRest ? C.textFaint : C.text, fontWeight: d.isRest ? 400 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.isRest ? "Rest" : d.type}</span>
            </div>
            <span style={{ fontSize: 11, color: C.textDim, letterSpacing: "0.04em", flexShrink: 0, marginLeft: 8, textAlign: "right" }}>{d.isRest ? "—" : d.label}</span>
          </div>
        ))}
      </div>

      {/* Rationale */}
      {plan.rationale?.length > 0 && (
        <div style={sectionWrap}>
          <div style={label}>Why this plan</div>
          <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 5 }}>
            {plan.rationale.map((r, i) => (
              <li key={i} style={{ fontSize: 12, color: C.textDim, lineHeight: 1.55 }}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {plan.warnings?.length > 0 && (
        <div style={sectionWrap}>
          <div style={{ ...label, color: C.red }}>Heads up</div>
          <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 5 }}>
            {plan.warnings.map((w, i) => (
              <li key={i} style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.55 }}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 4-week variation preview */}
      <div style={sectionWrap}>
        <div style={label}>4-week progression</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 0, borderTop: `1px solid ${C.line}` }}>
          {weeks.map((w) => (
            <div key={w.weekIndex} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
              <span style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: w.isDeload ? C.text : C.textFaint, width: 54, flexShrink: 0, fontWeight: w.isDeload ? 600 : 500 }}>{w.weekLabel}</span>
              <span style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.5 }}>{w.focus}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer — explicit Apply / Cancel */}
      <div style={{ padding: "12px 16px calc(16px + env(safe-area-inset-bottom, 0px))", borderTop: `1px solid ${C.lineBright}`, background: C.panel, position: "sticky", bottom: 0, display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{ flex: 1, background: "none", border: `1px solid ${C.lineBright}`, color: C.textDim, padding: "13px", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: mono, cursor: busy ? "not-allowed" : "pointer" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={busy}
          style={{ flex: 2, background: C.bg, border: `1px solid ${C.text}`, color: C.text, padding: "13px", fontSize: 11.5, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: mono, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer" }}
        >
          {busy ? "Applying…" : "Apply this plan →"}
        </button>
      </div>
    </div>
  );
}

// ── Selectable ruled row (goal / equipment / experience / cardio) ──
function SelectRow({ C, mono, serif, selected, onClick, label, desc, compact }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${label}. ${desc}`}
      onClick={onClick}
      style={{
        background: selected ? C.block : "transparent",
        border: `${selected ? 2 : 1}px solid ${selected ? C.text : C.lineBright}`,
        borderRadius: 0,
        padding: compact ? "10px 12px" : "12px 14px",
        textAlign: "left",
        cursor: "pointer",
        fontFamily: mono,
        width: "100%",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontFamily: serif, fontSize: compact ? 13 : 14, fontWeight: 500, color: C.text }}>{label}</span>
        <span style={{ width: 14, height: 14, border: `1px solid ${selected ? C.text : C.textFaint}`, background: selected ? C.text : "transparent", flexShrink: 0, marginLeft: 8, display: "flex", alignItems: "center", justifyContent: "center" }} aria-hidden="true">
          {selected && <span style={{ width: 5, height: 5, background: C.bg }} />}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.55 }}>{desc}</div>
    </button>
  );
}

// ── Segmented pills (single-select) ──
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

export default ProgramBuilderPanel;
