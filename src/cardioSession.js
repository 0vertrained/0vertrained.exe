// src/cardioSession.js
// Cardio session runner logic. Builds a flat segment list (warmup →
// work/rest rounds → cooldown) from a plan config, plus a conservative parser
// that tries to pre-fill the plan from the program's free-text cardio notes.
// Pure functions only — the timer/UI lives in CardioSession.jsx, and the only
// write at the end goes through the existing workout.cardio.time path.

export const CARDIO_PRESETS = [
  { key: "4x4",    label: "4×4min · 3min rest", work: 240, rest: 180, rounds: 4,  warmup: 300 },
  { key: "8x1",    label: "8×1min · 1min rest", work: 60,  rest: 60,  rounds: 8,  warmup: 300 },
  { key: "30_30",  label: "30/30 × 10",         work: 30,  rest: 30,  rounds: 10, warmup: 300 },
  { key: "emom10", label: "EMOM 10",            work: 60,  rest: 0,   rounds: 10, warmup: 180 },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v) || lo));

export function normalizePlan(raw = {}) {
  if (raw.kind === "steady") {
    return { kind: "steady", seconds: clamp(raw.seconds, 1, Number.MAX_SAFE_INTEGER / 1000) };
  }
  return {
    work:   clamp(raw.work ?? 60, 5, 3600),
    rest:   clamp(raw.rest ?? 60, 0, 3600),
    rounds: clamp(raw.rounds ?? 6, 1, 50),
    warmup: clamp(raw.warmup ?? 0, 0, 1800),
    ...(raw.cooldown != null && { cooldown: clamp(raw.cooldown, 0, 1800) }),
  };
}

// Recovery sits between work rounds. A prescribed cool-down follows the last.
export function buildSegments(planRaw) {
  const plan = normalizePlan(planRaw);
  if (plan.kind === "steady") return [{ kind: "steady", seconds: plan.seconds, round: 0 }];
  const segs = [];
  if (plan.warmup > 0) segs.push({ kind: "warmup", seconds: plan.warmup, round: 0 });
  for (let r = 1; r <= plan.rounds; r++) {
    segs.push({ kind: "work", seconds: plan.work, round: r });
    if (plan.rest > 0 && r < plan.rounds) segs.push({ kind: "rest", seconds: plan.rest, round: r });
  }
  if (plan.cooldown > 0) segs.push({ kind: "cooldown", seconds: plan.cooldown, round: 0 });
  return segs;
}

export function totalPlannedSeconds(planRaw) {
  return buildSegments(planRaw).reduce((t, s) => t + s.seconds, 0);
}

export function fmtSeconds(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// Structured steps
// Race-plan runs carry their workout as steps: warmup → repeat { work,
// recovery } → cooldown. The legacy race runner reads the interval block
// and warm-up here. A time-based prescription can also include a cool-down.
export function suggestPlanFromSteps(steps) {
  if (!Array.isArray(steps)) return null;
  const repeat = steps.find((s) => s?.kind === "repeat");
  const workMin = Number(repeat?.work?.minutes);
  const reps = Number(repeat?.reps);
  if (!(workMin > 0) || !(reps >= 1)) return null;
  const warmup = steps.find((s) => s?.kind === "warmup");
  return normalizePlan({
    work: workMin * 60,
    rest: (Number(repeat.recovery?.minutes) || 0) * 60,
    rounds: reps,
    warmup: (Number(warmup?.minutes) || 0) * 60,
  });
}

// Notes parser — deliberately conservative
// Pre-fills the plan ONLY for unambiguous time-based patterns:
//   "6x3min", "4 × 4 min w/ 3min rest", "8x90s", "10 x 30 sec / 30 sec off"
// Distance-based intervals ("6x800m") depend on pace we don't know → null.
// Anything uncertain → null, and the UI falls back to presets. A wrong
// pre-fill is worse than none.
export function suggestPlanFromNotes(notes) {
  if (!notes || typeof notes !== "string") return null;
  const t = notes.toLowerCase();
  if (/\d\s*(m|km|mi|meter|mile)\b/.test(t) && !/\d\s*min/.test(t)) return null;

  const main = t.match(/(\d{1,2})\s*[x×]\s*(\d{1,3})\s*(min|minute|minutes|m(?![a-z])|s|sec|secs|seconds)\b/);
  if (!main) return null;
  const rounds = parseInt(main[1], 10);
  const amount = parseInt(main[2], 10);
  const unit = main[3];
  const isSeconds = unit === "s" || unit.startsWith("sec");
  const work = isSeconds ? amount : amount * 60;
  if (rounds < 1 || rounds > 50 || work < 10 || work > 3600) return null;

  // Optional rest: "w/ 2min rest", "/ 90s off", "rest 3 min"
  let rest = null;
  const restMatch =
    t.match(/(?:w\/|with|\/|,)?\s*(\d{1,3})\s*(min|minute|minutes|s|sec|secs|seconds)\s*(?:rest|off|easy|recovery)/) ||
    t.match(/(?:rest|off|recovery)\s*(?:of\s*)?(\d{1,3})\s*(min|minute|minutes|s|sec|secs|seconds)/);
  if (restMatch) {
    const rAmt = parseInt(restMatch[1], 10);
    rest = restMatch[2].startsWith("s") ? rAmt : rAmt * 60;
  }

  return normalizePlan({ work, rest: rest ?? Math.min(work, 180), rounds, warmup: 300 });
}

export function timeBasedCardioPlan(cardio) {
  const minutes = Number(cardio?.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0 || Number(cardio.miles) > 0) return null;

  const seconds = Math.round(minutes * 60);
  const intervals = suggestPlanFromSteps(cardio.steps);
  if (intervals) {
    const cooldown = cardio.steps.find((step) => step?.kind === "cooldown");
    const plan = normalizePlan({ ...intervals, cooldown: (Number(cooldown?.minutes) || 0) * 60 });
    if (totalPlannedSeconds(plan) === seconds) return plan;
  }
  // The athlete can replace the duration in the editor. Old interval notes
  // may still mention the previous prescription after that edit.
  return normalizePlan({ kind: "steady", seconds });
}

export function suggestPlanForCardio(cardio) {
  return timeBasedCardioPlan(cardio) || suggestPlanFromSteps(cardio?.steps) || suggestPlanFromNotes(cardio?.notes);
}
