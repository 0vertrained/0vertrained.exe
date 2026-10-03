// Issuing the Daily Quest: the one place that decides what today asks for.
// The tier comes from readiness (check-in + load guard, caution-only), the
// plan from the program revision in force, and the result is frozen on the
// day as a QuestSnapshot the moment it is issued, so later program or rule
// changes never re-judge a day that already happened.

import type { DateKey } from "../dates";
import type { CheckIn, DayMap, DayV2, PlannedExercise, QuestSnapshot, Tier } from "../day/schema";
import type { ProgramDay } from "../program/types";
import { plannedCardioMinutes, plannedSetsForDay } from "../program/revisions";
import { isCheckinCounted } from "../readiness/checkin";
import { loadGuard } from "../readiness/loadGuard";
import { decideTier, type TierDecision } from "../readiness/tier";
import { REDUCED, RULES_VERSION } from "./config";
import type { DayResult, NextAction, TrialSpec } from "./types";

export interface IssueQuestInput {
  dateKey: DateKey;
  programDay: ProgramDay;
  plannedWeeklySets: number;
  plannedWeeklyCardioMinutes: number;
  checkin?: CheckIn;
  /** History for the load guard (today's own entry is ignored by it). */
  days: DayMap;
  issuedAt: string;
  /** A Rank Trial waiting for a FULL day with its exercise. */
  trial?: TrialSpec | null;
}

export function scaleReduced(day: ProgramDay): { exercises: PlannedExercise[]; cardioMinutes: number | null } {
  const exercises = day.lifting.map((lift) => ({
    id: lift.id,
    name: lift.name,
    ...(lift.libraryId ? { libraryId: lift.libraryId } : {}),
    sets: Math.max(REDUCED.minSetsPerLift, lift.sets - REDUCED.setsPerLiftMinus),
    reps: lift.reps,
    trackingMode: lift.trackingMode,
  }));
  const planned = plannedCardioMinutes(day.cardio);
  const cardioMinutes = planned > 0 ? Math.max(REDUCED.cardioRoundMinutes, Math.round((planned * REDUCED.cardioFactor) / REDUCED.cardioRoundMinutes) * REDUCED.cardioRoundMinutes) : null;
  return { exercises, cardioMinutes };
}

function fullPlan(day: ProgramDay): { exercises: PlannedExercise[]; cardioMinutes: number | null } {
  const exercises = day.lifting.map((lift) => ({
    id: lift.id,
    name: lift.name,
    ...(lift.libraryId ? { libraryId: lift.libraryId } : {}),
    sets: lift.sets,
    reps: lift.reps,
    trackingMode: lift.trackingMode,
  }));
  const planned = plannedCardioMinutes(day.cardio);
  return { exercises, cardioMinutes: planned > 0 ? planned : null };
}

/** The reason line under the tier badge. */
export function questReason(decision: TierDecision, day: ProgramDay): string {
  const lifts = day.lifting.length;
  const sets = plannedSetsForDay(day);
  const cardio = plannedCardioMinutes(day.cardio);
  const parts: string[] = [];
  if (lifts > 0) parts.push(`${day.title}, ${lifts} ${lifts === 1 ? "exercise" : "exercises"}, ${sets} sets`);
  if (cardio > 0) parts.push(`${day.cardio?.kind ?? "cardio"} ${cardio} min`);
  const plan = parts.join(" · ");
  switch (decision.tier) {
    case "REST":
      return decision.illness ? "Rest day. Ill or injured: streak protected." : "Rest day. A walk or some mobility keeps the streak.";
    case "RECOVER":
      return decision.illness
        ? "Ill or injured: rest today. Streak protected."
        : `${decision.reason}: recovery day. A 20-minute walk or 10 minutes of mobility clears it. Same XP.`;
    case "REDUCED":
      return `${decision.reason}: Reduced quest. One set less per lift${cardio > 0 ? ", shorter cardio" : ""}. Same XP.`;
    default:
      return `Full quest. ${plan}.`;
  }
}

export function issueDailyQuest(input: IssueQuestInput): QuestSnapshot {
  const guard = loadGuard({
    days: input.days,
    todayKey: input.dateKey,
    plannedWeeklySets: input.plannedWeeklySets,
    plannedWeeklyCardioMinutes: input.plannedWeeklyCardioMinutes,
  });
  const decision = decideTier({ isRestDay: input.programDay.rest, checkin: input.checkin, caps: [guard.cap] });
  const tier: Tier = decision.tier;
  const plan = tier === "FULL" ? fullPlan(input.programDay) : tier === "REDUCED" ? scaleReduced(input.programDay) : { exercises: [], cardioMinutes: null };
  const snapshot: QuestSnapshot = {
    rulesVersion: RULES_VERSION,
    tier,
    reason: questReason(decision, input.programDay),
    issuedAt: input.issuedAt,
    engineIssued: true,
    planned: {
      exercises: plan.exercises,
      plannedSets: plan.exercises.reduce((n, e) => n + e.sets, 0),
      cardioMinutes: plan.cardioMinutes,
      ...(input.programDay.cardio?.kind ? { cardioKind: input.programDay.cardio.kind } : {}),
    },
  };
  const trial = input.trial;
  if (trial && tier === "FULL" && (trial.kind === "cardio" ? plan.cardioMinutes !== null : plan.exercises.some((e) => e.id === trial.exerciseId))) {
    snapshot.trial = { targetRank: trial.targetRank, exerciseId: trial.exerciseId ?? "cardio", spec: trial.spec };
  }
  return snapshot;
}

/**
 * A snapshot for a day that never had one issued: a past-day edit, or
 * scoring today before the app opened. Always FULL (illness is read from the
 * check-in at scoring time), never a trial.
 */
export function synthesizeQuest(day: ProgramDay, dateKey: DateKey): QuestSnapshot {
  const plan = day.rest ? { exercises: [], cardioMinutes: null } : fullPlan(day);
  return {
    rulesVersion: RULES_VERSION,
    tier: day.rest ? "REST" : "FULL",
    reason: day.rest ? "Rest day." : `Full quest. ${day.title}.`,
    issuedAt: `${dateKey}T00:00:00.000Z`,
    engineIssued: false,
    planned: { exercises: plan.exercises, plannedSets: plan.exercises.reduce((n, e) => n + e.sets, 0), cardioMinutes: plan.cardioMinutes },
  };
}

/** The single primary action on the Quest screen. */
export function nextAction(result: DayResult, day: DayV2 | undefined): NextAction {
  if (result.paused) return { key: "paused", label: "Training paused", primary: false };
  if (result.status === "neutral" && !result.isTrainingDay && result.tier === null) return { key: "none", label: "", primary: false };
  const ill = result.illness || day?.checkin.illness === true;
  if (!result.checkinCounted && !isCheckinCounted(day?.checkin) && !ill) return { key: "checkin", label: "Check in", primary: true };
  // Ill or injured: the day is protected and asks nothing more.
  if (ill) return { key: "none", label: "", primary: false };
  const claimed = day?.quest?.claimedAt !== undefined;
  const claimedLabel = { key: "cleared" as const, label: `${result.cleared ? "Quest cleared" : "Quest claimed"} · +${result.xp} XP`, primary: false };
  if (result.tier === "REST" || result.tier === "RECOVER") {
    if (result.recoveryDone) return claimed ? claimedLabel : { key: "claim", label: "Claim rewards", primary: true };
    return { key: "recovery", label: "Mark recovery done", primary: true };
  }
  if (claimed) return claimedLabel;
  if (result.cleared) return { key: "claim", label: "Claim rewards", primary: true };
  const finished = day?.workout.completedAt !== undefined;
  if (result.plannedSets > 0 && result.completedSets < result.plannedSets && !finished) {
    if (result.completedSets === 0) return { key: "begin", label: "Begin quest", primary: true };
    return { key: "continue", label: `Continue · ${result.completedSets} / ${result.plannedSets}`, primary: true };
  }
  if (result.plannedCardioMinutes > 0 && result.cardioMinutes < result.plannedCardioMinutes && !finished) return { key: "cardio", label: "Log cardio", primary: true };
  if (finished || result.completedSets > 0 || result.cardioMinutes > 0) return { key: "claim", label: "Claim rewards", primary: true };
  if (result.plannedCardioMinutes > 0) return { key: "cardio", label: "Log cardio", primary: true };
  return { key: "none", label: "", primary: false };
}
