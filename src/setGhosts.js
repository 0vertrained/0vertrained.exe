// src/setGhosts.js
// Ghost taps — the highest-frequency interaction in the product,
// reduced from typing to one tap.
//
// Design rules (the intuition contract, each pinned by test):
//   · ONE chip, always where you're working: the ghost renders on the FIRST
//     empty set only. Fill it and the chip moves to the next set. Never a
//     column of repeated suggestions.
//   · EXPLICIT tap, never auto-adopt: an unperformed weight must be
//     impossible to log by accident. Tapping ✓ on an empty row logs nothing.
//   · Fill priority mirrors how lifters actually think:
//       carry (your previous set TODAY — "same as last set")
//       > last time, same set slot (set 3 vs set 3 — where fatigue history
//         actually lives)
//       > last time, final set (when today plans more sets than last time).
//   · The chip SAYS its source ("from set 2" / "last time · Jul 12") — a
//     suggestion you can't audit is a suggestion you can't trust.

const numOr = (v, fb = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fb;
};

/**
 * The most recent PRIOR day's raw sets for an exercise, index-preserved.
 * (sessionIntelligence.getLastPerformance aggregates to max/reps — ghosts
 * need the per-slot values, so this reads the raw list.)
 */
export function lastSessionSets(data, exerciseName, todayKey, lookbackDays = 60) {
  if (!data || !exerciseName || !todayKey) return null;
  const keys = Object.keys(data).filter((k) => k < todayKey).sort().reverse().slice(0, lookbackDays);
  for (const key of keys) {
    const exercises = data[key]?.workout?.exercises || {};
    for (const [plannedName, entry] of Object.entries(exercises)) {
      const performedName = String(entry?.performedName || plannedName);
      if (performedName.toLowerCase() !== exerciseName.toLowerCase()) continue;
      const sets = (entry?.sets || []).filter((s) => s.done && numOr(s.weight) > 0);
      if (sets.length > 0) {
        return { date: key, sets: sets.map((s) => ({ weight: String(s.weight), reps: String(s.reps ?? "") })) };
      }
    }
  }
  return null;
}

// The set index the single chip attaches to: first row without a weight.
export function firstEmptyIndex(sets) {
  const i = (sets || []).findIndex((s) => !s || String(s.weight ?? "").trim() === "");
  return i; // -1 when every row has a weight
}

/**
 * The ghost for one set index. Returns null when there's nothing worth
 * offering (no history and no carry).
 * @returns {{weight, reps, source: "carry"|"last", label} | null}
 */
export function ghostForSet(sets, index, last) {
  // 1 · Carry: the nearest EARLIER set today that has a weight.
  for (let i = index - 1; i >= 0; i--) {
    const s = sets?.[i];
    if (s && numOr(s.weight) > 0) {
      return { weight: String(s.weight), reps: String(s.reps ?? ""), source: "carry", label: `from set ${i + 1}` };
    }
  }
  // 2 · Last time, same slot — else its final set.
  if (last?.sets?.length) {
    const slot = last.sets[index] || last.sets[last.sets.length - 1];
    const md = new Date(`${last.date}T12:00:00`);
    const when = md.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return { weight: slot.weight, reps: slot.reps, source: "last", label: `last time · ${when}` };
  }
  return null;
}

/**
 * The rest-overlay glance: what's next and what it looked like last time.
 * Called at the moment rest starts (the just-completed index is known).
 */
export function buildNextGlance({ sets, completedIndex, exerciseName, last, nextExerciseName = null }) {
  const total = sets?.length || 0;
  const nextIdx = (sets || []).findIndex((s, i) => i > completedIndex && !s?.done);
  if (nextIdx !== -1) {
    const slot = last?.sets?.[nextIdx] || (last?.sets?.length ? last.sets[last.sets.length - 1] : null);
    return {
      line: `Next · set ${nextIdx + 1} of ${total}`,
      ghost: slot ? `last time ${numOr(slot.weight) || "·"}×${numOr(slot.reps) || "·"}` : null,
      exercise: exerciseName,
    };
  }
  if (nextExerciseName) return { line: `Next · ${nextExerciseName}`, ghost: null, exercise: nextExerciseName };
  return { line: "Last set banked", ghost: null, exercise: exerciseName };
}

export default { lastSessionSets, firstEmptyIndex, ghostForSet, buildNextGlance };
