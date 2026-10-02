import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import type { DayMap } from "../day/schema";
import { CHECKIN_ALL_BAD, CHECKIN_FINE, CHECKIN_ILL, CHECKIN_ROUGH, day, doneSets, logged, REST, trainingDay } from "../../test/gameFixtures";
import { REDUCED, RULES_VERSION } from "./config";
import { issueDailyQuest, nextAction, questReason, scaleReduced, synthesizeQuest } from "./quest";
import type { DayResult, TrialSpec } from "./types";

const TODAY = "2026-10-05";
const upper = trainingDay("Upper A", [{ id: "bench", sets: 4 }, { id: "row", sets: 3 }, { id: "curl", sets: 1 }], { kind: "Easy Run", minutes: 30 });

const issue = (overrides: Partial<Parameters<typeof issueDailyQuest>[0]> = {}) =>
  issueDailyQuest({ dateKey: TODAY, programDay: upper, plannedWeeklySets: 40, plannedWeeklyCardioMinutes: 90, days: {}, issuedAt: "2026-10-05T06:00:00Z", ...overrides });

describe("issueDailyQuest", () => {
  it("issues a FULL quest with the whole plan when the check-in is fine", () => {
    const q = issue({ checkin: CHECKIN_FINE });
    expect(q).toMatchObject({ rulesVersion: RULES_VERSION, tier: "FULL", engineIssued: true, issuedAt: "2026-10-05T06:00:00Z" });
    expect(q.planned).toEqual({
      exercises: [
        { id: "bench", name: "bench", sets: 4, reps: "8", trackingMode: "loaded_reps" },
        { id: "row", name: "row", sets: 3, reps: "8", trackingMode: "loaded_reps" },
        { id: "curl", name: "curl", sets: 1, reps: "8", trackingMode: "loaded_reps" },
      ],
      plannedSets: 8,
      cardioMinutes: 30,
      cardioKind: "Easy Run",
    });
    expect(q.reason).toBe("Full quest. Upper A, 3 exercises, 8 sets · Easy Run 30 min.");
  });

  it("scales a REDUCED day: one set less per lift (never below one), shorter cardio", () => {
    const q = issue({ checkin: CHECKIN_ROUGH });
    expect(q.tier).toBe("REDUCED");
    expect(q.planned.exercises.map((e) => e.sets)).toEqual([3, 2, 1]);
    expect(q.planned.plannedSets).toBe(6);
    expect(q.planned.cardioMinutes).toBe(20);
    expect(q.reason).toBe("Slept poorly + very sore: Reduced quest. One set less per lift, shorter cardio. Same XP.");
    expect(scaleReduced(trainingDay("x", [{ id: "a", sets: 1 }], { kind: "Run", minutes: 5 })).cardioMinutes).toBe(REDUCED.cardioRoundMinutes);
    expect(scaleReduced(trainingDay("x", [{ id: "a", sets: 1 }])).cardioMinutes).toBeNull();
  });

  it("issues RECOVER with no planned work when all four taps are rough, or on illness", () => {
    const q = issue({ checkin: CHECKIN_ALL_BAD });
    expect(q.tier).toBe("RECOVER");
    expect(q.planned).toEqual({ exercises: [], plannedSets: 0, cardioMinutes: null, cardioKind: "Easy Run" });
    expect(q.reason).toMatch(/recovery day\. A 20-minute walk/);
    expect(issue({ checkin: CHECKIN_ILL }).reason).toBe("Ill or injured: rest today. Streak protected.");
  });

  it("issues REST on a scheduled rest day", () => {
    const q = issue({ programDay: REST, checkin: CHECKIN_FINE });
    expect(q).toMatchObject({ tier: "REST", planned: { exercises: [], plannedSets: 0, cardioMinutes: null } });
    expect(q.reason).toBe("Rest day. A walk or some mobility keeps the streak.");
    expect(issue({ programDay: REST, checkin: CHECKIN_ILL }).reason).toBe("Rest day. Ill or injured: streak protected.");
  });

  it("lets the load guard cap a great check-in at REDUCED", () => {
    const days: DayMap = {};
    for (let i = 1; i <= 6; i += 1) days[addDays(TODAY, -i)] = day({ exercises: [logged("bench", { sets: doneSets(3) })] });
    const q = issue({ checkin: { sleepQuality: 9, soreness: 2, stress: 2, energy: 9 }, days });
    expect(q.tier).toBe("REDUCED");
    expect(q.reason).toBe("6 training days in a row: Reduced quest. One set less per lift, shorter cardio. Same XP.");
  });

  it("attaches a Rank Trial only to a FULL day that contains its exercise", () => {
    const trial: TrialSpec = { targetRank: "C", kind: "loaded", exerciseId: "bench", exerciseName: "bench", loadKg: 80, reps: 5, minutes: null, spec: "5 × 80 kg" };
    expect(issue({ checkin: CHECKIN_FINE, trial }).trial).toEqual({ targetRank: "C", exerciseId: "bench", spec: "5 × 80 kg" });
    expect(issue({ checkin: CHECKIN_ROUGH, trial }).trial).toBeUndefined();
    expect(issue({ checkin: CHECKIN_FINE, trial: { ...trial, exerciseId: "deadlift" } }).trial).toBeUndefined();
    const cardio: TrialSpec = { ...trial, kind: "cardio", exerciseId: null, exerciseName: null, loadKg: null, reps: null, minutes: 20 };
    expect(issue({ checkin: CHECKIN_FINE, trial: cardio }).trial).toEqual({ targetRank: "C", exerciseId: "cardio", spec: "5 × 80 kg" });
    expect(issue({ checkin: CHECKIN_FINE, trial: cardio, programDay: trainingDay("Lift only", [{ id: "bench" }]) }).trial).toBeUndefined();
  });
});

describe("synthesizeQuest", () => {
  it("builds a FULL snapshot for a past day that never had one", () => {
    const q = synthesizeQuest(upper, "2026-09-01");
    expect(q).toMatchObject({ tier: "FULL", engineIssued: false, issuedAt: "2026-09-01T00:00:00.000Z", planned: { plannedSets: 8, cardioMinutes: 30 } });
    expect(synthesizeQuest(REST, "2026-09-01")).toMatchObject({ tier: "REST", planned: { exercises: [], plannedSets: 0, cardioMinutes: null } });
  });
});

describe("questReason", () => {
  it("describes a lift-only and a cardio-only plan", () => {
    const decision = { tier: "FULL" as const, reason: "", drivers: [], illness: false, capped: false };
    expect(questReason(decision, trainingDay("Legs", [{ id: "squat", sets: 5 }]))).toBe("Full quest. Legs, 1 exercise, 5 sets.");
    expect(questReason(decision, trainingDay("Run", [], { kind: "Long Run", km: 10 }))).toBe("Full quest. Long Run 60 min.");
  });
});

describe("nextAction", () => {
  const base = (p: Partial<DayResult>): DayResult => ({
    dateKey: TODAY, status: "open", tier: "FULL", engineIssued: true, isTrainingDay: true, illness: false, paused: false, legacy: false,
    completion: 0, completedSets: 0, plannedSets: 12, cardioMinutes: 0, plannedCardioMinutes: 0, cleared: false, checkinCounted: true,
    recoveryDone: false, painCredited: [], records: [], recordXp: [], lines: [], xp: 0, reason: "", ...p,
  });

  it("walks the primary button through the day", () => {
    expect(nextAction(base({ checkinCounted: false }), undefined)).toEqual({ key: "checkin", label: "Check in", primary: true });
    expect(nextAction(base({}), undefined)).toEqual({ key: "begin", label: "Begin quest", primary: true });
    expect(nextAction(base({ completedSets: 7 }), undefined)).toEqual({ key: "continue", label: "Continue · 7 / 12", primary: true });
    expect(nextAction(base({ cleared: true, xp: 130 }), undefined)).toEqual({ key: "claim", label: "Claim rewards", primary: true });
    expect(nextAction(base({ cleared: true, xp: 130 }), day({ claimedAt: "2026-10-05T08:00:00Z" }))).toEqual({ key: "cleared", label: "Quest cleared · +130 XP", primary: false });
  });

  it("handles cardio-only, rest, recover and paused days", () => {
    expect(nextAction(base({ plannedSets: 0, plannedCardioMinutes: 30 }), undefined)).toEqual({ key: "cardio", label: "Log cardio", primary: true });
    expect(nextAction(base({ tier: "REST", isTrainingDay: false, plannedSets: 0 }), undefined)).toEqual({ key: "recovery", label: "Mark recovery done", primary: true });
    expect(nextAction(base({ tier: "RECOVER", recoveryDone: true, xp: 120 }), undefined)).toEqual({ key: "claim", label: "Claim rewards", primary: true });
    expect(nextAction(base({ tier: "RECOVER", recoveryDone: true, xp: 120 }), day({ recoveryDone: true, claimedAt: "x" }))).toMatchObject({ key: "cleared" });
    expect(nextAction(base({ paused: true }), undefined)).toEqual({ key: "paused", label: "Training paused", primary: false });
    expect(nextAction(base({ status: "neutral", tier: null, isTrainingDay: false }), undefined)).toEqual({ key: "none", label: "", primary: false });
    expect(nextAction(base({ plannedSets: 0 }), undefined)).toEqual({ key: "none", label: "", primary: false });
  });

  it("reads the check-in from the day when the result predates it", () => {
    expect(nextAction(base({ checkinCounted: false }), day({ checkin: CHECKIN_FINE }))).toMatchObject({ key: "begin" });
  });
});
