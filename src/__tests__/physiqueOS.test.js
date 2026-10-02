import { describe, expect, it } from "vitest";
import {
  buildCloseoutEntry,
  buildDailyCloseout,
  buildFactorOperatingPlan,
  buildOperatingTargets,
  buildTrainingPrescription,
  recommendDayMode,
  resolveDayMode,
} from "../physiqueOS";

const goals = { calories: 2400, protein: 200 };

describe("Physique OS day modes", () => {
  it("recommends conservative modes from the existing decision engine", () => {
    expect(recommendDayMode({ decision: { call: "maintain" } })).toBe("full");
    expect(recommendDayMode({ decision: { call: "modify" } })).toBe("minimum");
    expect(recommendDayMode({ decision: { call: "recover" } })).toBe("rescue");
    expect(recommendDayMode({ body: { illnessOrInjury: true } })).toBe("rescue");
  });

  it("respects an explicit stored mode", () => {
    expect(resolveDayMode({ storedMode: "minimum", decision: { call: "maintain" } })).toBe("minimum");
    expect(resolveDayMode({ storedMode: "invalid", decision: { call: "modify" } })).toBe("minimum");
  });

  it("turns the active goals into full, minimum, and rescue targets", () => {
    expect(buildOperatingTargets({ mode: "full", goals })).toMatchObject({ calories: 2400, protein: 200, steps: 9000, sleepHours: 8 });
    expect(buildOperatingTargets({ mode: "minimum", goals })).toMatchObject({ calories: 2400, protein: 180, steps: 6000, sleepHours: 8.5 });
    expect(buildOperatingTargets({ mode: "rescue", goals })).toMatchObject({ calories: 2400, protein: 160, steps: 3000, sleepHours: 9 });
  });

  it("honors a configured full-day step target without raising reduced modes", () => {
    const settings = { physiqueOS: { stepTarget: 11000 } };
    expect(buildOperatingTargets({ mode: "full", goals, settings }).steps).toBe(11000);
    expect(buildOperatingTargets({ mode: "minimum", goals, settings }).steps).toBe(6000);
  });
});

describe("Physique OS prescription", () => {
  const day = { type: "Upper Strength", lifting: [{ name: "Bench", sets: 3, reps: 6 }] };

  it("uses the program on a full day", () => {
    const out = buildTrainingPrescription({ mode: "full", decision: { call: "maintain" }, programDay: day });
    expect(out.title).toMatch(/Upper Strength/i);
    expect(out.tone).toBe("maintain");
  });

  it("recognizes nested AM/PM sessions as training", () => {
    const result = buildTrainingPrescription({
      mode: "full",
      programDay: {
        type: "Double Edition",
        lifting: [],
        cardio: null,
        sessions: [
          { id: "am", lifting: [{ name: "Incline Press" }], cardio: null },
          { id: "pm", lifting: [{ name: "Lateral Raise" }], cardio: null },
        ],
      },
    });

    expect(result.title).toBe("Double Edition");
    expect(result.title).not.toMatch(/recovery/i);
  });

  it("turns minimum and rescue modes into clear constraints", () => {
    const minimum = buildTrainingPrescription({ mode: "minimum", decision: { call: "modify" }, programDay: day });
    expect(minimum.title).toMatch(/priority/i);
    const rescue = buildTrainingPrescription({ mode: "rescue", decision: { call: "recover" }, programDay: day });
    expect(rescue.title).toMatch(/recovery/i);
  });
});

describe("Physique OS Factor plan", () => {
  it("surfaces today's two trays and their logging state", () => {
    const out = buildFactorOperatingPlan("2026-07-20", { factorPlan: { factorLunch: "factor-thai" } });
    expect(out.day).toBe(1);
    expect(out.meals).toHaveLength(2);
    expect(out.meals[0]).toMatchObject({ slot: "factorLunch", logged: true });
    expect(out.loggedCount).toBe(1);
  });

  it("stays silent outside the active block", () => {
    expect(buildFactorOperatingPlan("2026-08-01", {})).toBe(null);
  });
});

describe("Physique OS closeout", () => {
  const targets = buildOperatingTargets({ mode: "full", goals });

  it("scores a fully executed day at 100", () => {
    const out = buildDailyCloseout({
      todayData: {
        nutrition: { calories: "2350", protein: "205" },
        body: { sleepQuality: "9", soreness: "2", stress: "2", energy: "9" },
        activity: { steps: "9500" },
      },
      targets,
      totalExercises: 5,
      doneExercises: 5,
    });
    expect(out.score).toBe(100);
    expect(out.status).toBe("complete");
    expect(out.openItems).toHaveLength(0);
  });

  it("allows a partial day to be closed without inventing compliance", () => {
    const out = buildDailyCloseout({
      todayData: {
        nutrition: { calories: "2100", protein: "200" },
        body: { sleepQuality: "6", soreness: "5", stress: "5" },
        activity: { steps: "4000" },
      },
      targets,
      totalExercises: 5,
      doneExercises: 3,
    });
    expect(out.score).toBe(35);
    expect(out.status).toBe("rescue");
    expect(out.openItems.map((item) => item.key)).toEqual(expect.arrayContaining(["training", "steps"]));
  });

  it("accepts wearable steps when no manual step count exists", () => {
    const out = buildDailyCloseout({
      todayData: {
        nutrition: { calories: "2400", protein: "200" },
        body: { sleepQuality: "9", soreness: "2", stress: "2", energy: "9" },
      },
      targets,
      totalExercises: 0,
      isRest: true,
      wearableSteps: 10000,
    });
    expect(out.snapshot.steps).toBe(10000);
    expect(out.score).toBe(100);
  });

  it("creates a stable versioned closeout snapshot", () => {
    const entry = buildCloseoutEntry({ status: "partial", score: 70, snapshot: { mode: "minimum" } }, new Date("2026-07-20T23:00:00.000Z"));
    expect(entry).toEqual({
      version: 1,
      status: "partial",
      score: 70,
      closedAt: "2026-07-20T23:00:00.000Z",
      snapshot: { mode: "minimum" },
    });
  });
});
