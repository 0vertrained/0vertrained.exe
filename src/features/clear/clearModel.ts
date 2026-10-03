// What the Quest cleared sheet shows, read from two engine results: `after`
// is today's Progress and `before` is the same data folded without today's
// day, so every difference (XP, level, rank, stats, titles, streak) is
// exactly what today added. Pure, so the sheet is a renderer.
import type { DateKey } from "../../domain/dates";
import { emptyDay, type DayV2, type ExerciseLog, type Tier } from "../../domain/day/schema";
import type { ExerciseMeta } from "../../domain/exercise";
import { STATS, STREAK } from "../../domain/game/config";
import type { Progress, Rank, XpLine } from "../../domain/game/types";
import type { RecordCandidate, RecordKind } from "../../domain/training/records";
import { tonnageKg } from "../../domain/training/sessionSummary";
import { formatWeight, round1, type UnitSystem } from "../../domain/units";

export interface ClearLine {
  key: string;
  label: string;
  /** "11 of 11 sets" under Training, the movement under Record. */
  sublabel?: string;
  xp: number;
}

export interface ClearLevel {
  before: number;
  after: number;
  leveledUp: boolean;
  into: number;
  needed: number;
  /** Where the XP bar ends. */
  fraction: number;
  /** Where the XP bar starts: the fraction before today. */
  previousFraction: number;
  /** "Rank Trial requirements: 2 of 5 met." or "Top rank." */
  nextRankLine: string;
}

export interface ClearRecord {
  name: string;
  kind: RecordKind;
  /** The row's label: "Bench Press est. max", "Push-Ups", "Plank hold". */
  label: string;
  previousText: string;
  currentText: string;
  /** The notice sentence: "Bench Press est. max 221 lb (was 216 lb)." */
  line: string;
}

export type StatName = "STR" | "END" | "VIT";

export interface ClearStat {
  name: StatName;
  before: number;
  after: number;
}

export interface ClearStreak {
  days: number;
  shields: number;
  shieldsTotal: number;
}

export interface ClearPromotion {
  rank: Rank;
  title: string;
}

export interface ClearSessionSummary {
  /** workout.startedAt → completedAt; null when either is missing. */
  durationMinutes: number | null;
  /** Sets marked done across every exercise, extra work included. */
  sets: number;
  volumeKg: number;
}

export interface ClearSummary {
  tier: Tier;
  lines: ClearLine[];
  total: number;
  level: ClearLevel;
  records: ClearRecord[];
  /** Only the stats that moved by STATS.steadyBand or more today. */
  stats: ClearStat[];
  streak: ClearStreak;
  /** Titles unlocked today. */
  titles: string[];
  promotion: ClearPromotion | null;
  summary: ClearSessionSummary;
}

export interface ClearSummaryInput {
  before: Progress;
  after: Progress;
  day: DayV2 | undefined;
  todayKey: DateKey;
  units: UnitSystem;
  metaFor: (log: ExerciseLog) => ExerciseMeta;
}

const STAT_KEYS: readonly { name: StatName; key: "str" | "end" | "vit" }[] = [
  { name: "STR", key: "str" },
  { name: "END", key: "end" },
  { name: "VIT", key: "vit" },
];

function lineFor(line: XpLine, index: number, today: Progress["today"], recordIndex: number): ClearLine {
  switch (line.key) {
    case "training":
      return { key: line.key, label: "Training", sublabel: `${today.completedSets} of ${today.plannedSets} sets`, xp: line.xp };
    case "record": {
      const name = today.recordXp[recordIndex]?.name ?? line.label.replace(/^Record\s*·\s*/, "");
      return { key: `record-${index}`, label: "Record", sublabel: name, xp: line.xp };
    }
    default:
      return { key: line.key, label: line.label, xp: line.xp };
  }
}

function holdText(seconds: number | null): string {
  return seconds === null ? "—" : `${round1(seconds)} s`;
}

function repsText(reps: number | null, loadKg: number | undefined, units: UnitSystem): string {
  if (reps === null) return "—";
  const load = (loadKg ?? 0) > 0 ? `+${formatWeight(loadKg, units)}` : "BW";
  return `${load} × ${reps}`;
}

/** "est. max" for loaded lifts, reps at a load for bodyweight moves, seconds for holds; never "e1RM". */
export function recordView(r: RecordCandidate, units: UnitSystem): ClearRecord {
  switch (r.kind) {
    case "e1rm": {
      const previousText = formatWeight(r.previous, units);
      const currentText = formatWeight(r.current, units);
      const label = `${r.name} est. max`;
      return { name: r.name, kind: r.kind, label, previousText, currentText, line: `${label} ${currentText} (was ${previousText}).` };
    }
    case "reps": {
      const previousText = repsText(r.previous, r.loadKg, units);
      const currentText = repsText(r.current, r.loadKg, units);
      const was = r.previous === null ? previousText : String(r.previous);
      return { name: r.name, kind: r.kind, label: r.name, previousText, currentText, line: `${r.name} ${currentText} (was ${was}).` };
    }
    default: {
      const previousText = holdText(r.previous);
      const currentText = holdText(r.current);
      const label = `${r.name} hold`;
      return { name: r.name, kind: r.kind, label, previousText, currentText, line: `${label} ${currentText} (was ${previousText}).` };
    }
  }
}

function nextRankLine(after: Progress): string {
  const next = after.nextRank;
  if (next.rank === null) return "Top rank.";
  const met = next.requirements.filter((r) => r.met).length;
  return `Rank Trial requirements: ${met} of ${next.requirements.length} met.`;
}

function durationMinutes(day: DayV2): number | null {
  const { startedAt, completedAt } = day.workout;
  if (!startedAt || !completedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 60_000);
}

function completedSets(day: DayV2): number {
  return Object.values(day.workout.exercises).reduce((n, log) => n + log.sets.filter((s) => s.done === true).length, 0);
}

export function clearSummary({ before, after, day, todayKey, units, metaFor }: ClearSummaryInput): ClearSummary {
  const today = after.days[todayKey] ?? after.today;
  const d = day ?? emptyDay();
  const tier: Tier = today.tier ?? d.quest?.tier ?? "REST";

  let recordIndex = 0;
  const lines = today.lines.map((line, i) => {
    const view = lineFor(line, i, today, recordIndex);
    if (line.key === "record") recordIndex += 1;
    return view;
  });

  const level: ClearLevel = {
    before: before.level,
    after: after.level,
    leveledUp: after.level > before.level,
    into: after.levelProgress.into,
    needed: after.levelProgress.needed,
    fraction: after.levelProgress.fraction,
    previousFraction: before.levelProgress.fraction,
    nextRankLine: nextRankLine(after),
  };

  const stats = STAT_KEYS.flatMap(({ name, key }) => {
    const b = before.stats[key].value;
    const a = after.stats[key].value;
    return Math.abs(a - b) >= STATS.steadyBand ? [{ name, before: b, after: a }] : [];
  });

  const held = new Set(before.titles.unlocked);
  const titles = after.titles.unlocked.filter((t) => !held.has(t));

  return {
    tier,
    lines,
    total: today.xp,
    level,
    records: today.recordXp.map((r) => recordView(r, units)),
    stats,
    streak: { days: after.streak.current, shields: after.streak.shields, shieldsTotal: STREAK.maxShields },
    titles,
    promotion: after.rank !== before.rank ? { rank: after.rank, title: after.rankTitle } : null,
    summary: { durationMinutes: durationMinutes(d), sets: completedSets(d), volumeKg: tonnageKg(d, metaFor) },
  };
}
