// buildProgress: the whole game state as one pure fold over the athlete's
// days, the program's revisions and their settings. XP, level, stats,
// streak and achievements are derived every time; only promotions, passed
// trials and unlocked achievements are high-water marks the caller writes
// back (settings.game.high), so an edit, a delete or a rule change can
// never take those away.

import { addDays, compareKeys, dateRange, diffDays, endOfDayMs, weekStart, type DateKey } from "../dates";
import { plannedDay, revisionAt, trainingDaysPerWeek } from "../program/revisions";
import { RecordLedger } from "../training/records";
import { achievementXp, evaluateAchievements, newlyUnlocked, titlesUnlocked } from "./achievements";
import { RANK_ORDER, RULES_VERSION, STREAK, TITLE_COUNT, XP } from "./config";
import { levelProgress } from "./levels";
import { deriveRank, displayedRank, nextRank as nextRankFor, rankTitle } from "./ranks";
import { advanceContext, emptyContext, scoreDay, type ScoreContext } from "./scoreDay";
import { computeStats } from "./stats";
import { foldStreak } from "./streak";
import { trialAllowedOn, trialFor } from "./trials";
import type { DayResult, GameHigh, Progress, ProgressInput, Rank, TrialSpec, WeeklyResult } from "./types";
import { scoreWeek } from "./weekly";

const higherRank = (a: Rank, b: Rank): Rank => (RANK_ORDER.indexOf(a) >= RANK_ORDER.indexOf(b) ? a : b);

function isPaused(settings: ProgressInput["settings"], key: DateKey): boolean {
  return (settings.pauses ?? []).some((p) => compareKeys(p.from, key) <= 0 && compareKeys(key, p.to) <= 0);
}

/** First day the fold judges: the game start, or older imported history. */
function firstKey(input: ProgressInput): DateKey {
  const keys = Object.keys(input.days).sort(compareKeys);
  const earliestEntry = keys[0];
  const start = input.settings.startedOn ?? earliestEntry ?? input.todayKey;
  const first = earliestEntry && compareKeys(earliestEntry, start) < 0 ? earliestEntry : start;
  return compareKeys(first, input.todayKey) <= 0 ? first : input.todayKey;
}

export function buildProgress(input: ProgressInput): Progress {
  const { days, program, settings, todayKey, metaFor } = input;
  const historyComplete = input.historyComplete !== false;
  const utcOffsetMinutes = input.utcOffsetMinutes ?? 0;
  const nowMs = input.nowMs ?? endOfDayMs(todayKey, utcOffsetMinutes);
  const units = input.units ?? "metric";
  const startedOn = settings.startedOn ?? firstKey(input);
  const importedThrough = settings.importedThrough;

  // Records compare each day against the work before it; the ledger carries that forward.
  const ledger = new RecordLedger();

  const results: Record<DateKey, DayResult> = {};
  const ordered: DayResult[] = [];
  const protectedOn: DateKey[] = [];
  let context: ScoreContext = emptyContext();

  for (const key of dateRange(firstKey(input), todayKey)) {
    const day = days[key];
    const legacy = importedThrough !== undefined && compareKeys(key, importedThrough) <= 0;
    const beforeStart = compareKeys(key, startedOn) < 0;
    if (beforeStart && !day) continue;
    const allowanceStart = addDays(key, -STREAK.pauseWindowDays);
    const allowanceLeft = protectedOn.filter((d) => compareKeys(d, allowanceStart) >= 0).length < STREAK.pauseAllowanceDays;
    const revision = program ? revisionAt(program, key) : null;
    const result = scoreDay({
      dateKey: key, day, planned: program ? plannedDay(program, key) : null,
      plannedDaysPerWeek: revision ? trainingDaysPerWeek(revision.week) : 0,
      history: days, prior: ledger, context, legacy, paused: isPaused(settings, key), allowanceLeft,
      historyComplete, utcOffsetMinutes, nowMs, metaFor,
    });
    if (result.status === "protected") protectedOn.push(key);
    results[key] = result;
    ordered.push(result);
    context = advanceContext(context, result);
    if (day) ledger.add(day);
  }
  const today = results[todayKey] ?? ordered[ordered.length - 1] ?? scoreDay({
    dateKey: todayKey, day: undefined, planned: null, plannedDaysPerWeek: 0, history: {}, context, legacy: false, paused: false,
    allowanceLeft: true, historyComplete, utcOffsetMinutes, nowMs, metaFor,
  });

  const streak = foldStreak(ordered);
  const keptDays = ordered.filter((r) => r.status === "kept").length;

  const weeks: WeeklyResult[] = [];
  if (program) {
    for (let monday = weekStart(startedOn); compareKeys(monday, todayKey) <= 0; monday = addDays(monday, 7)) {
      const plannedTrainingDays = dateRange(monday, addDays(monday, 6))
        .filter((k) => compareKeys(k, startedOn) >= 0 && !plannedDay(program, k).rest).length;
      weeks.push(scoreWeek({ weekStart: monday, plannedTrainingDays, results, todayKey }));
    }
  }
  const qualifyingWeeks = weeks.filter((w) => w.qualifying).length;

  const stats = computeStats({ days, todayKey, results, settings: { ...settings, startedOn }, metaFor });

  // Passed trials: persisted high-water marks plus any judged on a day.
  const high: Partial<GameHigh> = settings.high ?? {};
  const trialsPassed = [...(high.trialsPassed ?? [])];
  for (const [key, day] of Object.entries(days)) {
    const t = day.quest?.trial;
    if (t?.passed && !trialsPassed.some((p) => p.rank === t.targetRank)) trialsPassed.push({ rank: t.targetRank as Rank, date: key });
  }
  trialsPassed.sort((a, b) => compareKeys(a.date, b.date));

  const recordCount = ordered.reduce((n, r) => n + r.records.filter((x) => x.isRecord && !x.fromExtraWork).length, 0);
  const longestCardioMinutes = Object.values(days).reduce((best, d) => Math.max(best, ...d.workout.cardio.map((c) => c.minutes ?? 0)), 0);
  const achievements = evaluateAchievements({ results, streak, weeks, recordCount, high, longestCardioMinutes });
  const unlockedIds = achievements.filter((a) => a.unlocked).map((a) => a.id);

  const xp = ordered.reduce((n, r) => n + r.xp, 0)
    + weeks.reduce((n, w) => n + w.xp, 0)
    + trialsPassed.length * XP.rankTrial
    + achievementXp(unlockedIds);
  const lp = levelProgress(xp);

  const rankInput = { level: lp.level, qualifyingWeeks, keptDays, stats, trialsPassed };
  const derivedRank = deriveRank(rankInput);
  const rank = displayedRank(derivedRank, high);
  const next = nextRankFor(rank, rankInput);

  let trial: TrialSpec | null = null;
  if (next.trialAvailable && next.rank && historyComplete) {
    const last = trialsPassed[trialsPassed.length - 1]?.date;
    const lastAttempt = Object.entries(days).filter(([, d]) => d.quest?.trial).map(([k]) => k).sort(compareKeys).pop();
    const since = [last, lastAttempt].filter((d): d is DateKey => Boolean(d)).sort(compareKeys).pop();
    if (trialAllowedOn(since, todayKey)) trial = trialFor({ targetRank: next.rank, days, todayKey, metaFor, units });
  }

  const newHighs: Partial<GameHigh> = {};
  if (!high.rank || higherRank(rank, high.rank) !== high.rank) newHighs.rank = rank;
  const knownTrials = new Set((high.trialsPassed ?? []).map((t) => t.rank));
  if (trialsPassed.some((t) => !knownTrials.has(t.rank))) newHighs.trialsPassed = trialsPassed;
  const fresh = newlyUnlocked(achievements, high);
  if (fresh.length) newHighs.achievements = [...new Set([...(high.achievements ?? []), ...unlockedIds])];

  return {
    status: historyComplete ? "ready" : "loading-history",
    rulesVersion: RULES_VERSION,
    xp,
    level: lp.level,
    levelProgress: { into: lp.into, needed: lp.needed, fraction: lp.fraction },
    rank,
    derivedRank,
    rankTitle: rankTitle(rank),
    nextRank: next,
    stats,
    streak,
    qualifyingWeeks,
    keptDays,
    weeks,
    achievements,
    titles: { unlocked: titlesUnlocked(achievements, rank), total: TITLE_COUNT },
    days: results,
    today,
    trial,
    newHighs,
  };
}

/** Days since the game started, for "calibrating" copy and the VIT window. */
export function daysSinceStart(settings: ProgressInput["settings"], todayKey: DateKey): number | null {
  return settings.startedOn ? diffDays(settings.startedOn, todayKey) + 1 : null;
}
