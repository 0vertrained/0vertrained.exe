// src/workout/setFill.js
// What an empty set is filled from: today's target, the set before it, or the
// same set last time. The runner shows the first of these as the proposal and
// says which it is, so a set done as planned is logged in one tap. Nothing
// here is stored: the stored set stays empty until it is edited or logged.

import { prescriptionWeightAt } from "../progressionEngine";
import { TRACKING_MODES, resolveTrackingMode } from "../workoutLogging";

const NBSP = " ";
const filled = (value) => String(value ?? "").trim() !== "";
const positive = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0;
};

// The two fields each tracking mode logs, in the order the runner shows them.
export function setFields(exercise = {}) {
  const mode = resolveTrackingMode(exercise);
  const unilateral = /per side/i.test(String(exercise.notes || ""));
  const reps = { prop: "reps", label: unilateral ? "Reps per side" : "Reps", unit: unilateral ? "reps per side" : "reps", step: 1, inputMode: "numeric", less: "Fewer reps", more: "More reps" };
  if (mode === TRACKING_MODES.TIMED_HOLD) {
    return [
      { prop: "duration", label: "Seconds", unit: "s", step: 5, inputMode: "numeric", less: "Less time", more: "More time" },
      { prop: "weight", label: "Added weight in pounds", unit: "lb added", step: null, inputMode: "decimal", less: "Less weight", more: "More weight", optional: true },
    ];
  }
  if (mode === TRACKING_MODES.CARRY) {
    return [
      { prop: "weight", label: "Weight in pounds", unit: "lb", step: null, inputMode: "decimal", less: "Less weight", more: "More weight" },
      { prop: "distance", label: "Distance in yards", unit: "yd", step: 5, inputMode: "numeric", less: "Less distance", more: "More distance" },
    ];
  }
  if (mode === TRACKING_MODES.ASSISTED_REPS) {
    return [
      { prop: "assistance", label: "Assistance in pounds", unit: "lb assist", step: 5, inputMode: "decimal", less: "Less assistance", more: "More assistance" },
      reps,
    ];
  }
  if (mode === TRACKING_MODES.BODYWEIGHT_REPS) {
    return [
      reps,
      { prop: "weight", label: "Added weight in pounds", unit: "lb added", step: null, inputMode: "decimal", less: "Less weight", more: "More weight", optional: true },
    ];
  }
  return [
    { prop: "weight", label: "Weight in pounds", unit: "lb", step: null, inputMode: "decimal", less: "Less weight", more: "More weight" },
    reps,
  ];
}

// True once anything has been entered for the set's own two fields.
export function hasEntry(set = {}, exercise = {}) {
  return setFields(exercise).some((field) => filled(set[field.prop]));
}

function summarize(values, exercise) {
  const [first, second] = setFields(exercise);
  const a = filled(values[first.prop]) ? values[first.prop] : null;
  const b = filled(values[second.prop]) ? values[second.prop] : null;
  if (first.prop === "weight" && second.prop === "reps") {
    if (a !== null && b !== null) return `${a}${NBSP}×${NBSP}${b}`;
    return a !== null ? `${a}${NBSP}lb` : b !== null ? `${b}${NBSP}reps` : "";
  }
  return [a !== null ? `${a}${NBSP}${first.unit}` : null, b !== null ? `${b}${NBSP}${second.unit}` : null].filter(Boolean).join(" · ");
}

function targetValues(prescription, setIndex, mode) {
  if (!prescription) return null;
  const values = {};
  const reps = Array.isArray(prescription.targetReps) && prescription.targetReps.length
    ? prescription.targetReps[Math.min(setIndex, prescription.targetReps.length - 1)]
    : null;
  const weight = prescriptionWeightAt(prescription, setIndex);
  if (weight != null) {
    if (mode === TRACKING_MODES.ASSISTED_REPS) values.assistance = String(weight);
    else values.weight = String(weight);
  }
  if (reps != null) {
    if (mode === TRACKING_MODES.TIMED_HOLD) values.duration = String(reps);
    else if (mode === TRACKING_MODES.CARRY) values.distance = String(reps);
    else values.reps = String(reps);
  }
  return Object.keys(values).length ? values : null;
}

// Every source this set can be filled from, best first: the target, the set
// just before it today, then the same set last time.
export function fillOptions({ setIndex = 0, sets = [], exercise = {}, prescription = null, lastRaw = null } = {}) {
  const mode = resolveTrackingMode(exercise);
  const fields = setFields(exercise);
  const options = [];

  const target = targetValues(prescription, setIndex, mode);
  if (target) options.push({ key: "target", name: "Target", source: "Filled from target", values: target });

  const previous = setIndex > 0 ? sets[setIndex - 1] : null;
  if (previous && hasEntry(previous, exercise)) {
    const values = {};
    for (const field of fields) if (filled(previous[field.prop])) values[field.prop] = String(previous[field.prop]);
    options.push({ key: "previous", name: `Set ${setIndex}`, source: `Filled from set ${setIndex}`, values });
  }

  const slot = lastRaw?.sets?.length ? (lastRaw.sets[setIndex] || lastRaw.sets[lastRaw.sets.length - 1]) : null;
  if (slot && fields.some((field) => positive(slot[field.prop]))) {
    const values = {};
    for (const field of fields) if (filled(slot[field.prop])) values[field.prop] = String(slot[field.prop]);
    options.push({ key: "last", name: "Last time", source: "Filled from last time", values });
  }

  return options.map((option) => ({ ...option, label: `${option.name} ${summarize(option.values, exercise)}`.trim() }));
}

// The set as the runner shows it. An empty set takes the chosen source and
// reports which; a set with an entry is shown as it stands. Unless `choice`
// names a source, the first one that fills every number the set needs wins,
// so a target with no load on it does not hide the weight from the set before.
export function proposeSet({ set = {}, setIndex = 0, sets = [], exercise = {}, prescription = null, lastRaw = null, choice = null } = {}) {
  const options = fillOptions({ setIndex, sets, exercise, prescription, lastRaw });
  if (set.done || hasEntry(set, exercise)) return { set, options, source: null, proposed: false };
  const required = setFields(exercise).filter((field) => !field.optional);
  const complete = (entry) => required.every((field) => filled(entry.values[field.prop]));
  const option = options.find((entry) => entry.key === choice) || options.find(complete) || options[0] || null;
  if (!option) return { set, options, source: null, proposed: false };
  return { set: { ...set, ...option.values }, options, source: option, proposed: true };
}

export default { setFields, hasEntry, fillOptions, proposeSet };
