// src/muscleVolume.js
// V11 · Per-muscle weekly volume intelligence. The load model (ACWR) treats
// training as one global number — correct for injury risk, blind for
// hypertrophy, where the unit of progress is weekly hard sets per muscle.
// This module maps exercises to muscles, counts completed sets into weekly
// per-muscle volume, and audits it against published volume landmarks.
//
// Honesty rules baked in:
//   · A "hard set" = a completed set (no RIR logging yet — the standard
//     simplification, stated in the UI).
//   · Secondary movers count 0.5 (common convention; stated).
//   · Landmarks are POPULATION RANGES from the hypertrophy literature
//     (Israetel et al. / RP guidelines), not personal prescriptions.
//   · Sets on unmapped exercises are counted and SURFACED, never silently
//     dropped — "3 sets unmapped" is information.

// ─── Muscle groups + literature landmark ranges (weekly hard sets) ────────────
export const MUSCLE_LANDMARKS = {
  chest:      { label: "Chest",       mev: 8,  mavLo: 12, mavHi: 20, mrv: 22 },
  back:       { label: "Back",        mev: 8,  mavLo: 14, mavHi: 22, mrv: 25 },
  front_delt: { label: "Front delts", mev: 0,  mavLo: 6,  mavHi: 8,  mrv: 12 },
  side_delt:  { label: "Side delts",  mev: 6,  mavLo: 16, mavHi: 22, mrv: 26 },
  rear_delt:  { label: "Rear delts",  mev: 4,  mavLo: 12, mavHi: 18, mrv: 22 },
  biceps:     { label: "Biceps",      mev: 5,  mavLo: 14, mavHi: 20, mrv: 26 },
  triceps:    { label: "Triceps",     mev: 4,  mavLo: 10, mavHi: 14, mrv: 18 },
  quads:      { label: "Quads",       mev: 8,  mavLo: 12, mavHi: 18, mrv: 20 },
  hamstrings: { label: "Hamstrings",  mev: 4,  mavLo: 10, mavHi: 16, mrv: 20 },
  glutes:     { label: "Glutes",      mev: 2,  mavLo: 4,  mavHi: 12, mrv: 16 },
  calves:     { label: "Calves",      mev: 6,  mavLo: 12, mavHi: 16, mrv: 20 },
  abs:        { label: "Abs",         mev: 0,  mavLo: 16, mavHi: 20, mrv: 25 },
};

// ─── Exercise → muscle mapping (keyword-matched, first match wins) ────────────
// primary counts 1.0 set, secondary counts 0.5. Ordered specific → general so
// "incline bench" hits the bench rule, not a generic one.
const EXERCISE_MAP = [
  { match: ["bench", "chest press", "incline press", "incline db", "incline dumbbell", "push-up", "pushup", "chest fly", "pec deck", "cable fly", "dip"],
    primary: ["chest"], secondary: ["front_delt", "triceps"] },
  { match: ["overhead press", "ohp", "shoulder press", "military", "push press", "arnold"],
    primary: ["front_delt"], secondary: ["side_delt", "triceps"] },
  { match: ["lateral raise", "side raise", "upright row"],
    primary: ["side_delt"], secondary: [] },
  { match: ["rear delt", "reverse fly", "face pull", "reverse pec"],
    primary: ["rear_delt"], secondary: [] },
  { match: ["pull-up", "pullup", "chin-up", "chinup", "pulldown", "pullover"],
    primary: ["back"], secondary: ["biceps", "rear_delt"] },
  { match: ["row", "shrug"],
    primary: ["back"], secondary: ["biceps", "rear_delt"] },
  { match: ["deadlift", "rdl", "romanian", "good morning", "back extension", "hyperextension", "nordic", "leg curl", "hamstring"],
    primary: ["hamstrings"], secondary: ["glutes", "back"] },
  { match: ["hip thrust", "glute bridge", "glute", "kickback", "abduction"],
    primary: ["glutes"], secondary: ["hamstrings"] },
  { match: ["squat", "leg press", "hack", "lunge", "step-up", "step up", "leg extension", "sissy"],
    primary: ["quads"], secondary: ["glutes"] },
  { match: ["curl"],
    primary: ["biceps"], secondary: [] },
  { match: ["pushdown", "push-down", "skull", "extension", "close-grip", "close grip", "kickback triceps", "jm press"],
    primary: ["triceps"], secondary: [] },
  { match: ["calf"],
    primary: ["calves"], secondary: [] },
  { match: ["crunch", "plank", "ab ", "abs", "leg raise", "hanging raise", "rollout", "woodchop", "pallof", "sit-up", "situp"],
    primary: ["abs"], secondary: [] },
];

// NOTE: "leg curl" must resolve to hamstrings, not biceps — the hamstrings
// rule sits before the generic "curl" rule, and mapping is first-match-wins.
export function mapExerciseToMuscles(exerciseName) {
  if (!exerciseName || typeof exerciseName !== "string") return null;
  const n = ` ${exerciseName.toLowerCase()} `;
  for (const rule of EXERCISE_MAP) {
    if (rule.match.some(k => n.includes(k))) {
      return { primary: rule.primary, secondary: rule.secondary };
    }
  }
  return null;
}

// ─── Weekly counting ──────────────────────────────────────────────────────────
export function weekStartKey(dateKey) {
  const d = new Date(dateKey + "T12:00:00");
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyWeek() {
  const w = { muscles: {}, unmappedSets: 0, unmappedNames: new Set(), totalSets: 0 };
  for (const key of Object.keys(MUSCLE_LANDMARKS)) w.muscles[key] = 0;
  return w;
}

// V12 · A completed set logged at RIR 5+ isn't a hard set — it's a warm-up or
// technique work by the athlete's own report, so it doesn't count toward
// landmark volume. Unlogged RIR still counts (the pre-V12 behavior).
function isHardSet(s) {
  if (!s.done) return false;
  const rir = s.rir === "" || s.rir === undefined || s.rir === null ? null : parseFloat(s.rir);
  return rir === null || rir < 5;
}

// Count completed sets per muscle per calendar week (Mon-start).
export function buildWeeklyMuscleVolume(data, { weeks = 5 } = {}) {
  if (!data) return [];
  const byWeek = new Map();
  for (const dateKey of Object.keys(data)) {
    const exercises = data[dateKey]?.workout?.exercises;
    if (!exercises) continue;
    const wk = weekStartKey(dateKey);
    if (!byWeek.has(wk)) byWeek.set(wk, emptyWeek());
    const bucket = byWeek.get(wk);
    for (const [name, ex] of Object.entries(exercises)) {
      const doneSets = (ex?.sets || []).filter(isHardSet).length;
      if (!doneSets) continue;
      bucket.totalSets += doneSets;
      const mapped = mapExerciseToMuscles(name);
      if (!mapped) {
        bucket.unmappedSets += doneSets;
        bucket.unmappedNames.add(name);
        continue;
      }
      for (const m of mapped.primary) bucket.muscles[m] += doneSets;
      for (const m of mapped.secondary) bucket.muscles[m] += doneSets * 0.5;
    }
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-weeks)
    .map(([weekStart, w]) => ({
      weekStart,
      muscles: Object.fromEntries(Object.entries(w.muscles).map(([k, v]) => [k, Math.round(v * 10) / 10])),
      unmappedSets: w.unmappedSets,
      unmappedNames: [...w.unmappedNames],
      totalSets: w.totalSets,
    }));
}

// ─── Muscle recency (V12) — "what's actually fresh today?" ───────────────────
// Days since each muscle was last PRIMARILY trained (secondary involvement is
// tracked separately as a lighter signal). null = never in the window.
export function buildMuscleRecency(data, todayKey, { windowDays = 21 } = {}) {
  if (!data || !todayKey) return null;
  const lastPrimary = {};
  const lastSecondary = {};
  const keys = Object.keys(data).filter(k => k <= todayKey).sort().slice(-windowDays);
  for (const dateKey of keys) {
    const exercises = data[dateKey]?.workout?.exercises;
    if (!exercises) continue;
    for (const [name, ex] of Object.entries(exercises)) {
      if (!(ex?.sets || []).some(s => s.done)) continue;
      const mapped = mapExerciseToMuscles(name);
      if (!mapped) continue;
      for (const m of mapped.primary) lastPrimary[m] = dateKey;
      for (const m of mapped.secondary) lastSecondary[m] = dateKey;
    }
  }
  const dayDiff = (a) => Math.round((new Date(todayKey + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
  return Object.keys(MUSCLE_LANDMARKS).map(key => {
    const p = lastPrimary[key] ? dayDiff(lastPrimary[key]) : null;
    const s = lastSecondary[key] ? dayDiff(lastSecondary[key]) : null;
    const days = p !== null && s !== null ? Math.min(p, s) : p ?? s;
    return {
      key,
      label: MUSCLE_LANDMARKS[key].label,
      daysSincePrimary: p,
      daysSinceAny: days,
      status: days === null ? "untrained" : days <= 1 ? "worked" : days <= 3 ? "ready" : "fresh",
    };
  });
}

// ─── Landmark audit ───────────────────────────────────────────────────────────
export function classifyVolume(muscleKey, sets) {
  const L = MUSCLE_LANDMARKS[muscleKey];
  if (!L) return null;
  if (sets < L.mev)   return { status: "below_mev",  label: "below MEV",  tone: "warn" };
  if (sets < L.mavLo) return { status: "productive", label: "MEV–MAV",    tone: "ok" };
  if (sets <= L.mavHi) return { status: "optimal",   label: "within MAV", tone: "good" };
  if (sets <= L.mrv)  return { status: "high",       label: "MAV–MRV",    tone: "watch" };
  return { status: "above_mrv", label: "above MRV",  tone: "warn" };
}

// ─── Balance ratios ───────────────────────────────────────────────────────────
// Push = chest + front/side delts + triceps · Pull = back + rear delts + biceps.
// Guidance bands are conventional coaching heuristics, framed as such.
export function buildBalanceRatios(weekMuscles) {
  const m = weekMuscles || {};
  const push = (m.chest || 0) + (m.front_delt || 0) + (m.side_delt || 0) + (m.triceps || 0);
  const pull = (m.back || 0) + (m.rear_delt || 0) + (m.biceps || 0);
  const quads = m.quads || 0;
  const hams = (m.hamstrings || 0) + (m.glutes || 0) * 0.5;
  const pressing = (m.chest || 0) + (m.front_delt || 0);
  const rear = m.rear_delt || 0;

  const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 100) / 100 : null);
  return [
    { key: "push_pull", label: "Push : Pull", value: ratio(push, pull), band: "≈ 1.0 or pull-heavy", ok: pull === 0 ? false : push / pull <= 1.15 },
    { key: "quad_ham", label: "Quad : Ham+Glute", value: ratio(quads, hams), band: "≈ 1.0–1.5", ok: hams === 0 ? false : quads / hams >= 0.8 && quads / hams <= 1.7 },
    { key: "press_rear", label: "Pressing : Rear delt", value: ratio(pressing, rear), band: "≤ 3.0", ok: rear === 0 ? pressing === 0 : pressing / rear <= 3.0 },
  ];
}

// ─── Report builder for the UI ────────────────────────────────────────────────
const MIN_WEEK_SETS = 6; // fewer than this and "weekly volume" is noise

export function buildVolumeReport(data) {
  const weeks = buildWeeklyMuscleVolume(data, { weeks: 5 });
  const usable = weeks.filter(w => w.totalSets >= MIN_WEEK_SETS);
  if (usable.length === 0) {
    return { ready: false, note: "Log a week of lifting (6+ completed sets) to unlock the per-muscle volume audit." };
  }
  const current = usable[usable.length - 1];
  const prior = usable.length > 1 ? usable[usable.length - 2] : null;

  const rows = Object.keys(MUSCLE_LANDMARKS)
    .map(key => {
      const sets = current.muscles[key];
      const prev = prior ? prior.muscles[key] : null;
      const delta = prev === null ? null : Math.round((sets - prev) * 10) / 10;
      return { key, sets, delta, ...classifyVolume(key, sets), label: MUSCLE_LANDMARKS[key].label, landmarks: MUSCLE_LANDMARKS[key] };
    })
    .sort((a, b) => b.sets - a.sets);

  const flags = rows.filter(r => r.tone === "warn");
  const headline = flags.length === 0
    ? "All trained muscles inside productive volume ranges."
    : flags.map(f => `${f.label} ${f.label && f.status === "below_mev" ? "below MEV" : "above MRV"}`).slice(0, 3).join(" · ");

  return {
    ready: true,
    weekStart: current.weekStart,
    rows,
    ratios: buildBalanceRatios(current.muscles),
    unmappedSets: current.unmappedSets,
    unmappedNames: current.unmappedNames,
    headline,
    flagCount: flags.length,
  };
}
