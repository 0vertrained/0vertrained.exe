// What the Quest tab shows, read from the engine's output: the day's tier
// and reason, the objective rows with their XP, the one primary action, the
// week strip and the single notice. Pure, so the screen is a renderer.
import { addDays, compareKeys, dateRange, weekdayName, weekStart, type DateKey } from "../../domain/dates";
import type { DayMap, DayV2, QuestSnapshot, Tier } from "../../domain/day/schema";
import { STREAK, XP } from "../../domain/game/config";
import { nextAction, synthesizeQuest } from "../../domain/game/quest";
import { trainingShare } from "../../domain/game/scoreDay";
import type { DayResult, NextAction, Progress } from "../../domain/game/types";
import { plannedDay, revisionAt, trainingDaysPerWeek } from "../../domain/program/revisions";
import type { ProgramDay, ProgramPayloadV2 } from "../../domain/program/types";

export type ObjectiveState = "not-started" | "in-progress" | "done";

export interface QuestObjective {
  key: "checkin" | "training" | "cardio" | "recovery";
  label: string;
  sublabel?: string;
  state: ObjectiveState;
  progress?: { done: number; total: number; unit: string } | string;
  xp?: number;
}

export type DayMarkerState = "kept" | "rest" | "protected" | "open" | "missed" | "upcoming";

export interface DayMarker {
  dateKey: DateKey;
  label: string;
  name: string;
  state: DayMarkerState;
  today: boolean;
  xp?: number;
}

export interface WeeklyRow {
  label: string;
  progress: string;
  xp: number;
  value: number;
}

export interface QuestNotice {
  tag: "RANK TRIAL" | "SHIELD" | "PAUSED" | "REST" | "QUEST";
  text: string;
  action?: "trial";
}

export interface QuestView {
  tier: Tier;
  reason: string;
  /** What the day pays when every objective is met (records aside). */
  potentialXp: number;
  issued: boolean;
  planned: ProgramDay | null;
  objectives: QuestObjective[];
  action: NextAction;
  days: DayMarker[];
  weekly: WeeklyRow | null;
  notice: QuestNotice | null;
  /** Illness and pause days left in the rolling 90-day allowance. */
  allowanceLeft: number;
}

export interface QuestViewInput {
  progress: Progress;
  todayKey: DateKey;
  day: DayV2 | undefined;
  days: DayMap;
  program: ProgramPayloadV2 | null;
}

function objectiveState(done: number, total: number): ObjectiveState {
  if (total > 0 && done >= total) return "done";
  return done > 0 ? "in-progress" : "not-started";
}

function markerState(result: DayResult | undefined, key: DateKey, todayKey: DateKey): DayMarkerState {
  if (compareKeys(key, todayKey) > 0 || !result) return "upcoming";
  switch (result.status) {
    case "kept":
      return result.tier === "REST" || result.tier === "RECOVER" ? "rest" : "kept";
    case "protected":
      return "protected";
    case "missed":
      return "missed";
    case "open":
      return "open";
    default:
      return "upcoming";
  }
}

export function allowanceLeft(progress: Progress, todayKey: DateKey): number {
  const from = addDays(todayKey, -STREAK.pauseWindowDays);
  const used = Object.values(progress.days).filter((r) => r.status === "protected" && compareKeys(r.dateKey, from) >= 0).length;
  return Math.max(0, STREAK.pauseAllowanceDays - used);
}

export function questView({ progress, todayKey, day, program }: QuestViewInput): QuestView {
  const planned = program ? plannedDay(program, todayKey) : null;
  const share = program ? trainingShare(trainingDaysPerWeek(revisionAt(program, todayKey).week)) : 0;
  const quest: QuestSnapshot | null = day?.quest ?? (planned ? synthesizeQuest(planned, todayKey) : null);
  const result = progress.today;
  const tier: Tier = quest?.tier ?? result.tier ?? "REST";
  const action = nextAction(result, day);

  const ill = result.illness || day?.checkin.illness === true;
  const objectives: QuestObjective[] = [{ key: "checkin", label: "Status check", state: result.checkinCounted || ill ? "done" : "not-started", ...(ill && !result.checkinCounted ? {} : { xp: XP.checkin }) }];
  let potentialXp = ill && !result.checkinCounted ? 0 : XP.checkin;
  if (ill) {
    // Protected: nothing else is asked of the day.
  } else if ((tier === "FULL" || tier === "REDUCED") && quest) {
    const plannedSets = quest.planned.plannedSets;
    if (plannedSets > 0) {
      objectives.push({
        key: "training",
        label: "Training",
        ...(planned?.title ? { sublabel: planned.title } : {}),
        state: objectiveState(result.completedSets, plannedSets),
        progress: { done: result.completedSets, total: plannedSets, unit: "sets" },
        xp: share,
      });
    }
    const cardio = quest.planned.cardioMinutes ?? 0;
    if (cardio > 0) {
      objectives.push({
        key: "cardio",
        label: quest.planned.cardioKind ?? planned?.cardio?.kind ?? "Cardio",
        state: objectiveState(Math.min(result.cardioMinutes, cardio), cardio),
        progress: `${cardio} min`,
        ...(plannedSets === 0 ? { xp: share } : {}),
      });
    }
    potentialXp += share;
  } else if (tier === "REST" || tier === "RECOVER") {
    const engineRecover = tier === "RECOVER" && quest?.engineIssued === true && !result.illness;
    const xp = engineRecover ? share : XP.restDay;
    objectives.push({
      key: "recovery",
      label: "Recovery",
      sublabel: engineRecover ? "A 20-minute walk or 10 minutes of mobility" : "A short walk or some mobility",
      state: result.recoveryDone ? "done" : "not-started",
      xp,
    });
    potentialXp += xp;
  }

  const monday = weekStart(todayKey);
  const days: DayMarker[] = dateRange(monday, addDays(monday, 6)).map((key) => {
    const r = progress.days[key];
    const state = markerState(r, key, todayKey);
    return { dateKey: key, label: weekdayName(key).charAt(0), name: weekdayName(key), state, today: key === todayKey, ...(r && r.xp > 0 ? { xp: r.xp } : {}) };
  });
  const week = progress.weeks.find((w) => w.weekStart === monday);
  const training = week?.objectives.find((o) => o.key === "training");
  const weekly: WeeklyRow | null = week && training
    ? { label: "Weekly quest", progress: `${training.done}/${training.target} cleared`, xp: week.closed ? week.xp : XP.weeklyObjective * 2 + XP.weeklyBothBonus, value: training.target ? Math.min(1, training.done / training.target) : 0 }
    : null;

  let notice: QuestNotice | null = null;
  const shieldThisWeek = progress.streak.shieldUsedOn.find((d) => compareKeys(d, monday) >= 0 && compareKeys(d, todayKey) <= 0);
  if (result.paused) notice = { tag: "PAUSED", text: `Training paused. ${allowanceLeft(progress, todayKey)} pause days left this quarter.` };
  else if (progress.trial) notice = { tag: "RANK TRIAL", text: `Available: ${progress.trial.spec}`, action: "trial" };
  else if (shieldThisWeek) notice = { tag: "SHIELD", text: `Shield used on ${weekdayName(shieldThisWeek)}. Streak kept: ${progress.streak.current} days.` };
  else if (tier === "REST") notice = { tag: "REST", text: "Rest day. Recovery done pays in full." };

  return { tier, reason: quest?.reason ?? result.reason, potentialXp, issued: day?.quest !== undefined, planned, objectives, action, days, weekly, notice, allowanceLeft: allowanceLeft(progress, todayKey) };
}
