// src/coachCalibration.js
// Coach calibration report — closes the loop between the daily decision
// (call + the athlete's Followed/Modified/Ignored/Skipped response, persisted
// at intelligence.todayDecisionResponse) and next-day recovery. Pure display:
// reads entries, computes averages, renders nothing itself and changes no
// scoring. Honest by construction — surfaces sample sizes, requires a minimum
// n before claiming anything, and labels results as association, not proof.

import { calcRecoveryScore } from "./recovery";

const MIN_SAMPLES = 3;

function nextDayKey(dateKey) {
  const d = new Date(dateKey + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Collect (call, response, nextDayRecoveryScore) samples from entries.
// Next-day recovery uses the same canonical manual scorer the app already
// uses (calcRecoveryScore) — no new scoring introduced here.
export function collectCalibrationSamples(data) {
  if (!data) return [];
  const samples = [];
  for (const dateKey of Object.keys(data)) {
    const resp = data[dateKey]?.intelligence?.todayDecisionResponse;
    if (!resp?.response || !resp?.decisionCall) continue;
    const nk = nextDayKey(dateKey);
    const nextDay = data[nk];
    if (!nextDay) continue;
    const rec = calcRecoveryScore(nextDay, data, nk);
    if (!rec || !Number.isFinite(Number(rec.score))) continue;
    samples.push({
      date: dateKey,
      call: resp.decisionCall,
      response: resp.response,
      followed: resp.response === "followed",
      nextScore: Number(rec.score),
    });
  }
  return samples.sort((a, b) => a.date.localeCompare(b.date));
}

export function buildCalibrationReport(data, { windowDays = 60 } = {}) {
  const all = collectCalibrationSamples(data);
  const cutoff = (() => {
    const d = new Date();
    d.setDate(d.getDate() - windowDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const samples = all.filter(s => s.date >= cutoff);

  if (samples.length < MIN_SAMPLES) {
    return {
      ready: false,
      sampleCount: samples.length,
      needed: MIN_SAMPLES,
      note: `Building history — ${samples.length}/${MIN_SAMPLES} decision responses with a next-day check-in. Respond to the daily call and log the next morning to unlock this.`,
    };
  }

  const avg = (arr) => arr.length ? Math.round((arr.reduce((t, s) => t + s.nextScore, 0) / arr.length) * 10) / 10 : null;
  const baseline = avg(samples);

  const followed = samples.filter(s => s.followed);
  const notFollowed = samples.filter(s => !s.followed);

  // Per-call breakdown, only for calls with enough samples to be honest.
  const calls = {};
  for (const s of samples) {
    (calls[s.call] = calls[s.call] || []).push(s);
  }
  const rows = Object.entries(calls)
    .map(([call, list]) => {
      const f = list.filter(s => s.followed);
      return {
        call,
        n: list.length,
        followedN: f.length,
        avgNextFollowed: avg(f),
        avgNextAll: avg(list),
        thin: f.length < MIN_SAMPLES,
      };
    })
    .sort((a, b) => b.n - a.n);

  const followRate = Math.round((followed.length / samples.length) * 100);
  const followedAvg = avg(followed);
  const notFollowedAvg = avg(notFollowed);
  const delta = followedAvg !== null && notFollowedAvg !== null
    ? Math.round((followedAvg - notFollowedAvg) * 10) / 10
    : null;

  return {
    ready: true,
    windowDays,
    sampleCount: samples.length,
    baseline,
    followRate,
    followedN: followed.length,
    notFollowedN: notFollowed.length,
    followedAvg,
    notFollowedAvg,
    delta,
    rows,
    caveat: `n=${samples.length} responded days in the last ${windowDays} — association, not proof. Next-day score is your manual check-in via the app's standard recovery scorer.`,
  };
}
