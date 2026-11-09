// src/dayZero.js
// Day Zero Edition — the zero-state detector.
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
//   · A specimen never hides the only way past it. A specimen
//     replaces its whole tab, so what clears it can't be something only that
//     tab can log: Today and Fuel clear when setup finishes, Recovery when a
//     wearable connects or a check-in is logged on Today.
//   · Pure module. No React, no theme, no network.

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

// A manual check-in: the readiness inputs Recovery reads, logged on Today's
// body row or with Recovery's tap row.
const CHECKIN_FIELDS = ["sleep", "sleepQuality", "energy", "soreness", "stress", "motivation"];
function hasRecoveryCheckin(data) {
  return Object.values(data || {}).some((day) => {
    const b = day?.body || {};
    return CHECKIN_FIELDS.some((k) => num(b[k])) || b.illnessOrInjury === true;
  });
}

// Setup (Tutorial.jsx) is what picks the program and the macro
// targets, so a finished setup is the honest "chosen" signal. Waiting for a
// logged workout or meal instead would never end, because the loggers live
// inside the very tabs the specimens replace:
// Today and Fuel stayed samples forever. (A default program and default goals
// are assigned at load, which is why neither is detectable by absence.)
export function isOnboarded(settings) {
  return settings?.onboarded === true || settings?.onboarded === "true";
}

// Setup's recovery answer. "oura" is the "Wearable connected" choice (Oura or
// Whoop). Manual and "connect later" start on manual check-ins, and so does an
// account onboarded before setup recorded an answer (manual is the default).
export function expectsWearable(settings) {
  return settings?.setup?.dataMode === "oura";
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
  const onboarded = isOnboarded(settings);
  const loggedDays = countLoggedDays(data);
  return {
    // Cleared by finishing setup (the program is chosen there) or by any
    // logged workout. The action opens setup.
    today: { isZero: !onboarded && !hasWorkoutContent(data) },
    // Manual check-ins are first-class: only someone who hasn't set up, or who
    // said they'd connect a wearable and hasn't yet, sees the sample. Any
    // connection or check-in clears it. The action opens Integrations.
    recovery: {
      isZero: !ouraConnected && !whoopConnected && !hasRecoveryCheckin(data) && (!onboarded || expectsWearable(settings)),
    },
    // Cleared by finishing setup (targets are set there) or by any logged meal.
    fuel: { isZero: !onboarded && !hasNutritionContent(data) },
    progress: {
      isZero: loggedDays < PROGRESS_UNLOCK_DAYS,
      daysHave: loggedDays,
      daysNeeded: Math.max(0, PROGRESS_UNLOCK_DAYS - loggedDays),
    },
  };
}

export default { detectDayZero, dayHasContent, countLoggedDays, isOnboarded, expectsWearable, PROGRESS_UNLOCK_DAYS };
