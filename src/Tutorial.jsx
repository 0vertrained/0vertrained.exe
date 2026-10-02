import { useState } from "react";
import { THEMES } from "./theme";
import {
  ONBOARDING_GOALS,
  ONBOARDING_DATA_MODES,
  ONBOARDING_MACRO_PRESETS,
  defaultMacroPresetForGoal,
  buildFirstTask,
} from "./onboardingSetup";
import {
  TRAINING_DAY_OPTIONS,
  EQUIPMENT_OPTIONS,
  EXPERIENCE_LEVELS,
  SESSION_LENGTH_OPTIONS,
  CARDIO_PREFERENCES,
  DAYS,
  goalUsesRunning,
  recommendTrainingDaysForGoal,
  recommendCardioPreference,
  mapOnboardingGoalToBuilderGoal,
  buildProgramPlan,
  summarizeGeneratedPlan,
} from "./programBuilder";

// Onboarding slides — kept in sync with the real navigation
// (Today · Recovery · Fuel · Progress · More) and set in the Whitepaper System
// type language: serif index, mono kicker, no emoji.
const SLIDES = [
  {
    kicker: "Welcome",
    title: "Your daily\ntraining ledger",
    body: "One place for athletes who take lifting and endurance equally seriously. Log the work, track the fuel, and let the app tell you how hard to go — with the reasoning shown, not hidden.",
    hint: "Today · Recovery · Fuel · Progress · Profile all use the same ruled whitepaper system.",
    ledger: [["Mode", "manual-first"], ["Sync", "Oura / Whoop optional"], ["Privacy", "no ads · no sale"]],
  },
  {
    kicker: "How readiness works",
    title: "Two signals,\none call",
    diagram: "readiness",
    body: "Each day combines how recovered you are with how much you've been training. Both matter. From those two signals you get one call — Push, Normal, Moderate, Pull back, or Rest — and a plain-language reason.",
    hint: "It's decision support, not an oracle. When data is missing, it says so.",
    ledger: [["Recovery", "sleep · HRV · soreness"], ["Load", "acute : chronic"], ["Output", "actionable band"]],
  },
  {
    kicker: "Program",
    title: "Build the week,\nthen edit it",
    body: "Pick your goal, equipment, days, experience and cardio preference. The app generates a weekly split you can edit, switch, or regenerate later from Profile → Program.",
    hint: "The setup flow now mirrors the app: compact choices, live preview, no fake wizard gloss.",
    ledger: [["Strength", "sets · reps · RIR"], ["Endurance", "runs · intervals"], ["Deload", "load-aware"]],
  },
  {
    kicker: "Privacy boundary",
    title: "Private by design,\nuseful by default",
    body: "Manual logs stay private to your account. Wearable connections are opt-in. Form Check stores derived summaries, not raw video. The coach receives a sanitized training/recovery slice, not secrets.",
    hint: "Social boards are opt-in and show handle-level stats only.",
    ledger: [["Coach", "summary only"], ["Form", "derived-only"], ["Data", "export / delete"]],
  },
];

// Ordered setup steps that follow the tour. Each is an interactive selection.
const SETUP_STEPS = ["goal", "dataMode", "program", "macros", "privacy"];

// Minimal, theme-aware two-axis sketch for the readiness slide.
function ReadinessDiagram({ T }) {
  const w = 240, h = 150, pad = 26;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Recovery on one axis, training load on the other; high recovery with moderate load is the ready-to-push zone." style={{ display: "block", margin: "0 auto 24px" }}>
      {/* axes */}
      <line x1={pad} y1={h - pad} x2={w - 8} y2={h - pad} stroke={T.line} strokeWidth="1" />
      <line x1={pad} y1={h - pad} x2={pad} y2={8} stroke={T.line} strokeWidth="1" />
      {/* ready zone (high recovery, moderate load) */}
      <rect x={w - pad - 78} y={pad} width={78} height={48} fill="none" stroke={T.text} strokeWidth="1" strokeDasharray="3 3" />
      <text x={w - pad - 39} y={pad + 28} textAnchor="middle" fill={T.text} fontSize="9" fontFamily={T.monoFamily} letterSpacing="0.08em">PUSH</text>
      {/* sample point */}
      <circle cx={w - pad - 39} cy={pad + 24} r="3" fill={T.text} />
      {/* axis labels */}
      <text x={(w + pad) / 2} y={h - 6} textAnchor="middle" fill={T.textDim} fontSize="8" fontFamily={T.monoFamily} letterSpacing="0.1em">RECOVERY →</text>
      <text x={12} y={(h - pad) / 2} textAnchor="middle" fill={T.textDim} fontSize="8" fontFamily={T.monoFamily} letterSpacing="0.1em" transform={`rotate(-90 12 ${(h - pad) / 2})`}>LOAD →</text>
    </svg>
  );
}

function TourLedger({ T, rows }) {
  if (!rows?.length) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", borderTop: `1px solid ${T.line}`, borderLeft: `1px solid ${T.line}`, marginTop: 18 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ borderRight: `1px solid ${T.line}`, borderBottom: `1px solid ${T.line}`, padding: "9px 7px", minWidth: 0 }}>
          <div style={{ fontFamily: T.monoFamily, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: T.text }}>{k}</div>
          <div style={{ fontFamily: T.monoFamily, fontSize: 10, letterSpacing: "0.03em", color: T.textFaint, marginTop: 4, whiteSpace: "normal" }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

export function Tutorial({ username, onComplete, theme = "whitepaperLight" }) {
  // phase: "tour" (slide carousel) → "setup" (interactive selections)
  const [phase, setPhase]   = useState("tour");
  const [slide, setSlide]   = useState(0);
  const [step, setStep]     = useState(0);
  const [busy, setBusy]     = useState(false);

  // Selections
  const [goal, setGoalState]         = useState(null);
  const [dataMode, setDataMode]      = useState(null);
  const [macroPreset, setMacroPreset] = useState(null);
  // V2.3: compact Program Builder preferences collected during onboarding.
  const [builder, setBuilder] = useState({
    trainingDaysPerWeek: null,
    equipment: null,
    experience: null,
    sessionLength: 60,
    cardioPreference: null,
    longRunDay: "Saturday",
    restDays: [],
  });
  const setBuilderField = (key, value) => setBuilder((b) => ({ ...b, [key]: value }));

  const T = THEMES[theme] || THEMES.whitepaperLight;
  const mono = T.fontFamily;
  const serif = T.serifFamily || mono;
  const isLastSlide = slide === SLIDES.length - 1;
  const stepKey = SETUP_STEPS[step];

  // Picking a goal seeds sensible builder + macro defaults the user can override.
  const chooseGoal = (id) => {
    setGoalState(id);
    setMacroPreset(defaultMacroPresetForGoal(id));
    const builderGoal = mapOnboardingGoalToBuilderGoal(id);
    setBuilder((b) => ({
      ...b,
      trainingDaysPerWeek: b.trainingDaysPerWeek || recommendTrainingDaysForGoal(builderGoal),
      cardioPreference: b.cardioPreference || recommendCardioPreference(builderGoal),
    }));
  };

  const startSetup = () => { setPhase("setup"); setStep(0); };

  const advanceSlide = () => {
    if (isLastSlide) { startSetup(); return; }
    setSlide(s => s + 1);
  };

  // Whether the current setup step has a required selection made.
  const stepReady = (
    stepKey === "goal"     ? !!goal :
    stepKey === "dataMode" ? !!dataMode :
    stepKey === "program"  ? !!(builder.trainingDaysPerWeek && builder.equipment && builder.experience && builder.cardioPreference) :
    stepKey === "macros"   ? !!macroPreset :
    true // privacy — confirmation only
  );

  const nextStep = () => {
    if (!stepReady) return;
    if (step < SETUP_STEPS.length - 1) { setStep(s => s + 1); return; }
    finish();
  };

  const prevStep = () => {
    if (step === 0) { setPhase("tour"); setSlide(SLIDES.length - 1); return; }
    setStep(s => s - 1);
  };

  const finish = async () => {
    setBusy(true);
    // V2.3: hand the builder preferences to App, which generates + saves the
    // plan and stores settings.programBuilder. Legacy preset payloads still work.
    await onComplete({ goal, dataMode, macroPreset, builderPrefs: builder });
    setBusy(false);
  };

  // ── Tour view ──
  if (phase === "tour") {
    const s = SLIDES[slide];
    return (
      <div
        role="group"
        aria-roledescription="carousel"
        aria-label={`Welcome tour, step ${slide + 1} of ${SLIDES.length}`}
        onClick={advanceSlide}
        style={{
          position: "fixed", inset: 0, background: T.bg, zIndex: 900,
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "40px 32px", cursor: "pointer",
          fontFamily: mono, maxWidth: "var(--ovt-content-width)", margin: "0 auto",
          userSelect: "none",
        }}
      >
        {/* Current-system masthead */}
        <div style={{ position: "absolute", top: 28, left: 24, display: "flex", alignItems: "baseline", gap: 10 }} aria-hidden="true">
          <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 15, color: T.text }}><span style={{ fontFamily: serif, fontStyle: "italic", fontWeight: 500 }}>θ</span>VERTRAINED</span>
          <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.18em", textTransform: "uppercase", color: T.textFaint }}>Setup ledger</span>
        </div>

        {/* Progress dots */}
        <div style={{ display: "flex", gap: 6, position: "absolute", top: 72 }} aria-hidden="true">
          {SLIDES.map((_, i) => (
            <div key={i} style={{ width: i === slide ? 20 : 6, height: 6, borderRadius: 0, background: i === slide ? T.text : T.line, transition: "all 0.3s" }} />
          ))}
        </div>

        {/* Skip */}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); startSetup(); }}
          aria-label="Skip the welcome tour and go to setup"
          style={{ position: "absolute", top: 28, right: 24, background: "none", border: `1px solid ${T.lineBright}`, color: T.textFaint, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer", fontFamily: mono, padding: "7px 10px" }}
        >
          Skip →
        </button>

        {/* Content */}
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 40, lineHeight: 1, color: T.text, marginBottom: 10 }}>
            {String(slide + 1).padStart(2, "0")}
          </div>
          <div style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: "0.22em", textTransform: "uppercase", color: T.textFaint, marginBottom: 22 }}>
            {s.kicker} · {String(slide + 1).padStart(2, "0")}/{String(SLIDES.length).padStart(2, "0")}
          </div>

          {s.diagram === "readiness" && <ReadinessDiagram T={T} />}

          <div style={{ fontFamily: serif, fontSize: 30, fontWeight: 500, color: T.text, letterSpacing: "-0.02em", marginBottom: 18, lineHeight: 1.15, whiteSpace: "pre-line" }}>
            {s.title}
          </div>
          <div style={{ fontSize: 14, color: T.textDim, lineHeight: 1.75, letterSpacing: "0.01em", marginBottom: 24 }}>
            {s.body}
          </div>
          {s.hint && (
            <div style={{ fontSize: 11.5, color: T.textFaint, letterSpacing: "0.03em", lineHeight: 1.6, padding: "12px 16px 0", borderTop: `1px solid ${T.line}`, marginTop: 8, fontFamily: mono }}>
              {s.hint}
            </div>
          )}
          <TourLedger T={T} rows={s.ledger} />
        </div>

        {/* Explicit advance control (keyboard + assistive tech; tap-anywhere still works) */}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); advanceSlide(); }}
          style={{
            position: "absolute", bottom: 52, left: "50%", transform: "translateX(-50%)",
            background: "none", border: `1px solid ${T.lineBright}`, color: T.textDim,
            fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer",
            fontFamily: mono, padding: "9px 18px",
          }}
        >
          {isLastSlide ? "Set up your app →" : "Continue →"}
        </button>
      </div>
    );
  }

  // ── Setup view ──
  const stepMeta = {
    goal:     { kicker: "Goal",      title: "What are you\ntraining for?", sub: "Sets your starter program and macro targets. You can change everything later." },
    dataMode: { kicker: "Data",      title: "How will you\ntrack recovery?", sub: "Manual logging is first-class. A wearable adds HRV and resting heart rate." },
    program:  { kicker: "Program",   title: "Build your\nweekly plan", sub: "A few choices and we generate your split. Edit, switch or regenerate anytime from the More tab." },
    macros:   { kicker: "Fuel",      title: "Set your\nmacro targets", sub: "Start from a preset. Fine-tune calories and macros later in Settings." },
    privacy:  { kicker: "Privacy",   title: "What we store,\nand what we don't", sub: "A quick summary before you start." },
  }[stepKey];

  const primaryLabel =
    step < SETUP_STEPS.length - 1
      ? "Continue →"
      : (busy ? "Setting up…" : "Finish setup →");

  return (
    <div style={{ position: "fixed", inset: 0, background: T.bg, zIndex: 900, display: "flex", flexDirection: "column", fontFamily: mono, maxWidth: "var(--ovt-content-width)", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ padding: "18px 20px 16px", borderBottom: `1px solid ${T.line}`, background: T.panel, position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 14, color: T.text }}><span style={{ fontFamily: serif, fontStyle: "italic", fontWeight: 500 }}>θ</span>VERTRAINED</span>
          <span style={{ fontSize: 9.5, letterSpacing: "0.18em", color: T.textFaint, textTransform: "uppercase" }}>onboarding</span>
        </div>
        <div style={{ fontSize: 10, letterSpacing: "0.25em", color: T.textDim, textTransform: "uppercase", marginBottom: 6 }}>
          Setup · {String(step + 1).padStart(2, "0")}/{String(SETUP_STEPS.length).padStart(2, "0")} · {stepMeta.kicker}
        </div>
        {/* Step progress bars */}
        <div style={{ display: "flex", gap: 4, marginBottom: 12 }} aria-hidden="true">
          {SETUP_STEPS.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 3, background: i <= step ? T.text : T.line, transition: "all 0.3s" }} />
          ))}
        </div>
        <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 500, color: T.text, letterSpacing: "-0.02em", marginBottom: 4, whiteSpace: "pre-line", lineHeight: 1.15 }}>
          {stepMeta.title}
        </div>
        <div style={{ fontSize: 11.5, color: T.textDim, letterSpacing: "0.02em", lineHeight: 1.5 }}>
          {stepMeta.sub}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "16px", flex: 1, overflowY: "auto" }}>
        {stepKey === "goal" && (
          <div role="radiogroup" aria-label="Training goal" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ONBOARDING_GOALS.map(g => (
              <OptionCard key={g.id} T={T} mono={mono} serif={serif}
                selected={goal === g.id} onClick={() => chooseGoal(g.id)}
                label={g.label} desc={g.desc} />
            ))}
          </div>
        )}

        {stepKey === "dataMode" && (
          <div role="radiogroup" aria-label="Recovery data mode" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ONBOARDING_DATA_MODES.map(m => (
              <OptionCard key={m.id} T={T} mono={mono} serif={serif}
                selected={dataMode === m.id} onClick={() => setDataMode(m.id)}
                label={m.label} desc={m.desc} />
            ))}
            <div style={{ fontSize: 11, color: T.textFaint, lineHeight: 1.6, padding: "12px 2px 0", borderTop: `1px solid ${T.line}`, marginTop: 4 }}>
              Wearables connect from Settings → Integrations — there is nothing to enter here. Manual mode needs no wearable and works offline.
            </div>
          </div>
        )}

        {stepKey === "program" && (
          <BuilderStep T={T} mono={mono} serif={serif} goal={goal} builder={builder} setBuilderField={setBuilderField} />
        )}

        {stepKey === "macros" && (
          <div role="radiogroup" aria-label="Macro target preset" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {Object.values(ONBOARDING_MACRO_PRESETS).map(p => (
              <OptionCard key={p.id} T={T} mono={mono} serif={serif}
                selected={macroPreset === p.id} onClick={() => setMacroPreset(p.id)}
                label={p.label} desc={p.desc}
                meta={`${p.goals.calories} kcal · ${p.goals.protein}P / ${p.goals.carbs}C / ${p.goals.fats}F`} />
            ))}
            <div style={{ fontSize: 11, color: T.textFaint, lineHeight: 1.6, padding: "12px 2px 0", borderTop: `1px solid ${T.line}`, marginTop: 4 }}>
              These are starting targets. Adjust exact calories, protein, carbs, fats and water anytime in Settings → Macros.
            </div>
          </div>
        )}

        {stepKey === "privacy" && (
          <PrivacySummary T={T} mono={mono} serif={serif} dataMode={dataMode} />
        )}
      </div>

      {/* Footer nav */}
      <div style={{ padding: "12px 16px", borderTop: `1px solid ${T.lineBright}`, background: T.panel, position: "sticky", bottom: 0, display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={prevStep}
          disabled={busy}
          style={{ flex: 1, background: "none", border: `1px solid ${T.lineBright}`, borderRadius: 0, padding: "14px", color: T.textDim, fontSize: 11.5, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: mono, cursor: busy ? "not-allowed" : "pointer" }}
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={nextStep}
          disabled={!stepReady || busy}
          style={{
            flex: 2,
            background: T.bg,
            border: `1px solid ${stepReady ? T.text : T.lineBright}`,
            borderRadius: 0,
            padding: "14px",
            color: stepReady ? T.text : T.textFaint,
            fontSize: 13,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            fontFamily: mono,
            fontWeight: 600,
            cursor: (stepReady && !busy) ? "pointer" : "not-allowed",
            transition: "all 0.15s",
          }}
        >
          {primaryLabel}
        </button>
      </div>
    </div>
  );
}

// V2.3 compact Program Builder step for onboarding. Collects the essential
// preferences and shows a live weekly preview generated by the pure builder.
function BuilderStep({ T, mono, serif, goal, builder, setBuilderField }) {
  const builderGoal = mapOnboardingGoalToBuilderGoal(goal);
  const usesRunning = goalUsesRunning(builderGoal);
  const input = {
    goal: builderGoal,
    trainingDaysPerWeek: builder.trainingDaysPerWeek || recommendTrainingDaysForGoal(builderGoal),
    equipment: builder.equipment || "full_gym",
    experience: builder.experience || "intermediate",
    sessionLength: builder.sessionLength || 60,
    cardioPreference: builder.cardioPreference || recommendCardioPreference(builderGoal),
    longRunDay: builder.longRunDay,
    restDays: builder.restDays,
  };
  const plan = buildProgramPlan(input);
  const summary = summarizeGeneratedPlan(plan);

  const labelStyle = { fontFamily: mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: T.textDim, marginBottom: 8, fontWeight: 600 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <div style={labelStyle}>Training days / week</div>
        <TutorialPills T={T} mono={mono} ariaLabel="Training days per week"
          options={TRAINING_DAY_OPTIONS.map((n) => ({ id: n, label: String(n) }))}
          value={input.trainingDaysPerWeek} onChange={(v) => setBuilderField("trainingDaysPerWeek", v)} />
      </div>

      <div>
        <div style={labelStyle}>Equipment</div>
        <TutorialPills T={T} mono={mono} ariaLabel="Equipment"
          options={EQUIPMENT_OPTIONS.map((e) => ({ id: e.id, label: e.label }))}
          value={builder.equipment} onChange={(v) => setBuilderField("equipment", v)} />
      </div>

      <div>
        <div style={labelStyle}>Experience</div>
        <TutorialPills T={T} mono={mono} ariaLabel="Experience level"
          options={EXPERIENCE_LEVELS.map((e) => ({ id: e.id, label: e.label }))}
          value={builder.experience} onChange={(v) => setBuilderField("experience", v)} />
      </div>

      <div>
        <div style={labelStyle}>Session length</div>
        <TutorialPills T={T} mono={mono} ariaLabel="Session length"
          options={SESSION_LENGTH_OPTIONS.map((n) => ({ id: n, label: `${n}m` }))}
          value={input.sessionLength} onChange={(v) => setBuilderField("sessionLength", v)} />
      </div>

      <div>
        <div style={labelStyle}>Cardio</div>
        <TutorialPills T={T} mono={mono} ariaLabel="Cardio preference"
          options={CARDIO_PREFERENCES.map((c) => ({ id: c.id, label: c.label }))}
          value={input.cardioPreference} onChange={(v) => setBuilderField("cardioPreference", v)} />
      </div>

      {usesRunning && (
        <div>
          <div style={labelStyle}>Long run day</div>
          <TutorialPills T={T} mono={mono} ariaLabel="Long run day"
            options={DAYS.map((d) => ({ id: d, label: d.slice(0, 3) }))}
            value={plan.input.longRunDay} onChange={(v) => setBuilderField("longRunDay", v)} />
        </div>
      )}

      {/* Live weekly preview */}
      <div style={{ borderTop: `1px solid ${T.line}`, paddingTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <div style={{ fontFamily: serif, fontSize: 14, fontWeight: 500, color: T.text }}>Your week</div>
          <div style={{ fontSize: 10.5, color: T.textDim, letterSpacing: "0.05em" }}>{summary.headline}</div>
        </div>
        {summary.days.map((d) => (
          <div key={d.day} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0", borderTop: `1px solid ${T.line}` }}>
            <span style={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: T.textFaint, width: 30 }}>{d.day.slice(0, 3)}</span>
            <span style={{ fontSize: 12, color: d.isRest ? T.textFaint : T.text, flex: 1, marginLeft: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.isRest ? "Rest" : d.type}</span>
            <span style={{ fontSize: 11, color: T.textDim, marginLeft: 8 }}>{d.isRest ? "—" : d.label}</span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, color: T.textFaint, lineHeight: 1.6, borderTop: `1px solid ${T.line}`, paddingTop: 12 }}>
        Generated programming is general guidance, not medical advice. You can edit, switch or regenerate this plan anytime from More → Program.
      </div>
    </div>
  );
}

// Compact single-select pills for the onboarding builder step.
function TutorialPills({ T, mono, options, value, onChange, ariaLabel }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.id)}
            style={{ padding: "8px 12px", border: `1px solid ${on ? T.text : T.lineBright}`, background: on ? T.text : "transparent", color: on ? T.bg : T.textDim, fontFamily: mono, fontSize: 11, letterSpacing: "0.04em", cursor: "pointer", fontWeight: on ? 600 : 500 }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Reusable selectable card — used for goal, data mode and macro steps.
function OptionCard({ T, mono, serif, selected, onClick, label, desc, tags, meta }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${label}. ${desc}`}
      onClick={onClick}
      style={{
        background: T.bg,
        border: `${selected ? 2 : 1}px solid ${selected ? T.text : T.lineBright}`,
        borderRadius: 0,
        padding: "14px 16px",
        textAlign: "left",
        cursor: "pointer",
        fontFamily: mono,
        transition: "all 0.15s",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 500, color: T.text }}>
          {label}
        </div>
        <div style={{ width: 16, height: 16, borderRadius: 0, border: `1px solid ${selected ? T.text : T.textFaint}`, background: selected ? T.text : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginLeft: 8 }} aria-hidden="true">
          {selected && <div style={{ width: 6, height: 6, borderRadius: 0, background: T.bg }} />}
        </div>
      </div>
      <div style={{ fontSize: 13, color: T.textDim, lineHeight: 1.6, marginBottom: (tags || meta) ? 8 : 0 }}>
        {desc}
      </div>
      {meta && (
        <div style={{ fontSize: 11, color: selected ? T.text : T.textDim, letterSpacing: "0.06em" }}>
          {meta}
        </div>
      )}
      {tags && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {tags.map(tag => (
            <span key={tag} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 0, border: `1px solid ${selected ? T.text : T.lineBright}`, color: selected ? T.text : T.textDim, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {tag}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

// Plain-language privacy summary — honest about what is and isn't stored.
function PrivacySummary({ T, mono, serif, dataMode }) {
  const first = buildFirstTask({ dataMode });
  const points = [
    ["Manual recovery is first-class", "Sleep, energy, soreness and stress you log produce a full recovery score. No wearable is required to get a readiness call."],
    ["Wearables are optional", "Oura and Whoop stay disconnected until you link them in Settings → Integrations. Tokens stay server-side and disconnecting deletes provider data from the app."],
    ["Form Check keeps summaries, not video", "Recorded lifts are analysed through the privacy-preserving Form Check flow and only derived summaries (depth, tempo, bar path) are saved. Raw videos are not stored."],
    ["Coach gets a summary, not secrets", "The AI coach receives a compact training and recovery context only when you use it. OAuth tokens, passwords and recovery phrases are never included."],
    ["Your data stays yours", "Entries are private to your account and work offline. Export a full copy from Profile, and request deletion from the legal contact."],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {points.map(([h, b]) => (
        <div key={h} style={{ borderLeft: `2px solid ${T.lineBright}`, paddingLeft: 12 }}>
          <div style={{ fontFamily: serif, fontSize: 14, fontWeight: 500, color: T.text, marginBottom: 4 }}>{h}</div>
          <div style={{ fontSize: 13, color: T.textDim, lineHeight: 1.65 }}>{b}</div>
        </div>
      ))}
      <div style={{ marginTop: 4, padding: "14px 16px", border: `1px solid ${T.text}`, background: T.bg }}>
        <div style={{ fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: T.textDim, marginBottom: 6 }}>
          First task · {first.tab}
        </div>
        <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 500, color: T.text, marginBottom: 4 }}>{first.title}</div>
        <div style={{ fontSize: 13, color: T.textDim, lineHeight: 1.65 }}>{first.body}</div>
      </div>
    </div>
  );
}
