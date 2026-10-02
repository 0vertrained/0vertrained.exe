// src/raceBuild.js
// V19.2 · Race-build resolver — pure date → build-week mapping.
//
// A weekly program opts in by carrying `__raceBuild: "<configId>"` (a plain
// string, safe through JSON round-trips and every defensive Object.values
// iteration in the codebase). App.jsx resolves once per render against the
// active log date, so back-logging a past day shows that week's prescription.
//
// The ladder OWNS the cardio for the days it patches (Tue/Sat/Sun here) while
// a build is active: manual edits to those cardio blocks are overwritten on
// the next resolve. The template in constants.js stays the source of truth
// for everything else, and the editor always sees the raw template.
//
// Pure module: no React, no network, no clocks — dates are passed in.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function isoKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Monday-anchored week key, using the codebase's T12:00:00 convention to
// dodge timezone off-by-ones.
export function mondayKeyOf(dateKey) {
  const d = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const sinceMonday = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - sinceMonday);
  return isoKey(d);
}

function weeksBetweenMondays(fromKey, toKey) {
  const a = new Date(`${fromKey}T12:00:00`);
  const b = new Date(`${toKey}T12:00:00`);
  return Math.round((b - a) / WEEK_MS);
}

// ─── The 50K ladder (race Friday 2026-08-28) ────────────────────────────────
// Six Monday-anchored weeks. Each week patches days by name:
//   { cardio: {...} }  → replace that day's cardio, keep lifting/type/code
//   { day: {...} }     → replace the whole day (race week uses this)
export const RACE_BUILD_50K = {
  id: "raceBuild50k",
  raceDate: "2026-08-28",
  raceName: "50K",
  weeks: [
    {
      id: "w1", label: "Week 1 — Base", phase: "build",
      days: {
        Tuesday:  { cardio: { type: "Easy Run", miles: 4.5, effort: "Easy", notes: "40 min conversational. No speed anywhere in this build — a 50K is a durability and fueling problem, not a VO2 problem." } },
        Saturday: { cardio: { type: "Long Run/Walk", miles: 6.2, effort: "Easy", notes: "10k on 3 min run / 2 min walk from the very first interval. Cap 90 min. Fueling starts NOW: 30–60g carbs/hr — gut training is half this race." } },
        Sunday:   { cardio: { type: "B2B Walk", miles: 3, effort: "Very Easy", notes: "60 min brisk walk on yesterday's legs — the second half of the weekend block. Zone 1, podcast pace." } },
      },
    },
    {
      id: "w2", label: "Week 2 — Build", phase: "build",
      days: {
        Tuesday:  { cardio: { type: "Easy Run", miles: 5, effort: "Easy", notes: "45 min conversational." } },
        Saturday: { cardio: { type: "Long Run/Walk", miles: 10, effort: "Easy", notes: "16k on 3/2 run-walk. Cap 2h15. Eat the full race-morning breakfast beforehand and 40–60g carbs/hr during — rehearse everything." } },
        Sunday:   { cardio: { type: "B2B Walk", miles: 3.5, effort: "Very Easy", notes: "75 min walk or easy hike. Time on feet is the point." } },
      },
    },
    {
      id: "w3", label: "Week 3 — Build", phase: "build",
      days: {
        Tuesday:  { cardio: { type: "Easy Run", miles: 5.5, effort: "Easy", notes: "50–60 min conversational." } },
        Saturday: { cardio: { type: "Long Run/Walk", miles: 13, effort: "Easy", notes: "21k on 3/2 run-walk. Cap 3h. Full dress rehearsal: race shoes, socks, anti-chafe, vest/bottles. 500–800mg sodium/hr in this heat." } },
        Sunday:   { cardio: { type: "B2B Walk", miles: 4, effort: "Very Easy", notes: "90 min walk. Tired is expected; sharp pain is not — sharp means stop." } },
      },
    },
    {
      id: "w4", label: "Week 4 — Peak", phase: "peak",
      days: {
        Tuesday:  { cardio: { type: "Easy Run", miles: 6, effort: "Easy", notes: "60 min conversational." } },
        Saturday: { cardio: { type: "Long Run/Walk — PEAK", miles: 18, effort: "Easy", notes: "28–30k OR 4 hours — whichever comes first, then stop. The single biggest day of the build. Everything race-day: dawn start, fuel every 25 min, walk breaks on schedule not on feel." } },
        Sunday:   { cardio: { type: "B2B Walk", miles: 3, effort: "Very Easy", notes: "60–75 min very easy walk. Recovery is the training today." } },
      },
    },
    {
      id: "w5", label: "Week 5 — Taper", phase: "taper",
      days: {
        Tuesday:  { cardio: { type: "Easy Run", miles: 4.5, effort: "Easy", notes: "40 min easy. The hay is in the barn — nothing you do this week makes you fitter, plenty makes you tired." } },
        Saturday: { cardio: { type: "Long Run/Walk — Taper", miles: 7.5, effort: "Easy", notes: "12k easy on race rhythm, cap 90 min. Keep the fueling practice." } },
        Sunday:   { cardio: { type: "B2B Walk", miles: 2.5, effort: "Very Easy", notes: "45 min walk. Sleep is the supplement this week." } },
      },
    },
    {
      id: "race", label: "Race Week", phase: "race",
      days: {
        Tuesday:   { cardio: { type: "Easy Run + Strides", miles: 3, effort: "Easy", notes: "25–30 min easy + 4 relaxed strides." } },
        Wednesday: { day: { type: "Rest — Race Week", code: "REST", lifting: [], cardio: null } },
        Thursday:  { cardio: { type: "Shakeout", miles: 1.5, effort: "Very Easy", notes: "15 min shakeout. Lay out everything tonight: gels, sodium, lube, sunscreen, drop bag, charged watch." } },
        Friday:    { day: { type: "RACE DAY — 50K", code: "RACE", lifting: [], cardio: { type: "50K Race", miles: 31.1, effort: "Survival Pace", notes: "Start slower than feels reasonable, then slow down. Run 3 / walk 2 from the gun; hike every uphill. 200–300 cal + 500–800mg sodium per hour from hour one. Aid stations: in, refill, out. Nothing new today. Relentless forward progress." } } },
        Saturday:  { day: { type: "Post-Race Rest", code: "REST", lifting: [], cardio: null } },
        Sunday:    { cardio: { type: "Recovery Walk", miles: 1, effort: "Very Easy", notes: "20–30 min if the legs allow. Eat. Sleep. You just covered 31 miles." } },
      },
    },
  ],
};

export const RACE_BUILDS = {
  [RACE_BUILD_50K.id]: RACE_BUILD_50K,
};

// ─── Resolution ─────────────────────────────────────────────────────────────

// Maps a date to a ladder week. Dates before the ladder clamp to week 0
// (early joiners just start at the base week); dates after race week resolve
// to phase "complete" and the caller leaves the program untouched.
export function resolveBuildWeek(config, todayKey) {
  if (!config?.raceDate || !Array.isArray(config?.weeks) || config.weeks.length === 0) return null;
  const raceMonday = mondayKeyOf(config.raceDate);
  const todayMonday = mondayKeyOf(todayKey);
  if (!raceMonday || !todayMonday) return null;
  const weeksToRaceWeek = weeksBetweenMondays(todayMonday, raceMonday);
  const rawIndex = (config.weeks.length - 1) - weeksToRaceWeek;
  if (rawIndex > config.weeks.length - 1) {
    return { phase: "complete", index: null, week: null, raceDate: config.raceDate };
  }
  const index = Math.max(0, rawIndex);
  const week = config.weeks[index];
  return {
    phase: week.phase || "build",
    index,
    totalWeeks: config.weeks.length,
    label: week.label,
    week,
    raceDate: config.raceDate,
  };
}

// Small descriptor for UI/coach surfaces. Null when the program carries no
// active build (or the race is done).
export function describeBuildWeek(program, todayKey) {
  const config = RACE_BUILDS[program?.__raceBuild];
  if (!config) return null;
  const resolved = resolveBuildWeek(config, todayKey);
  if (!resolved || resolved.phase === "complete") return null;
  const race = new Date(`${config.raceDate}T12:00:00`);
  const today = new Date(`${todayKey}T12:00:00`);
  const daysToRace = Math.round((race - today) / (24 * 60 * 60 * 1000));
  return {
    label: resolved.label,
    weekIndex: resolved.index,
    totalWeeks: resolved.totalWeeks,
    daysToRace,
    raceName: config.raceName,
    raceDate: config.raceDate,
  };
}

// Returns the program with the current build week's patches applied, or the
// exact same reference when there is nothing to do (no marker, unknown id,
// race complete) so React consumers don't re-render for nothing.
export function applyRaceBuild(program, todayKey) {
  const config = RACE_BUILDS[program?.__raceBuild];
  if (!config) return program;
  const resolved = resolveBuildWeek(config, todayKey);
  if (!resolved || resolved.phase === "complete" || !resolved.week) return program;
  const next = { ...program };
  for (const [dayName, patch] of Object.entries(resolved.week.days || {})) {
    if (!patch || !program[dayName]) continue;
    if (patch.day) {
      next[dayName] = { ...patch.day };
    } else if (Object.prototype.hasOwnProperty.call(patch, "cardio")) {
      next[dayName] = { ...program[dayName], cardio: patch.cardio ? { ...patch.cardio } : null };
    }
  }
  return next;
}
