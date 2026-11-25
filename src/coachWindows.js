// src/coachWindows.js
// Seven-day window summaries for the coach's evidence packet: logged days,
// weight and waist, intake and adherence, sleep, steps, and completed sets.
// Pure: dates are passed in.

const n = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const avg = (values) => {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
};
const round1 = (value) => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;

export function dateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(`${value}T12:00:00`);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function shiftDate(key, days) {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function hasWorkout(entry) {
  return Object.keys(entry?.workout?.exercises || {}).length > 0 || (n(entry?.workout?.cardio?.miles) || 0) > 0;
}

function completedSetStats(entry) {
  let sets = 0;
  let volume = 0;
  let strainSets = 0;
  for (const exercise of Object.values(entry?.workout?.exercises || {})) {
    for (const set of exercise?.sets || []) {
      if (!set?.done) continue;
      sets += 1;
      volume += (n(set.weight) || 0) * (n(set.reps) || 0);
      if (set.quality === "grind" || set.quality === "form_break" || n(set.rir) === 0) strainSets += 1;
    }
  }
  return { sets, volume, strainSets };
}

export function summarizeWindow(data = {}, startKey, endKey, goals = {}) {
  const keys = Object.keys(data).filter((key) => key >= startKey && key <= endKey).sort();
  const rows = keys.map((key) => ({ key, entry: data[key] })).filter(({ entry }) => entry);
  const weights = rows.map(({ entry }) => n(entry?.body?.weight)).filter((value) => value > 0);
  const waists = rows.map(({ entry }) => n(entry?.body?.waist ?? entry?.body?.waistInches ?? entry?.measurements?.waist)).filter((value) => value > 0);
  const calories = rows.map(({ entry }) => n(entry?.nutrition?.calories)).filter((value) => value > 0);
  const proteins = rows.map(({ entry }) => n(entry?.nutrition?.protein)).filter((value) => value > 0);
  const sleeps = rows.map(({ entry }) => n(entry?.body?.sleep)).filter(Number.isFinite);
  const soreness = rows.map(({ entry }) => n(entry?.body?.soreness)).filter(Number.isFinite);
  const energy = rows.map(({ entry }) => n(entry?.body?.energy)).filter(Number.isFinite);
  const steps = rows.map(({ entry }) => n(entry?.activity?.steps)).filter(Number.isFinite);
  const workoutDays = rows.filter(({ entry }) => hasWorkout(entry)).length;
  const setStats = rows.reduce((total, { entry }) => {
    const stats = completedSetStats(entry);
    total.sets += stats.sets;
    total.volume += stats.volume;
    total.strainSets += stats.strainSets;
    return total;
  }, { sets: 0, volume: 0, strainSets: 0 });
  const targetCalories = n(goals.calories);
  const targetProtein = n(goals.protein) || 200;
  const targetSteps = n(goals.steps) || 9000;
  const calorieHits = targetCalories ? calories.filter((value) => value >= targetCalories * 0.9 && value <= targetCalories * 1.1).length : 0;
  const proteinHits = proteins.filter((value) => value >= targetProtein * 0.9).length;
  const stepHits = steps.filter((value) => value >= targetSteps).length;
  return {
    startKey,
    endKey,
    daysLogged: rows.length,
    weight: round1(avg(weights)),
    weightCount: weights.length,
    waist: waists.at(-1) ?? null,
    waistCount: waists.length,
    calories: Math.round(avg(calories) || 0),
    protein: Math.round(avg(proteins) || 0),
    sleep: round1(avg(sleeps)),
    soreness: round1(avg(soreness)),
    energy: round1(avg(energy)),
    steps: Math.round(avg(steps) || 0),
    workoutDays,
    completedSets: setStats.sets,
    volume: Math.round(setStats.volume),
    strainSetPct: setStats.sets ? Math.round((setStats.strainSets / setStats.sets) * 100) : 0,
    calorieAdherence: calories.length ? Math.round((calorieHits / calories.length) * 100) : 0,
    proteinAdherence: proteins.length ? Math.round((proteinHits / proteins.length) * 100) : 0,
    stepAdherence: steps.length ? Math.round((stepHits / steps.length) * 100) : 0,
  };
}
