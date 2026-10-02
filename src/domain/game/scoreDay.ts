// Scoring one day: what it earned and whether it kept the streak.
//
// The guards that make the economy safe all live here:
//   - XP saturates at the planned work; extra sets, second sessions and
//     training on a RECOVER or illness day earn nothing (records still save).
//   - An engine-scaled REDUCED day pays the same share as FULL.
//   - One engine RECOVER per rolling week pays the full share; later ones
//     pay the rest-day rate.
//   - Illness is protected but earns only the check-in.
//   - Pain credits remaining sets only after a completed set, for at most
//     two exercises a week.
//   - Records pay once a day, twice a week, never from extra work or on a
//     recovery day, and only once history is fully loaded.
//   - Sets completed more than 48 h after the day ended are history, not XP.
//   - Imported v19 days: a flat amount for any day with work.

import { endOfDayMs, type DateKey } from "../dates";
import type { DayMap, DayV2, ExerciseLog, QuestSnapshot, SetLog } from "../day/schema";
import type { ExerciseMeta } from "../exercise";
import type { ProgramDay } from "../program/types";
import { isCheckinCounted } from "../readiness/checkin";
import { didTrain } from "../readiness/loadGuard";
import { detectRecords, type RecordCandidate } from "../training/records";
import { completedPlannedSets } from "../training/sets";
import { XP } from "./config";
import { synthesizeQuest } from "./quest";
import type { DayResult, XpLine } from "./types";

/** Rolling-window state the fold carries into each day. */
export interface ScoreContext {
  /** Engine RECOVER days that paid the full share, oldest first. */
  recoverPaidOn: DateKey[];
  /** `${dateKey}:${exerciseId}` of pain-credited exercises. */
  painCreditedOn: string[];
  /** Days a record earned XP, one entry per record. */
  recordXpOn: DateKey[];
}

export interface ScoreDayInput {
  dateKey: DateKey;
  day: DayV2 | undefined;
  /** The plan in force that day; null when there is no program. */
  planned: ProgramDay | null;
  plannedDaysPerWeek: number;
  /** Days strictly before dateKey, for records. */
  history: DayMap;
  context: ScoreContext;
  legacy: boolean;
  paused: boolean;
  /** False once the illness/pause allowance is used up. */
  allowanceLeft: boolean;
  historyComplete: boolean;
  utcOffsetMinutes: number;
  nowMs: number;
  metaFor: (log: ExerciseLog) => ExerciseMeta;
}

export const emptyContext = (): ScoreContext => ({ recoverPaidOn: [], painCreditedOn: [], recordXpOn: [] });

/** XP for one planned training day: the weekly pool split across planned days. */
export function trainingShare(plannedDaysPerWeek: number): number {
  const days = Math.max(1, Math.floor(plannedDaysPerWeek));
  return Math.round(XP.weeklyTrainingPool / days / XP.trainingShareStep) * XP.trainingShareStep;
}

export function trainingXp(share: number, completion: number): number {
  const c = Math.max(0, Math.min(1, completion));
  return Math.round(share * XP.completionWeight * c + (c >= XP.clearedThreshold - 1e-9 ? share * XP.clearBonusWeight : 0));
}

const DAY_MS = 86_400_000;

function withinWindow(dates: readonly string[], dateKey: DateKey, days: number): number {
  const from = new Date(endOfDayMs(dateKey) - days * DAY_MS).toISOString().slice(0, 10);
  return dates.filter((d) => d.slice(0, 10) >= from && d.slice(0, 10) < dateKey).length;
}

/** A set counts for XP unless it was completed after the late-logging window. */
function countsForXp(set: SetLog, closeMs: number): boolean {
  if (!set.completedAt) return true;
  const t = Date.parse(set.completedAt);
  return !Number.isFinite(t) || t <= closeMs;
}

function isPainFlagged(log: ExerciseLog): boolean {
  return log.skipped === "pain" || log.sets.some((s) => s.pain === true);
}

interface Completion {
  completedSets: number;
  plannedSets: number;
  cardioMinutes: number;
  plannedCardioMinutes: number;
  completion: number;
  painCredited: string[];
}

function completionOf(day: DayV2 | undefined, planned: QuestSnapshot["planned"], input: ScoreDayInput): Completion {
  const closeMs = endOfDayMs(input.dateKey, input.utcOffsetMinutes) + XP.lateLoggingHours * 3_600_000;
  const painCredited: string[] = [];
  let completedSets = 0;
  const painBudget = XP.painCreditPer7Days - withinWindow(input.context.painCreditedOn, input.dateKey, 7);
  for (const exercise of planned.exercises) {
    const log = day?.workout.exercises[exercise.id];
    if (!log || (log.skipped && log.skipped !== "pain")) continue;
    const timely: ExerciseLog = { ...log, sets: log.sets.filter((s) => countsForXp(s, closeMs)) };
    const done = Math.min(exercise.sets, completedPlannedSets(timely, exercise.sets, exercise.trackingMode));
    if (done > 0 && done < exercise.sets && isPainFlagged(log) && painCredited.length < painBudget) {
      painCredited.push(exercise.id);
      completedSets += exercise.sets;
    } else {
      completedSets += done;
    }
  }
  const plannedSets = planned.plannedSets;
  const plannedCardioMinutes = planned.cardioMinutes ?? 0;
  const cardioMinutes = (day?.workout.cardio ?? []).reduce((n, c) => n + (c.minutes ?? 0), 0);
  const parts: number[] = [];
  if (plannedSets > 0) parts.push(Math.min(1, completedSets / plannedSets));
  if (plannedCardioMinutes > 0) parts.push(Math.min(1, cardioMinutes / plannedCardioMinutes));
  const completion = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
  return { completedSets, plannedSets, cardioMinutes, plannedCardioMinutes, completion, painCredited };
}

function base(input: ScoreDayInput, partial: Partial<DayResult>): DayResult {
  return {
    dateKey: input.dateKey,
    status: "neutral",
    tier: null,
    engineIssued: false,
    isTrainingDay: false,
    illness: false,
    paused: false,
    legacy: false,
    completion: 0,
    completedSets: 0,
    plannedSets: 0,
    cardioMinutes: 0,
    plannedCardioMinutes: 0,
    cleared: false,
    checkinCounted: false,
    recoveryDone: false,
    painCredited: [],
    records: [],
    recordXp: [],
    lines: [],
    xp: 0,
    reason: "",
    ...partial,
  };
}

function total(lines: XpLine[]): number {
  return lines.reduce((n, l) => n + l.xp, 0);
}

function recordsFor(input: ScoreDayInput, tier: DayResult["tier"], lines: XpLine[]): Pick<DayResult, "records" | "recordXp"> {
  if (!input.day) return { records: [], recordXp: [] };
  const records = detectRecords({ dateKey: input.dateKey, day: input.day, history: input.history, metaFor: input.metaFor, units: "metric" });
  if (!input.historyComplete || (tier !== "FULL" && tier !== "REDUCED")) return { records, recordXp: [] };
  const weekUsed = withinWindow(input.context.recordXpOn, input.dateKey, 7);
  let budget = Math.max(0, Math.min(XP.recordsPerDay, XP.recordsPer7Days - weekUsed));
  const recordXp: RecordCandidate[] = [];
  for (const r of records) {
    if (budget === 0) break;
    if (!r.isRecord || r.fromExtraWork || r.baseline || r.priorExposures < XP.recordMinPriorExposures) continue;
    recordXp.push(r);
    lines.push({ key: "record", label: `Record · ${r.name}`, xp: XP.record });
    budget -= 1;
  }
  return { records, recordXp };
}

export function scoreDay(input: ScoreDayInput): DayResult {
  const { day, planned, dateKey } = input;
  const checkinCounted = isCheckinCounted(day?.checkin);
  const lines: XpLine[] = [];
  if (checkinCounted) lines.push({ key: "checkin", label: "Status check", xp: XP.checkin });

  if (input.legacy) {
    if (!day || !didTrain(day)) return base(input, { legacy: true, status: "neutral", checkinCounted, lines: [], xp: 0 });
    lines.push({ key: "legacy", label: "Training (imported)", xp: XP.legacyTrainingDay });
    return base(input, { legacy: true, status: "kept", cleared: true, isTrainingDay: true, checkinCounted, lines, xp: total(lines), reason: "Imported from the previous version." });
  }

  if (input.paused && input.allowanceLeft) {
    return base(input, { paused: true, status: "protected", checkinCounted, lines, xp: total(lines), reason: "Training paused." });
  }

  if (!planned) return base(input, { status: "neutral", checkinCounted, lines, xp: total(lines) });

  const illness = day?.checkin.illness === true;
  if (illness && input.allowanceLeft) {
    const { records } = recordsFor(input, "RECOVER", []);
    return base(input, {
      status: "protected", tier: planned.rest ? "REST" : "RECOVER", illness: true, isTrainingDay: !planned.rest,
      checkinCounted, recoveryDone: day?.quest?.recoveryDone === true, records, lines, xp: total(lines),
      reason: "Ill or injured: rest today. Streak protected.",
    });
  }

  const snapshot = day?.quest ?? synthesizeQuest(planned, dateKey);
  const tier = snapshot.tier;
  const recoveryDone = snapshot.recoveryDone === true;
  const closeMs = endOfDayMs(dateKey, input.utcOffsetMinutes) + XP.lateLoggingHours * 3_600_000;
  const windowClosed = input.nowMs > closeMs;

  if (tier === "REST") {
    if (recoveryDone) lines.push({ key: "rest", label: "Recovery", xp: XP.restDay });
    const { records } = recordsFor(input, tier, []);
    return base(input, { status: "kept", tier, engineIssued: snapshot.engineIssued, cleared: true, checkinCounted, recoveryDone, records, lines, xp: total(lines), reason: snapshot.reason });
  }

  const share = trainingShare(input.plannedDaysPerWeek);

  if (tier === "RECOVER") {
    const paidThisWeek = withinWindow(input.context.recoverPaidOn, dateKey, 7);
    const fullPay = snapshot.engineIssued && paidThisWeek < XP.recoverFullPayPer7Days;
    if (recoveryDone) lines.push({ key: "recovery", label: "Recovery", xp: fullPay ? share : XP.restDay });
    const { records } = recordsFor(input, tier, []);
    const status = recoveryDone ? "kept" : windowClosed ? "missed" : "open";
    return base(input, {
      status, tier, engineIssued: snapshot.engineIssued, isTrainingDay: true, cleared: recoveryDone, checkinCounted, recoveryDone,
      records, lines, xp: total(lines), reason: snapshot.reason,
    });
  }

  const c = completionOf(day, snapshot.planned, input);
  const cleared = c.completion >= XP.clearedThreshold - 1e-9 && (c.plannedSets > 0 || c.plannedCardioMinutes > 0);
  const xpTraining = c.plannedSets > 0 || c.plannedCardioMinutes > 0 ? trainingXp(share, c.completion) : 0;
  if (xpTraining > 0) lines.push({ key: "training", label: `Training · ${c.completedSets} / ${c.plannedSets} sets`, xp: xpTraining });
  const { records, recordXp } = recordsFor(input, tier, lines);
  const status = cleared ? "kept" : windowClosed ? "missed" : "open";
  return base(input, {
    status, tier, engineIssued: snapshot.engineIssued, isTrainingDay: true,
    completion: c.completion, completedSets: c.completedSets, plannedSets: c.plannedSets,
    cardioMinutes: c.cardioMinutes, plannedCardioMinutes: c.plannedCardioMinutes,
    cleared, checkinCounted, recoveryDone, painCredited: c.painCredited, records, recordXp,
    lines, xp: total(lines), reason: snapshot.reason,
  });
}

/** Carry a scored day into the rolling windows. */
export function advanceContext(context: ScoreContext, result: DayResult): ScoreContext {
  const next: ScoreContext = {
    recoverPaidOn: context.recoverPaidOn.slice(),
    painCreditedOn: context.painCreditedOn.slice(),
    recordXpOn: context.recordXpOn.slice(),
  };
  if (result.tier === "RECOVER" && result.engineIssued && result.recoveryDone && result.lines.some((l) => l.key === "recovery" && l.xp > XP.restDay)) {
    next.recoverPaidOn.push(result.dateKey);
  }
  for (const id of result.painCredited) next.painCreditedOn.push(`${result.dateKey}:${id}`);
  for (let i = 0; i < result.recordXp.length; i += 1) next.recordXpOn.push(result.dateKey);
  return next;
}
