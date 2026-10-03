import { describe, expect, it } from "vitest";
import type { DateKey } from "../../domain/dates";
import type { DayV2 } from "../../domain/day/schema";
import { STATS } from "../../domain/game/config";
import { buildProgress } from "../../domain/game/progress";
import type { Progress } from "../../domain/game/types";
import type { RecordCandidate } from "../../domain/training/records";
import { lbToKg } from "../../domain/units";
import { metaFor, set, threeDayProgram } from "../../test/gameFixtures";
import { scenario } from "../../test/gameScenario";
import { clearSummary, recordView } from "./clearModel";

const TODAY: DateKey = "2026-10-05"; // a Monday: Full A on the three-day program

/** `after` from the scenario, `before` from the same days without today. */
function pair(startedOn: DateKey, todayKey: DateKey = TODAY) {
  const s = scenario({ program: threeDayProgram(), startedOn, todayKey });
  const after = buildProgress({ days: s.days, program: s.program, settings: s.settings, todayKey, metaFor });
  const { [todayKey]: _today, ...rest } = s.days;
  const before = buildProgress({ days: rest, program: s.program, settings: s.settings, todayKey, metaFor });
  const day = s.days[todayKey] as DayV2;
  return { before, after, day, todayKey };
}

const summarise = (p: ReturnType<typeof pair>, units: "metric" | "imperial" = "metric") =>
  clearSummary({ ...p, units, metaFor });

const candidate = (over: Partial<RecordCandidate>): RecordCandidate => ({
  exerciseId: "x", name: "Bench Press", kind: "e1rm", previous: 90, current: 95, priorExposures: 6, fromExtraWork: false, baseline: false, isRecord: true, label: "", ...over,
});

describe("clearSummary", () => {
  it("lists a cleared training day's lines, summing to the total", () => {
    const s = summarise(pair("2026-09-28"));
    expect(s.tier).toBe("FULL");
    expect(s.lines.map((l) => l.label)).toEqual(["Status check", "Training", "Record"]);
    expect(s.lines[1]).toMatchObject({ key: "training", sublabel: "12 of 12 sets", xp: 120 });
    expect(s.lines[2]).toMatchObject({ label: "Record", sublabel: "Back Squat", xp: 25 });
    expect(s.lines.reduce((n, l) => n + l.xp, 0)).toBe(s.total);
    expect(s.total).toBe(155);
    expect(new Set(s.lines.map((l) => l.key)).size).toBe(s.lines.length);
  });

  it("detects a level up when today's XP crosses a boundary, with the bar's start and end", () => {
    const up = summarise(pair("2026-09-21"));
    expect(up.level.before).toBe(7);
    expect(up.level.after).toBe(8);
    expect(up.level.leveledUp).toBe(true);
    expect(up.level.previousFraction).toBeGreaterThan(up.level.fraction);
    expect(up.level.into).toBe(120);
    expect(up.level.needed).toBe(480);
    expect(up.level.nextRankLine).toMatch(/^Rank Trial requirements: \d of \d met\.$/);

    const flat = summarise(pair("2026-09-28"));
    expect(flat.level.leveledUp).toBe(false);
    expect(flat.level.before).toBe(flat.level.after);
    expect(flat.level.previousFraction).toBeLessThan(flat.level.fraction);
  });

  it("says Top rank. at S", () => {
    const p = pair("2026-09-28");
    const after: Progress = { ...p.after, rank: "S", rankTitle: "Paragon", nextRank: { rank: null, title: null, requirements: [], trialAvailable: false } };
    expect(summarise({ ...p, after }).level.nextRankLine).toBe("Top rank.");
  });

  it("formats est. max, reps at a load and hold records in the athlete's units", () => {
    const e1rm = recordView(candidate({ previous: lbToKg(216), current: lbToKg(221) }), "imperial");
    expect(e1rm).toMatchObject({ name: "Bench Press", kind: "e1rm", label: "Bench Press est. max", previousText: "216 lb", currentText: "221 lb" });
    expect(e1rm.line).toBe("Bench Press est. max 221 lb (was 216 lb).");

    const bw = recordView(candidate({ name: "Push-Ups", kind: "reps", previous: 10, current: 12, loadKg: 0 }), "metric");
    expect(bw).toMatchObject({ label: "Push-Ups", previousText: "BW × 10", currentText: "BW × 12", line: "Push-Ups BW × 12 (was 10)." });
    const loaded = recordView(candidate({ name: "Pull-Ups", kind: "reps", previous: 8, current: 12, loadKg: 10 }), "metric");
    expect(loaded).toMatchObject({ previousText: "+10 kg × 8", currentText: "+10 kg × 12" });

    const hold = recordView(candidate({ name: "Plank", kind: "hold", previous: 60, current: 65 }), "metric");
    expect(hold).toMatchObject({ label: "Plank hold", previousText: "60 s", currentText: "65 s", line: "Plank hold 65 s (was 60 s)." });
    expect(hold.line).not.toMatch(/e1RM|!/);
  });

  it("reads records from today's record XP and never says e1RM", () => {
    const s = summarise(pair("2026-09-28"), "imperial");
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ name: "Back Squat", kind: "e1rm", label: "Back Squat est. max" });
    expect(s.records[0]?.currentText).toMatch(/^\d+(\.\d)? lb$/);
    expect(JSON.stringify(s)).not.toMatch(/e1RM/);
  });

  it("includes a stat only when it moved by the steady band or more", () => {
    const first = summarise(pair(TODAY));
    expect(first.stats.map((s) => s.name)).toEqual(["STR", "VIT"]);
    expect(first.stats[0]).toMatchObject({ name: "STR", before: 1, after: 34 });

    const p = pair("2026-09-21");
    const nudge = (delta: number): Progress => ({ ...p.after, stats: { ...p.after.stats, end: { ...p.after.stats.end, value: p.before.stats.end.value + delta } } });
    expect(summarise({ ...p, after: nudge(STATS.steadyBand - 1) }).stats.some((s) => s.name === "END")).toBe(false);
    expect(summarise({ ...p, after: nudge(STATS.steadyBand) }).stats.find((s) => s.name === "END")).toMatchObject({ before: 1, after: 1 + STATS.steadyBand });
    expect(summarise({ ...p, after: nudge(-STATS.steadyBand) }).stats.some((s) => s.name === "END")).toBe(true);
  });

  it("reports the streak with its shields and the titles unlocked today", () => {
    const first = summarise(pair(TODAY));
    expect(first.streak).toEqual({ days: 1, shields: 0, shieldsTotal: 2 });
    expect(first.titles).toEqual(["First Quest"]);
    const later = summarise(pair("2026-09-21"));
    expect(later.streak).toEqual({ days: 15, shields: 2, shieldsTotal: 2 });
    expect(later.titles).toEqual([]);
  });

  it("flags a promotion when the ranks differ, with the new rank's title", () => {
    const sunday = summarise(pair("2026-09-28", "2026-10-04"));
    expect(sunday.promotion).toEqual({ rank: "D", title: "Initiate" });
    expect(sunday.titles).toContain("Initiate");
    expect(sunday.tier).toBe("REST");
    expect(sunday.lines.map((l) => l.label)).toEqual(["Status check", "Recovery"]);

    expect(summarise(pair("2026-09-28")).promotion).toBeNull();
    const p = pair("2026-09-28");
    const after: Progress = { ...p.after, rank: "C", rankTitle: "Contender" };
    expect(summarise({ ...p, after }).promotion).toEqual({ rank: "C", title: "Contender" });
  });

  it("summarises the session: duration from the workout timestamps, done sets, volume", () => {
    const p = pair(TODAY);
    const bare = summarise(p);
    expect(bare.summary).toEqual({ durationMinutes: null, sets: 12, volumeKg: 2700 });

    const timed: DayV2 = { ...p.day, workout: { ...p.day.workout, startedAt: "2026-10-05T17:00:00.000Z", completedAt: "2026-10-05T17:48:20.000Z" } };
    expect(summarise({ ...p, day: timed }).summary.durationMinutes).toBe(48);

    const onlyStart: DayV2 = { ...p.day, workout: { ...p.day.workout, startedAt: "2026-10-05T17:00:00.000Z" } };
    expect(summarise({ ...p, day: onlyStart }).summary.durationMinutes).toBeNull();

    const squat = p.day.workout.exercises.squat;
    expect(squat).toBeDefined();
    const extra: DayV2 = { ...p.day, workout: { ...p.day.workout, exercises: { ...p.day.workout.exercises, squat: { ...squat!, sets: [...squat!.sets, set(3, { extra: true, weightKg: 100, reps: 5 }), set(4, { done: false })] } } } };
    const withExtra = summarise({ ...p, day: extra }).summary;
    expect(withExtra.sets).toBe(13);
    expect(withExtra.volumeKg).toBe(2700);

    expect(clearSummary({ before: p.before, after: p.after, day: undefined, todayKey: TODAY, units: "metric", metaFor }).summary).toEqual({ durationMinutes: null, sets: 0, volumeKg: 0 });
  });
});
