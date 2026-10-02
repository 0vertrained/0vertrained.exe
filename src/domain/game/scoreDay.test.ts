import { describe, expect, it } from "vitest";
import { addDays, endOfDayMs } from "../dates";
import type { DayMap, DayV2 } from "../day/schema";
import { CHECKIN_FINE, CHECKIN_ILL, day, doneSets, logged, metaFor, REST, set, snapshot, trainingDay, type LiftSpec } from "../../test/gameFixtures";
import { XP } from "./config";
import { advanceContext, emptyContext, scoreDay, trainingShare, trainingXp, type ScoreDayInput } from "./scoreDay";

const TODAY = "2026-10-05";
const LIFTS: LiftSpec[] = [{ id: "bench", name: "Barbell Bench Press", sets: 3 }, { id: "row", name: "Barbell Row", sets: 3 }];
const PLAN = trainingDay("Upper A", LIFTS);
const SHARE = trainingShare(3);

function score(partial: Partial<ScoreDayInput>) {
  return scoreDay({
    dateKey: TODAY, day: undefined, planned: PLAN, plannedDaysPerWeek: 3, history: {}, context: emptyContext(),
    legacy: false, paused: false, allowanceLeft: true, historyComplete: true, utcOffsetMinutes: 0,
    nowMs: endOfDayMs(TODAY), metaFor, ...partial,
  });
}

/** A full session on the plan: every planned set done. */
const fullSession = (): [string, DayV2["workout"]["exercises"][string]][] => [logged("bench", { sets: doneSets(3) }), logged("row", { sets: doneSets(3) })];

describe("training share and XP", () => {
  it("splits the weekly pool across planned days exactly", () => {
    expect([2, 3, 4, 5, 6].map(trainingShare)).toEqual([180, 120, 90, 72, 60]);
    expect(trainingShare(0)).toBe(360);
  });

  it("pays 60% pro rata and 40% at the cleared threshold", () => {
    expect(trainingXp(120, 1)).toBe(120);
    expect(trainingXp(120, 0.8)).toBe(106);
    expect(trainingXp(120, 0.5)).toBe(36);
    expect(trainingXp(120, 0)).toBe(0);
    expect(trainingXp(120, 2)).toBe(120);
  });
});

describe("a training day", () => {
  it("pays the share plus the check-in for a full session, and keeps the streak", () => {
    const r = score({ day: day({ exercises: fullSession(), checkin: CHECKIN_FINE }) });
    expect(r).toMatchObject({ status: "kept", tier: "FULL", engineIssued: false, cleared: true, completion: 1, completedSets: 6, plannedSets: 6, checkinCounted: true, xp: SHARE + XP.checkin });
    expect(r.lines.map((l) => [l.key, l.xp])).toEqual([["checkin", 10], ["training", SHARE]]);
  });

  it("stays open with partial work until the 48-hour window closes, then counts as missed", () => {
    const d = day({ exercises: [logged("bench", { sets: doneSets(3) })] });
    expect(score({ day: d })).toMatchObject({ status: "open", completion: 0.5, xp: trainingXp(SHARE, 0.5) });
    const late = endOfDayMs(TODAY) + XP.lateLoggingHours * 3_600_000 + 1;
    expect(score({ day: d, nowMs: late })).toMatchObject({ status: "missed", cleared: false });
    expect(score({ day: undefined, nowMs: late })).toMatchObject({ status: "missed", xp: 0, completedSets: 0 });
  });

  it("clears at 80% completion", () => {
    const five = day({ exercises: [logged("bench", { sets: doneSets(3) }), logged("row", { sets: doneSets(2) })] });
    expect(score({ day: five })).toMatchObject({ cleared: true, status: "kept", completion: 5 / 6 });
    const four = day({ exercises: [logged("bench", { sets: doneSets(2) }), logged("row", { sets: doneSets(2) })] });
    expect(score({ day: four })).toMatchObject({ cleared: false, status: "open" });
  });

  it("pays an engine-issued REDUCED day exactly the same share as FULL", () => {
    const reduced = snapshot("REDUCED", [{ id: "bench", name: "Barbell Bench Press", sets: 2 }, { id: "row", name: "Barbell Row", sets: 2 }]);
    const r = score({ day: day({ exercises: [logged("bench", { sets: doneSets(2) }), logged("row", { sets: doneSets(2) })], quest: reduced }) });
    expect(r).toMatchObject({ tier: "REDUCED", engineIssued: true, cleared: true, plannedSets: 4, xp: SHARE });
  });

  it("gives extra sets, extra exercises and second sessions nothing", () => {
    const extra = day({ exercises: [...fullSession(), logged("curl", { sets: doneSets(4) })] });
    extra.workout.exercises.bench!.sets.push(set(3, { extra: true }), set(4, { extra: true }));
    const r = score({ day: extra });
    expect(r).toMatchObject({ completedSets: 6, completion: 1, xp: SHARE });
  });

  it("counts a swapped exercise as planned and a skipped one as nothing", () => {
    const swapped = day({ exercises: [logged("bench", { sets: doneSets(3), performedName: "Dumbbell Bench Press" }), logged("row", { sets: [], skipped: "equipment" })] });
    expect(score({ day: swapped })).toMatchObject({ completedSets: 3, completion: 0.5 });
  });

  it("averages set and cardio completion when the day plans both", () => {
    const plan = trainingDay("Hybrid", LIFTS, { kind: "Easy Run", minutes: 30 });
    const d = day({ exercises: fullSession(), cardio: [{ minutes: 15 }] });
    const r = score({ day: d, planned: plan });
    expect(r).toMatchObject({ completion: 0.75, cardioMinutes: 15, plannedCardioMinutes: 30, cleared: false });
    expect(score({ day: day({ exercises: fullSession(), cardio: [{ minutes: 40 }] }), planned: plan })).toMatchObject({ completion: 1, cleared: true });
    expect(score({ day: day({ cardio: [{ minutes: 24 }] }), planned: trainingDay("Run", [], { kind: "Run", minutes: 30 }) })).toMatchObject({ completion: 0.8, cleared: true, xp: trainingXp(SHARE, 0.8) });
  });

  it("ignores sets completed more than 48 hours after the day ended", () => {
    const onTime = new Date(endOfDayMs(TODAY) + 47 * 3_600_000).toISOString();
    const tooLate = new Date(endOfDayMs(TODAY) + 49 * 3_600_000).toISOString();
    const d = day({ exercises: [logged("bench", { sets: doneSets(3, { completedAt: onTime }) }), logged("row", { sets: doneSets(3, { completedAt: tooLate }) })] });
    expect(score({ day: d })).toMatchObject({ completedSets: 3, completion: 0.5 });
    const d2 = day({ exercises: [logged("bench", { sets: [set(0, { completedAt: "garbage" }), set(1), set(2)] })] });
    expect(score({ day: d2 }).completedSets).toBe(3);
  });

  it("respects the athlete's UTC offset for the window", () => {
    const d = day({ exercises: [logged("bench", { sets: doneSets(3, { completedAt: new Date(endOfDayMs(TODAY) + 48.5 * 3_600_000).toISOString() }) })] });
    expect(score({ day: d, utcOffsetMinutes: 0 }).completedSets).toBe(0);
    expect(score({ day: d, utcOffsetMinutes: -300 }).completedSets).toBe(3);
  });
});

describe("pain credit", () => {
  it("credits the remaining sets once at least one set is done", () => {
    const d = day({ exercises: [logged("bench", { sets: [set(0), set(1, { pain: true }), set(2, { done: false })] }), logged("row", { sets: doneSets(3) })] });
    expect(score({ day: d })).toMatchObject({ completedSets: 6, completion: 1, painCredited: ["bench"] });
  });

  it("gives nothing for pain flagged before the first set", () => {
    const d = day({ exercises: [logged("bench", { sets: [set(0, { done: false, pain: true }), set(1, { done: false }), set(2, { done: false })], skipped: "pain" }), logged("row", { sets: doneSets(3) })] });
    expect(score({ day: d })).toMatchObject({ completedSets: 3, painCredited: [] });
  });

  it("allows at most two pain-credited exercises per rolling week", () => {
    const flagged = (id: string) => logged(id, { sets: [set(0), set(1, { pain: true }), set(2, { done: false })] });
    const context = { ...emptyContext(), painCreditedOn: [`${addDays(TODAY, -6)}:x`, `${addDays(TODAY, -3)}:y`] };
    // The pain-flagged set itself is performed work: two done sets per exercise without credit.
    expect(score({ day: day({ exercises: [flagged("bench"), flagged("row")] }), context })).toMatchObject({ completedSets: 4, painCredited: [] });
    const older = { ...emptyContext(), painCreditedOn: [`${addDays(TODAY, -8)}:x`, `${addDays(TODAY, -3)}:y`] };
    expect(score({ day: day({ exercises: [flagged("bench"), flagged("row")] }), context: older })).toMatchObject({ completedSets: 5, painCredited: ["bench"] });
  });
});

describe("rest, recovery and illness", () => {
  it("keeps a scheduled rest day by itself and pays the recovery objective", () => {
    expect(score({ planned: REST, day: undefined })).toMatchObject({ status: "kept", tier: "REST", cleared: true, xp: 0, isTrainingDay: false });
    const r = score({ planned: REST, day: day({ recoveryDone: true, checkin: CHECKIN_FINE, quest: snapshot("REST", [], { recoveryDone: true }) }) });
    expect(r.lines.map((l) => [l.key, l.xp])).toEqual([["checkin", 10], ["rest", XP.restDay]]);
    expect(r.xp).toBe(XP.restDay + XP.checkin);
  });

  it("pays an engine RECOVER day the full share once a week, then the rest rate", () => {
    const recover = day({ quest: snapshot("RECOVER", [], { recoveryDone: true }) });
    expect(score({ day: recover })).toMatchObject({ status: "kept", tier: "RECOVER", cleared: true, isTrainingDay: true, xp: SHARE });
    const paid = { ...emptyContext(), recoverPaidOn: [addDays(TODAY, -4)] };
    expect(score({ day: recover, context: paid })).toMatchObject({ xp: XP.restDay });
    const longAgo = { ...emptyContext(), recoverPaidOn: [addDays(TODAY, -8)] };
    expect(score({ day: recover, context: longAgo })).toMatchObject({ xp: SHARE });
    expect(score({ day: day({ quest: snapshot("RECOVER", []) }) })).toMatchObject({ status: "open", xp: 0, cleared: false });
  });

  it("gives training logged on a RECOVER day no XP", () => {
    const r = score({ day: day({ exercises: fullSession(), quest: snapshot("RECOVER", [], { recoveryDone: true }) }) });
    expect(r.xp).toBe(SHARE);
    expect(r.lines.some((l) => l.key === "training")).toBe(false);
  });

  it("protects an illness day and pays only the check-in, even with training logged", () => {
    const r = score({ day: day({ exercises: fullSession(), checkin: CHECKIN_ILL }) });
    expect(r).toMatchObject({ status: "protected", illness: true, tier: "RECOVER", xp: XP.checkin });
    expect(score({ day: day({ checkin: CHECKIN_ILL }), planned: REST })).toMatchObject({ status: "protected", tier: "REST" });
  });

  it("drops protection once the allowance is used up", () => {
    const r = score({ day: day({ exercises: fullSession(), checkin: CHECKIN_ILL }), allowanceLeft: false });
    expect(r).toMatchObject({ status: "kept", illness: false, xp: SHARE + XP.checkin });
  });

  it("marks a paused day protected with no quest", () => {
    expect(score({ paused: true, day: day({ exercises: fullSession() }) })).toMatchObject({ status: "protected", paused: true, tier: null, xp: 0 });
    expect(score({ paused: true, allowanceLeft: false, day: day({ exercises: fullSession() }) })).toMatchObject({ status: "kept", paused: false });
  });
});

describe("legacy and neutral days", () => {
  it("scores an imported day with work as a flat kept day", () => {
    const r = score({ legacy: true, day: day({ exercises: fullSession(), checkin: CHECKIN_FINE }) });
    expect(r).toMatchObject({ legacy: true, status: "kept", cleared: true, xp: XP.legacyTrainingDay + XP.checkin, tier: null });
    expect(score({ legacy: true, day: day({ cardio: [{ minutes: 20 }] }) }).xp).toBe(XP.legacyTrainingDay);
  });

  it("treats an imported day without work, and a day with no program, as neutral", () => {
    expect(score({ legacy: true, day: day({ checkin: CHECKIN_FINE }) })).toMatchObject({ status: "neutral", xp: 0 });
    expect(score({ legacy: true, day: undefined })).toMatchObject({ status: "neutral" });
    expect(score({ planned: null, day: day({ checkin: CHECKIN_FINE }) })).toMatchObject({ status: "neutral", xp: XP.checkin, tier: null });
  });
});

describe("records", () => {
  function history(sessions: number, weightKg: number): DayMap {
    const h: DayMap = {};
    for (let i = 1; i <= sessions; i += 1) h[addDays(TODAY, -i * 2)] = day({ exercises: [logged("bench", { name: "Barbell Bench Press", sets: doneSets(3, { weightKg, reps: 5 }) })] });
    return h;
  }
  const pr = (weightKg: number, extra = false) => day({ exercises: [logged("bench", { name: "Barbell Bench Press", sets: [...doneSets(3, { weightKg: 60, reps: 5 }), ...(extra ? [set(3, { weightKg, reps: 5, extra: true })] : [])] }), logged("row", { sets: doneSets(3) })] });

  it("pays one record a day after three prior exposures", () => {
    const d = day({ exercises: [logged("bench", { name: "Barbell Bench Press", sets: doneSets(3, { weightKg: 70, reps: 5 }) }), logged("row", { sets: doneSets(3) })] });
    const r = score({ day: d, history: history(3, 60) });
    expect(r.recordXp).toHaveLength(1);
    expect(r.records.find((x) => x.exerciseId === "bench")).toMatchObject({ isRecord: true, previous: expect.any(Number) });
    expect(r.lines.at(-1)).toEqual({ key: "record", label: "Record · Barbell Bench Press", xp: XP.record });
    expect(r.xp).toBe(SHARE + XP.record);
    expect(score({ day: d, history: history(2, 60) }).recordXp).toHaveLength(0);
  });

  it("never pays for a record from extra sets, on a recovery day, or before history is loaded", () => {
    const h = history(3, 60);
    expect(score({ day: pr(80, true), history: h }).recordXp).toHaveLength(0);
    const recoverDay = day({ exercises: [logged("bench", { name: "Barbell Bench Press", sets: doneSets(3, { weightKg: 80, reps: 5 }) })], quest: snapshot("RECOVER", [], { recoveryDone: true }) });
    const rr = score({ day: recoverDay, history: h });
    expect(rr.records.some((x) => x.isRecord)).toBe(true);
    expect(rr.recordXp).toHaveLength(0);
    const d = day({ exercises: [logged("bench", { name: "Barbell Bench Press", sets: doneSets(3, { weightKg: 80, reps: 5 }) })] });
    expect(score({ day: d, history: h, historyComplete: false }).recordXp).toHaveLength(0);
  });

  it("caps record XP at two per rolling week", () => {
    const d = day({ exercises: [logged("bench", { name: "Barbell Bench Press", sets: doneSets(3, { weightKg: 80, reps: 5 }) })] });
    const spent = { ...emptyContext(), recordXpOn: [addDays(TODAY, -5), addDays(TODAY, -2)] };
    expect(score({ day: d, history: history(3, 60), context: spent }).recordXp).toHaveLength(0);
    const oneLeft = { ...emptyContext(), recordXpOn: [addDays(TODAY, -9), addDays(TODAY, -2)] };
    expect(score({ day: d, history: history(3, 60), context: oneLeft }).recordXp).toHaveLength(1);
  });
});

describe("advanceContext", () => {
  it("records the rolling-window events a day produced", () => {
    const h: DayMap = {};
    for (let i = 1; i <= 3; i += 1) h[addDays(TODAY, -i)] = day({ exercises: [logged("bench", { name: "Barbell Bench Press", sets: doneSets(3, { weightKg: 60, reps: 5 }) })] });
    const d = day({ exercises: [logged("bench", { name: "Barbell Bench Press", sets: [set(0, { weightKg: 80, reps: 5 }), set(1, { pain: true }), set(2, { done: false })] }), logged("row", { sets: doneSets(3) })] });
    const next = advanceContext(emptyContext(), score({ day: d, history: h }));
    expect(next).toEqual({ recoverPaidOn: [], painCreditedOn: [`${TODAY}:bench`], recordXpOn: [TODAY] });
    const recover = score({ day: day({ quest: snapshot("RECOVER", [], { recoveryDone: true }) }) });
    expect(advanceContext(emptyContext(), recover).recoverPaidOn).toEqual([TODAY]);
    const restRate = score({ day: day({ quest: snapshot("RECOVER", [], { recoveryDone: true }) }), context: { ...emptyContext(), recoverPaidOn: [addDays(TODAY, -1)] } });
    expect(advanceContext(emptyContext(), restRate).recoverPaidOn).toEqual([]);
  });
});
