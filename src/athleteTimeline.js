// src/athleteTimeline.js
// Athlete OS Timeline: read-only event synthesis from local entries. No network, no writes.

const n = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function dayLabel(date) {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function exerciseSummary(exercises = {}) {
  const names = Object.keys(exercises);
  const sets = Object.values(exercises).reduce((acc, ex) => acc + (Array.isArray(ex?.sets) ? ex.sets.filter(s => s.done !== false).length : 0), 0);
  const volume = Object.values(exercises).reduce((acc, ex) => acc + (Array.isArray(ex?.sets) ? ex.sets.reduce((sum, s) => sum + n(s.weight) * n(s.reps), 0) : 0), 0);
  return { names, sets, volume: Math.round(volume) };
}

function event(date, type, title, detail, metrics = {}, tone = "neutral") {
  return { id: `${date}-${type}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"), date, dayLabel: dayLabel(date), type, title, detail, metrics, tone };
}

export function buildAthleteTimeline(entries = {}, { limit = 60 } = {}) {
  const events = [];
  const sorted = Object.entries(entries || {}).sort((a, b) => b[0].localeCompare(a[0]));

  for (const [date, entry] of sorted) {
    const workout = entry?.workout || {};
    const nutrition = entry?.nutrition || {};
    const body = entry?.body || {};
    const intelligence = entry?.intelligence || {};

    const ex = exerciseSummary(workout.exercises || {});
    const miles = n(workout.cardio?.miles);
    if (ex.names.length > 0 || miles > 0) {
      const parts = [];
      if (ex.names.length > 0) parts.push(`${ex.names.length} lifts`, `${ex.sets} sets`);
      if (miles > 0) parts.push(`${miles} mi run`);
      events.push(event(date, "training", "Training logged", parts.join(" · "), { lifts: ex.names.length, sets: ex.sets, miles, volume: ex.volume }, "positive"));
    }

    if (n(nutrition.calories) > 0 || n(nutrition.protein) > 0) {
      const protein = n(nutrition.protein);
      const calories = n(nutrition.calories);
      const tone = protein >= 180 ? "positive" : protein > 0 ? "caution" : "neutral";
      events.push(event(date, "nutrition", "Nutrition logged", `${calories || "—"} kcal · ${protein || "—"}g protein`, {
        calories, protein, carbs: n(nutrition.carbs), fats: n(nutrition.fats), water: n(nutrition.water),
      }, tone));
    }

    if (n(body.sleep) > 0 || n(body.energy) > 0 || n(body.soreness) > 0 || n(body.weight) > 0) {
      const sleep = n(body.sleep);
      const tone = sleep >= 7 ? "positive" : sleep > 0 && sleep < 6 ? "warning" : "neutral";
      events.push(event(date, "recovery", "Body check-in", `${body.weight || "—"} lb · ${sleep || "—"}h sleep · E${body.energy || "—"}/S${body.soreness || "—"}`, {
        weight: n(body.weight), sleep, energy: n(body.energy), soreness: n(body.soreness),
      }, tone));
    }

    if (workout.notes && String(workout.notes).trim()) {
      events.push(event(date, "note", "Training note", String(workout.notes).trim().slice(0, 180), {}, "neutral"));
    }

    if (intelligence.acceptedTrainingSuggestion) {
      const s = intelligence.acceptedTrainingSuggestion;
      events.push(event(date, "intelligence", "Adaptive training accepted", s.title || s.mode || "Suggestion accepted", { mode: s.mode || null }, "caution"));
    }
    if (intelligence.keptOriginalTrainingPlan) {
      const s = intelligence.keptOriginalTrainingPlan;
      events.push(event(date, "intelligence", "Original training kept", s.title || "Original plan kept", {}, "neutral"));
    }
    if (intelligence.lastNutritionQuickAdd) {
      const s = intelligence.lastNutritionQuickAdd;
      events.push(event(date, "nutrition", "Nutrition quick-add", s.label || "Quick-add used", {}, "positive"));
    }
  }

  return events.slice(0, limit);
}

export function filterTimelineEvents(events = [], filter = "all") {
  if (!filter || filter === "all") return events;
  return events.filter(e => e.type === filter);
}

export function groupTimelineByDate(events = []) {
  const groups = [];
  const byDate = new Map();
  for (const ev of events) {
    if (!byDate.has(ev.date)) {
      const group = { date: ev.date, dayLabel: ev.dayLabel, events: [] };
      byDate.set(ev.date, group);
      groups.push(group);
    }
    byDate.get(ev.date).events.push(ev);
  }
  return groups;
}

export function summarizeTimeline(events = []) {
  const counts = events.reduce((acc, e) => ({ ...acc, [e.type]: (acc[e.type] || 0) + 1 }), {});
  const recentTraining = events.filter(e => e.type === "training").slice(0, 7);
  const miles = recentTraining.reduce((acc, e) => acc + n(e.metrics?.miles), 0);
  const volume = recentTraining.reduce((acc, e) => acc + n(e.metrics?.volume), 0);
  return { total: events.length, counts, recentTrainingDays: recentTraining.length, recentMiles: Number(miles.toFixed(1)), recentVolume: Math.round(volume) };
}

export default { buildAthleteTimeline, filterTimelineEvents, groupTimelineByDate, summarizeTimeline };
