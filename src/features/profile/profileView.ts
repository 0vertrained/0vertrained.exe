// Pure helpers behind the Profile page: which week the editor works on (the
// one live from tomorrow, since every program change applies from
// tomorrow), what a program row says, the pause bookkeeping on
// settings.game.pauses, and the bodyweight field's two directions.
import { addDays, compareKeys, type DateKey } from "../../domain/dates";
import { STREAK } from "../../domain/game/config";
import type { Pause } from "../../domain/game/types";
import { revisionAt } from "../../domain/program/revisions";
import type { ProgramDay, ProgramPayloadV2, ProgramRevision } from "../../domain/program/types";
import { toDisplayWeight, weightUnit, type UnitSystem } from "../../domain/units";

export type PauseReason = Pause["reason"];

/** A pause covers the shared allowance in one go: today and the 13 days after. */
export const PAUSE_DAYS = STREAK.pauseAllowanceDays;

export const PAUSE_REASONS: readonly { value: PauseReason; label: string }[] = [
  { value: "sick", label: "sick" },
  { value: "travel", label: "travel" },
  { value: "life", label: "life" },
];

/** How the notice names the reason: "Training paused for illness." */
export const PAUSE_REASON_TEXT: Readonly<Record<PauseReason, string>> = { sick: "illness", travel: "travel", life: "life" };

export const UNIT_OPTIONS = [
  { value: "metric", label: "kg · km" },
  { value: "imperial", label: "lb · mi" },
] as const;

/** The revision live from tomorrow: what the editor shows and builds on. */
export function upcomingRevision(program: ProgramPayloadV2 | null, todayKey: DateKey): ProgramRevision | null {
  return program ? revisionAt(program, addDays(todayKey, 1)) : null;
}

/** The row's right-hand caption: the lift count, else the cardio, else nothing. */
export function dayRowMeta(day: ProgramDay): string {
  if (day.rest) return "";
  const n = day.lifting.length;
  if (n > 0) return `${n} ${n === 1 ? "lift" : "lifts"}`;
  return day.cardio ? day.cardio.kind : "";
}

const covers = (p: Pause, key: DateKey): boolean => compareKeys(p.from, key) <= 0 && compareKeys(key, p.to) <= 0;

export function coveringPause(pauses: Pause[] | undefined, todayKey: DateKey): Pause | undefined {
  return (pauses ?? []).find((p) => covers(p, todayKey));
}

/** Start a pause today, replacing any pause that already covers today. */
export function pausesStarted(pauses: Pause[] | undefined, todayKey: DateKey, reason: PauseReason): Pause[] {
  const others = (pauses ?? []).filter((p) => !covers(p, todayKey));
  return [...others, { from: todayKey, to: addDays(todayKey, PAUSE_DAYS - 1), reason }];
}

/** End the covering pause yesterday, or drop it when it only started today. */
export function pausesEnded(pauses: Pause[] | undefined, todayKey: DateKey): Pause[] {
  const out: Pause[] = [];
  for (const p of pauses ?? []) {
    if (!covers(p, todayKey)) out.push(p);
    else if (p.from !== todayKey) out.push({ ...p, to: addDays(todayKey, -1) });
  }
  return out;
}

export function pausesWithReason(pauses: Pause[] | undefined, todayKey: DateKey, reason: PauseReason): Pause[] {
  return (pauses ?? []).map((p) => (covers(p, todayKey) ? { ...p, reason } : p));
}

export function bodyweightLabel(units: UnitSystem): string {
  return `Bodyweight (${weightUnit(units)})`;
}

/** The stored kg as the number the athlete sees in their units; blank when none. */
export function bodyweightDisplay(kg: number | undefined, units: UnitSystem): string {
  return kg === undefined ? "" : String(toDisplayWeight(kg, units));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "5 Jan 2026": short, and the same in every locale. */
export function shortDate(key: DateKey): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${d ?? 1} ${MONTHS[(m ?? 1) - 1] ?? ""} ${y ?? ""}`;
}
