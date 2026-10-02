// src/dayZero.js
// ─────────────────────────────────────────────────────────────────────────────
// V17.0 · Day Zero Edition — the zero-state detector.
//
// A cold visitor's first minutes are the whole conversion game. Each tab gets
// exactly one question answered here: "does this person have ANY real data on
// this surface?" If not, the tab renders a designed specimen with ONE action
// (DayZeroSpecimen.jsx) instead of empty panels.
//
// Rules of the detector:
//   · "Meaningful content" beats key-existence. Opening a day creates a blank
//     defaultDay() shell — a shell must not defeat the zero state, and a
//     single logged set, meal, or weigh-in must.
//   · Demo mode counts as real data everywhere (the demo build's job is a
//     full fake environment; specimens would fight it).
//   · Progress is honest about its unlock: it reports how many logged days
//     exist and how many remain, in the Morning Edition calibration voice.
//   · Pure module. No React, no theme, no network.
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRESS_UNLOCK_DAYS = 7;

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Does a single day's entry carry anything a human actually logged?
export function dayHasContent(day) {
  if (!day || typeof day !== "object") return false;
  const w = day.workout || {};
  if (w.exercises && Object.keys(w.exercises).length > 0) return true;
  if (w.cardio && (num(w.cardio.miles) || num(w.cardio.time))) return true;
  const n = day.nutrition || {};
  if (Array.isArray(n.meals) && n.meals.length > 0) return true;
  if (num(n.calories) || num(n.protein)) return true;
  const b = day.body || {};
  if (num(b.weight) || num(b.sleep) || num(b.energy) || num(b.soreness)) return true;
  return false;
}

export function countLoggedDays(data) {
  return Object.values(data || {}).filter(dayHasContent).length;
}

function hasWorkoutContent(data) {
  return Object.values(data || {}).some((day) => {
    const w = day?.workout || {};
    if (w.exercises && Object.keys(w.exercises).length > 0) return true;
    if (w.cardio && (num(w.cardio.miles) || num(w.cardio.time))) return true;
    return false;
  });
}

function hasNutritionContent(data) {
  return Object.values(data || {}).some((day) => {
    const n = day?.nutrition || {};
    return (Array.isArray(n.meals) && n.meals.length > 0) || num(n.calories) !== null || num(n.protein) !== null;
  });
}

function hasFuelTargets(settings) {
  const t = settings?.macroTargets || {};
  return Object.values(t).some((v) => (num(v) || 0) > 0);
}

/**
 * The per-tab zero map.
 * @param {object} args — { data, settings, ouraConnected, demoMode }
 * @returns {{ today, recovery, fuel, progress }} each { isZero, ... }
 */
export function detectDayZero({ data = {}, settings = {}, ouraConnected = false, demoMode = false } = {}) {
  if (demoMode) {
    const none = { isZero: false };
    return { today: none, recovery: none, fuel: none, progress: { isZero: false, daysHave: PROGRESS_UNLOCK_DAYS, daysNeeded: 0 } };
  }
  const whoopConnected = settings?.whoopConnected === true;
  const loggedDays = countLoggedDays(data);
  return {
    // A default program is auto-assigned at load, so "no program" is
    // undetectable by absence — the honest zero signal for Today is that no
    // workout has ever been logged. The one action is still "pick your
    // program": choosing consciously is the right first move either way.
    today: { isZero: !hasWorkoutContent(data) },
    recovery: { isZero: !ouraConnected && !whoopConnected },
    fuel: { isZero: !hasFuelTargets(settings) && !hasNutritionContent(data) },
    progress: {
      isZero: loggedDays < PROGRESS_UNLOCK_DAYS,
      daysHave: loggedDays,
      daysNeeded: Math.max(0, PROGRESS_UNLOCK_DAYS - loggedDays),
    },
  };
}

export default { detectDayZero, dayHasContent, countLoggedDays, PROGRESS_UNLOCK_DAYS };
