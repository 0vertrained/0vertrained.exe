// What the Stats tab shows, read from the engine's Progress: the next rank's
// checklist in the design's wording, the four weekly points behind each stat
// tile and its delta in words, one record row per movement, the title tiles
// and the plain-words formula of each stat. Pure, so the screen is a renderer.
import type { ObjectiveState } from "../../design/ObjectiveRow";
import type { StatDelta } from "../../design/StatTile";
import { addDays, compareKeys, weekdayName, type DateKey } from "../../domain/dates";
import type { DayMap, SetLog, TrackingMode } from "../../domain/day/schema";
import { RANK_ORDER, STATS, XP } from "../../domain/game/config";
import { rankIndex, rankTitle } from "../../domain/game/ranks";
import { computeStats, type StatsInput } from "../../domain/game/stats";
import type { Progress, Requirement, StatValue, TrialSpec } from "../../domain/game/types";
import { plannedDay } from "../../domain/program/revisions";
import type { ProgramPayloadV2 } from "../../domain/program/types";
import { exerciseHistory, normalizeName, performedMovement, type TrackedMovement } from "../../domain/training/history";
import { e1rmSeries, isRecordEligible, type RecordCandidate, type RecordKind } from "../../domain/training/records";
import { modeOf } from "../../domain/training/sets";
import { formatWeight, round1, type UnitSystem } from "../../domain/units";

export type StatKey = "str" | "end" | "vit";
export type StatName = "STR" | "END" | "VIT";

export const STAT_NAMES: Readonly<Record<StatKey, StatName>> = { str: "STR", end: "END", vit: "VIT" };
export const STAT_KEYS: readonly StatKey[] = ["str", "end", "vit"];

// ─── Dates ───────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Fri 2 Oct": short, local, no relative words. */
export function shortDate(key: DateKey): string {
  const [, m, d] = key.split("-").map(Number);
  return `${weekdayName(key).slice(0, 3)} ${d ?? 1} ${MONTHS[(m ?? 1) - 1] ?? ""}`;
}

// ─── Requirements ────────────────────────────────────────────────────────────

export interface RequirementRow {
  key: Requirement["key"];
  /** "Level 22 (you: 19)", "STR or END 40 (43, met)", "Rank Trial". */
  label: string;
  /** The trial row only: "locked", "available" or "passed". */
  sublabel?: string;
  state: ObjectiveState;
  /** The trial before every other requirement is met: the row carries a lock. */
  locked: boolean;
}

function requirementLabel(r: Requirement): string {
  const met = r.met ? ", met" : "";
  return r.key === "level" ? `${r.label} (you: ${r.current}${met})` : `${r.label} (${r.current}${met})`;
}

/** The next rank's checklist as ObjectiveRow props; empty at the top rank. */
export function requirementRows(progress: Progress): RequirementRow[] {
  const { requirements, trialAvailable } = progress.nextRank;
  return requirements.map((r) => {
    const state: ObjectiveState = r.met ? "done" : "not-started";
    if (r.key !== "trial") return { key: r.key, label: requirementLabel(r), state, locked: false };
    const sublabel = r.met ? "passed" : trialAvailable ? "available" : "locked";
    return { key: r.key, label: r.label, sublabel, state, locked: sublabel === "locked" };
  });
}

// ─── Stat series and deltas ──────────────────────────────────────────────────

export const SERIES_WEEKS = 4;

/** The four weekly points' days: today − 21, − 14, − 7, today. */
export function seriesKeys(todayKey: DateKey): DateKey[] {
  return Array.from({ length: SERIES_WEEKS }, (_, i) => addDays(todayKey, -7 * (SERIES_WEEKS - 1 - i)));
}

/** Each stat's value on the four weekly days, oldest first; the last point is today's value. */
export function statSeries(input: StatsInput): Record<StatKey, number[]> {
  const out: Record<StatKey, number[]> = { str: [], end: [], vit: [] };
  for (const todayKey of seriesKeys(input.todayKey)) {
    const stats = computeStats({ ...input, todayKey });
    for (const key of STAT_KEYS) out[key].push(stats[key].value);
  }
  return out;
}

/** The tile's delta in words. Down is information, not a verdict: the tile keeps it neutral. */
export function statDelta(stat: StatValue & { calibrating?: boolean }): StatDelta {
  if (stat.calibrating) return { kind: "steady", text: "calibrating" };
  if (stat.delta !== null && stat.trend === "up") return { kind: "up", text: `+${stat.delta} in ${SERIES_WEEKS} weeks` };
  if (stat.delta !== null && stat.trend === "down") return { kind: "down", text: `−${Math.abs(stat.delta)} in ${SERIES_WEEKS} weeks` };
  return { kind: "steady", text: "steady" };
}

// ─── Records ─────────────────────────────────────────────────────────────────

export const RECORD_WINDOW_DAYS = 90;

export interface RecordRow {
  key: string;
  name: string;
  kind: RecordKind;
  /** "est. max 221 lb", "best 12 reps at BW", "best 65 s". */
  valueText: string;
  dateKey: DateKey;
  dateText: string;
  /** Per-day bests over the last 90 days, for the sparkline. */
  series: number[];
}

const MODE_OF_KIND: Record<Exclude<RecordKind, "e1rm">, TrackingMode> = { reps: "bodyweight_reps", hold: "timed_hold" };
const LOAD_TOLERANCE_KG = 0.05;

function valueText(r: RecordCandidate, units: UnitSystem): string {
  if (r.kind === "e1rm") return `est. max ${formatWeight(r.current, units)}`;
  if (r.kind === "hold") return `best ${round1(r.current)} s`;
  const load = (r.loadKg ?? 0) > 0 ? `+${formatWeight(r.loadKg, units)}` : "BW";
  return `best ${r.current} reps at ${load}`;
}

/** Best reps (at the record's added load) or hold seconds per day, oldest first. */
function bestPerDay(days: DayMap, target: TrackedMovement, r: RecordCandidate, todayKey: DateKey): number[] {
  if (r.kind === "e1rm") return e1rmSeries(days, target, { todayKey, windowDays: RECORD_WINDOW_DAYS }).map((p) => round1(p.e1rmKg));
  const mode = MODE_OF_KIND[r.kind];
  const score = (s: SetLog): number => (r.kind === "hold" ? (s.seconds ?? 0) : s.reps ?? 0);
  const comparable = (s: SetLog): boolean => r.kind === "hold" || Math.abs((s.weightKg ?? 0) - (r.loadKg ?? 0)) <= LOAD_TOLERANCE_KG;
  const best = new Map<DateKey, number>();
  const window = { fromKey: addDays(todayKey, -(RECORD_WINDOW_DAYS - 1)), beforeKey: addDays(todayKey, 1) };
  for (const { dateKey, log } of exerciseHistory(days, target, window)) {
    if (modeOf(log, target.trackingMode) !== mode) continue;
    for (const set of log.sets) {
      if (!isRecordEligible(set, mode) || !comparable(set)) continue;
      if (score(set) > (best.get(dateKey) ?? 0)) best.set(dateKey, score(set));
    }
  }
  return [...best.values()];
}

/** One row per movement, its latest record, newest first. Extra-work records never count. */
export function recordRows(progress: Progress, days: DayMap, units: UnitSystem, todayKey: DateKey): RecordRow[] {
  const latest = new Map<string, { r: RecordCandidate; dateKey: DateKey }>();
  for (const result of Object.values(progress.days).sort((a, b) => compareKeys(a.dateKey, b.dateKey))) {
    for (const r of result.records) if (r.isRecord && !r.fromExtraWork) latest.set(normalizeName(r.name), { r, dateKey: result.dateKey });
  }
  return [...latest.values()]
    .sort((a, b) => compareKeys(b.dateKey, a.dateKey))
    .map(({ r, dateKey }) => {
      const log = days[dateKey]?.workout.exercises[r.exerciseId];
      const target: TrackedMovement = log ? { ...performedMovement(log), ...(log.trackingMode ? { trackingMode: log.trackingMode } : {}) } : { name: r.name };
      return { key: normalizeName(r.name), name: r.name, kind: r.kind, valueText: valueText(r, units), dateKey, dateText: shortDate(dateKey), series: bestPerDay(days, target, r, todayKey) };
    });
}

// ─── Titles ──────────────────────────────────────────────────────────────────

export interface TitleTile {
  id: string;
  title: string;
  unlocked: boolean;
  /** The achievement's description, or "Reach rank X". */
  requirement: string;
  featured: boolean;
}

/** Every achievement title plus every rank title above E, unlocked up to the current rank. */
export function titleTiles(progress: Progress, featured: string | null | undefined): TitleTile[] {
  const held = rankIndex(progress.rank);
  const achievements = progress.achievements.map((a) => ({ id: a.id, title: a.title, unlocked: a.unlocked, requirement: a.description, featured: a.title === featured }));
  const ranks = RANK_ORDER.slice(1).map((rank) => {
    const title = rankTitle(rank);
    return { id: `rank-${rank.toLowerCase()}`, title, unlocked: rankIndex(rank) <= held, requirement: `Reach rank ${rank}`, featured: title === featured };
  });
  return [...achievements, ...ranks];
}

// ─── Explain ─────────────────────────────────────────────────────────────────

export interface ExplainInput {
  label: string;
  value: string;
}

export interface Explain {
  name: StatName;
  /** The formula in plain words, with the config's numbers as digits. */
  formula: string;
  inputs: ExplainInput[];
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const share = (v: number): string => `${Math.round(v * 100)}%`;
const GROUP_LABELS = { squat: "Squat", hinge: "Hinge", push: "Push", pull: "Pull" } as const;

/** What a stat measures and the inputs behind today's value. "est. max", never e1RM. */
export function explainText(stat: StatKey, progress: Progress): Explain {
  const { str, end, vit } = progress.stats;
  switch (stat) {
    case "str": {
      const { elite, windowDays } = STATS.str;
      const marks = `squat ${elite.squat}×, hinge ${elite.hinge}×, push ${elite.push}×, pull ${elite.pull}×`;
      return {
        name: "STR",
        formula: `STR is the average of 4 groups: squat, hinge, push and pull. Each group scores your best est. max of the last ${windowDays} days as a share of your bodyweight, against an elite mark (${marks} bodyweight). A group you have not trained scores 0.`,
        inputs: [
          ...(Object.keys(GROUP_LABELS) as (keyof typeof GROUP_LABELS)[]).map((g) => ({ label: GROUP_LABELS[g], value: str.groups[g] === null ? "not measured" : String(str.groups[g]) })),
          { label: "Groups measured", value: `${str.measuredGroups} of 4` },
        ],
      };
    }
    case "end": {
      const { weeks, weeklyMinutesFull, longestMinutesFull, longestWindowDays, weeklyWeight, longestWeight } = STATS.end;
      return {
        name: "END",
        formula: `END is ${share(weeklyWeight)} your average weekly cardio minutes over the last ${weeks} weeks against ${weeklyMinutesFull}, plus ${share(longestWeight)} your longest session of the last ${longestWindowDays} days against ${longestMinutesFull} minutes.`,
        inputs: [
          { label: `Weekly minutes (${weeks}-week average)`, value: `${Math.round(end.weeklyMinutes)} min` },
          { label: "Longest session", value: `${Math.round(end.longestMinutes)} min` },
        ],
      };
    }
    default: {
      const { windowDays, checkinWeight, sleepWeight, restWeight, calibratingDays } = STATS.vit;
      const calibrating = vit.calibrating ? ` It calibrates over the first ${calibratingDays} days.` : "";
      return {
        name: "VIT",
        formula: `VIT is ${checkinWeight}% your check-in rate over the last ${windowDays} days, ${sleepWeight}% your sleep answers and ${restWeight}% the rest days you honoured.${calibrating}`,
        inputs: [
          { label: "Check-in rate", value: pct(vit.checkinRate) },
          { label: "Sleep answers", value: pct(vit.sleepScore) },
          { label: "Rest days honoured", value: pct(vit.restHonor) },
        ],
      };
    }
  }
}

// ─── Rank Trial ──────────────────────────────────────────────────────────────

export const TRIAL_LOOKAHEAD_DAYS = 14;
/** Carried on the sheet every time, on its own line. */
export const SAFETY_LINE = "Stop if anything hurts.";

/** The prescription as a numeral line: without the safety line (the sheet sets it on its own) or a closing period. */
export function trialPrescription(trial: TrialSpec): string {
  return trial.spec.replace(new RegExp(`\\s*${SAFETY_LINE.replace(".", "\\.")}$`), "").replace(/\.$/, "");
}

/** "+300 XP, promotion, a title" */
export const TRIAL_REWARD = `+${XP.rankTrial} XP, promotion, a title`;

/** The first planned day from `fromKey` whose lifting includes the trial's movement; null for cardio or none in 14 days. */
export function trialAttachDay(program: ProgramPayloadV2 | null, trial: TrialSpec, fromKey: DateKey): DateKey | null {
  if (!program || trial.exerciseId === null) return null;
  const name = normalizeName(trial.exerciseName ?? "");
  for (let i = 0; i < TRIAL_LOOKAHEAD_DAYS; i += 1) {
    const key = addDays(fromKey, i);
    const day = plannedDay(program, key);
    if (!day.rest && day.lifting.some((l) => l.id === trial.exerciseId || l.libraryId === trial.exerciseId || normalizeName(l.name) === name)) return key;
  }
  return null;
}
