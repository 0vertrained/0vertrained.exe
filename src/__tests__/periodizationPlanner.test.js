import { describe, expect, it } from "vitest";
import { buildPeriodizationPlan, getCurrentBlock, suggestPeriodizationAction } from "../periodizationPlanner";

const program = {
  Monday: { type: "Push + Easy Run", lifting: [{ name: "Bench", sets: 4 }], cardio: { miles: 3.5 } },
  Tuesday: { type: "Intervals + Legs", lifting: [{ name: "Squat", sets: 4 }], cardio: { miles: 4.5, effort: "High" } },
  Wednesday: { type: "Pull + Easy Run", lifting: [{ name: "Row", sets: 4 }], cardio: { miles: 3.5 } },
  Thursday: { type: "Hyrox Engine", lifting: [{ name: "Sled Push", sets: 4 }], cardio: { miles: 4.5, effort: "Tempo" } },
  Friday: { type: "Arms + Trunk", lifting: [{ name: "Curl", sets: 4 }], cardio: null },
  Saturday: { type: "Long Run", lifting: [], cardio: { miles: 7 } },
  Sunday: { type: "Full Rest", lifting: [], cardio: null },
};

const entries = {
  "2026-06-01": { workout: { exercises: { Bench: { sets: [{ weight: "185", reps: "5", done: true }] } }, cardio: { miles: "3" } }, nutrition: {}, body: { sleep: "7" } },
  "2026-06-02": { workout: { exercises: { Squat: { sets: [{ weight: "225", reps: "5", done: true }] } }, cardio: { miles: "4" } }, nutrition: {}, body: { sleep: "6" } },
  "2026-06-03": { workout: { exercises: {}, cardio: { miles: "3" } }, nutrition: {}, body: { sleep: "6.5" } },
  "2026-06-04": { workout: { exercises: { Sled: { sets: [{ weight: "100", reps: "10", done: true }] } }, cardio: { miles: "5" } }, nutrition: {}, body: { sleep: "5.8" } },
  "2026-06-05": { workout: { exercises: { Curl: { sets: [{ weight: "40", reps: "10", done: true }] } }, cardio: { miles: "" } }, nutrition: {}, body: { sleep: "6" } },
};

describe("periodizationPlanner", () => {
  it("builds a 4-week block with deload in week 4", () => {
    const plan = buildPeriodizationPlan({ startDate: "2026-06-01", program, entries });
    expect(plan.weeks).toHaveLength(4);
    expect(plan.weeks[0].focus).toBe("base");
    expect(plan.weeks[3].focus).toBe("deload");
    expect(plan.weeks[3].volumeMultiplier).toBeLessThan(1);
  });

  it("finds the current week by date", () => {
    const plan = buildPeriodizationPlan({ startDate: "2026-06-01", program, entries });
    const current = getCurrentBlock(plan, "2026-06-17");
    expect(current.weekNumber).toBe(3);
    expect(current.focus).toBe("intensify");
  });

  it("suggests deload when readiness is rest and training density is high", () => {
    const plan = buildPeriodizationPlan({ startDate: "2026-06-01", program, entries });
    const action = suggestPeriodizationAction({ plan, todayKey: "2026-06-06", recommendation: { readiness: "rest" }, entries });
    expect(action.action).toBe("deload_now");
    expect(action.risk).toBe("high");
  });

  it("suggests progress when readiness is push in build week", () => {
    const plan = buildPeriodizationPlan({ startDate: "2026-06-01", program, entries });
    const action = suggestPeriodizationAction({ plan, todayKey: "2026-06-10", recommendation: { readiness: "push" }, entries });
    expect(action.action).toBe("progress");
    expect(action.suggestedChanges.some(c => c.type === "progression")).toBe(true);
  });

  it("rolls the block anchor forward to include today", () => {
    const plan = buildPeriodizationPlan({ startDate: "2026-05-01", todayKey: "2026-06-27", program, entries });
    expect(plan.startDate <= "2026-06-27").toBe(true);
    expect(plan.weeks[plan.weeks.length - 1].endDate >= "2026-06-27").toBe(true);
  });

  it("honors custom block metadata, length, and deload week", () => {
    const plan = buildPeriodizationPlan({
      startDate: "2026-06-01",
      todayKey: "2026-06-10",
      program,
      entries,
      blockLengthWeeks: 6,
      blockName: "Hyrox Base",
      goal: "Build aerobic base",
      deloadWeek: 5,
    });

    expect(plan.name).toBe("Hyrox Base");
    expect(plan.goal).toBe("Build aerobic base");
    expect(plan.deloadWeek).toBe(5);
    expect(plan.weeks).toHaveLength(6);
    expect(plan.weeks[4].focus).toBe("deload");
    expect(plan.weeks[4].volumeMultiplier).toBeLessThan(1);
  });

  it("exposes endDate equal to the last week's end", () => {
    const plan = buildPeriodizationPlan({ startDate: "2026-06-01", todayKey: "2026-06-10", program, entries, blockLengthWeeks: 6 });
    expect(plan.endDate).toBe(plan.weeks[plan.weeks.length - 1].endDate);
  });

  it("computes currentWeekNumber and completionPct for week 2 of 6", () => {
    const plan = buildPeriodizationPlan({ startDate: "2026-06-01", todayKey: "2026-06-10", program, entries, blockLengthWeeks: 6 });
    expect(plan.currentWeekNumber).toBe(2);
    expect(plan.completionPct).toBe(33);
    expect(plan.summary).toMatch(/Week 2\/6/);
    expect(plan.summary).toMatch(/Deload W6/);
  });

  it("assigns completed/current/upcoming week statuses by today", () => {
    const plan = buildPeriodizationPlan({ startDate: "2026-06-01", todayKey: "2026-06-10", program, entries, blockLengthWeeks: 6 });
    expect(plan.weeks[0].status).toBe("completed"); // 06-01..06-07
    expect(plan.weeks[1].status).toBe("current");   // 06-08..06-14
    expect(plan.weeks[2].status).toBe("upcoming");  // 06-15..06-21
  });

  it("passes through run/strength emphasis", () => {
    const plan = buildPeriodizationPlan({ startDate: "2026-06-01", todayKey: "2026-06-10", program, entries, runEmphasis: "build", strengthEmphasis: "deload" });
    expect(plan.emphasis).toEqual({ run: "build", strength: "deload" });
  });

  it("handles missing data safely", () => {
    const plan = buildPeriodizationPlan({});
    const action = suggestPeriodizationAction({ plan, todayKey: "2026-06-01", recommendation: null, entries: {} });
    expect(plan.weeks.length).toBe(4);
    expect(action.action).toBeTruthy();
    expect(JSON.stringify({ plan, action })).not.toMatch(/NaN/);
  });
});

describe("autoregulated deload (load-driven)", () => {
  it("deloads on high acute load even when readiness is push", () => {
    const plan = buildPeriodizationPlan({ startDate: "2026-06-01", program, entries });
    const action = suggestPeriodizationAction({
      plan, todayKey: "2026-06-10", recommendation: { readiness: "push" }, entries,
      trainingLoad: { ratio: 1.7, zone: "high_risk", monotony: 1.5 },
    });
    expect(action.action).toBe("deload_now");
    expect(action.risk).toBe("high");
  });

  it("holds progression when load is merely elevated", () => {
    const plan = buildPeriodizationPlan({ startDate: "2026-06-01", program, entries });
    const action = suggestPeriodizationAction({
      plan, todayKey: "2026-06-10", recommendation: { readiness: "push" }, entries,
      trainingLoad: { ratio: 1.4, zone: "overreaching", monotony: 1.5 },
    });
    expect(action.action).toBe("maintain");
  });

  it("still progresses on push when load is not provided (backward compatible)", () => {
    const plan = buildPeriodizationPlan({ startDate: "2026-06-01", program, entries });
    const action = suggestPeriodizationAction({ plan, todayKey: "2026-06-10", recommendation: { readiness: "push" }, entries });
    expect(action.action).toBe("progress");
  });
});
