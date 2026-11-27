// src/todaySummary.js
// Pure display helpers for the Today command center. They turn the already-
// computed program day + today decision + logged data into (1) a planned-vs-
// today plan summary and (2) a compact quick-log status strip. No side effects,
// no persistence, no algorithm changes — purely presentational reshaping of
// values the app already has, so they are safe to unit test.
import { summarizeProgramDay } from "./programSummary";

// Calls that meaningfully change the planned session. "maintain"/"push" keep
// the plan, so the plan card only shows a delta for these two.
const CALL_MODIFIES = new Set(["modify", "recover"]);

// Short "Today:" line derived from the decision call when the decision itself
// does not carry a primaryAction. Kept plain and non-medical.
const TODAY_LINE = {
  recover: "Swap training for recovery — rest, mobility, or an easy walk.",
  modify: "Keep the session but cut volume and cap intensity.",
  maintain: "Run the planned session at controlled effort.",
  push: "Run the planned session and push the top sets.",
};

const MODIFY_TAG = {
  recover: "recover",
  modify: "modify",
  maintain: "on plan",
  push: "push",
};

/**
 * Build a planned-vs-today plan summary for the Today Plan card.
 * @param {object} opts
 * @param {object|null} opts.programDay - the program day (lifting/cardio/type).
 * @param {object|null} opts.decision - the Today decision (call/primaryAction).
 * @returns {object} plan summary with plannedLabel and optional modification.
 */
export function buildTodayPlan({ programDay = null, decision = null } = {}) {
  const summary = summarizeProgramDay(programDay);
  const call = decision?.call || null;
  const modifies = call ? CALL_MODIFIES.has(call) : false;
  const isRest = !summary.hasLifting && !summary.hasCardio;

  // Prefer the decision's own primary action for the "Today:" line so the plan
  // card and the coach hero never contradict each other; fall back to a
  // call-derived line if the decision has none.
  const todayLine = call
    ? (decision?.primaryAction || TODAY_LINE[call] || TODAY_LINE.maintain)
    : null;

  // Short focus tag for the header stat (LIFT / LIFT + CARDIO / CARDIO / REST).
  let focus = "REST";
  if (summary.hasLifting && summary.hasCardio) focus = "LIFT + CARDIO";
  else if (summary.hasLifting) focus = "LIFT";
  else if (summary.hasCardio) focus = "CARDIO";

  return {
    plannedLabel: summary.label,
    hasLifting: summary.hasLifting,
    hasCardio: summary.hasCardio,
    liftCount: summary.liftCount,
    cardioLabel: summary.cardioLabel,
    isRest,
    focus,
    call,
    todayLine,
    modifyTag: call ? (MODIFY_TAG[call] || call) : null,
    // Only surface a delta when the call actually modifies training AND there
    // is a real planned session to modify (never "modify" a rest day).
    showModification: modifies && !isRest,
  };
}

/**
 * Build the single "Do next" action for the Today command center — the one row
 * that answers "what do I do next, and how do I log it?" from the session's
 * current logging state. Purely presentational: it reads counts the app already
 * computed and never mutates data or touches scoring.
 *
 * The status ladder (rest → start → continue → cardio → done) mirrors how a
 * session actually progresses, so the row updates as sets get checked off.
 *
 * @param {object} opts
 * @param {number} opts.totalExercises - planned lifting exercises (0 if none).
 * @param {number} opts.doneExercises - completed lifting exercises.
 * @param {boolean} opts.hasCardio - whether the day includes cardio.
 * @param {boolean} opts.cardioLogged - whether cardio has any logged effort.
 * @param {boolean} opts.isRest - whether the day is a rest day (no training).
 * @returns {object} { key, status, label, detail, tone, target }.
 *   `target` is a hint for the scroll anchor: "log" (workout/cardio inputs) or
 *   "checkin" (check-in card). No DOM work happens here.
 */
export function buildNextAction({
  totalExercises = 0,
  doneExercises = 0,
  hasCardio = false,
  cardioLogged = false,
  isRest = false,
} = {}) {
  const hasLifting = totalExercises > 0;

  // Rest day (or an empty day): the only thing left to capture is the check-in.
  if (isRest || (!hasLifting && !hasCardio)) {
    return {
      key: "checkin",
      status: "rest",
      label: "Log your check-in",
      detail: "Rest day — note sleep, energy, and how recovery feels.",
      tone: "neutral",
      target: "checkin",
    };
  }

  const liftsDone = hasLifting && doneExercises >= totalExercises;
  const liftsStarted = doneExercises > 0;

  // A live lifting session takes priority — that's the work in front of you.
  if (hasLifting && !liftsDone) {
    if (!liftsStarted) {
      return {
        key: "start",
        status: "start",
        label: "Start logging",
        detail: `Log your first set — ${totalExercises} exercise${totalExercises === 1 ? "" : "s"} planned.`,
        tone: "neutral",
        target: "log",
      };
    }
    return {
      key: "continue",
      status: "continue",
      label: "Continue logging",
      detail: `${doneExercises} of ${totalExercises} exercises done — keep going.`,
      tone: "neutral",
      target: "log",
    };
  }

  // Lifts are done (or there were none). Cardio is next if it still needs input.
  if (hasCardio && !cardioLogged) {
    return {
      key: "cardio",
      status: "cardio",
      label: liftsStarted ? "Log your cardio" : "Start logging",
      detail: "Enter distance, time, and pace.",
      tone: "neutral",
      target: "log",
    };
  }

  // Everything trainable is logged — wrap up with the check-in.
  return {
    key: "finish",
    status: "done",
    label: "Finish session",
    detail: "All training logged — add your check-in and wrap up.",
    tone: "good",
    target: "checkin",
  };
}

// Short verb for the single primary CTA button on Today, derived from the
// next-action status so the button reads as the actual next step instead of a
// generic "Log". Display-only — the button still just scrolls to the inputs
// (see PrimaryNextAction), it never writes data or changes the recommendation.
const NEXT_ACTION_CTA = {
  start: "Start",
  continue: "Continue",
  cardio: "Log cardio",
  done: "Wrap up",
  rest: "Check in",
};

/**
 * The CTA verb for the Today "Do next" button, keyed off the action status
 * from buildNextAction. Falls back to "Log" for an unknown/absent action.
 * @param {object|null} action - the object returned by buildNextAction.
 * @returns {string} a short button verb (arrow is added by the caller).
 */
export function nextActionCta(action) {
  if (!action) return "Log";
  return NEXT_ACTION_CTA[action.status] || "Log";
}

const finite = (value) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

// Percentage of a goal, clamped 0–100. Missing/zero goals read as 0 so the
// strip never divides by zero or asserts progress it cannot compute.
function pctOf(value, goal) {
  const g = Number(goal);
  if (!Number.isFinite(g) || g <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((finite(value) / g) * 100)));
}

/**
 * Build the compact quick-log status strip. Display-only: it reports current
 * state (workout completion, check-in completeness, water/protein/calorie
 * progress) and never mutates data.
 * @param {object} opts
 * @param {object} opts.nutrition - today's nutrition ({ calories, protein, water }).
 * @param {object} opts.goals - user macro/water goals.
 * @param {number} opts.doneExercises - completed lifting exercises.
 * @param {number} opts.totalExercises - planned lifting exercises.
 * @param {object|null} opts.body - today's body/check-in fields.
 * @returns {Array<object>} metric items for <MetricStrip>.
 */
export function buildQuickLogStatus({
  nutrition = {},
  goals = {},
  doneExercises = 0,
  totalExercises = 0,
  body = null,
} = {}) {
  const items = [];

  // Workout completion.
  if (totalExercises > 0) {
    const done = doneExercises >= totalExercises;
    items.push({
      key: "workout",
      label: "Workout",
      value: `${doneExercises}/${totalExercises}`,
      hint: done ? "complete" : "logged",
      tone: done ? "good" : "neutral",
    });
  } else {
    items.push({ key: "workout", label: "Workout", value: "—", hint: "no lifts", tone: "neutral" });
  }

  // Check-in completeness (sleep / energy / soreness are the daily basics).
  const basics = ["sleep", "energy", "soreness"];
  const filled = body ? basics.filter((k) => String(body[k] ?? "").trim() !== "").length : 0;
  items.push({
    key: "checkin",
    label: "Check-in",
    value: `${filled}/${basics.length}`,
    hint: filled >= basics.length ? "complete" : "partial",
    tone: filled >= basics.length ? "good" : filled > 0 ? "caution" : "neutral",
  });

  // Water progress.
  const waterPct = pctOf(nutrition.water, goals.water);
  items.push({
    key: "water",
    label: "Water",
    value: `${waterPct}%`,
    hint: `${Math.round(finite(nutrition.water))}/${Math.round(Number(goals.water) || 0)}oz`,
    tone: waterPct >= 100 ? "good" : "neutral",
  });

  // Protein progress.
  const proteinPct = pctOf(nutrition.protein, goals.protein);
  items.push({
    key: "protein",
    label: "Protein",
    value: `${proteinPct}%`,
    hint: `${Math.round(finite(nutrition.protein))}/${Math.round(Number(goals.protein) || 0)}g`,
    tone: proteinPct >= 100 ? "good" : "neutral",
  });

  // Calorie progress.
  const calPct = pctOf(nutrition.calories, goals.calories);
  items.push({
    key: "calories",
    label: "Calories",
    value: `${calPct}%`,
    hint: `${Math.round(finite(nutrition.calories))}/${Math.round(Number(goals.calories) || 0)}`,
    tone: calPct >= 100 ? "good" : "neutral",
  });

  return items;
}
