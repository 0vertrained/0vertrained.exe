// The economy's safety guarantees, as properties over random weeks:
//   - XP is never negative and never pays for work beyond the plan;
//   - an engine-scaled REDUCED day pays exactly what FULL pays;
//   - illness never earns training XP;
//   - every 2–6-day plan earns within 12% of the others for full adherence;
//   - a week with zero training earns at most 65% of a full-adherence week,
//     whatever the check-in pattern (faking a bad day doesn't pay).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays, endOfDayMs, WEEKDAYS, weekdayName } from "../dates";
import type { CheckIn, DayMap, DayV2, SetLog } from "../day/schema";
import { CHECKIN_ALL_BAD, CHECKIN_FINE, CHECKIN_ILL, day, doneSets, logged, metaFor, program, REST, set, snapshot, trainingDay, week, type LiftSpec } from "../../test/gameFixtures";
import { plannedDay, trainingDaysPerWeek } from "../program/revisions";
import { XP } from "./config";
import { issueDailyQuest } from "./quest";
import { advanceContext, emptyContext, scoreDay, trainingShare, type ScoreContext } from "./scoreDay";
import type { DayResult } from "./types";
import { scoreWeek } from "./weekly";

const MON = "2026-09-28";
const LIFTS: LiftSpec[] = [{ id: "squat", name: "Back Squat", sets: 3 }, { id: "bench", name: "Barbell Bench Press", sets: 3 }, { id: "row", name: "Barbell Row", sets: 3 }];
const PLAN = trainingDay("Full", LIFTS);

/** A plan with n training days, spread across the week. */
function planWith(n: number) {
  const slots = [0, 2, 4, 1, 3, 5].slice(0, n).sort();
  return program(week(Object.fromEntries(slots.map((i) => [WEEKDAYS[i], PLAN]))));
}

function fullSession(): DayV2 {
  return day({ exercises: LIFTS.map((l) => logged(l.id, { name: l.name, sets: doneSets(l.sets ?? 3) })), checkin: CHECKIN_FINE });
}

/** Score Monday–Sunday with the rolling context carried day to day. */
function scoreTheWeek(prog: ReturnType<typeof planWith>, days: DayMap, todayKey = addDays(MON, 7)) {
  const results: Record<string, DayResult> = {};
  let context: ScoreContext = emptyContext();
  const history: DayMap = {};
  for (let i = 0; i < 7; i += 1) {
    const key = addDays(MON, i);
    const planned = plannedDay(prog, key);
    const result = scoreDay({
      dateKey: key, day: days[key], planned, plannedDaysPerWeek: trainingDaysPerWeek(prog.revisions[0]!.week), history: { ...history }, context,
      legacy: false, paused: false, allowanceLeft: true, historyComplete: true, utcOffsetMinutes: 0, nowMs: endOfDayMs(todayKey), metaFor,
    });
    results[key] = result;
    context = advanceContext(context, result);
    if (days[key]) history[key] = days[key]!;
  }
  const weekly = scoreWeek({ weekStart: MON, plannedTrainingDays: trainingDaysPerWeek(prog.revisions[0]!.week), results, todayKey });
  const dayXp = Object.values(results).reduce((n, r) => n + r.xp, 0);
  return { results, weekly, total: dayXp + weekly.xp };
}

/** The best possible honest week: every quest cleared, check-in daily, rest objectives done. No records (none have 3 prior exposures). */
function fullAdherenceWeek(n: number) {
  const prog = planWith(n);
  const days: DayMap = {};
  for (let i = 0; i < 7; i += 1) {
    const key = addDays(MON, i);
    const planned = plannedDay(prog, key);
    days[key] = planned.rest ? day({ checkin: CHECKIN_FINE, quest: snapshot("REST", [], { recoveryDone: true }) }) : fullSession();
  }
  return scoreTheWeek(prog, days);
}

const arbSet = (index: number): fc.Arbitrary<SetLog> =>
  fc.record({ done: fc.boolean(), weightKg: fc.option(fc.integer({ min: 0, max: 200 }), { nil: null }), reps: fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }), pain: fc.boolean(), extra: fc.boolean() })
    .map((s) => set(index, { done: s.done, weightKg: s.weightKg, reps: s.reps, pain: s.pain, extra: s.extra }));

const arbDay: fc.Arbitrary<DayV2> = fc.record({
  sets: fc.array(fc.integer({ min: 0, max: 6 }), { minLength: 3, maxLength: 3 }),
  checkin: fc.constantFrom<CheckIn | undefined>(undefined, CHECKIN_FINE, CHECKIN_ALL_BAD, CHECKIN_ILL, { energy: 6 }),
  cardio: fc.array(fc.integer({ min: 0, max: 120 }), { maxLength: 3 }),
  skip: fc.boolean(),
}).chain(({ sets, checkin, cardio, skip }) =>
  fc.tuple(...sets.map((n) => fc.array(fc.integer({ min: 0, max: 9 }), { minLength: n, maxLength: n }).chain((idx) => fc.tuple(...idx.map((i) => arbSet(i)))))).map((perLift) => {
    const exercises = LIFTS.map((l, i) => logged(l.id, { name: l.name, sets: [...(perLift[i] ?? [])], ...(skip && i === 2 ? { skipped: "equipment" as const } : {}) }));
    return day({ exercises, ...(checkin ? { checkin } : {}), cardio: cardio.map((m) => ({ minutes: m })) });
  }),
);

const score = (d: DayV2 | undefined, planned = PLAN, context = emptyContext()) =>
  scoreDay({ dateKey: MON, day: d, planned, plannedDaysPerWeek: 3, history: {}, context, legacy: false, paused: false, allowanceLeft: true, historyComplete: true, utcOffsetMinutes: 0, nowMs: endOfDayMs(MON), metaFor });

describe("day-level invariants", () => {
  const SHARE = trainingShare(3);

  it("XP is never negative and never exceeds the share plus the check-in on a day with no records", () => {
    fc.assert(fc.property(arbDay, (d) => {
      const r = score(d);
      expect(r.xp).toBeGreaterThanOrEqual(0);
      expect(r.xp).toBeLessThanOrEqual(SHARE + XP.checkin);
      expect(r.completion).toBeGreaterThanOrEqual(0);
      expect(r.completion).toBeLessThanOrEqual(1);
    }), { numRuns: 500 });
  });

  it("adding extra sets, extra exercises or a second session never adds XP", () => {
    fc.assert(fc.property(arbDay, fc.integer({ min: 1, max: 5 }), (d, n) => {
      const more: DayV2 = JSON.parse(JSON.stringify(d));
      for (const log of Object.values(more.workout.exercises)) for (let i = 0; i < n; i += 1) log.sets.push(set(log.sets.length, { extra: true }));
      more.workout.exercises.curl = { name: "Cable Curl", sets: doneSets(n) };
      more.workout.cardio.push({ id: "pm", kind: "run", minutes: 60, km: null, source: "manual" });
      expect(score(more).xp).toBe(score(d).xp);
    }), { numRuns: 300 });
  });

  it("an engine-issued REDUCED day pays exactly what FULL pays for the same completion", () => {
    const reducedLifts = LIFTS.map((l) => ({ ...l, sets: 2 }));
    const full = day({ exercises: LIFTS.map((l) => logged(l.id, { name: l.name, sets: doneSets(3) })) });
    const reduced = day({ exercises: reducedLifts.map((l) => logged(l.id, { name: l.name, sets: doneSets(2) })), quest: snapshot("REDUCED", reducedLifts) });
    expect(score(reduced).xp).toBe(score(full).xp);
    expect(score(reduced).xp).toBe(SHARE);
  });

  it("illness never earns training XP, whatever was logged", () => {
    fc.assert(fc.property(arbDay, (d) => {
      const ill: DayV2 = { ...d, checkin: { ...d.checkin, illness: true } };
      const r = score(ill);
      expect(r.status).toBe("protected");
      expect(r.lines.every((l) => l.key === "checkin")).toBe(true);
      expect(r.xp).toBeLessThanOrEqual(XP.checkin);
    }), { numRuns: 300 });
  });

  it("completion is monotone in the work done", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 9 }), fc.integer({ min: 0, max: 9 }), (a, b) => {
      const build = (n: number) => {
        const perLift = [Math.min(3, n), Math.min(3, Math.max(0, n - 3)), Math.min(3, Math.max(0, n - 6))];
        return day({ exercises: LIFTS.map((l, i) => logged(l.id, { name: l.name, sets: doneSets(perLift[i] ?? 0) })) });
      };
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      expect(score(build(hi)).xp).toBeGreaterThanOrEqual(score(build(lo)).xp);
    }), { numRuns: 200 });
  });
});

describe("week-level invariants", () => {
  it("full adherence pays the same training XP for every plan; rest days are the only difference", () => {
    const weeks = [2, 3, 4, 5, 6].map((n) => fullAdherenceWeek(n));
    const trainingXp = weeks.map((w) => Object.values(w.results).flatMap((r) => r.lines).filter((l) => l.key === "training").reduce((n, l) => n + l.xp, 0));
    expect(trainingXp).toEqual([360, 360, 360, 360, 360]);
    // training 360 + check-ins 70 + rest days × 20 + weekly 150
    const totals = weeks.map((w) => w.total);
    expect(totals).toEqual([680, 660, 640, 620, 600]);
    // Rest days are paid, so a 2-day plan earns a little more per week than a 6-day one. Bounded.
    expect(Math.max(...totals) / Math.min(...totals) - 1).toBeLessThanOrEqual(0.14);
  });

  it("a week with zero training earns at most 65% of a full-adherence week, for every plan and check-in pattern", () => {
    const arbCheckin = fc.constantFrom<CheckIn>(CHECKIN_FINE, CHECKIN_ALL_BAD, { sleepQuality: 3, soreness: 8, stress: 5, energy: 6 }, { sleepQuality: 9, soreness: 2, stress: 8, energy: 3 });
    fc.assert(fc.property(fc.integer({ min: 2, max: 6 }), fc.array(arbCheckin, { minLength: 7, maxLength: 7 }), fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }), (n, checkins, recovery) => {
      const prog = planWith(n);
      const days: DayMap = {};
      for (let i = 0; i < 7; i += 1) {
        const key = addDays(MON, i);
        const planned = plannedDay(prog, key);
        const checkin = checkins[i]!;
        const quest = issueDailyQuest({ dateKey: key, programDay: planned, plannedWeeklySets: 27, plannedWeeklyCardioMinutes: 0, checkin, days, issuedAt: `${key}T06:00:00Z` });
        // Faking: tap every rest/recover objective, never lift a thing.
        days[key] = day({ checkin, quest: { ...quest, recoveryDone: recovery[i]! || quest.tier !== "FULL" } });
      }
      const lazy = scoreTheWeek(prog, days).total;
      const honest = fullAdherenceWeek(n).total;
      expect(lazy).toBeLessThanOrEqual(honest * 0.65);
      expect(lazy).toBeGreaterThanOrEqual(0);
    }), { numRuns: 300 });
  });

  it("the weekday of the plan never changes what a full-adherence week earns", () => {
    const totals = new Set<number>();
    for (const start of [0, 1, 2, 3, 4]) {
      const prog = program(week(Object.fromEntries([start, start + 1, start + 2].map((i) => [WEEKDAYS[i % 7], PLAN]))));
      const days: DayMap = {};
      for (let i = 0; i < 7; i += 1) {
        const key = addDays(MON, i);
        days[key] = plannedDay(prog, key).rest ? day({ checkin: CHECKIN_FINE, quest: snapshot("REST", [], { recoveryDone: true }) }) : fullSession();
      }
      totals.add(scoreTheWeek(prog, days).total);
      expect(weekdayName(MON)).toBe("Monday");
    }
    expect(totals.size).toBe(1);
  });

  it("a rest day keeps itself with no entry and a missed training day stays missed", () => {
    const prog = planWith(3);
    const { results } = scoreTheWeek(prog, {});
    expect(results[addDays(MON, 1)]).toMatchObject({ status: "kept", tier: "REST" });
    expect(results[MON]).toMatchObject({ status: "missed", isTrainingDay: true });
    expect(plannedDay(prog, MON)).not.toBe(REST);
  });
});
