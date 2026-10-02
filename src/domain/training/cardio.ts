// Cardio runner logic: interval plans and their segments, a conservative
// parser that pre-fills a plan from the program's cardio notes, the timer
// (as a pure reduction over start/pause/resume/stop events) and pace.
// Plans are seconds; what gets logged is a CardioLog in minutes and km.
//
// Ported from src/cardioSession.js and the timer in src/CardioSession.jsx
// @ c955d5a. Deliberate changes:
//   - activeSeconds excludes paused time. v19 logged now − startedAt, so a
//     10-minute pause in a 20-minute session was logged as 30 minutes.
//   - The timer is a pure function of timestamped events (the UI keeps the
//     event list), and segmentAt maps active time onto the plan.
//   - runnerLog builds the v2 CardioLog (minutes, km, source "runner")
//     instead of writing an "mm:ss" string into workout.cardio.time.
//   - Pace helpers (s/km, shown per km or per mile) are new.
// Cut: fmtSeconds (units.formatDuration covers it).

import type { CardioLog } from "../day/schema";
import { formatDuration, KM_PER_MI, type UnitSystem } from "../units";

export interface IntervalPlan {
  work: number;
  rest: number;
  rounds: number;
  warmup: number;
}

export interface CardioPreset extends IntervalPlan {
  key: string;
  label: string;
}

export const CARDIO_PRESETS: readonly CardioPreset[] = [
  { key: "4x4", label: "4×4 min · 3 min rest", work: 240, rest: 180, rounds: 4, warmup: 300 },
  { key: "8x1", label: "8×1 min · 1 min rest", work: 60, rest: 60, rounds: 8, warmup: 300 },
  { key: "30_30", label: "30/30 × 10", work: 30, rest: 30, rounds: 10, warmup: 300 },
  { key: "emom10", label: "EMOM 10", work: 60, rest: 0, rounds: 10, warmup: 180 },
  { key: "hyrox8", label: "Hyrox 8 stations", work: 240, rest: 60, rounds: 8, warmup: 300 },
];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(v) || lo));

export function normalizePlan(raw: Partial<IntervalPlan>): IntervalPlan {
  return {
    work: clamp(raw.work ?? 60, 5, 3600),
    rest: clamp(raw.rest ?? 60, 0, 3600),
    rounds: clamp(raw.rounds ?? 6, 1, 50),
    warmup: clamp(raw.warmup ?? 0, 0, 1800),
  };
}

export interface Segment {
  kind: "warmup" | "work" | "rest";
  seconds: number;
  /** Work round the segment belongs to; 0 for the warm-up. */
  round: number;
}

/** Ordered segments. No rest after the last round: the session ends on work. */
export function buildSegments(raw: Partial<IntervalPlan>): Segment[] {
  const plan = normalizePlan(raw);
  const segments: Segment[] = plan.warmup > 0 ? [{ kind: "warmup", seconds: plan.warmup, round: 0 }] : [];
  for (let round = 1; round <= plan.rounds; round += 1) {
    segments.push({ kind: "work", seconds: plan.work, round });
    if (plan.rest > 0 && round < plan.rounds) segments.push({ kind: "rest", seconds: plan.rest, round });
  }
  return segments;
}

export function totalPlannedSeconds(raw: Partial<IntervalPlan>): number {
  return buildSegments(raw).reduce((total, s) => total + s.seconds, 0);
}

/** Planned time in minutes, the unit quests and cardio logs use. */
export const plannedMinutes = (raw: Partial<IntervalPlan>): number => totalPlannedSeconds(raw) / 60;

const SECONDS_UNIT = /^s/;

/**
 * Pre-fills a plan only from unambiguous time-based intervals ("6x3min",
 * "8 x 90s on / 60s off"). Distance intervals depend on a pace we don't know,
 * so they (and anything uncertain) return null: a wrong pre-fill is worse
 * than none.
 */
export function suggestPlanFromNotes(notes: string | null | undefined): IntervalPlan | null {
  if (!notes) return null;
  const t = notes.toLowerCase();
  if (/\d\s*(m|km|mi|meter|mile)\b/.test(t) && !/\d\s*min/.test(t)) return null;
  const main = t.match(/(\d{1,2})\s*[x×]\s*(\d{1,3})\s*(min|minute|minutes|m(?![a-z])|s|sec|secs|seconds)\b/);
  if (!main) return null;
  const rounds = Number(main[1]);
  const work = SECONDS_UNIT.test(main[3] as string) ? Number(main[2]) : Number(main[2]) * 60;
  if (rounds < 1 || rounds > 50 || work < 10 || work > 3600) return null;
  // Optional rest: "w/ 2min rest", "/ 90s off", "rest 3 min".
  const restMatch =
    t.match(/(\d{1,3})\s*(min|minute|minutes|s|sec|secs|seconds)\s*(?:rest|off|easy|recovery)/) ??
    t.match(/(?:rest|off|recovery)\s*(?:of\s*)?(\d{1,3})\s*(min|minute|minutes|s|sec|secs|seconds)/);
  const rest = restMatch ? (SECONDS_UNIT.test(restMatch[2] as string) ? Number(restMatch[1]) : Number(restMatch[1]) * 60) : Math.min(work, 180);
  return normalizePlan({ work, rest, rounds, warmup: 300 });
}

// ─── Timer ───────────────────────────────────────────────────────────────────

export interface TimerEvent {
  type: "start" | "pause" | "resume" | "stop";
  /** Epoch milliseconds, from the caller's clock. */
  atMs: number;
}

/**
 * Seconds the session actually ran: paused time is excluded. Events are
 * applied in time order; ones that make no sense in the current state (a
 * pause while paused, anything after stop) are ignored. A session still
 * running counts up to `nowMs` when given.
 */
export function activeSeconds(events: readonly TimerEvent[], nowMs?: number): number {
  let runningSince: number | null = null;
  let started = false;
  let totalMs = 0;
  for (const e of [...events].sort((a, b) => a.atMs - b.atMs)) {
    const running = runningSince !== null;
    if ((e.type === "start" && !running) || (e.type === "resume" && started && !running)) {
      runningSince = e.atMs;
      started = true;
    } else if ((e.type === "pause" || e.type === "stop") && runningSince !== null) {
      totalMs += e.atMs - runningSince;
      runningSince = null;
    }
    if (e.type === "stop" && started) break;
  }
  if (runningSince !== null && nowMs !== undefined) totalMs += Math.max(0, nowMs - runningSince);
  return totalMs / 1000;
}

/** The segment running after `elapsed` active seconds; null once the plan is done. */
export function segmentAt(segments: readonly Segment[], elapsed: number): { index: number; segment: Segment; remaining: number } | null {
  let end = 0;
  for (const [index, segment] of segments.entries()) {
    end += segment.seconds;
    if (elapsed < end) return { index, segment, remaining: end - elapsed };
  }
  return null;
}

/** The v2 cardio log for a finished (or ended-early) runner session. */
export function runnerLog(args: { id: string; kind: string; events: readonly TimerEvent[]; nowMs?: number; km?: number | null; completedAt?: string }): CardioLog {
  const log: CardioLog = {
    id: args.id,
    kind: args.kind,
    minutes: Math.round(activeSeconds(args.events, args.nowMs)) / 60,
    km: args.km ?? null,
    source: "runner",
  };
  return args.completedAt ? { ...log, completedAt: args.completedAt } : log;
}

// ─── Pace ────────────────────────────────────────────────────────────────────

/** Seconds per km; null without a positive time and distance. */
export function paceSecondsPerKm(minutes: number | null | undefined, km: number | null | undefined): number | null {
  if (minutes == null || km == null || !(minutes > 0) || !(km > 0) || !Number.isFinite(minutes) || !Number.isFinite(km)) return null;
  return (minutes * 60) / km;
}

/** "5:00 /km" or "8:52 /mi". */
export function formatPace(secondsPerKm: number | null, units: UnitSystem): string {
  if (secondsPerKm === null) return "—";
  return units === "imperial" ? `${formatDuration(secondsPerKm * KM_PER_MI)} /mi` : `${formatDuration(secondsPerKm)} /km`;
}
