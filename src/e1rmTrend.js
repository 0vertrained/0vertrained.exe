// src/e1rmTrend.js
// Per-lift strength intelligence. Builds an estimated-1RM series per
// exercise from logged sets (RIR-effective when RIR is logged — 8 @ RIR 2 is
// really a 10RM), then classifies the recent trajectory: progressing, flat
// (stalled), or regressing, with a concrete suggestion for stalls. Pure math;
// intensity-technique sets (drop/myo/rest-pause/partial) are excluded from
// e1RM because they intentionally distort the load-rep relationship.

import { effectiveE1RM } from "./sessionIntelligence";

const MIN_SESSIONS = 6;   // below this, "trend" is noise
const RECENT_WINDOW = 4;  // sessions considered "recent"
const PROGRESS_PCT = 1.01;
const REGRESS_PCT = 0.98;

function isStraightSet(s) {
  return !s.type || s.type === "straight";
}

// Best e1RM per calendar day for one exercise.
export function buildE1RMSeries(data, exerciseName, { windowDays = 180 } = {}) {
  if (!data || !exerciseName) return [];
  return Object.keys(data)
    .sort()
    .slice(-windowDays)
    .map(date => {
      const ex = data[date]?.workout?.exercises?.[exerciseName];
      if (!ex?.sets) return null;
      let best = 0;
      for (const s of ex.sets) {
        if (!s.done || !isStraightSet(s)) continue;
        const est = effectiveE1RM(s.weight, s.reps, s.rir);
        if (est && est > best) best = est;
      }
      return best > 0 ? { date, e1rm: best } : null;
    })
    .filter(Boolean);
}

export function detectStall(series) {
  if (!series || series.length < MIN_SESSIONS) {
    return { status: "building", note: `${series?.length || 0}/${MIN_SESSIONS} sessions — building trend history.` };
  }
  const recent = series.slice(-RECENT_WINDOW);
  const prior = series.slice(-(RECENT_WINDOW * 2), -RECENT_WINDOW);
  if (prior.length === 0) return { status: "building", note: "Building trend history." };

  const recentBest = Math.max(...recent.map(p => p.e1rm));
  const priorBest = Math.max(...prior.map(p => p.e1rm));

  if (recentBest >= priorBest * PROGRESS_PCT) {
    return { status: "progressing", note: `e1RM up ${Math.round((recentBest / priorBest - 1) * 1000) / 10}% over the last ${RECENT_WINDOW} sessions.` };
  }
  if (recentBest <= priorBest * REGRESS_PCT) {
    return { status: "regressing", note: `e1RM down ${Math.round((1 - recentBest / priorBest) * 1000) / 10}% — check recovery, sleep, and cut depth before blaming the program.` };
  }
  return {
    status: "stalled",
    note: `e1RM flat across ${RECENT_WINDOW} sessions — deload ~10% and rebuild, or rotate to a close variation for a block.`,
  };
}

// Top lifts by session count, each with series + verdict.
export function buildLiftIntelligence(data, { topN = 6, minSessions = MIN_SESSIONS } = {}) {
  if (!data) return { ready: false, lifts: [] };
  const names = new Set();
  for (const day of Object.values(data)) {
    for (const n of Object.keys(day?.workout?.exercises || {})) names.add(n);
  }
  const lifts = [...names]
    .map(name => {
      const series = buildE1RMSeries(data, name);
      return { name, series };
    })
    .filter(l => l.series.length >= Math.min(3, minSessions)) // keep near-misses visible as "building"
    .sort((a, b) => b.series.length - a.series.length)
    .slice(0, topN)
    .map(l => {
      const verdict = detectStall(l.series);
      const current = l.series[l.series.length - 1];
      const first30 = l.series.filter(p => p.date >= addDays(current.date, -30));
      const delta30 = first30.length > 1 ? current.e1rm - first30[0].e1rm : null;
      return { ...l, verdict, current: current.e1rm, delta30 };
    });
  return { ready: lifts.length > 0, lifts };
}

function addDays(dateKey, n) {
  const d = new Date(dateKey + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
