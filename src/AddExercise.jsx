// src/AddExercise.jsx
// Add an exercise to one day: search what you've logged lately and the
// exercise library, or type a name of your own, then set the sets and reps.
// It goes into the day only (src/addedExercises.js); the program stays as
// it is. Used from Quick edit, Today's plan and the session runner's queue.

import { useState } from "react";
import { Icon, Sheet } from "./ui/ledger";
import { selectionHaptic } from "./native";
import { defaultsFor, exerciseChoices, exerciseTarget, EXERCISE_FILTERS } from "./addedExercises";
import { EQUIPMENT_LABELS, MOVEMENT_LABELS, findLibraryExercise } from "./programExerciseLibrary";

function Stepper({ label, value, onChange, unit, high }) {
  const low = 1;
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

function AddForm({ allData, todayKey, existing, onAdd, program }) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(null);
  const [category, setCategory] = useState("all");
  const [pattern, setPattern] = useState("all");
  const [visible, setVisible] = useState(8);
  const typed = query.trim();
  const choices = exerciseChoices({ query, allData, todayKey, exclude: existing, category, pattern, browse: true });
  const taken = existing.some((name) => name.toLowerCase() === typed.toLowerCase());
  const custom = typed && !taken && !findLibraryExercise(typed) && !choices.some((name) => name.toLowerCase() === typed.toLowerCase()) ? typed : null;

  const choose = (name) => setChosen({ name, ...defaultsFor(name, { allData, todayKey }) });

  if (chosen) {
    const entry = findLibraryExercise(chosen.name);
    const target = exerciseTarget(chosen);
    const alternatives = (entry?.alternatives || []).filter(name =>
      !existing.some(takenName => takenName.toLowerCase() === name.toLowerCase()) && findLibraryExercise(name));
    return (
      <>
        <div className="row" style={{ minHeight: 56 }}>
          <span className="kv grow"><span className="t-bs">{chosen.name}</span>{entry && <span className="t-s c2">{EQUIPMENT_LABELS[entry.equipment]} · {MOVEMENT_LABELS[entry.pattern]}</span>}</span>
          <button type="button" className="btn btn-s btn-sm" onClick={() => setChosen(null)}>Change</button>
        </div>
        {entry && <p className="t-s c2">{entry.notes}</p>}
        <Stepper label="Sets" unit="sets" high={10} value={chosen.sets} onChange={(sets) => setChosen({ ...chosen, sets })} />
        <Stepper label={target.label} unit={target.unit} high={target.max} value={chosen.reps} onChange={(reps) => setChosen({ ...chosen, reps })} />
        <button type="button" className="btn btn-p btn-b" onClick={() => onAdd(program && entry ? { ...chosen, notes: entry.notes } : chosen)}>{program ? "Add to session" : "Add to today"}</button>
        {alternatives.length > 0 && <label className="field"><span className="lbl">Alternatives</span>
          <select className="input" value="" onChange={event => event.target.value && choose(event.target.value)}>
            <option value="">Choose an alternative</option>
            {alternatives.map(name => <option key={name}>{name}</option>)}
          </select>
        </label>}
      </>
    );
  }

  return (
    <>
      <label className="field">
        <span className="lbl">Exercise</span>
        <input className="input" type="search" autoComplete="off" enterKeyHint="search" maxLength={60} value={query} onChange={(event) => { setQuery(event.target.value); setVisible(8); }} placeholder="Search or type a name" />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        <label className="field">
          <span className="lbl">Equipment or activity</span>
          <select className="input" value={category} onChange={event => { setCategory(event.target.value); setVisible(8); }}>
            {Object.entries(EXERCISE_FILTERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="lbl">Movement</span>
          <select className="input" value={pattern} onChange={event => { setPattern(event.target.value); setVisible(8); }}>
            <option value="all">All movements</option>
            {Object.entries(MOVEMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>
      {taken && <p className="t-s c2">{typed} is already in this session.</p>}
      <div className="rows">
        {choices.slice(0, visible).map((name) => (
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
      {visible < choices.length && <button type="button" className="btn btn-s btn-sm" onClick={() => setVisible(visible + 12)}>Show more exercises</button>}
      {choices.length === 0 && !custom && <p className="t-s c2">No matching exercises. Try another category or search.</p>}
    </>
  );
}

/**
 * existing: the names already in the day, which can't be added again.
 * onAdd({ name, sets, reps, trackingMode? }).
 */
export function AddExerciseSheet({ open, onClose, allData, todayKey, existing = [], onAdd, program = false }) {
  return (
    <Sheet open={open} title="Add an exercise" onClose={onClose}>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <AddForm allData={allData} todayKey={todayKey} existing={existing} onAdd={onAdd} program={program} />
        </div>
      )}
    </Sheet>
  );
}

export default AddExerciseSheet;
