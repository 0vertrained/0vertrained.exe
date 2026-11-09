// src/boxScore.js
// The Box Score — the post-session story, pure.
//
// The seconds after the last set are the peak-emotion moment of the loop; the
// old complete screen spent them on a tonnage number and a random flavor
// line. The Box Score tells the session's actual story from data the app
// already computes:
//   headline (strict priority: PRs → strength arrows → tonnage jump →
//   first-on-record → "Session banked.") · tonnage vs the last same-name
//   session · today's PRs vs ALL history · e1RM direction per anchor lift ·
//   sets banked per muscle against the weekly landmarks · skips, named
//   honestly.
// Honesty rules: no prior same-name session → no fake deltas ("first Pull
// day on record — the baseline is set"); every comparison names its basis.

import { effectiveE1RM } from "./sessionIntelligence";
import { buildE1RMSeries } from "./e1rmTrend";
import { mapExerciseToMuscles, buildVolumeReport } from "./muscleVolume";

const numOr = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

function dayTonnage(day) {
  let t = 0;
  for (const ex of Object.values(day?.workout?.exercises || {})) {
    for (const s of ex?.sets || []) if (s.done) t += numOr(s.weight) * numOr(s.reps);
  }
  return Math.round(t);
}

function doneStraightSets(exData) {
  return (exData?.sets || []).filter((s) => s.done && (!s.type || s.type === "straight") && numOr(s.weight) > 0);
}

export function buildBoxScore({ data = {}, todayKey, todayName = null } = {}) {
  const today = data?.[todayKey];
  const exercises = Object.entries(today?.workout?.exercises || {});
  const tonnage = dayTonnage(today);

  // ── Comparison basis: the most recent prior day with the SAME program-day
  //    name and any lifting. Program day name lives per weekday, so matching
  //    the weekday matches the name.
  const weekday = new Date(`${todayKey}T12:00:00`).getDay();
  const priorSameDayKey = Object.keys(data)
    .filter((k) => k < todayKey && new Date(`${k}T12:00:00`).getDay() === weekday && dayTonnage(data[k]) > 0)
    .sort()
    .reverse()[0] || null;
  const priorTonnage = priorSameDayKey ? dayTonnage(data[priorSameDayKey]) : null;
  const tonnageDeltaPct = priorTonnage ? Math.round(((tonnage - priorTonnage) / priorTonnage) * 100) : null;

  // ── PRs: today's best e1RM per exercise vs ALL prior history (straight
  //    sets only, on both sides).
  const prs = [];
  const arrows = [];
  for (const [name, exData] of exercises) {
    const todaysSets = doneStraightSets(exData);
    if (!todaysSets.length) continue;
    const todayBest = Math.max(...todaysSets.map((s) => effectiveE1RM(numOr(s.weight), numOr(s.reps), s.rir)));
    let priorBest = 0;
    for (const [k, d] of Object.entries(data)) {
      if (k >= todayKey) continue;
      for (const s of doneStraightSets(d?.workout?.exercises?.[name])) {
        priorBest = Math.max(priorBest, effectiveE1RM(numOr(s.weight), numOr(s.reps), s.rir));
      }
    }
    if (priorBest > 0 && todayBest > priorBest + 0.5) {
      prs.push({ name, e1rm: Math.round(todayBest), priorBest: Math.round(priorBest) });
    }
    // Direction arrow from the real series (today vs previous point).
    const series = buildE1RMSeries(data, name);
    if (series.length >= 2 && series[series.length - 1].date === todayKey) {
      const nowV = series[series.length - 1].e1rm;
      const prevV = series[series.length - 2].e1rm;
      const dir = nowV > prevV + 0.5 ? "↗" : nowV < prevV - 0.5 ? "↘" : "→";
      arrows.push({ name, e1rm: Math.round(nowV), dir });
    }
  }

  // ── Sets banked per muscle (today's straight+cascade done sets, primaries
  //    1 / secondaries 0.5 — the weekly volume audit's own currency) with the
  //    weekly position from that audit.
  const bankedByMuscle = {};
  for (const [name, exData] of exercises) {
    const doneCount = (exData?.sets || []).filter((s) => s.done && numOr(s.weight) >= 0).length;
    if (!doneCount) continue;
    const mapped = mapExerciseToMuscles(name);
    if (!mapped) continue; // unmapped exercises stay out of the banked figure
    for (const m of mapped.primary || []) bankedByMuscle[m] = (bankedByMuscle[m] || 0) + doneCount;
    for (const m of mapped.secondary || []) bankedByMuscle[m] = (bankedByMuscle[m] || 0) + doneCount * 0.5;
  }
  const report = buildVolumeReport(data);
  const banked = Object.entries(bankedByMuscle)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, sets]) => {
      const row = report?.ready ? report.rows.find((r) => r.key === key) : null;
      return {
        key, label: row?.label || key, today: Math.round(sets * 2) / 2,
        weekSets: row?.sets ?? null,
        weekNote: row ? `${row.sets} this week · ${row.landmarks.mev}–${row.landmarks.mrv} range` : null,
      };
    });

  // ── Skips, named honestly.
  const skips = exercises
    .filter(([, exData]) => exData?.skipped)
    .map(([name, exData]) => ({ name, reason: String(exData.skipped) }));

  // ── Headline: strict priority. ──
  let headline;
  if (prs.length) {
    headline = prs.length === 1 ? `PR: ${prs[0].name}.` : `${prs.length} PRs today.`;
  } else if (arrows.some((a) => a.dir === "↗")) {
    const up = arrows.find((a) => a.dir === "↗");
    headline = `Strength moving — ${up.name} ↗.`;
  } else if (tonnageDeltaPct !== null && tonnageDeltaPct >= 10) {
    headline = `Biggest ${todayName || "session"} in a while — up ${tonnageDeltaPct}%.`;
  } else if (priorSameDayKey === null && tonnage > 0) {
    headline = `First ${todayName || "session"} on record — the baseline is set.`;
  } else {
    headline = "Session banked.";
  }

  return {
    headline,
    tonnage,
    tonnageCompare: priorSameDayKey
      ? { priorDate: priorSameDayKey, priorTonnage, deltaPct: tonnageDeltaPct }
      : null,
    prs, arrows, banked, skips,
    method: priorSameDayKey
      ? `vs your last ${todayName || "same-day"} session · e1RM from straight sets only · secondaries count half`
      : "e1RM from straight sets only · secondaries count half",
  };
}

export default { buildBoxScore };
