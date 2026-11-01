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
//
// V19.3 · `__raceBuild` may also be an OBJECT: a generated race-plan spec
// (runPlanGenerator.js, kind "runPlan"). It is expanded on read, and its weeks
// use plan patches — { run } / { cross } / { clearRuns } — that own running on
// all seven days, reach into AM/PM sessions, and never touch lifting. The
// registry-string path (the 50K) is unchanged.

import { generateRunPlan, isRunPlanSpec } from "./runPlanGenerator";

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

// Generated plans are pure functions of their spec; keep the last few so a
// re-render never regenerates.
const generatedCache = new Map();
function generatedConfig(spec) {
  const key = JSON.stringify(spec);
  if (generatedCache.has(key)) return generatedCache.get(key);
  const config = generateRunPlan(spec);
  generatedCache.set(key, config);
  if (generatedCache.size > 8) generatedCache.delete(generatedCache.keys().next().value);
  return config;
}

/**
 * Swapping a program's lifting (preset switch, Program Builder apply) keeps an
 * active generated race plan — unless the incoming program brings a race
 * build of its own (e.g. the 50K preset).
 */
export function keepRacePlan(current, incoming) {
  if (!isRunPlanSpec(current?.__raceBuild) || !incoming || incoming.__raceBuild) return incoming;
  return { ...incoming, __raceBuild: current.__raceBuild };
}

/** The ladder a program's `__raceBuild` marker points at, or null. */
export function resolveRaceBuildConfig(marker) {
  if (typeof marker === "string") return RACE_BUILDS[marker] || null;
  if (isRunPlanSpec(marker)) return generatedConfig(marker);
  return null;
}

// ─── Resolution ─────────────────────────────────────────────────────────────

// Maps a date to a ladder week. Dates before the ladder clamp to week 0
// (early joiners just start at the base week) — except for generated plans,
// which carry a startDate and resolve to "pending" until it arrives. Dates
// after race week resolve to phase "complete" and the caller leaves the
// program untouched.
export function resolveBuildWeek(config, todayKey) {
  if (!config?.raceDate || !Array.isArray(config?.weeks) || config.weeks.length === 0) return null;
  const raceMonday = mondayKeyOf(config.raceDate);
  const todayMonday = mondayKeyOf(todayKey);
  if (!raceMonday || !todayMonday) return null;
  if (config.startDate && todayMonday < mondayKeyOf(config.startDate)) {
    return { phase: "pending", index: null, week: null, totalWeeks: config.weeks.length, startsOn: config.startDate, raceDate: config.raceDate };
  }
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
// active build (or the race is done). A generated plan that hasn't started
// yet describes itself as pending, with its start date.
export function describeBuildWeek(program, todayKey) {
  const config = resolveRaceBuildConfig(program?.__raceBuild);
  if (!config) return null;
  const resolved = resolveBuildWeek(config, todayKey);
  if (!resolved || resolved.phase === "complete") return null;
  const race = new Date(`${config.raceDate}T12:00:00`);
  const today = new Date(`${todayKey}T12:00:00`);
  const daysToRace = Math.round((race - today) / (24 * 60 * 60 * 1000));
  if (resolved.phase === "pending") {
    return {
      pending: true,
      startsOn: resolved.startsOn,
      totalWeeks: resolved.totalWeeks,
      daysToRace,
      raceName: config.raceName,
      raceDate: config.raceDate,
      generated: Boolean(config.generated),
    };
  }
  return {
    label: resolved.label,
    weekIndex: resolved.index,
    totalWeeks: resolved.totalWeeks,
    phase: resolved.phase,
    cutback: Boolean(resolved.week?.cutback),
    benchmark: Boolean(resolved.week?.benchmark),
    totalRunMinutes: resolved.week?.totalRunMinutes ?? null,
    daysToRace,
    raceName: config.raceName,
    raceDate: config.raceDate,
    generated: Boolean(config.generated),
  };
}

// ─── Plan patches (generated plans only) ────────────────────────────────────

const RUN_HINT = /\b(run|runs|running|jog|jogging|intervals?|tempo|threshold|strides?|fartlek|track|hill repeats?|shakeout|race|5k|10k|half marathon|marathon|zone\s*2|long zone)\b/i;
const NON_RUN = /\b(walk|walking|hike|hiking|bike|ride|cycling|cycle|row|rowing|elliptical|swim|ski|erg|stair|sled)\b/i;
const EXPLICIT_RUN = /\b(run|runs|running|jog|jogging)\b/i;

/**
 * Is this prescribed cardio a run? Walks, bike, row etc. are not — unless the
 * type also says run ("Zone 2 Bike/Run", "Long Run/Walk"), in which case the
 * plan claims it so running is never doubled up.
 */
export function isRunCardio(cardio) {
  const text = String(cardio?.type || "");
  if (!cardio || !RUN_HINT.test(text)) return false;
  return !NON_RUN.test(text) || EXPLICIT_RUN.test(text);
}

// Cardio the plan itself placed — stripped first on every resolve, so the
// overlay is idempotent and self-heals if a resolved program is ever saved.
const isPlanOwned = (cardio) => Boolean(cardio && cardio.planRole);
const strippable = (cardio) => isRunCardio(cardio) || isPlanOwned(cardio);

const ROLE_CODE = { easy: "EASY", quality: "QUALITY", long: "LONG", benchmark: "TEST", cross: "WALK", race: "RACE" };
const REST_DAY = { type: "Rest", code: "REST", lifting: [], cardio: null };

function hasLifting(day) {
  const own = Array.isArray(day?.lifting) && day.lifting.length > 0;
  const inSessions = Array.isArray(day?.sessions) && day.sessions.some((s) => (s?.lifting || []).length > 0);
  return own || inSessions;
}

function applyPlanPatch(day, patch) {
  const original = day || REST_DAY;
  const placed = patch.run || patch.cross || null;
  // A day left with no lifting is named for what's on it: the plan's session,
  // or Rest when nothing remains.
  const relabel = (d) => {
    if (hasLifting(d)) return d;
    const sessionDay = Array.isArray(d.sessions) && d.sessions.length > 0;
    const cardios = sessionDay ? d.sessions.map((s) => s.cardio).filter(Boolean) : [d.cardio].filter(Boolean);
    if (!cardios.length) return sessionDay ? { ...d, ...REST_DAY, sessions: [] } : { ...d, ...REST_DAY };
    if (placed && cardios.length === 1 && isPlanOwned(cardios[0])) return { ...d, type: placed.type, code: ROLE_CODE[placed.planRole] || "RUN" };
    return d;
  };

  // AM/PM days: strip runs from every session, keep the slot the old run lived
  // in, drop sessions left empty, then put the plan's session back in place.
  if (Array.isArray(original.sessions) && original.sessions.length) {
    let slot = null; // { index, id, label, timeOfDay, keepsLifting }
    const kept = [];
    original.sessions.forEach((s) => {
      const strip = strippable(s?.cardio);
      const next = strip ? { ...s, cardio: null } : s;
      const empty = !(next?.lifting || []).length && !next?.cardio;
      if (strip && !slot) slot = { index: kept.length, id: s.id, label: s.label, timeOfDay: s.timeOfDay, keepsLifting: !empty };
      if (!empty) kept.push(next);
    });
    if (placed) {
      if (slot?.keepsLifting) {
        kept[slot.index] = { ...kept[slot.index], cardio: { ...placed } };
      } else {
        const session = {
          id: slot?.id || (patch.cross ? "walk" : "run"),
          label: slot?.label || (patch.cross ? "WALK" : "RUN"),
          title: placed.type,
          timeOfDay: slot?.timeOfDay || "morning",
          emphasis: placed.effort || null,
          lifting: [],
          cardio: { ...placed },
        };
        kept.splice(slot ? slot.index : 0, 0, session);
      }
    }
    return relabel({ ...original, sessions: kept });
  }

  // Single-session days: one cardio slot beside the lifting. The plan's
  // session takes the slot (a walk the template had there sits out that day —
  // it stays in the template). Never split into AM/PM sessions here: most
  // readers only see workout.cardio, so the logged run must land there.
  const current = original.cardio && !strippable(original.cardio) ? original.cardio : null;
  return relabel({ ...original, cardio: placed ? { ...placed } : current });
}

// Returns the program with the current build week's patches applied, or the
// exact same reference when there is nothing to do (no marker, unknown id,
// not started, race complete) so React consumers don't re-render for nothing.
export function applyRaceBuild(program, todayKey) {
  const config = resolveRaceBuildConfig(program?.__raceBuild);
  if (!config) return program;
  const resolved = resolveBuildWeek(config, todayKey);
  if (!resolved || resolved.phase === "complete" || resolved.phase === "pending" || !resolved.week) return program;
  const next = { ...program };
  for (const [dayName, patch] of Object.entries(resolved.week.days || {})) {
    if (!patch || !program[dayName]) continue;
    if (patch.day) {
      next[dayName] = { ...patch.day };
    } else if (patch.run || patch.cross || patch.clearRuns) {
      next[dayName] = applyPlanPatch(program[dayName], patch);
    } else if (Object.prototype.hasOwnProperty.call(patch, "cardio")) {
      next[dayName] = { ...program[dayName], cardio: patch.cardio ? { ...patch.cardio } : null };
    }
  }
  return next;
}
