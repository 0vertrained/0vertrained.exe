// src/cardioSession.js
// V10 · Cardio session runner logic. Builds a flat segment list (warmup →
// work/rest rounds → cooldown) from a plan config, plus a conservative parser
// that tries to pre-fill the plan from the program's free-text cardio notes.
// Pure functions only — the timer/UI lives in CardioSession.jsx, and the only
// write at the end goes through the existing workout.cardio.time path.

export const CARDIO_PRESETS = [
  { key: "4x4",    label: "4×4min · 3min rest", work: 240, rest: 180, rounds: 4,  warmup: 300 },
  { key: "8x1",    label: "8×1min · 1min rest", work: 60,  rest: 60,  rounds: 8,  warmup: 300 },
  { key: "30_30",  label: "30/30 × 10",         work: 30,  rest: 30,  rounds: 10, warmup: 300 },
  { key: "emom10", label: "EMOM 10",            work: 60,  rest: 0,   rounds: 10, warmup: 180 },
  { key: "hyrox8", label: "Hyrox 8 stations",   work: 240, rest: 60,  rounds: 8,  warmup: 300 },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v) || lo));

export function normalizePlan(raw = {}) {
  return {
    work:   clamp(raw.work ?? 60, 5, 3600),
    rest:   clamp(raw.rest ?? 60, 0, 3600),
    rounds: clamp(raw.rounds ?? 6, 1, 50),
    warmup: clamp(raw.warmup ?? 0, 0, 1800),
  };
}

// Flat, ordered segment list. Rest after the final work round is dropped —
// the session ends on work, not on standing around.
export function buildSegments(planRaw) {
  const plan = normalizePlan(planRaw);
  const segs = [];
  if (plan.warmup > 0) segs.push({ kind: "warmup", seconds: plan.warmup, round: 0 });
  for (let r = 1; r <= plan.rounds; r++) {
    segs.push({ kind: "work", seconds: plan.work, round: r });
    if (plan.rest > 0 && r < plan.rounds) segs.push({ kind: "rest", seconds: plan.rest, round: r });
  }
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

// ─── Notes parser — deliberately conservative ─────────────────────────────────
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
