// src/Tutorial.jsx
// First run. A four-card tour (Skip is always there and nothing moves on a
// timer), then setup in five steps with one question each: goal, recovery
// data, program, fuel targets and privacy. Finishing hands the answers to App
// (handleTutorialComplete), which builds and saves the program and settings.
import { useEffect, useRef, useState } from "react";
import {
  ONBOARDING_GOALS,
  ONBOARDING_DATA_MODES,
  ONBOARDING_MACRO_PRESETS,
  defaultMacroPresetForGoal,
  buildFirstTask,
} from "./onboardingSetup";
import {
  TRAINING_DAY_OPTIONS,
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
import { Flow, Fold, Icon, Meter, RadioRows, Seg, TopBar, Wordmark } from "./ui/ledger";
import { AdaptiveLiftingChoice, BuilderEquipment, BuilderWeekPreview, TrainingWeekdays } from "./BuilderWeek";

const TOUR = [
  {
    title: "Your daily training ledger.",
    figure: "mark",
    body: "One place for people who lift and run. Log the work and the food, and each morning the app tells you how hard to go, with the reasons shown.",
    note: "Logging by hand works on its own. Oura and Whoop are optional.",
  },
  {
    title: "Two signals, one call.",
    figure: "signals",
    body: "Each morning you say how you feel and your data says how you recovered. The app weighs both and answers one question: how hard should today be?",
    note: "A rough check-in, short sleep or a heavy week can only make the call more cautious, never less.",
  },
  {
    title: "Build the week, then edit it.",
    body: "Pick your goal, days, equipment and experience. The app builds a week you can edit, switch or rebuild later in Train.",
    note: "Lifting, runs and intervals share one week, and deloads follow your training load.",
  },
  {
    title: "Private by design.",
    body: "Your log is private to your account. Wearables stay off until you connect them. The coach gets a short summary, never your tokens or passwords.",
    note: "Export a full copy any time from Profile.",
  },
];

const STEPS = [
  { key: "goal", name: "Goal", question: "What are you training for?", sub: "It picks your starter program and fuel targets. You can change all of it later." },
  { key: "dataMode", name: "Recovery data", question: "How will you track recovery?", sub: "Each way gives you a daily call. Pick what you have." },
  { key: "program", name: "Program", question: "Build your week.", sub: "Four choices, and the week below follows them. Edit it any time in Train." },
  { key: "macros", name: "Fuel", question: "Set your daily targets.", sub: "A preset fills every field, and each one stays editable." },
  { key: "privacy", name: "Privacy", question: "What we store, and what we don't.", sub: "A short summary before you start." },
];

const TARGET_FIELDS = [
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fats", label: "Fat", unit: "g" },
  { key: "water", label: "Water", unit: "oz" },
];

const PRIVACY_POINTS = [
  ["Checking in by hand is enough", "Sleep, energy, soreness and stress you log give a full recovery score. No wearable is needed for a daily call."],
  ["Wearables are optional", "Oura and Whoop stay disconnected until you connect them in Settings, under Integrations. Their tokens stay on the server, and disconnecting deletes their data from the app."],
  ["The coach gets a summary, not secrets", "When you use it, the AI coach gets a short summary of your training and recovery. Tokens, passwords and recovery phrases are never included."],
  ["Your data stays yours", "Entries are private to your account and work offline. Export a full copy from Profile, and ask for deletion through the legal contact."],
];

const formatNumber = (n) => Number(n).toLocaleString("en-US");

function SignalsFigure() {
  return (
    <div role="img" aria-label="Two signals, how you feel and what your body says, combine into one call." style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div className="card kv" style={{ padding: 12 }}><span className="t-ss">How you feel</span><span className="t-s c2">Sleep, soreness, stress, energy</span></div>
        <div className="card kv" style={{ padding: 12 }}><span className="t-ss">What your body says</span><span className="t-s c2">Sleep, HRV, heart rate, load</span></div>
      </div>
      <div aria-hidden="true" className="card" style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}><Meter level={4} /><span className="stamp">Train</span></span>
        <span className="t-title">Run the plan as written.</span>
      </div>
    </div>
  );
}

function Tour({ slide, onNext, onBack, onSkip }) {
  const card = TOUR[slide];
  const last = slide === TOUR.length - 1;
  const titleRef = useRef(null);
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, [slide]);
  return (
    <div className="shell" style={{ maxWidth: "var(--ovt-content-width)" }}>
      <header className="top">
        <p className="t-s c2 grow">{slide + 1} of {TOUR.length}</p>
        <button type="button" className="btn btn-g btn-sm" onClick={onSkip}>Skip tour</button>
        <span style={{ width: 8, flex: "none" }} />
      </header>
      <main className="main" style={{ gap: 20, paddingTop: 16 }}>
        <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: `repeat(${TOUR.length}, 1fr)`, gap: 4 }}>
          {TOUR.map((_, i) => <span key={i} style={{ height: 4, borderRadius: 2, background: i <= slide ? "var(--ink)" : "var(--line)" }} />)}
        </div>
        {card.figure === "mark" && <div style={{ padding: "16px 0" }}><Wordmark /></div>}
        {card.figure === "signals" && <SignalsFigure />}
        <div className="kv" style={{ gap: 12 }}>
          <h1 ref={titleRef} className="t-xl" tabIndex={-1}>{card.title}</h1>
          <p className="t-b c2">{card.body}</p>
          <p className="t-s c2">{card.note}</p>
        </div>
      </main>
      <div className="foot">
        <button type="button" className="btn btn-p btn-lg btn-b" onClick={onNext}>{last ? "Set up" : "Next"}</button>
        {slide > 0 && <button type="button" className="btn btn-g btn-b" onClick={onBack}>Back</button>}
      </div>
    </div>
  );
}

function ProgramStep({ goal, builder, setPrefs }) {
  const setField = (key, value) => setPrefs({ [key]: value });
  const [more, setMore] = useState(false);
  const builderGoal = mapOnboardingGoalToBuilderGoal(goal);
  const usesRunning = goalUsesRunning(builderGoal);
  const input = {
    goal: builderGoal,
    trainingDaysPerWeek: builder.trainingDaysPerWeek || recommendTrainingDaysForGoal(builderGoal),
    equipment: builder.equipment || "full_gym",
    equipmentChoices: builder.equipmentChoices,
    experience: builder.experience || "intermediate",
    sessionLength: builder.sessionLength || 60,
    cardioPreference: builder.cardioPreference || recommendCardioPreference(builderGoal),
    longRunDay: builder.longRunDay,
    restDays: builder.restDays,
    adaptiveTraining: builder.adaptiveTraining,
  };
  const plan = buildProgramPlan(input);
  const summary = summarizeGeneratedPlan(plan);
  const trainingDays = DAYS.filter(day => !plan.input.restDays.includes(day));
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span id="ob-days" className="lbl">Training days per week</span>
        <Seg labelledBy="ob-days" options={TRAINING_DAY_OPTIONS.map((n) => ({ value: n, label: String(n) }))} value={input.trainingDaysPerWeek} onChange={(v) => setField("trainingDaysPerWeek", v)} />
      </div>
      <BuilderEquipment id="ob-equip" equipment={builder.equipment} choices={builder.equipmentChoices} onChange={setPrefs} />
      <RadioRows id="ob-exp" label="Experience level" options={EXPERIENCE_LEVELS} value={builder.experience} onChange={(v) => setField("experience", v)} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span id="ob-len" className="lbl">Session length (min)</span>
        <Seg labelledBy="ob-len" options={SESSION_LENGTH_OPTIONS.map((n) => ({ value: n, label: String(n) }))} value={input.sessionLength} onChange={(v) => setField("sessionLength", v)} />
      </div>
      <div>
        <button type="button" className="row" aria-expanded={more} aria-controls="ob-more" onClick={() => setMore((open) => !open)}>
          <span className="kv grow"><span className="t-bs">More choices</span><span className="t-s c2">{trainingDays.map(day => day.slice(0, 3)).join(" · ")}</span></span>
          <Icon name={more ? "up" : "down"} size="s" className="c2" />
        </button>
        <Fold open={more} id="ob-more">
          <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 8 }}>
            <TrainingWeekdays input={plan.input} onChange={setPrefs} />
            {!usesRunning && <RadioRows id="ob-cardio" label="Cardio" options={CARDIO_PREFERENCES} value={input.cardioPreference} onChange={(v) => setField("cardioPreference", v)} />}
            {usesRunning && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span id="ob-long" className="lbl">Long run day</span>
                <Seg labelledBy="ob-long" options={trainingDays.map(day => ({ value: day, label: day.slice(0, 3) }))} value={plan.input.longRunDay} onChange={(v) => setField("longRunDay", v)} />
              </div>
            )}
          </div>
        </Fold>
      </div>
      {summary.liftingDays > 0 && <AdaptiveLiftingChoice enabled={plan.input.adaptiveTraining} onChange={(v) => setField("adaptiveTraining", v)} />}
      <BuilderWeekPreview id="ob-week" plan={plan} summary={summary} />
    </>
  );
}

function FuelStep({ macroPreset, onPreset, targets, onTarget }) {
  const preset = ONBOARDING_MACRO_PRESETS[macroPreset];
  const options = Object.values(ONBOARDING_MACRO_PRESETS).map((p) => ({
    id: p.id,
    label: p.label,
    desc: p.desc,
    meta: `${formatNumber(p.goals.calories)} kcal, ${p.goals.protein} g protein.`,
  }));
  return (
    <>
      <RadioRows id="ob-preset" labelledBy="ob-q" options={options} value={macroPreset} onChange={onPreset} />
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <legend className="t-h" style={{ padding: 0, marginBottom: 8 }}>Your targets</legend>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))", gap: 12 }}>
          {TARGET_FIELDS.map((f) => (
            <label key={f.key} className="field">
              <span className="lbl">{f.label} ({f.unit})</span>
              <input className="input n" inputMode="numeric" pattern="[0-9]*" value={targets[f.key] ?? preset?.goals[f.key] ?? ""} onChange={(event) => onTarget(f.key, event.target.value.replace(/[^0-9]/g, ""))} />
            </label>
          ))}
        </div>
      </fieldset>
      <p className="t-s c2">Change them any time in Settings, under Targets.</p>
    </>
  );
}

function PrivacyStep({ dataMode }) {
  const first = buildFirstTask({ dataMode });
  return (
    <>
      <ul className="rows" style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {PRIVACY_POINTS.map(([title, text]) => (
          <li key={title} className="kv" style={{ padding: "4px 0" }}>
            <span className="t-bs">{title}</span>
            <span className="t-b c2">{text}</span>
          </li>
        ))}
      </ul>
      <section className="card" aria-labelledby="ob-first" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <p className="t-s c2">First, on {first.tab}</p>
        <h3 id="ob-first" className="t-h">{first.title}</h3>
        <p className="t-b c2">{first.body}</p>
      </section>
      <p className="t-s c2">The daily call and the program are suggestions, not medical advice.</p>
    </>
  );
}

export function Tutorial({ onComplete }) {
  const [phase, setPhase] = useState("tour");
  const [slide, setSlide] = useState(0);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState(null);
  const [dataMode, setDataMode] = useState(null);
  const [macroPreset, setMacroPreset] = useState(null);
  const [targets, setTargets] = useState({});
  const [missing, setMissing] = useState("");
  const [builder, setBuilder] = useState({
    trainingDaysPerWeek: null,
    equipment: null,
    equipmentChoices: [],
    experience: null,
    sessionLength: 60,
    cardioPreference: null,
    longRunDay: "Saturday",
    restDays: [],
  });
  const questionRef = useRef(null);
  const current = STEPS[step];

  useEffect(() => { if (phase === "setup") questionRef.current?.focus({ preventScroll: true }); }, [phase, step]);

  const setPrefs = (patch) => { setBuilder((b) => ({ ...b, ...patch })); setMissing(""); };

  // The goal sets the defaults the next steps start from.
  const chooseGoal = (id) => {
    setGoal(id);
    setMissing("");
    setMacroPreset(defaultMacroPresetForGoal(id));
    setTargets({});
    const builderGoal = mapOnboardingGoalToBuilderGoal(id);
    setBuilder((b) => ({
      ...b,
      trainingDaysPerWeek: b.trainingDaysPerWeek || recommendTrainingDaysForGoal(builderGoal),
      cardioPreference: b.cardioPreference || recommendCardioPreference(builderGoal),
    }));
  };

  // What the step still needs, said in words rather than a disabled button.
  const programGaps = [!builder.equipment && "equipment", !builder.experience && "experience level"].filter(Boolean);
  const needs = {
    goal: goal ? "" : "Pick what you are training for.",
    dataMode: dataMode ? "" : "Pick how you will track recovery.",
    program: programGaps.length ? `Pick your ${programGaps.join(" and ")}.` : "",
    macros: macroPreset ? "" : "Pick a starting preset.",
    privacy: "",
  }[current.key];

  const go = (next) => {
    setMissing("");
    window.scrollTo?.(0, 0);
    document.querySelector(".flow-screen")?.scrollTo?.(0, 0);
    setStep(next);
  };

  const finish = async () => {
    setBusy(true);
    const edited = Object.fromEntries(Object.entries(targets).filter(([, v]) => v !== ""));
    await onComplete({
      goal,
      dataMode,
      macroPreset,
      customGoals: Object.keys(edited).length ? edited : undefined,
      builderPrefs: builder,
    });
    setBusy(false);
  };

  const next = () => {
    if (busy) return;
    if (needs) { setMissing(needs); return; }
    if (step < STEPS.length - 1) { go(step + 1); return; }
    finish();
  };

  const back = () => {
    if (busy) return;
    if (step === 0) { setPhase("tour"); setSlide(TOUR.length - 1); return; }
    go(step - 1);
  };

  return (
    <Flow label="Welcome to 0VERTRAINED" data-screen="onboarding">
      {phase === "tour" ? (
        <Tour
          slide={slide}
          onNext={() => (slide === TOUR.length - 1 ? setPhase("setup") : setSlide((s) => s + 1))}
          onBack={() => setSlide((s) => Math.max(0, s - 1))}
          onSkip={() => { setPhase("setup"); setStep(0); }}
        />
      ) : (
        <div className="shell" style={{ maxWidth: "var(--ovt-content-width)" }}>
          <TopBar title="Set up" sub={` · step ${step + 1} of ${STEPS.length}`} back={step === 0 ? "Tour" : STEPS[step - 1].name} onBack={back} />
          <main className="main" style={{ gap: 20, paddingTop: 12 }}>
            <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: `repeat(${STEPS.length}, 1fr)`, gap: 4 }}>
              {STEPS.map((s, i) => <span key={s.key} style={{ height: 4, borderRadius: 2, background: i <= step ? "var(--ink)" : "var(--line)" }} />)}
            </div>
            <div className="kv" style={{ gap: 8 }}>
              <h2 id="ob-q" ref={questionRef} className="t-xl" tabIndex={-1}>{current.question}</h2>
              <p className="t-b c2">{current.sub}</p>
            </div>
            {current.key === "goal" && <RadioRows id="ob-goal" labelledBy="ob-q" options={ONBOARDING_GOALS} value={goal} onChange={chooseGoal} />}
            {current.key === "dataMode" && (
              <>
                <RadioRows id="ob-data" labelledBy="ob-q" options={ONBOARDING_DATA_MODES} value={dataMode} onChange={(id) => { setDataMode(id); setMissing(""); }} />
                <p className="t-s c2">Connect Oura, Whoop or Strava in Settings, under Integrations. There is nothing to enter here.</p>
              </>
            )}
            {current.key === "program" && <ProgramStep goal={goal} builder={builder} setPrefs={setPrefs} />}
            {current.key === "macros" && (
              <FuelStep
                macroPreset={macroPreset}
                onPreset={(id) => { setMacroPreset(id); setTargets({}); setMissing(""); }}
                targets={targets}
                onTarget={(key, value) => setTargets((t) => ({ ...t, [key]: value }))}
              />
            )}
            {current.key === "privacy" && <PrivacyStep dataMode={dataMode} />}
          </main>
          <div className="foot">
            {missing && <p className="err" role="alert"><Icon name="warn" size="s" /><span>{missing}</span></p>}
            <button type="button" className="btn btn-p btn-lg btn-b" aria-disabled={busy || undefined} onClick={next}>
              {step < STEPS.length - 1 ? `Next: ${STEPS[step + 1].name.toLowerCase()}` : busy ? "Setting up…" : "Go to Today"}
            </button>
          </div>
        </div>
      )}
    </Flow>
  );
}
