// src/runPlanGenerator.js
// Race-plan generator — the general form of the hand-written 50K ladder.
//
// A program opts in by carrying a small spec under `__raceBuild` (an object
// instead of the 50K's registry string):
//
//   { kind: "runPlan", v: 1, raceName, distance: "5k"|"10k"|"half",
//     raceDate, startDate (Monday), runsPerWeek: 3–5, longRunDay, qualityDay,
//     crossTraining: "none"|"walk"|"vest_walk", startLongRunMin,
//     benchmark: { distance, seconds, date } | null,
//     benchmarkTest: "auto" | "none" | "YYYY-MM-DD" }
//
// generateRunPlan(spec) expands it into the exact config shape raceBuild.js
// already resolves ({ raceDate, weeks: [{ label, phase, days }] }), so the
// Monday-anchored resolver, back-logging and the editor's raw-template rule
// all keep working unchanged. Only the spec is stored — the weeks are derived
// on read, so the payload stays a few hundred bytes.
//
// Phases: base → build → race-specific → race week. Lighter weeks land every
// 4th week of base and build. Every run is prescribed in MINUTES (the athlete
// may not know their pace yet) with estimated miles so the load model, running
// volume and Box Score keep reading the same `miles` field they always have.
// Paces appear only when there is a benchmark (runPaces.js); without one,
// targets are effort cues.
//
// The plan OWNS running while it is active: each week patches all seven days —
// a run, a cross-training walk, or `clearRuns` (other runs removed; walks,
// bike and lifting untouched). Lifting is never modified; conflicts with leg
// days surface as warnings, never edits (suggest-only, like the rest of the app).
//
// Pure module: no React, no network, no clocks — dates are passed in.

import { DAYS } from "./constants";
import { mapExerciseToMuscles } from "./muscleVolume";
import { getProgramSessions } from "./programSessions";
import { buildPaceZones, normalizeBenchmark, paceTarget, predictRaceSeconds, RACE_DISTANCES, METERS_PER_MILE } from "./runPaces";

export const RUN_PLAN_KIND = "runPlan";
export const RUN_PLAN_VERSION = 1;
export const MIN_PLAN_WEEKS = 6;
export const MAX_PLAN_WEEKS = 20;
export const RUNS_PER_WEEK_OPTIONS = [3, 4, 5];
export const PLAN_DISTANCE_IDS = ["5k", "10k", "half"];
// Below these lengths a plan is compressed: it still generates, with a warning.
export const COMFORTABLE_WEEKS = { "5k": 8, "10k": 8, "half": 10 };
export const CROSS_TRAINING_OPTIONS = [
  { id: "none", label: "None" },
  { id: "walk", label: "Incline walk" },
  { id: "vest_walk", label: "Weighted-vest walk" },
];

// Dates (same T12:00:00 convention as raceBuild.js)

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseKey(key) {
  if (typeof key !== "string" || !ISO_RE.test(key)) return null;
  const d = new Date(`${key}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function mondayOfKey(key) {
  const d = parseKey(key);
  if (!d) return null;
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoKey(d);
}

function addDaysKey(key, days) {
  const d = parseKey(key);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return isoKey(d);
}

function daysBetweenKeys(a, b) {
  return Math.round((parseKey(b) - parseKey(a)) / DAY_MS);
}

function weekdayOf(key) {
  const d = parseKey(key);
  return d ? DAYS[(d.getDay() + 6) % 7] : null;
}

const dayIndex = (day) => DAYS.indexOf(day);
const dayAt = (i) => DAYS[((i % 7) + 7) % 7];
const round5 = (m) => Math.max(5, Math.round(m / 5) * 5);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Spec

function defaultQualityDay(longRunDay) {
  const L = dayIndex(longRunDay);
  const blocked = new Set([L, (L + 1) % 7, (L + 6) % 7]);
  return ["Tuesday", "Wednesday", "Thursday", "Monday", "Friday", "Sunday", "Saturday"]
    .find((d) => !blocked.has(dayIndex(d))) || "Tuesday";
}

/** Normalize a stored/edited spec. Unknown values snap to defaults. */
export function normalizeRunPlanSpec(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const distance = PLAN_DISTANCE_IDS.includes(r.distance) ? r.distance : "10k";
  const longRunDay = DAYS.includes(r.longRunDay) ? r.longRunDay : "Saturday";
  const qualityDay = DAYS.includes(r.qualityDay) && r.qualityDay !== longRunDay ? r.qualityDay : defaultQualityDay(longRunDay);
  const runsPerWeek = RUNS_PER_WEEK_OPTIONS.includes(Number(r.runsPerWeek)) ? Number(r.runsPerWeek) : 4;
  const crossTraining = CROSS_TRAINING_OPTIONS.some((o) => o.id === r.crossTraining) ? r.crossTraining : "none";
  const startLongRunMin = clamp(round5(Number(r.startLongRunMin) || 35), 20, 120);
  const benchmarkTest = r.benchmarkTest === "none" ? "none" : (parseKey(r.benchmarkTest) ? r.benchmarkTest : "auto");
  const raceName = (typeof r.raceName === "string" && r.raceName.trim()
    ? r.raceName.trim()
    : `${RACE_DISTANCES[distance].label} race`).slice(0, 60);
  return {
    kind: RUN_PLAN_KIND,
    v: RUN_PLAN_VERSION,
    raceName,
    distance,
    raceDate: parseKey(r.raceDate) ? r.raceDate : null,
    startDate: parseKey(r.startDate) ? mondayOfKey(r.startDate) : null,
    runsPerWeek,
    longRunDay,
    qualityDay,
    crossTraining,
    startLongRunMin,
    benchmark: normalizeBenchmark(r.benchmark),
    benchmarkTest,
  };
}

export function isRunPlanSpec(value) {
  return Boolean(value && typeof value === "object" && value.kind === RUN_PLAN_KIND);
}

/** { valid, errors, warnings, weeks } — weeks counts the race week. */
export function validateRunPlanSpec(raw) {
  const spec = normalizeRunPlanSpec(raw);
  const errors = [];
  const warnings = [];
  if (!spec.raceDate) errors.push("Pick a race date.");
  if (!spec.startDate) errors.push("Pick a start date.");
  let weeks = 0;
  if (spec.raceDate && spec.startDate) {
    if (spec.raceDate < spec.startDate) {
      errors.push("The race date is before the plan starts.");
    } else {
      weeks = Math.round(daysBetweenKeys(spec.startDate, mondayOfKey(spec.raceDate)) / 7) + 1;
      if (weeks < MIN_PLAN_WEEKS) errors.push(`The race is only ${weeks} week${weeks === 1 ? "" : "s"} out — a plan needs at least ${MIN_PLAN_WEEKS}.`);
      if (weeks > MAX_PLAN_WEEKS) errors.push(`The race is ${weeks} weeks out — start the plan within ${MAX_PLAN_WEEKS} weeks of race day.`);
    }
  }
  const L = dayIndex(spec.longRunDay);
  const Q = dayIndex(spec.qualityDay);
  if ((Q + 1) % 7 === L || (L + 1) % 7 === Q) {
    warnings.push(`${spec.qualityDay} sits right next to your long run — hard days back to back. Another day is safer.`);
  }
  if (spec.startLongRunMin < 30) warnings.push("Short starting long run: use run/walk freely in the first weeks.");
  const comfortable = COMFORTABLE_WEEKS[spec.distance];
  if (weeks && weeks >= MIN_PLAN_WEEKS && weeks < comfortable) {
    warnings.push(`${weeks} weeks is a compressed build for a ${RACE_DISTANCES[spec.distance].label}. It assumes you already run a few times a week — a later race is the safer choice.`);
  }
  return { valid: errors.length === 0, errors, warnings, weeks, spec };
}

// Distance profiles

const T = (reps, workMin, recMin) => ({ intensity: "threshold", reps, workMin, recMin });
const I = (reps, workMin, recMin) => ({ intensity: "interval", reps, workMin, recMin });
const RP = (reps, workMin, recMin) => ({ intensity: "race", reps, workMin, recMin });
// Long bases (plans over 12 weeks) get a by-feel fartlek from the second
// 4-week cycle on, so nobody spends months on strides alone.
const FARTLEK = { intensity: "fartlek", reps: 6, workMin: 1, recMin: 2 };

// build[0] is the intro slot (or the benchmark week); build[3] is its lighter
// week. race[2] is the peak (or, for the half, the pre-race taper week).
const PROFILES = {
  "5k": {
    longCap: 70, easyCap: 50, longInc: { base: 5, build: 5, specific: 5 }, peakBonus: 5, taperLastWeek: false,
    intro: T(3, 5, 2), build: [null, T(3, 6, 2), I(5, 3, 2), T(2, 8, 2)], race: [RP(6, 3, 2), T(2, 10, 3), RP(5, 4, 2)], sharpener: RP(4, 2, 2),
  },
  "10k": {
    longCap: 90, easyCap: 55, longInc: { base: 5, build: 5, specific: 5 }, peakBonus: 5, taperLastWeek: false,
    intro: T(3, 5, 2), build: [null, T(3, 6, 2), T(3, 8, 2), T(2, 8, 2)], race: [RP(5, 5, 2), T(2, 12, 3), RP(3, 10, 2)], sharpener: RP(3, 4, 2),
  },
  "half": {
    longCap: 120, easyCap: 60, longInc: { base: 5, build: 10, specific: 10 }, peakBonus: 0, taperLastWeek: true,
    intro: T(3, 6, 2), build: [null, T(3, 8, 2), T(3, 10, 2), T(2, 10, 2)], race: [RP(3, 10, 2), T(2, 15, 3), RP(2, 12, 2)], sharpener: RP(2, 8, 2),
  },
};

// Pre-race weeks P → [base, build, race-specific]. 11 is the canonical
// 12-week plan; longer plans grow the base.
const PHASE_TABLE = { 5: [1, 2, 2], 6: [1, 3, 2], 7: [1, 3, 3], 8: [1, 4, 3], 9: [2, 4, 3], 10: [3, 4, 3], 11: [4, 4, 3] };
function phaseLengths(preRaceWeeks) {
  const row = PHASE_TABLE[preRaceWeeks] || [preRaceWeeks - 7, 4, 3];
  return { base: row[0], build: row[1], specific: row[2] };
}

// Run days

/**
 * Weekday for each role: { long, quality, easyA, easyB, easyC, cross }.
 * easyA sits before the quality day, easyB two days after it, nothing hard
 * on either side of the long run, and the cross walk the day after quality.
 */
export function assignRunDays(rawSpec) {
  const spec = normalizeRunPlanSpec(rawSpec);
  const L = dayIndex(spec.longRunDay);
  const Q = dayIndex(spec.qualityDay);
  const taken = new Set([L, Q]);
  const norm = (i) => ((i % 7) + 7) % 7;
  const dayBeforeLong = norm(L - 1);
  const dayAfterLong = norm(L + 1);
  const pick = (prefs, avoid = []) => {
    const avoidSet = new Set(avoid.map(norm));
    const ordered = [...prefs.map(norm).filter((i) => !avoidSet.has(i)), ...[0, 1, 2, 3, 4, 5, 6].filter((i) => !avoidSet.has(i))];
    for (const i of ordered) if (!taken.has(i)) { taken.add(i); return DAYS[i]; }
    return null;
  };
  const roles = { long: DAYS[L], quality: DAYS[Q], easyA: null, easyB: null, easyC: null, cross: null };
  roles.easyB = pick([Q + 2, Q + 3, Q - 2, L - 2, Q + 4], [dayBeforeLong, dayAfterLong]);
  if (spec.runsPerWeek >= 4) roles.easyA = pick([Q - 1, Q - 2, L + 2, Q + 3, L - 2], [dayAfterLong]);
  if (spec.runsPerWeek >= 5) roles.easyC = pick([L - 1, L + 2, Q + 3, Q - 2]);
  if (spec.crossTraining !== "none") roles.cross = pick([Q + 1, L + 1, Q - 2, Q + 3], [dayBeforeLong]);
  return roles;
}

// Leg-day awareness (read-only over the program)

const HEAVY_LEG_SETS = 6;

/** Planned sets per weekday whose primary mover is quads, hamstrings or glutes. */
export function lowerBodySetsByDay(program) {
  const out = {};
  for (const day of DAYS) {
    let sets = 0;
    for (const session of getProgramSessions(program?.[day] || {})) {
      for (const ex of session.lifting || []) {
        const mapped = mapExerciseToMuscles(ex?.name);
        if (mapped?.primary?.some((m) => m === "quads" || m === "hamstrings" || m === "glutes")) sets += Number(ex?.sets) || 0;
      }
    }
    out[day] = sets;
  }
  return out;
}

/**
 * The quality run belongs on the heaviest leg day — hard days hard, easy days
 * easy — unless that day touches the long run. Falls back to Tuesday-ish.
 */
export function suggestQualityDay(program, longRunDay = "Saturday") {
  const L = dayIndex(DAYS.includes(longRunDay) ? longRunDay : "Saturday");
  const blocked = new Set([L, (L + 1) % 7, (L + 6) % 7]);
  const legs = lowerBodySetsByDay(program);
  const best = DAYS
    .filter((d) => !blocked.has(dayIndex(d)) && legs[d] >= HEAVY_LEG_SETS)
    .sort((a, b) => legs[b] - legs[a] || dayIndex(a) - dayIndex(b))[0];
  return best || defaultQualityDay(DAYS[L]);
}

/** Suggest-only conflicts between the plan's days and the program's leg work. */
export function planProgramWarnings(program, rawSpec) {
  const spec = normalizeRunPlanSpec(rawSpec);
  const legs = lowerBodySetsByDay(program);
  const L = dayIndex(spec.longRunDay);
  const before = dayAt(L - 1);
  const warnings = [];
  if (legs[spec.longRunDay] >= HEAVY_LEG_SETS) warnings.push(`${spec.longRunDay} has heavy leg work on your long-run day.`);
  if (legs[before] >= HEAVY_LEG_SETS) warnings.push(`${before} has heavy leg work the day before your long run — move it if you can.`);
  const heaviest = DAYS.filter((d) => legs[d] >= HEAVY_LEG_SETS).sort((a, b) => legs[b] - legs[a])[0];
  if (heaviest && heaviest !== spec.qualityDay && heaviest !== spec.longRunDay && heaviest !== before) {
    warnings.push(`Your heaviest leg day is ${heaviest}. Putting the quality run there keeps your easy days easy.`);
  }
  return warnings;
}

// Prescriptions

// Pace guesses (sec/mi) used ONLY to estimate miles when there is no
// benchmark. Never displayed as targets.
const EST_PACE = { easy: 660, jog: 690, fartlek: 600, threshold: 570, interval: 540, "race:5k": 555, "race:10k": 585, "race:half": 615, walk: 1125 };

function paceFor(zones, intensity, distance) {
  const key = intensity === "race" ? `race:${distance}` : intensity;
  if (zones) {
    if (intensity === "walk") return EST_PACE.walk;
    if (intensity === "jog") return (zones.easy?.slow || EST_PACE.easy) + 30;
    if (intensity === "fartlek") return Math.round(((zones.easy?.fast || EST_PACE.easy) + (zones.threshold || EST_PACE.threshold)) / 2);
    const target = paceTarget(zones, key);
    if (target?.secPerMile) return target.secPerMile;
  }
  return EST_PACE[key] || EST_PACE.easy;
}

function targetLabel(zones, intensity, distance) {
  if (!zones || intensity === "fartlek") return null; // fartlek is by feel, always
  const key = intensity === "race" ? `race:${distance}` : intensity;
  return paceTarget(zones, key)?.label || null;
}

function milesFor(segments, zones, distance) {
  const miles = segments.reduce((sum, seg) => sum + (seg.minutes * 60) / paceFor(zones, seg.intensity, distance), 0);
  return Math.round(miles * 10) / 10;
}

const EFFORT_CUE = {
  easy: "Conversational — full sentences. Walk 30–60 s whenever you can't.",
  fartlek: "Brisk but relaxed (RPE 6–7) — by feel, not pace.",
  threshold: "Comfortably hard: a few words at a time (RPE 7).",
  interval: "Hard but controlled (RPE 8–9) — the last rep should match the first.",
  race: "Goal race pace: words, not sentences (RPE 8).",
};

function stridesText(n) {
  return n ? ` + ${n} strides (15–20 s fast and smooth, walk back between)` : "";
}

function easyRun(minutes, { strides = 0, zones, distance, week, kind = "easy", note = "" } = {}) {
  const target = targetLabel(zones, "easy", distance);
  const steps = [{ kind: "run", minutes, intensity: "easy" }];
  if (strides) steps.push({ kind: "strides", reps: strides, seconds: 20 });
  return {
    type: kind === "shakeout" ? "Shakeout" : strides ? "Easy Run + Strides" : "Easy Run",
    minutes,
    miles: milesFor([{ minutes, intensity: "easy" }], zones, distance),
    effort: "Easy",
    targetPace: target,
    notes: `${minutes} min easy${stridesText(strides)}. ${EFFORT_CUE.easy}${target ? ` Target ≈ ${target}.` : ""}${note ? ` ${note}` : ""}`,
    steps,
    planRole: "easy",
    planWeek: week,
  };
}

function longRun(minutes, { zones, distance, week, walkOk, noWalk, finishMin = 0 }) {
  const label = RACE_DISTANCES[distance].label;
  const target = targetLabel(zones, "easy", distance);
  const steps = finishMin
    ? [{ kind: "run", minutes: minutes - finishMin, intensity: "easy" }, { kind: "run", minutes: finishMin, intensity: "race" }]
    : [{ kind: "run", minutes, intensity: "easy" }];
  const detail = finishMin
    ? `, last ${finishMin} min at ${label} effort`
    : noWalk ? ", no walk breaks" : walkOk ? " (run/walk is fine)" : "";
  return {
    type: "Long Run",
    minutes,
    miles: milesFor(steps, zones, distance),
    effort: "Easy",
    targetPace: target,
    notes: `${minutes} min easy${detail}. Time on feet is the point — keep it conversational.${target ? ` Easy ≈ ${target}.` : ""}`,
    steps,
    planRole: "long",
    planWeek: week,
  };
}

const QUALITY_TYPE = { threshold: "Threshold Run", interval: "Interval Run", fartlek: "Fartlek Run" };
const WORK_PHRASE = { threshold: "comfortably hard", interval: "hard", fartlek: "brisk" };
const EFFORT_NAME = { threshold: "Threshold", interval: "Interval", fartlek: "Fartlek" };

function qualityRun(q, { zones, distance, week, sharpener = false, note = "" }) {
  const label = RACE_DISTANCES[distance].label;
  const workPhrase = WORK_PHRASE[q.intensity] || `at ${label} pace`;
  const target = targetLabel(zones, q.intensity, distance);
  const total = 10 + q.reps * q.workMin + (q.reps - 1) * q.recMin + 10;
  const segments = [
    { minutes: 10, intensity: "easy" },
    { minutes: q.reps * q.workMin, intensity: q.intensity },
    { minutes: (q.reps - 1) * q.recMin, intensity: "jog" },
    { minutes: 10, intensity: "easy" },
  ];
  const type = sharpener ? "Sharpener Run" : (QUALITY_TYPE[q.intensity] || `${label} Pace Run`);
  const effortName = EFFORT_NAME[q.intensity] || `${label} pace`;
  return {
    type,
    minutes: total,
    miles: milesFor(segments, zones, distance),
    effort: effortName,
    targetPace: target,
    notes: `10 min easy, ${q.reps} × ${q.workMin} min ${workPhrase} (${q.recMin} min easy jog between), 10 min easy. ${target ? `${effortName} ≈ ${target}.` : EFFORT_CUE[q.intensity]}${note ? ` ${note}` : ""}`,
    steps: [
      { kind: "warmup", minutes: 10, intensity: "easy" },
      { kind: "repeat", reps: q.reps, work: { minutes: q.workMin, intensity: q.intensity }, recovery: { minutes: q.recMin, intensity: "jog" } },
      { kind: "cooldown", minutes: 10, intensity: "easy" },
    ],
    planRole: "quality",
    planWeek: week,
  };
}

function benchmarkRun({ zones, distance, week }) {
  const predicted = zones ? predictRaceSeconds(zones.vdot, "5k") : null;
  const raceMin = predicted ? Math.round(predicted / 60) : 28;
  const minutes = 10 + 2 + raceMin + 10;
  return {
    type: "5K Benchmark",
    minutes,
    miles: Math.round((milesFor([{ minutes: 20, intensity: "easy" }], zones, distance) + 5000 / METERS_PER_MILE) * 10) / 10,
    effort: "Race",
    targetPace: null,
    notes: "10 min easy + 4 strides, race 5K, 10 min easy. First mile controlled, last mile all-out. Enter your time in the race plan — it sets your paces for the rest of the plan.",
    steps: [
      { kind: "warmup", minutes: 10, intensity: "easy" },
      { kind: "strides", reps: 4, seconds: 20 },
      { kind: "time_trial", distance: "5k" },
      { kind: "cooldown", minutes: 10, intensity: "easy" },
    ],
    planRole: "benchmark",
    planWeek: week,
  };
}

const RACE_NOTES = {
  "5k": "First half-mile controlled — 5K blow-ups start at the gun. Settle into goal pace, then empty the tank over the last mile.",
  "10k": "Mile 1: 10–15 s/mi slower than goal pace. Miles 2–4: settle in; on hills hold effort, not pace. Mile 5 on: push if you're in control.",
  "half": "First 3 miles a touch slower than goal pace. Fuel every 30–40 min. Hold effort on hills; race the last 5K.",
};

function raceRun({ zones, distance, week, raceName }) {
  const label = RACE_DISTANCES[distance].label;
  const target = targetLabel(zones, "race", distance);
  const meters = RACE_DISTANCES[distance].meters;
  const predicted = zones ? predictRaceSeconds(zones.vdot, distance) : null;
  return {
    type: `RACE — ${label}`,
    minutes: predicted ? Math.round(predicted / 60) + 12 : null,
    miles: Math.round((meters / METERS_PER_MILE) * 10) / 10,
    effort: "Race",
    targetPace: target,
    notes: `${raceName}: 10 min easy + 4 strides, then race. ${RACE_NOTES[distance]}${target ? ` Goal pace ≈ ${target}.` : ""}`,
    steps: [
      { kind: "warmup", minutes: 10, intensity: "easy" },
      { kind: "strides", reps: 4, seconds: 20 },
      { kind: "race", distance },
    ],
    planRole: "race",
    planWeek: week,
  };
}

function crossWalk(minutes, crossTraining, week) {
  const vest = crossTraining === "vest_walk";
  return {
    type: vest ? "Vest Walk" : "Incline Walk",
    minutes,
    miles: Math.round(((minutes * 60) / EST_PACE.walk) * 10) / 10,
    effort: "Very Easy",
    targetPace: null,
    notes: vest
      ? `${minutes} min vest walk — treadmill 8–12% incline at 3.0–3.5 mph, 10–15 lb to start. Full sentences the whole way. Skip it if a shin, foot or Achilles is sore.`
      : `${minutes} min incline walk — 8–12% at 3.0–3.5 mph. Full sentences the whole way.`,
    steps: [{ kind: "walk", minutes, intensity: "easy" }],
    planRole: "cross",
    planWeek: week,
  };
}

// Generation

const PHASE_LABEL = { base: "Base", build: "Build", specific: "Race-specific", race: "Race week" };

function resolveBenchmarkDate(spec, startMonday, preRaceWeeks, firstBuildIndex) {
  if (spec.benchmarkTest === "none") return null;
  const lastPreRaceDay = addDaysKey(startMonday, preRaceWeeks * 7 - 1);
  if (spec.benchmarkTest !== "auto") {
    return spec.benchmarkTest >= startMonday && spec.benchmarkTest <= lastPreRaceDay ? spec.benchmarkTest : null;
  }
  return addDaysKey(startMonday, firstBuildIndex * 7 + dayIndex(spec.qualityDay));
}

/**
 * Expand a spec into a race-build config, or null when the spec is invalid.
 * Deterministic: the same spec always yields the same plan.
 */
export function generateRunPlan(rawSpec) {
  const check = validateRunPlanSpec(rawSpec);
  if (!check.valid) return null;
  const spec = check.spec;
  const totalWeeks = check.weeks;
  const preRace = totalWeeks - 1;
  const lengths = phaseLengths(preRace);
  const profile = PROFILES[spec.distance];
  const zones = buildPaceZones(spec.benchmark);
  const roles = assignRunDays(spec);
  const distance = spec.distance;
  const label = RACE_DISTANCES[distance].label;
  const warnings = [...check.warnings];

  const E = Math.max(20, round5(spec.startLongRunMin * 0.7)); // starting easy run
  const L0 = spec.startLongRunMin;                              // starting long run
  const X0 = Math.min(45, E + 5);                               // starting cross walk

  // Pre-race week skeleton.
  const seq = [];
  for (let i = 0; i < lengths.base; i++) seq.push({ phase: "base", pos: i % 4, cycle: Math.floor(i / 4), cut: lengths.base >= 4 && i % 4 === 3 });
  const buildPositions = lengths.build >= 4 ? [0, 1, 2, 3] : Array.from({ length: lengths.build }, (_, i) => i);
  for (const pos of buildPositions) seq.push({ phase: "build", pos, cut: pos === 3 });
  for (const pos of [0, 1, 2].slice(3 - lengths.specific)) seq.push({ phase: "specific", pos, peak: pos === 2, cut: false });

  const benchmarkDate = resolveBenchmarkDate(spec, spec.startDate, preRace, lengths.base);
  if (spec.benchmarkTest !== "auto" && spec.benchmarkTest !== "none" && !benchmarkDate) {
    warnings.push("The benchmark test date falls outside the plan's training weeks, so it was left out.");
  }
  const benchmarkWeek = benchmarkDate ? Math.floor(daysBetweenKeys(spec.startDate, benchmarkDate) / 7) : -1;
  const benchmarkDay = benchmarkDate ? weekdayOf(benchmarkDate) : null;

  const weeks = [];
  let k = 0;
  let longTrend = L0;
  let prev = null;

  seq.forEach((wk, w) => {
    const taper = profile.taperLastWeek && wk.phase === "specific" && wk.peak;
    const lighter = wk.cut || taper;
    let v;
    if (!lighter) {
      if (k > 0) longTrend = Math.min(profile.longCap, longTrend + profile.longInc[wk.phase]);
      const easyA = Math.min(profile.easyCap, E + 5 * Math.floor((wk.phase === "specific" ? k + 1 : k) / 2));
      const easyB = Math.min(profile.easyCap, wk.phase === "base"
        ? E + 5 * Math.min(k, 2) + 5 * Math.floor(Math.max(0, k - 2) / 2)
        : E + 5 * Math.floor((k + 1) / 2));
      const cross = Math.min(45, wk.phase === "base"
        ? X0 + 5 * Math.min(k, 2) + 5 * Math.floor(Math.max(0, k - 2) / 2)
        : X0 + 5 * Math.floor((k + 1) / 2));
      const long = Math.min(profile.longCap, longTrend + (wk.peak ? profile.peakBonus : 0));
      const easyC = clamp(round5(E - 5 + 5 * Math.floor(k / 3)), 20, 30);
      v = { easyA, easyB, easyC, cross, long, k };
      k += 1;
    } else {
      v = {
        easyA: round5(0.85 * prev.easyA),
        easyB: round5((taper ? 0.85 : 0.75) * prev.easyB),
        easyC: 20,
        cross: X0,
        long: round5((taper ? 0.75 : 0.85) * longTrend),
        k,
      };
    }

    // Quality session for the week.
    let quality;
    if (wk.phase === "base") {
      quality = wk.cycle >= 1 && !lighter
        ? FARTLEK
        : { strides: lighter ? 6 : (v.k === 0 ? 4 : 6), easyMin: lighter ? E : (v.k === 0 ? E : E + 5) };
    } else if (wk.phase === "build") {
      quality = wk.pos === 0 ? profile.intro : profile.build[wk.pos];
    } else {
      quality = profile.race[wk.pos];
    }

    const weekNo = w + 1;
    const ctx = { zones, distance, week: weekNo };
    const days = {};
    for (const d of DAYS) days[d] = { clearRuns: true };
    days[roles.long] = {
      run: longRun(v.long, {
        ...ctx,
        walkOk: wk.phase === "base" && v.k === 0,
        noWalk: wk.phase === "specific" && wk.pos === 1,
        finishMin: wk.peak && !taper ? 10 : 0,
      }),
    };
    days[roles.quality] = {
      run: quality.strides !== undefined
        ? easyRun(quality.easyMin, { ...ctx, strides: quality.strides })
        : qualityRun(quality, ctx),
    };
    if (roles.easyA) days[roles.easyA] = { run: easyRun(v.easyA, ctx) };
    if (roles.easyB) days[roles.easyB] = { run: easyRun(v.easyB, { ...ctx, strides: wk.phase === "base" ? 0 : 4 }) };
    if (roles.easyC) days[roles.easyC] = { run: easyRun(v.easyC, ctx) };
    if (roles.cross) days[roles.cross] = { cross: crossWalk(v.cross, spec.crossTraining, weekNo) };

    // Benchmark week: the test replaces that day's session, the quality day
    // drops to easy + strides, and the day before is a rest day.
    const isBenchmarkWeek = w === benchmarkWeek;
    if (isBenchmarkWeek) {
      if (benchmarkDay !== roles.quality) days[roles.quality] = { run: easyRun(E, { ...ctx, strides: 4 }) };
      if (benchmarkDay === roles.long) warnings.push(`The benchmark replaces week ${weekNo}'s long run.`);
      const dayBefore = dayAt(dayIndex(benchmarkDay) - 1);
      if (dayIndex(benchmarkDay) > 0) {
        if (dayBefore === roles.long) warnings.push(`Week ${weekNo}'s long run moves out of the way of the benchmark — it's skipped that week.`);
        days[dayBefore] = { clearRuns: true, rest: true };
      }
      days[benchmarkDay] = { run: benchmarkRun(ctx) };
    }

    weeks.push(finishWeek({
      id: `w${weekNo}`,
      index: w,
      label: `Week ${weekNo} — ${PHASE_LABEL[wk.phase]}${lighter ? (taper ? " (taper)" : " (lighter)") : ""}${isBenchmarkWeek ? " · 5K test" : ""}`,
      phase: wk.phase,
      cutback: Boolean(lighter),
      benchmark: isBenchmarkWeek,
      days,
    }));
    prev = v;
  });

  // Race week.
  const raceWeekNo = totalWeeks;
  const raceDay = weekdayOf(spec.raceDate);
  const R = dayIndex(raceDay);
  const ctx = { zones, distance, week: raceWeekNo };
  const days = {};
  DAYS.forEach((d, i) => {
    if (i === R) {
      days[d] = { day: { type: `RACE DAY — ${label}`, code: "RACE", lifting: [], cardio: raceRun({ ...ctx, raceName: spec.raceName }) } };
    } else if (i === R - 1) {
      days[d] = { day: { type: "Rest — race tomorrow", code: "REST", lifting: [], cardio: null } };
    } else if (i > R) {
      days[d] = { clearRuns: true };
    } else if (d === roles.easyA) {
      days[d] = { run: easyRun(round5(0.65 * (prev?.easyA || E)), ctx) };
    } else if (d === roles.quality) {
      days[d] = { run: qualityRun(profile.sharpener, { ...ctx, sharpener: true, note: "Light legs or none this week." }) };
    } else if (d === roles.easyB || d === roles.easyC) {
      days[d] = { run: easyRun(20, { ...ctx, strides: d === roles.easyB ? 4 : 0, kind: "shakeout" }) };
    } else {
      days[d] = { clearRuns: true };
    }
  });
  // A Monday race makes the Sunday before it the rest day.
  if (R === 0 && weeks.length) {
    weeks[weeks.length - 1].days.Sunday = { day: { type: "Rest — race tomorrow", code: "REST", lifting: [], cardio: null } };
    weeks[weeks.length - 1] = finishWeek(weeks[weeks.length - 1]);
  }
  weeks.push(finishWeek({ id: "race", index: preRace, label: `Week ${raceWeekNo} — Race week`, phase: "race", cutback: true, benchmark: false, days }));

  return {
    id: RUN_PLAN_KIND,
    kind: RUN_PLAN_KIND,
    generated: true,
    raceName: spec.raceName,
    raceDate: spec.raceDate,
    distance,
    startDate: spec.startDate,
    totalWeeks,
    roles,
    zones,
    benchmarkDate,
    warnings,
    weeks,
  };
}

// Weekly run minutes (cross walks and the race itself excluded) — the number
// the weekly-volume figure and the tests read.
function finishWeek(week) {
  let totalRunMinutes = 0;
  for (const patch of Object.values(week.days)) {
    const run = patch.run;
    if (run && Number.isFinite(run.minutes)) totalRunMinutes += run.minutes;
  }
  return { ...week, totalRunMinutes };
}

/** Compact week list for previews: [{ n, label, phase, totalRunMinutes, long, quality }]. */
export function summarizeRunPlan(config) {
  if (!config?.weeks) return [];
  return config.weeks.map((week, i) => {
    const runs = Object.values(week.days).map((p) => p.run || p.day?.cardio).filter(Boolean);
    const long = runs.find((r) => r.planRole === "long");
    // The week's headline session: the race, else the 5K test, else the quality run.
    const quality = ["race", "benchmark", "quality"].map((role) => runs.find((r) => r.planRole === role)).find(Boolean);
    return {
      n: i + 1,
      label: week.label,
      phase: week.phase,
      cutback: week.cutback,
      totalRunMinutes: week.totalRunMinutes,
      longMinutes: long?.minutes || null,
      quality: quality ? quality.type : null,
    };
  });
}
