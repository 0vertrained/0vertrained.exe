// src/sessionIntelligence.js
// Pure display helpers for Session Mode. They read the already-persisted
// entries shape (data[dateKey].workout.exercises[name].sets) and produce
// (1) a "last time" summary per exercise, (2) a conservative double-progression
// hint, and (3) plate math for a target weight. No side effects, no writes,
// no changes to the decision engine — purely presentational, so unit-testable.

// Estimated 1RM (canonical home; TodayTab re-exports for compat)
// Epley formula, capped at 12 reps where the estimate stops being meaningful.
export function epley1RM(weight, reps) {
  const w = parseFloat(weight); const r = parseFloat(reps);
  if (!w || !r || r < 1) return null;
  if (r === 1) return Math.round(w);
  if (r > 12) return null; // estimate unreliable for high-rep sets
  return Math.round(w * (1 + r / 30));
}

// RIR-effective e1RM: a set of 8 @ RIR 2 was really a 10RM in the tank, so
// effective reps = reps + RIR (capped at 4 RIR — beyond that self-report is
// noise). Falls back to plain Epley when RIR isn't logged.
export function effectiveE1RM(weight, reps, rir) {
  const r = parseFloat(reps);
  const ri = parseFloat(rir);
  if (Number.isFinite(ri) && ri >= 0 && Number.isFinite(r)) {
    return epley1RM(weight, r + Math.min(ri, 4));
  }
  return epley1RM(weight, reps);
}

// Last performance
// Scan backwards from (but excluding) todayKey for the most recent day where
// this exercise has at least one completed set with a weight. Returns null when
// there's no history yet.
export function getLastPerformance(data, exerciseName, todayKey, lookbackDays = 60) {
  if (!data || !exerciseName || !todayKey) return null;
  const keys = Object.keys(data)
    .filter(k => k < todayKey)
    .sort()
    .reverse()
    .slice(0, lookbackDays);
  for (const key of keys) {
    const exercises = data[key]?.workout?.exercises || {};
    for (const [plannedName, ex] of Object.entries(exercises)) {
      const performedName = String(ex?.performedName || plannedName);
      if (performedName.toLowerCase() !== exerciseName.toLowerCase()) continue;
      const sets = (ex?.sets || []).filter(s => s.done && (parseFloat(s.weight) || 0) > 0);
      if (sets.length > 0) {
        const weight = Math.max(...sets.map(s => parseFloat(s.weight) || 0));
        const reps = sets.map(s => parseInt(s.reps, 10) || 0);
        // Carry logged RIR (may be sparse/empty — consumers must not assume)
        const rirs = sets.map(s => (s.rir === "" || s.rir === undefined || s.rir === null ? null : parseInt(s.rir, 10)));
        return {
          date: key,
          weight,
          reps,
          rirs,
          setsCompleted: sets.length,
          label: `${weight}×${reps.join("/")}`,
        };
      }
    }
  }
  return null;
}

// Progression hint — conservative double progression
// If the athlete hit the programmed reps on every completed set at a single
// weight in the LAST session with this movement, suggest a small load bump:
// +5 lb for lower-body/compound cues, +5 lb default (kept deliberately simple
// and conservative — this is a hint, not a program change). If reps fell short,
// suggest repeating the weight and chasing reps. Never suggests deloads —
// that's the decision engine's job, not a per-exercise heuristic.
const LOWER_BODY_HINTS = ["squat", "deadlift", "leg", "lunge", "rdl", "hip thrust", "calf"];

export function buildProgressionHint({ last, exercise }) {
  if (!last || !exercise) return null;
  const targetReps = parseInt(exercise.reps, 10) || 0;
  const targetSets = parseInt(exercise.sets, 10) || 0;
  if (!targetReps || !targetSets) return null;

  const completedAll = last.setsCompleted >= targetSets;
  const hitAllReps = completedAll && last.reps.length >= targetSets &&
    last.reps.slice(0, targetSets).every(r => r >= targetReps);

  const isLower = LOWER_BODY_HINTS.some(k => exercise.name.toLowerCase().includes(k));
  const increment = isLower ? 10 : 5;

  // RIR-aware adjustment: if every set was logged and the WORST set
  // still had 3+ in reserve, a double jump is safe; if any set hit RIR 0,
  // the hit-all-reps signal is a grind, not headroom — repeat the weight.
  const loggedRirs = (last.rirs || []).filter(v => Number.isFinite(v));
  const allRirLogged = loggedRirs.length >= last.setsCompleted && last.setsCompleted > 0;
  const minRir = loggedRirs.length ? Math.min(...loggedRirs) : null;

  if (hitAllReps) {
    if (allRirLogged && minRir === 0) {
      return {
        kind: "reps",
        suggestedWeight: last.weight,
        text: `Hit ${last.weight}×${targetSets}×${targetReps} but at RIR 0 — repeat the weight and bank cleaner reps first.`,
      };
    }
    const easy = allRirLogged && minRir >= 3;
    const suggested = last.weight + (easy ? increment * 2 : increment);
    return {
      kind: "load",
      suggestedWeight: suggested,
      text: easy
        ? `Hit ${last.weight}×${targetSets}×${targetReps} with ${minRir}+ in reserve — jump to ${suggested}.`
        : `Hit ${last.weight}×${targetSets}×${targetReps} last time — try ${suggested}.`,
    };
  }
  return {
    kind: "reps",
    suggestedWeight: last.weight,
    text: `Last time: ${last.label}. Repeat ${last.weight} and chase ${targetSets}×${targetReps}.`,
  };
}

// Plate math
// Standard lb plates per side for a given target on a 45-lb bar. Returns null
// when the target is below the bar or not a number. Greedy from heaviest —
// exact for anything loadable in 2.5-lb steps; flags a remainder otherwise.
const PLATES_LB = [45, 35, 25, 10, 5, 2.5];

export function calcPlateMath(target, barWeight = 45) {
  const t = parseFloat(target);
  if (!Number.isFinite(t) || t < barWeight) return null;
  if (t === barWeight) return { perSide: [], label: "empty bar" };
  let perSideWeight = (t - barWeight) / 2;
  const perSide = [];
  for (const p of PLATES_LB) {
    while (perSideWeight >= p - 1e-9) {
      perSide.push(p);
      perSideWeight -= p;
    }
  }
  const remainder = Math.round(perSideWeight * 100) / 100;
  return {
    perSide,
    remainder: remainder > 0 ? remainder : 0,
    label: perSide.length
      ? `${perSide.join(" + ")} / side${remainder > 0 ? ` (+${remainder} short)` : ""}`
      : "empty bar",
  };
}

// Warm-up ramp
// Standard percentage ramp to a working weight: empty bar × 10, ~55% × 5,
// ~70% × 3, ~85% × 2, then work sets. Steps round to 5 lb, dedupe, and skip
// anything at/below the bar. Below 95 lb a ramp is pointless — bar work and
// the first set ARE the warm-up — so this returns null.
const RAMP_STEPS = [
  { pct: 0.55, reps: 5 },
  { pct: 0.70, reps: 3 },
  { pct: 0.85, reps: 2 },
];

export function buildWarmupRamp(workingWeight, barWeight = 45) {
  const w = parseFloat(workingWeight);
  if (!Number.isFinite(w) || w < 95) return null;
  const steps = [{ weight: barWeight, reps: 10, label: "empty bar" }];
  const seen = new Set([barWeight]);
  for (const s of RAMP_STEPS) {
    const target = Math.round((w * s.pct) / 5) * 5;
    if (target <= barWeight || target >= w || seen.has(target)) continue;
    seen.add(target);
    const plates = calcPlateMath(target, barWeight);
    steps.push({ weight: target, reps: s.reps, label: plates ? plates.label : "" });
  }
  const workPlates = calcPlateMath(w, barWeight);
  return { steps, working: { weight: w, label: workPlates ? workPlates.label : "" } };
}

// Rest timer defaults
// Display-only suggestion: heavier compound work earns longer rests. The timer
// itself is client state in SessionMode; this just picks the default seconds.
export function suggestRestSeconds(exercise) {
  if (!exercise) return 90;
  const name = (exercise.name || "").toLowerCase();
  const reps = parseInt(exercise.reps, 10) || 10;
  const compound = ["squat", "deadlift", "bench", "press", "row", "pull"].some(k => name.includes(k));
  if (compound && reps <= 6) return 180;
  if (compound) return 120;
  return 90;
}
