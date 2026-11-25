// src/workout/CurrentSetComposer.jsx
// The current set, as the hero of the runner: what it is filled from, the two
// numbers on steppers big enough for a gym floor, reps in reserve, and the
// rarely needed details (set type, how it felt, the pain flag) behind More.
// LoggedSets is the list above it: each logged set on one line, open to edit.
import { useState } from "react";
import { formatPrescription } from "../progressionEngine";
import { CascadeSet } from "../CascadeSet";
import { Icon, Seg, Switch } from "../ui/ledger";
import { defaultWeightIncrement, displaySet } from "../workoutLogging";
import { proposeSet, setFields } from "./setFill";

const SET_TYPES = [
  ["straight", "Straight"],
  ["drop", "Drop"],
  ["myo", "Myo-rep"],
  ["rp", "Rest-pause"],
  ["partial", "Partial"],
];
const FEEL = [
  ["clean", "Clean"],
  ["grind", "Grind"],
  ["form_break", "Form break"],
];

const numeric = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// One number on a stepper: 64 px buttons either side, and the value itself is
// a field, so 187.5 can be typed.
function Stepper({ field, value, step, onChange }) {
  const text = String(value ?? "");
  const nudge = (delta) => onChange(String(Math.max(0, Math.round((numeric(value) + delta) * 100) / 100)));
  return (
    <div className="step step-xl" role="group" aria-label={field.label}>
      <button type="button" aria-label={field.less} onClick={() => nudge(-step)}><Icon name="minus" /></button>
      <span className="stepv">
        <input
          className={`stepin ${text.length > 4 ? "n-lg" : "n-xl"}`}
          type="number"
          inputMode={field.inputMode}
          min="0"
          autoComplete="off"
          placeholder="0"
          value={text}
          onChange={(event) => onChange(event.target.value)}
          aria-label={field.label}
          style={{ width: `${Math.max(2, text.length || 1)}ch` }}
        />
        <span className="t-b c2">{field.unit}{field.optional ? ", optional" : ""}</span>
      </span>
      <button type="button" aria-label={field.more} onClick={() => nudge(step)}><Icon name="plus" /></button>
    </div>
  );
}

// The sets already logged for this exercise. A row opens its set for editing;
// the heaviest set on record carries the PR tag.
export function LoggedSets({ exercise, sets, activeIndex = -1, freshIndex = -1, recordIndex = -1, onSelect }) {
  const logged = sets.map((set, index) => ({ set, index })).filter((entry) => entry.set.done);
  if (!logged.length) return null;
  return (
    <ul className="rows" aria-label="Logged sets" style={{ borderTop: "1px solid var(--line)", paddingTop: 4 }}>
      {logged.map(({ set, index }) => {
        const fresh = index === freshIndex;
        const line = displaySet(set, exercise);
        return (
          <li key={index}>
            <button type="button" className="row" aria-current={index === activeIndex ? "true" : undefined} aria-label={`Set ${index + 1}, logged: ${line}${index === recordIndex ? ", a personal record" : ""}. Open to edit.`} onClick={() => onSelect(index)}>
              <Icon name="done" className="good" />
              <span className={`t-bs${fresh ? " mo-write" : ""}`}>Set {index + 1}</span>
              {index === recordIndex && <span className={`tag tag-e${fresh ? " mo-stamp mo-foil" : ""}`} style={fresh ? { "--d": "260ms" } : undefined}>PR</span>}
              <span className={`n grow${fresh ? " mo-write" : ""}`} style={{ textAlign: "right" }}>{line}</span>
              <Icon name="next" size="s" className="c2" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function CurrentSetComposer({
  exercise,
  sets,
  setIndex,
  onReplaceSet,
  onReopenSet = null,
  lastRaw,
  prescription = null,
  onAcceptPrescription = null,
  choice = null,
  onChoice = null,
  error = "",
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const stored = sets[setIndex] || {};
  const { set, options, source, proposed } = proposeSet({ set: stored, setIndex, sets, exercise, prescription, lastRaw, choice });
  const fields = setFields(exercise);
  const increment = defaultWeightIncrement(exercise);
  const type = stored.type || "straight";
  const targetRir = exercise.rir != null && String(exercise.rir).trim() !== "" ? String(exercise.rir) : null;

  // Any edit starts from what is on screen, so the first tap on a stepper
  // keeps the proposal's other number.
  const patch = (field, value) => onReplaceSet(setIndex, { ...set, [field]: value });
  const patchDetail = (field, value) => onReplaceSet(setIndex, { ...(proposed ? stored : set), [field]: value });

  const fillFrom = (key) => {
    const option = options.find((entry) => entry.key === key);
    if (!option) return;
    onChoice?.(key);
    // An empty set only needs the choice; a set with an entry is overwritten.
    if (!proposed || !onChoice) onReplaceSet(setIndex, { ...stored, ...option.values, done: false });
    if (key === "target") onAcceptPrescription?.(setIndex, { ...stored, ...option.values, done: false });
  };
  const matches = (option) => fields.every((field) => String(set[field.prop] ?? "") === String(option.values[field.prop] ?? set[field.prop] ?? ""));
  const chosenOption = proposed ? source : options.find(matches) || null;
  const chosen = chosenOption?.key;

  const chooseType = (nextType) => {
    const next = { ...(proposed ? stored : set), type: nextType };
    if (nextType !== "drop" && nextType !== "rp") delete next.segments;
    onReplaceSet(setIndex, next);
  };

  const status = stored.done ? "Logged"
    : chosenOption ? chosenOption.source
    : fields.some((field) => String(stored[field.prop] ?? "") !== "") ? "Edited by you"
    : "";

  return (
    <div data-testid="current-set-composer" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card" aria-labelledby="current-set" style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12 }}>
        <div className="sec"><h3 id="current-set" className="t-h">Set {setIndex + 1} of {sets.length}</h3>{status && <span className="t-s c2">{status}</span>}</div>

        {!stored.done && options.length > 0 && (
          <Seg
            label="Fill this set from"
            options={options.slice(0, 2).map((option) => ({ value: option.key, label: option.label }))}
            value={chosen}
            onChange={fillFrom}
          />
        )}

        {!stored.done && prescription && (
          <div data-testid="progression-prescription" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p className="t-s c2"><span className="t-ss" style={{ color: "var(--ink)" }}>Today’s target: {formatPrescription(prescription)}.</span> {prescription.rationale}</p>
            {prescription.caution && <p className="t-s" style={{ display: "flex", gap: 6, alignItems: "flex-start" }}><Icon name="warn" size="s" className="caution" /><span>{prescription.caution}</span></p>}
          </div>
        )}

        {fields.map((field) => (
          <Stepper key={field.prop} field={field} value={set[field.prop] ?? ""} step={field.step ?? increment} onChange={(value) => patch(field.prop, value)} />
        ))}

        {error && <p className="err" role="alert"><Icon name="warn" size="s" />{error}</p>}

        {stored.done && onReopenSet && (
          <button type="button" className="btn btn-s btn-sm" onClick={() => onReopenSet(setIndex)} style={{ alignSelf: "flex-start" }}>Mark as not done</button>
        )}
      </section>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="sec"><span id="set-rir" className="lbl">Reps in reserve (RIR)</span>{targetRir && <span className="t-s c2">Target {targetRir}</span>}</div>
        <div className="seg" role="group" aria-labelledby="set-rir">
          {[0, 1, 2, 3, 4].map((rir) => {
            const selected = String(stored.rir ?? "") === String(rir) || (rir === 4 && numeric(stored.rir) >= 4);
            return (
              <button key={rir} type="button" className="n" aria-pressed={selected} aria-label={rir === 4 ? "4 or more" : String(rir)} onClick={() => patchDetail("rir", selected ? "" : String(rir))}>
                {rir === 4 ? "4+" : rir}
              </button>
            );
          })}
        </div>
      </div>

      <button type="button" className="row" aria-expanded={moreOpen} aria-controls="set-more" onClick={() => setMoreOpen((open) => !open)}>
        <span className="t-bs grow">More: set type, how it felt, pain flag</span>
        <Icon name={moreOpen ? "up" : "down"} size="s" className="c2" />
      </button>
      {moreOpen && (
        <div id="set-more" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span id="set-type" className="lbl">Set type</span>
            <div className="chips" role="radiogroup" aria-labelledby="set-type">
              {SET_TYPES.map(([value, label]) => (
                <button key={value} type="button" className="chip" role="radio" aria-checked={type === value} onClick={() => chooseType(value)}>{label}</button>
              ))}
            </div>
          </div>
          {(type === "drop" || type === "rp") && <CascadeSet set={set} onChange={(next) => onReplaceSet(setIndex, next)} />}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span id="set-feel" className="lbl">How it felt (optional)</span>
            <div className="seg" role="group" aria-labelledby="set-feel">
              {FEEL.map(([value, label]) => {
                const selected = stored.quality === value;
                return <button key={value} type="button" aria-pressed={selected} onClick={() => patchDetail("quality", selected ? "" : value)}>{label}</button>;
              })}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 48 }}>
            <span id="set-pain" className="t-bs grow">Pain on this set</span>
            <Switch checked={Boolean(stored.pain)} onChange={(next) => patchDetail("pain", next)} labelledBy="set-pain" />
          </div>
        </div>
      )}
    </div>
  );
}

export default CurrentSetComposer;
