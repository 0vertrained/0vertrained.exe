// src/AddExercise.jsx
// Add an exercise to one day: search what you've logged lately and the
// exercise library, or type a name of your own, then set the sets and reps.
// It goes into the day only (src/addedExercises.js); the program stays as
// it is. Used from Quick edit, Today's plan and the session runner's queue.

import { useState } from "react";
import { Icon, Sheet } from "./ui/ledger";
import { selectionHaptic } from "./native";
import { defaultsFor, exerciseChoices } from "./addedExercises";

const LIMITS = { sets: [1, 10], reps: [1, 50] };

function Stepper({ label, value, onChange, unit }) {
  const [low, high] = LIMITS[unit];
  const step = (delta) => {
    const next = Math.min(high, Math.max(low, value + delta));
    if (next === value) return;
    selectionHaptic();
    onChange(next);
  };
  return (
    <div className="row" style={{ minHeight: 64 }}>
      <span className="t-bs grow">{label}</span>
      <div className="step" role="group" aria-label={label} style={{ width: 216 }}>
        <button type="button" aria-label={`Fewer ${unit}`} aria-disabled={value <= low || undefined} onClick={() => step(-1)}><Icon name="minus" /></button>
        <span className="stepv"><span className="n-md" aria-live="polite">{value}</span></span>
        <button type="button" aria-label={`More ${unit}`} aria-disabled={value >= high || undefined} onClick={() => step(1)}><Icon name="plus" /></button>
      </div>
    </div>
  );
}

function AddForm({ allData, todayKey, existing, onAdd }) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(null);
  const typed = query.trim();
  const choices = exerciseChoices({ query, allData, todayKey, exclude: existing });
  const taken = existing.some((name) => name.toLowerCase() === typed.toLowerCase());
  const custom = typed && !taken && !choices.some((name) => name.toLowerCase() === typed.toLowerCase()) ? typed : null;

  const choose = (name) => setChosen({ name, ...defaultsFor(name, { allData, todayKey }) });

  if (chosen) {
    return (
      <>
        <div className="row" style={{ minHeight: 56 }}>
          <span className="kv grow"><span className="t-bs">{chosen.name}</span><span className="t-s c2">Today only. Your program stays the same.</span></span>
          <button type="button" className="btn btn-s btn-sm" onClick={() => setChosen(null)}>Change</button>
        </div>
        <Stepper label="Sets" unit="sets" value={chosen.sets} onChange={(sets) => setChosen({ ...chosen, sets })} />
        <Stepper label="Reps" unit="reps" value={chosen.reps} onChange={(reps) => setChosen({ ...chosen, reps })} />
        <button type="button" className="btn btn-p btn-b" onClick={() => onAdd(chosen)}>Add to today</button>
      </>
    );
  }

  return (
    <>
      <label className="field">
        <span className="lbl">Exercise</span>
        <input className="input" type="search" autoComplete="off" enterKeyHint="search" maxLength={60} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search or type a name" />
      </label>
      {taken && <p className="t-s c2">{typed} is already in today’s plan.</p>}
      <div className="rows">
        {!typed && choices.length > 0 && <p className="t-c c2" style={{ padding: "4px 0" }}>Logged lately</p>}
        {choices.map((name) => (
          <button key={name} type="button" className="row" onClick={() => choose(name)} style={{ minHeight: 48, textAlign: "left" }}>
            <span className="t-b grow clip">{name}</span>
            <Icon name="plus" size="s" className="c2" />
          </button>
        ))}
        {custom && (
          <button type="button" className="row" onClick={() => choose(custom)} style={{ minHeight: 48, textAlign: "left" }}>
            <span className="t-b grow clip">Add “{custom}”</span>
            <Icon name="plus" size="s" className="c2" />
          </button>
        )}
      </div>
      {!typed && choices.length === 0 && <p className="t-s c2">Search the exercise library, or type the name of your own.</p>}
    </>
  );
}

/**
 * existing: the names already in the day, which can't be added again.
 * onAdd({ name, sets, reps, trackingMode? }).
 */
export function AddExerciseSheet({ open, onClose, allData, todayKey, existing = [], onAdd }) {
  return (
    <Sheet open={open} title="Add an exercise" onClose={onClose}>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <AddForm allData={allData} todayKey={todayKey} existing={existing} onAdd={onAdd} />
        </div>
      )}
    </Sheet>
  );
}

export default AddExerciseSheet;
