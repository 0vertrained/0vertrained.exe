// src/demo/demoDataset.js
// V15.5 · The recruiter/investor demo dataset. Everything here is
// DETERMINISTIC (seeded PRNG) so a demo walkthrough is reproducible and the
// contract tests can pin properties like "the load model resolves a zone".
//
// Design intent, in order of importance:
//   1. Program-driven: workouts come from DEFAULT_PROGRAM's own lifts, so the
//      per-muscle volume audit, e1RM trends, and stall detection all fire on
//      recognizable data instead of two hardcoded lifts.
//   2. Coherent across systems: Strava runs derive FROM the entries' cardio
//      days; Oura readiness dips the morning after heavy sessions; body-weight
//      trends down a slow cut. Cross-checks in the demo look *right*.
//   3. Interactive TODAY: today has no workout logged (Session Mode is live to
//      drive) and nutrition sits mid-day (~55% of targets) so Fuel has gaps
//      worth logging.
// Nothing here touches network, storage, or real user paths — consumed only
// behind isDemoMode() branches.

import { defaultDay, DEFAULT_PROGRAM } from "../constants";

// Deterministic PRNG (mulberry32). Seed 193 — the wordmark's issue number.
function rng(seed = 193) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const isoDay = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const weekdayOf = (iso) => WEEKDAYS[new Date(iso + "T12:00:00").getDay()];
const repTarget = (reps) => { const m = String(reps ?? "8").match(/\d+/); return m ? parseInt(m[0], 10) : 8; };

// Base working weight per lift, from name heuristics — stable per name.
function baseWeight(name, r) {
  const n = name.toLowerCase();
  if (/deadlift|rdl/.test(n)) return 275;
  if (/squat|leg press/.test(n)) return 245;
  if (/bench/.test(n)) return 195;
  if (/row|pull-?up|pulldown|ohp|overhead|press/.test(n)) return 135;
  if (/curl|extension|raise|fly|face|lateral|tricep|bicep/.test(n)) return 35;
  return 60 + Math.round(r() * 40);
}
const isLower = (name) => /squat|deadlift|rdl|leg|lunge|calf/.test(name.toLowerCase());

export function buildDemoEntries(days = 140) {
  const r = rng(193);
  const entries = {};
  const baseByLift = {};
  const goals = { calories: 3400, protein: 200, carbs: 380, fats: 95, water: 128 };
  let weight = 189.4; // slow cut → ~184

  for (let i = days - 1; i >= 0; i--) {
    const key = isoDay(-i);
    const day = defaultDay();
    const dayName = weekdayOf(key);
    const plan = DEFAULT_PROGRAM[dayName] || {};
    const week = Math.floor((days - 1 - i) / 7);
    const isDeloadWeek = week % 5 === 4;
    const isToday = i === 0;
    // Missed days: ~10% historically, but the trailing 12 days are perfect so
    // the masthead streak reads well in a demo.
    const missed = !isToday && i > 12 && r() < 0.10;

    // ── Workout ──
    const lifting = Array.isArray(plan.lifting) ? plan.lifting : [];
    if (!isToday && !missed && lifting.length) {
      const exercises = {};
      for (const ex of lifting) {
        if (r() < 0.05) continue; // occasionally skipped an accessory
        if (!(ex.name in baseByLift)) baseByLift[ex.name] = baseWeight(ex.name, r);
        const weeklyInc = isLower(ex.name) ? 5 : 2.5;
        let w = baseByLift[ex.name] + week * weeklyInc;
        if (isDeloadWeek) w *= 0.9;
        w = Math.round(w / 2.5) * 2.5;
        const target = repTarget(ex.reps);
        const nSets = Number(ex.sets) || 3;
        const sets = [];
        for (let sIdx = 0; sIdx < nSets; sIdx++) {
          const reps = Math.max(1, target + (r() < 0.25 ? -1 : 0) + (sIdx === 0 && r() < 0.2 ? 1 : 0));
          sets.push({ weight: String(w), reps: String(reps), done: true });
        }
        exercises[ex.name] = { sets };
      }
      day.workout.exercises = exercises;
      if (r() < 0.18) {
        const notes = [
          "Felt strong — sleep paid off.",
          "Cut rest to 2min on accessories.",
          "Left knee niggle on warmups; fine by working sets.",
          "PR energy today. Bar speed excellent.",
          "Deload pace, focused on bracing.",
        ];
        day.workout.notes = notes[Math.floor(r() * notes.length)];
      }
    }

    // ── Cardio (Hyrox flavor): Tue/Thu easy Z2, Sunday long ──
    if (!isToday && !missed) {
      if (dayName === "Sunday") {
        const miles = (8 + r() * 2).toFixed(1);
        day.workout.cardio = { miles: String(miles), time: `${Math.round(miles * 9.1)}:00`, pace: "9:05" };
      } else if ((dayName === "Tuesday" || dayName === "Thursday") && r() < 0.85) {
        const miles = (3 + r() * 2).toFixed(1);
        day.workout.cardio = { miles: String(miles), time: `${Math.round(miles * 8.8)}:30`, pace: "8:50" };
      }
    }

    // ── Nutrition: ~85% adherence around targets; today is mid-day ──
    const adher = isToday ? 0.55 : 0.86 + (r() - 0.5) * 0.16;
    day.nutrition = {
      calories: String(Math.round(goals.calories * adher)),
      protein: String(Math.round(goals.protein * Math.min(1.05, adher + 0.06))),
      carbs: String(Math.round(goals.carbs * adher)),
      fats: String(Math.round(goals.fats * adher)),
      water: String(Math.round(goals.water * (isToday ? 0.5 : 0.8 + r() * 0.25))),
      plannedMeals: {},
    };

    // ── Body: downtrend + soreness the day after lower sessions ──
    weight -= 0.036 + (r() - 0.5) * 0.12;
    const prevKey = isoDay(-(i + 1));
    const prevLower = entries[prevKey] && Object.keys(entries[prevKey].workout?.exercises || {}).some(isLower);
    day.body = {
      weight: isToday ? "" : String(weight.toFixed(1)),
      sleep: String((6.7 + r() * 1.6).toFixed(1)),
      sleepQuality: String(5 + Math.floor(r() * 5)),
      energy: String(prevLower ? 5 + Math.floor(r() * 3) : 6 + Math.floor(r() * 4)),
      soreness: String(prevLower ? 5 + Math.floor(r() * 4) : 1 + Math.floor(r() * 4)),
      stress: String(2 + Math.floor(r() * 5)),
      motivation: String(6 + Math.floor(r() * 4)),
    };
    entries[key] = day;
  }
  return entries;
}

// ── Oura: 35 days, readiness correlated inversely with yesterday's load ──
export function buildDemoOura(entries, days = 35) {
  const r = rng(517);
  const data = {};
  for (let i = days - 1; i >= 0; i--) {
    const key = isoDay(-i);
    const yesterday = entries[isoDay(-(i + 1))];
    const heavyYesterday = yesterday && Object.keys(yesterday.workout?.exercises || {}).some(isLower);
    const hrv = Math.round(58 + r() * 14 - (heavyYesterday ? 8 : 0));
    const rhr = Math.round(56 + r() * 5 + (heavyYesterday ? 3 : 0));
    const sleepScore = Math.round(70 + r() * 18 - (heavyYesterday ? 4 : 0));
    const readinessScore = Math.round(68 + r() * 22 - (heavyYesterday ? 9 : 0));
    const totalSleep = (6.6 + r() * 1.7) * 3600;
    data[key] = {
      sleep: { data: [{
        day: key, score: sleepScore,
        total_sleep_duration: totalSleep, time_in_bed: totalSleep + 2200,
        awake_time: 1500 + Math.round(r() * 1200),
        deep_sleep_duration: totalSleep * 0.17, rem_sleep_duration: totalSleep * 0.22,
        sleep_latency: 600 + Math.round(r() * 500), sleep_efficiency: 0.86 + r() * 0.08,
        lowest_heart_rate: rhr, average_heart_rate: rhr + 5,
        heart_rate_variability: { average: hrv, rmssd: hrv },
        skin_temperature_deviation: heavyYesterday ? 0.3 : 0.06,
      }]},
      readiness: { data: [{
        day: key, score: readinessScore, temperature_deviation: 0.1, respiratory_rate: 15.6 + r(),
        contributors: { hrv_balance: hrv + 10, resting_heart_rate: 100 - rhr, previous_day_activity: 75, sleep_balance: sleepScore },
      }]},
      activity: { data: [{
        day: key, score: Math.round(72 + r() * 20),
        steps: 7500 + Math.round(r() * 6500),
        active_calories: 420 + Math.round(r() * 380),
        total_calories: 2900 + Math.round(r() * 500),
      }]},
      daily_spo2: { data: [{ day: key, spo2_percentage: { average: 96 + Math.round(r() * 2) } }] },
    };
  }
  return data;
}

// ── Whoop: raw-shaped records the normalizers accept (grouped by day/type) ──
export function buildDemoWhoop(entries, days = 35) {
  const r = rng(881);
  const grouped = {};
  for (let i = days - 1; i >= 0; i--) {
    const key = isoDay(-i);
    const trained = entries[key] && Object.keys(entries[key].workout?.exercises || {}).length > 0;
    const stamp = `${key}T05:30:00.000Z`;
    const inBedMilli = Math.round((6.7 + r() * 1.6) * 3600 * 1000);
    const awakeMilli = Math.round((0.4 + r() * 0.4) * 3600 * 1000);
    grouped[key] = {
      recovery: { created_at: stamp, start: stamp, score: {
        recovery_score: Math.round(52 + r() * 42),
        hrv_rmssd_milli: Math.round(55 + r() * 25),
        resting_heart_rate: Math.round(55 + r() * 6),
      }},
      sleep: { created_at: stamp, start: stamp, score: {
        sleep_performance_percentage: Math.round(74 + r() * 22),
        stage_summary: {
          total_in_bed_time_milli: inBedMilli,
          total_awake_time_milli: awakeMilli,
          total_slow_wave_sleep_time_milli: Math.round(inBedMilli * 0.18),
          total_rem_sleep_time_milli: Math.round(inBedMilli * 0.22),
        },
      }},
      cycle: { created_at: stamp, start: stamp, score: {
        strain: Number((trained ? 12 + r() * 6 : 6 + r() * 5).toFixed(1)),
        average_heart_rate: Math.round(68 + r() * 12),
        max_heart_rate: Math.round(150 + r() * 30),
        kilojoule: Math.round(8000 + r() * 4000),
      }},
    };
  }
  return grouped;
}

// ── Strava: activities DERIVED from the entries' cardio days (table-row shape) ──
export function buildDemoStrava(entries, days = 30) {
  const r = rng(311);
  const acts = [];
  for (let i = 0; i < days; i++) {
    const key = isoDay(-i);
    const cardio = entries[key]?.workout?.cardio;
    if (!cardio?.miles) continue;
    const meters = Math.round(parseFloat(cardio.miles) * 1609.34);
    acts.push({
      id: 90000000 + i,
      name: parseFloat(cardio.miles) >= 8 ? "Long run · Z2" : "Easy run · Z2",
      type: "Run", sport_type: "Run",
      start_date: `${key}T06:${String(10 + Math.floor(r() * 40)).padStart(2, "0")}:00Z`,
      distance_m: meters,
      moving_time_s: Math.round((meters / 1609.34) * (8.8 + r() * 0.6) * 60),
      average_heartrate: Math.round(138 + r() * 14),
    });
  }
  return acts;
}

// ── Form-check history: stored-summary shape, improving squat arc ──
export function buildDemoFormHistory() {
  const mk = (offset, movement, score, label, reasons) => ({
    date: `${isoDay(-offset)}T18:${String(10 + offset).padStart(2, "0")}:00.000Z`,
    movement,
    formScore: { score, label, reasons },
    captureQuality: { score: 82, label: "Good" },
    repCount: 5,
    timeline: [],
  });
  return [
    mk(2, "Squat", 84, "Solid", ["Depth consistent", "Slight forward drift on rep 4"]),
    mk(9, "Bench Press", 78, "Solid", ["Bar path stable", "Elbow flare on final rep"]),
    mk(16, "Squat", 71, "Needs work", ["Depth shallow reps 3–5", "Knees cave on ascent"]),
    mk(24, "Romanian Deadlift", 81, "Solid", ["Neutral spine held", "Bar drifts from legs at lockout"]),
  ];
}
