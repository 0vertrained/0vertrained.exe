// The quest log, pure: the rows the Stats panel and the log screen list
// (newest first, only days the engine judged or paid), the day-detail
// sheet's content read from one DayResult and its stored entry, and what
// deleting a day would do to XP and the streak, found by folding the data
// twice, with and without it. Nothing here touches React or the clock.
import { compareKeys, weekdayName, type DateKey } from "../../domain/dates";
import type { CardioLog, CheckIn, DayMap, DayV2, ExerciseLog, SkipReason, Tier } from "../../domain/day/schema";
import type { ExerciseMeta } from "../../domain/exercise";
import { buildProgress } from "../../domain/game/progress";
import type { DayResult, GameSettings, Progress } from "../../domain/game/types";
import type { ProgramPayloadV2 } from "../../domain/program/types";
import { CHECKIN_ROWS, selectedOption } from "../../domain/readiness/checkin";
import { performedName } from "../../domain/training/history";
import { describeSet, modeOf } from "../../domain/training/sets";
import { formatDistance, type UnitSystem } from "../../domain/units";
import { recordView } from "../clear/clearModel";

export type MetaFor = (log: ExerciseLog) => ExerciseMeta;

/** Rows per page of the log. */
export const LOG_PAGE = 20;

export type StatusWord = "Cleared" | "Kept" | "Missed" | "Protected" | "Open" | "Rest" | "Logged";

export interface LogRow {
  dateKey: DateKey;
  /** "Fri 2 Oct" */
  dateText: string;
  tier: Tier | null;
  statusWord: StatusWord;
  xp: number;
}

export interface LogPage {
  limit: number;
  offset?: number;
}

export interface DetailLine {
  label: string;
  xp: number;
}

export interface DetailExercise {
  /** The movement performed (the swap, when there was one). */
  name: string;
  skipped?: SkipReason;
  /** One label per completed set: "60 × 8", "45 s", "BW × 12". */
  sets: string[];
  pain: boolean;
}

export interface DetailCardio {
  kind: string;
  minutes: number | null;
  km: number | null;
  /** "25 min · 3 km" in the athlete's units. */
  text: string;
}

export interface DayDetail {
  dateKey: DateKey;
  dateText: string;
  tier: Tier | null;
  statusWord: StatusWord;
  reason: string;
  lines: DetailLine[];
  exercises: DetailExercise[];
  cardio: DetailCardio[];
  /** "Slept fine", "Sore some", … and "Ill or injured" when flagged. */
  checkin: string[];
  note?: string;
  /** One sentence per record set that day. */
  records: string[];
  /** The day has a stored entry: something to delete. */
  hasEntry: boolean;
}

export interface DeleteImpactInput {
  days: DayMap;
  program: ProgramPayloadV2 | null;
  settings: GameSettings;
  todayKey: DateKey;
  units: UnitSystem;
  metaFor: MetaFor;
  dateKey: DateKey;
  utcOffsetMinutes?: number;
  historyComplete?: boolean;
}

export interface DeleteImpact {
  xpBefore: number;
  xpAfter: number;
  /** xpAfter − xpBefore: zero or negative. */
  delta: number;
  streakBefore: number;
  streakAfter: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Fri 2 Oct": short and local, built from the key so every device reads the same. */
export function shortDate(key: DateKey): string {
  const [, month, day] = key.split("-").map(Number);
  return `${weekdayName(key).slice(0, 3)} ${day ?? 1} ${MONTHS[(month ?? 1) - 1] ?? ""}`;
}

/** Digits with grouped thousands: 6770 → "6,770". */
export const groupDigits = (n: number): string => n.toLocaleString("en-US");

/** The row's one word: judged days by their status, a rest day as "Rest". */
export function statusWord(result: DayResult): StatusWord {
  switch (result.status) {
    case "protected":
      return "Protected";
    case "missed":
      return "Missed";
    case "open":
      return "Open";
    case "kept":
      return result.tier === "REST" ? "Rest" : result.cleared ? "Cleared" : "Kept";
    case "neutral":
      return "Logged";
  }
}

/** The log lists every judged day and every unjudged day that still paid. */
export const isLogged = (result: DayResult): boolean => result.status !== "neutral" || result.xp > 0;

function loggedResults(progress: Progress): DayResult[] {
  const todayKey = progress.today.dateKey;
  return Object.values(progress.days)
    .filter((r) => isLogged(r) && compareKeys(r.dateKey, todayKey) <= 0)
    .sort((a, b) => compareKeys(b.dateKey, a.dateKey));
}

/** How many rows the whole log holds. */
export function logCount(progress: Progress): number {
  return loggedResults(progress).length;
}

/** One page of rows, newest first. */
export function logRows(progress: Progress, { limit, offset = 0 }: LogPage): LogRow[] {
  return loggedResults(progress)
    .slice(offset, offset + Math.max(0, limit))
    .map((r) => ({ dateKey: r.dateKey, dateText: shortDate(r.dateKey), tier: r.tier, statusWord: statusWord(r), xp: r.xp }));
}

/** The check-in as the words the athlete tapped, in row order. */
export function checkinWords(checkin: CheckIn | undefined): string[] {
  const words: string[] = [];
  for (const row of CHECKIN_ROWS) {
    const option = selectedOption(row, checkin?.[row.field]);
    if (option) words.push(`${row.label} ${option.text}`);
  }
  if (checkin?.illness === true) words.push("Ill or injured");
  return words;
}

/** Logged exercises in the quest's planned order, then any logged beyond it; only those with work or a skip. */
function exercisesOf(day: DayV2, units: UnitSystem, metaFor: MetaFor): DetailExercise[] {
  const logs = day.workout.exercises;
  const plannedIds = (day.quest?.planned.exercises ?? []).map((e) => e.id);
  const ids = [...plannedIds.filter((id) => id in logs), ...Object.keys(logs).filter((id) => !plannedIds.includes(id))];
  const out: DetailExercise[] = [];
  for (const id of ids) {
    const log = logs[id];
    if (!log) continue;
    const mode = modeOf(log, metaFor(log).trackingMode);
    const sets = log.sets.filter((s) => s.done === true).map((s) => describeSet(s, mode, units));
    if (sets.length === 0 && !log.skipped) continue;
    const pain = log.skipped === "pain" || log.sets.some((s) => s.pain === true);
    out.push({ name: performedName(log), ...(log.skipped ? { skipped: log.skipped } : {}), sets, pain });
  }
  return out;
}

function cardioOf(c: CardioLog, units: UnitSystem): DetailCardio {
  const parts: string[] = [];
  if (c.minutes !== null && c.minutes > 0) parts.push(`${Math.round(c.minutes)} min`);
  if (c.km !== null && c.km > 0) parts.push(formatDistance(c.km, units));
  return { kind: c.kind, minutes: c.minutes, km: c.km, text: parts.join(" · ") || "—" };
}

/** Everything the day-detail sheet shows for `dateKey`; null when the engine has no result for it. */
export function dayDetail(progress: Progress, dateKey: DateKey, day: DayV2 | undefined, units: UnitSystem, metaFor: MetaFor): DayDetail | null {
  const result = progress.days[dateKey];
  if (!result) return null;
  const note = day?.checkin.note?.trim() ?? "";
  return {
    dateKey,
    dateText: shortDate(dateKey),
    tier: result.tier,
    statusWord: statusWord(result),
    reason: result.reason,
    lines: result.lines.map(({ label, xp }) => ({ label, xp })),
    exercises: day ? exercisesOf(day, units, metaFor) : [],
    cardio: day ? day.workout.cardio.map((c) => cardioOf(c, units)) : [],
    checkin: checkinWords(day?.checkin),
    ...(note ? { note } : {}),
    records: result.records.filter((r) => r.isRecord && !r.fromExtraWork).map((r) => recordView(r, units).line),
    hasEntry: day !== undefined,
  };
}

/** XP and streak with and without the day: two folds over the same data. */
export function xpImpactOfDelete(input: DeleteImpactInput): DeleteImpact {
  const { days, program, settings, todayKey, units, metaFor, dateKey, utcOffsetMinutes, historyComplete } = input;
  const { [dateKey]: _removed, ...without } = days;
  const fold = (d: DayMap) =>
    buildProgress({
      days: d, program, settings, todayKey, units, metaFor,
      ...(utcOffsetMinutes !== undefined ? { utcOffsetMinutes } : {}),
      ...(historyComplete !== undefined ? { historyComplete } : {}),
    });
  const before = fold(days);
  const after = fold(without);
  return { xpBefore: before.xp, xpAfter: after.xp, delta: after.xp - before.xp, streakBefore: before.streak.current, streakAfter: after.streak.current };
}

const dayCount = (n: number): string => `${n} ${n === 1 ? "day" : "days"}`;

/** The confirm's consequence: "Removes the log for Fri 2 Oct. XP goes from 6,770 to 6,640 (−130). Streak stays at 67 days." */
export function deleteImpactText(impact: DeleteImpact, dateText: string): string {
  const { xpBefore, xpAfter, delta, streakBefore, streakAfter } = impact;
  const xp = delta === 0
    ? `XP stays at ${groupDigits(xpBefore)}.`
    : `XP goes from ${groupDigits(xpBefore)} to ${groupDigits(xpAfter)} (${delta < 0 ? "−" : "+"}${groupDigits(Math.abs(delta))}).`;
  const streak = streakAfter < streakBefore
    ? `Streak drops to ${dayCount(streakAfter)}.`
    : streakAfter > streakBefore
      ? `Streak goes to ${dayCount(streakAfter)}.`
      : `Streak stays at ${dayCount(streakBefore)}.`;
  return `Removes the log for ${dateText}. ${xp} ${streak}`;
}
