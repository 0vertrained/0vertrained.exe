import { useTheme } from "../theme";
import { formatPrescription } from "../progressionEngine";
import { useMediaQuery } from "../ui/useMediaQuery";
import { GhostChip } from "../GhostChip";
import { CascadeSet } from "../CascadeSet";
import { ghostForSet } from "../setGhosts";
import {
  TRACKING_MODES,
  defaultWeightIncrement,
  displaySet,
  resolveTrackingMode,
  validateSet,
} from "../workoutLogging";

const SET_TYPES = ["straight", "drop", "myo", "rp", "partial"];
const SET_TYPE_LABEL = { straight: "Straight", drop: "Drop", myo: "Myo", rp: "Rest-pause", partial: "Partials" };

const numeric = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function StepControl({ label, value, step, min = 0, unit, onChange, inputMode = "decimal" }) {
  const { C } = useTheme();
  const current = numeric(value);
  const update = (delta) => onChange(String(Math.max(min, Math.round((current + delta) * 100) / 100)));
  return (
    <div style={{ border: `1px solid ${C.lineBright}`, background: C.cell, padding: "10px 10px 9px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 7 }}>
        <span style={{ fontFamily: C.fontFamily, fontSize: 9.5, letterSpacing: "0.13em", textTransform: "uppercase", color: C.textDim }}>{label}</span>
        <span style={{ fontFamily: C.fontFamily, fontSize: 9.5, color: C.textFaint }}>{unit}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 44px", gap: 7, alignItems: "stretch" }}>
        <button type="button" onClick={() => update(-step)} aria-label={`Decrease ${label}`} style={{ border: `1px solid ${C.lineBright}`, background: "none", color: C.text, fontSize: 22, cursor: "pointer" }}>−</button>
        <input
          type="number"
          inputMode={inputMode}
          min={min}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          style={{ minWidth: 0, width: "100%", border: `1px solid ${C.lineBright}`, background: C.bg, color: C.text, textAlign: "center", fontFamily: C.serifFamily, fontSize: 27, fontVariantNumeric: "tabular-nums", padding: "8px 4px", borderRadius: 0 }}
        />
        <button type="button" onClick={() => update(step)} aria-label={`Increase ${label}`} style={{ border: `1px solid ${C.lineBright}`, background: "none", color: C.text, fontSize: 22, cursor: "pointer" }}>+</button>
      </div>
    </div>
  );
}

export function CurrentSetComposer({
  exercise,
  sets,
  setIndex,
  onSelectSet,
  onReplaceSet,
  onBankSet,
  lastRaw,
  suggestedWeight,
  prescription = null,
  onAcceptPrescription = null,
  error,
}) {
  const { C } = useTheme();
  const twoColumnInputs = useMediaQuery("(min-width: 560px)");
  const set = sets[setIndex] || {};
  const mode = resolveTrackingMode(exercise);
  const increment = defaultWeightIncrement(exercise);
  const validation = validateSet(set, exercise);
  const previous = setIndex > 0 ? sets[setIndex - 1] : null;
  const ghost = ghostForSet(sets, setIndex, lastRaw);
  const isUnilateral = /per side/i.test(String(exercise.notes || ""));
  const rawTarget = String(exercise.reps ?? "").trim();
  const targetUnit = mode === TRACKING_MODES.TIMED_HOLD ? "sec" : mode === TRACKING_MODES.CARRY ? "yd" : "reps";
  const targetLabel = rawTarget
    ? `${rawTarget}${/[a-z]/i.test(rawTarget) ? "" : ` ${targetUnit}`}${exercise.rir != null && String(exercise.rir).trim() !== "" ? ` · ${exercise.rir} RIR` : ""}`
    : null;

  const patch = (field, value) => onReplaceSet(setIndex, { ...set, [field]: value });
  const cycleType = () => {
    const current = SET_TYPES.indexOf(set.type || "straight");
    const nextType = SET_TYPES[(current + 1) % SET_TYPES.length];
    const next = { ...set, type: nextType };
    if (nextType !== "drop" && nextType !== "rp") delete next.segments;
    onReplaceSet(setIndex, next);
  };
  const repeatPrevious = () => {
    if (!previous) return;
    const { done, completedAt, segments, ...values } = previous;
    void done; void completedAt; void segments;
    onReplaceSet(setIndex, { ...set, ...values, done: false });
  };
  const applyPrescription = () => {
    if (!prescription) return;
    const next = { ...set, done: false };
    const target = Array.isArray(prescription.targetReps)
      ? prescription.targetReps[Math.min(setIndex, prescription.targetReps.length - 1)]
      : null;
    if (prescription.targetWeight != null) {
      if (mode === TRACKING_MODES.ASSISTED_REPS) next.assistance = String(prescription.targetWeight);
      else next.weight = String(prescription.targetWeight);
    }
    if (target != null) {
      if (mode === TRACKING_MODES.TIMED_HOLD) next.duration = String(target);
      else if (mode === TRACKING_MODES.CARRY) next.distance = String(target);
      else next.reps = String(target);
    }
    onReplaceSet(setIndex, next);
    onAcceptPrescription?.(setIndex, next);
  };

  return (
    <section data-testid="current-set-composer" style={{ padding: "14px 16px 16px", borderBottom: `1px solid ${C.line}`, background: C.block }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ fontFamily: C.fontFamily, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textDim }}>Current set</div>
          <div style={{ fontFamily: C.serifFamily, fontSize: 21, color: C.text, marginTop: 2 }}>Set {setIndex + 1} of {sets.length}</div>
          {targetLabel && <div style={{ fontFamily: C.fontFamily, fontSize: 10, color: C.textFaint, marginTop: 3 }}>Target · {targetLabel}</div>}
        </div>
        <button type="button" onClick={cycleType} style={{ border: `1px solid ${set.type && set.type !== "straight" ? C.text : C.lineBright}`, background: "none", color: set.type && set.type !== "straight" ? C.text : C.textDim, padding: "7px 10px", fontFamily: C.fontFamily, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer" }}>
          {SET_TYPE_LABEL[set.type || "straight"]}
        </button>
      </div>

      {prescription && (
        <div data-testid="progression-prescription" style={{ marginBottom: 10, padding: "9px 10px", border: `1px solid ${C.lineBright}`, background: C.cell }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: C.fontFamily, fontSize: 9, letterSpacing: "0.13em", textTransform: "uppercase", color: C.textDim }}>Today&apos;s target · {prescription.confidence} confidence</div>
              <div style={{ fontFamily: C.serifFamily, fontSize: 17, color: C.text, marginTop: 3 }}>{formatPrescription(prescription)}</div>
              <div style={{ fontFamily: C.fontFamily, fontSize: 10.5, color: C.textDim, lineHeight: 1.45, marginTop: 4 }}>{prescription.rationale}</div>
            </div>
            <button type="button" onClick={applyPrescription} style={{ flexShrink: 0, border: `1px solid ${C.text}`, background: C.text, color: C.bg, padding: "7px 9px", fontFamily: C.fontFamily, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer" }}>Use target</button>
          </div>
          {prescription.caution && <div style={{ marginTop: 6, fontFamily: C.fontFamily, fontSize: 10, color: C.red, lineHeight: 1.4 }}>{prescription.caution}</div>}
        </div>
      )}

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
        {ghost && <GhostChip compact ghost={ghost} onFill={({ weight, reps }) => onReplaceSet(setIndex, { ...set, weight, reps })} />}
        {!prescription && !set.weight && suggestedWeight && mode === TRACKING_MODES.LOADED_REPS && (
          <button type="button" onClick={() => patch("weight", String(suggestedWeight))} style={{ border: `1px solid ${C.lineBright}`, background: "none", color: C.textDim, padding: "7px 10px", fontFamily: C.fontFamily, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}>
            Use suggestion · {suggestedWeight} lb
          </button>
        )}
        {previous && (
          <button type="button" onClick={repeatPrevious} style={{ border: `1px solid ${C.lineBright}`, background: "none", color: C.textDim, padding: "7px 10px", fontFamily: C.fontFamily, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}>
            Repeat set {setIndex}
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: twoColumnInputs ? "repeat(2, minmax(0, 1fr))" : "1fr", gap: 8 }}>
        {mode === TRACKING_MODES.LOADED_REPS && <>
          <StepControl label="Load" value={set.weight || ""} step={increment} unit="lb" onChange={(value) => patch("weight", value)} />
          <StepControl label={isUnilateral ? "Reps / side" : "Reps"} value={set.reps || ""} step={1} unit="reps" inputMode="numeric" onChange={(value) => patch("reps", value)} />
        </>}
        {mode === TRACKING_MODES.BODYWEIGHT_REPS && <>
          <StepControl label={isUnilateral ? "Reps / side" : "Reps"} value={set.reps || ""} step={1} unit="reps" inputMode="numeric" onChange={(value) => patch("reps", value)} />
          <StepControl label="Added load" value={set.weight || ""} step={increment} unit="lb · optional" onChange={(value) => patch("weight", value)} />
        </>}
        {mode === TRACKING_MODES.ASSISTED_REPS && <>
          <StepControl label="Assistance" value={set.assistance || ""} step={5} unit="lb" onChange={(value) => patch("assistance", value)} />
          <StepControl label="Reps" value={set.reps || ""} step={1} unit="reps" inputMode="numeric" onChange={(value) => patch("reps", value)} />
        </>}
        {mode === TRACKING_MODES.TIMED_HOLD && <>
          <StepControl label="Duration" value={set.duration || ""} step={5} unit="seconds" inputMode="numeric" onChange={(value) => patch("duration", value)} />
          <StepControl label="Added load" value={set.weight || ""} step={increment} unit="lb · optional" onChange={(value) => patch("weight", value)} />
        </>}
        {mode === TRACKING_MODES.CARRY && <>
          <StepControl label="Load" value={set.weight || ""} step={increment} unit="lb" onChange={(value) => patch("weight", value)} />
          <StepControl label="Distance" value={set.distance || ""} step={5} unit="yards" inputMode="numeric" onChange={(value) => patch("distance", value)} />
        </>}
      </div>

      <div style={{ marginTop: 11 }}>
        <div style={{ fontFamily: C.fontFamily, fontSize: 9.5, letterSpacing: "0.13em", textTransform: "uppercase", color: C.textDim, marginBottom: 7 }}>Reps in reserve</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 6 }}>
          {[0, 1, 2, 3, 4].map((rir) => {
            const selected = String(set.rir ?? "") === String(rir) || (rir === 4 && numeric(set.rir) >= 4);
            return (
              <button key={rir} type="button" onClick={() => patch("rir", selected ? "" : String(rir))} style={{ minHeight: 42, border: `1px solid ${selected ? C.text : C.lineBright}`, background: selected ? C.text : "none", color: selected ? C.bg : C.text, fontFamily: C.fontFamily, cursor: "pointer" }}>
                {rir === 4 ? "4+" : rir}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 11 }}>
        <div style={{ fontFamily: C.fontFamily, fontSize: 9.5, letterSpacing: "0.13em", textTransform: "uppercase", color: C.textDim, marginBottom: 7 }}>Set feedback <span style={{ color: C.textFaint }}>· optional</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
          {[
            ["clean", "Clean"],
            ["grind", "Grind"],
            ["form_break", "Form broke"],
          ].map(([value, label]) => {
            const selected = set.quality === value;
            return (
              <button key={value} type="button" onClick={() => patch("quality", selected ? "" : value)} style={{ minHeight: 38, border: `1px solid ${selected ? C.text : C.lineBright}`, background: selected ? C.text : "none", color: selected ? C.bg : C.textDim, fontFamily: C.fontFamily, fontSize: 9.5, cursor: "pointer" }}>
                {label}
              </button>
            );
          })}
          <button type="button" onClick={() => patch("pain", !set.pain)} style={{ minHeight: 38, border: `1px solid ${set.pain ? C.red : C.lineBright}`, background: set.pain ? C.red : "none", color: set.pain ? C.bg : C.textDim, fontFamily: C.fontFamily, fontSize: 9.5, cursor: "pointer" }}>Pain</button>
        </div>
      </div>

      {(error || (!set.done && !validation.valid)) && (
        <div role="status" style={{ marginTop: 9, fontFamily: C.fontFamily, fontSize: 10.5, color: error ? C.red : C.textFaint, lineHeight: 1.45 }}>
          {error || validation.message}
        </div>
      )}

      <button
        type="button"
        onClick={() => onBankSet(setIndex)}
        style={{ width: "100%", marginTop: 12, minHeight: 52, border: `1px solid ${set.done ? C.lineBright : C.text}`, background: set.done ? "none" : C.text, color: set.done ? C.text : C.bg, fontFamily: C.fontFamily, fontSize: 11.5, fontWeight: 600, letterSpacing: "0.13em", textTransform: "uppercase", cursor: "pointer" }}
      >
        {set.done ? "Reopen set" : `Bank set ${setIndex + 1}`}
      </button>

      {(set.type === "drop" || set.type === "rp") && (
        <div style={{ marginTop: 10 }}>
          <CascadeSet set={set} compact onChange={(next) => onReplaceSet(setIndex, next)} />
        </div>
      )}

      <div style={{ marginTop: 13, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
        <div style={{ fontFamily: C.fontFamily, fontSize: 9.5, letterSpacing: "0.13em", textTransform: "uppercase", color: C.textDim, marginBottom: 5 }}>Set ledger</div>
        {sets.map((entry, index) => (
          <button key={index} type="button" onClick={() => onSelectSet(index)} style={{ width: "100%", display: "grid", gridTemplateColumns: "26px 1fr auto", alignItems: "center", gap: 8, padding: "8px 0", background: index === setIndex ? C.cell : "none", border: "none", borderBottom: `1px solid ${C.line}`, color: C.text, cursor: "pointer", textAlign: "left" }}>
            <span style={{ fontFamily: C.fontFamily, color: C.textFaint, textAlign: "center" }}>{index + 1}</span>
            <span style={{ fontFamily: C.fontFamily, fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>{displaySet(entry, exercise)}</span>
            <span style={{ fontFamily: C.fontFamily, fontSize: 10, color: entry.done ? C.green : C.textFaint }}>{entry.done ? "BANKED" : index === setIndex ? "CURRENT" : "PLANNED"}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default CurrentSetComposer;
