import { describe, expect, it } from "vitest";
import { buildTodayPlan, buildQuickLogStatus, buildNextAction } from "../todaySummary";

describe("buildTodayPlan", () => {
  const day = {
    type: "Lower Strength",
    lifting: [{ name: "Back Squat", sets: 4, reps: 5 }],
  };

  it("shows the planned label and no modification when the call keeps the plan", () => {
    const out = buildTodayPlan({ programDay: day, decision: { call: "maintain", primaryAction: "Run your planned session." } });
    expect(out.plannedLabel).toBe("Lower Strength");
    expect(out.focus).toBe("LIFT");
    expect(out.showModification).toBe(false);
  });

  it("surfaces a plain modification delta when the decision modifies training", () => {
    const out = buildTodayPlan({
      programDay: day,
      decision: { call: "modify", primaryAction: "Train, but scale volume and intensity back." },
    });
    expect(out.showModification).toBe(true);
    expect(out.todayLine).toBe("Train, but scale volume and intensity back.");
    expect(out.modifyTag).toBe("modify");
  });

  it("falls back to a call-derived line when the decision has no primary action", () => {
    const out = buildTodayPlan({ programDay: day, decision: { call: "recover" } });
    expect(out.showModification).toBe(true);
    expect(out.todayLine).toMatch(/recovery/i);
  });

  it("never modifies a rest day", () => {
    const out = buildTodayPlan({ programDay: null, decision: { call: "recover" } });
    expect(out.isRest).toBe(true);
    expect(out.focus).toBe("REST");
    expect(out.showModification).toBe(false);
  });

  it("labels a combined lift + cardio day", () => {
    const out = buildTodayPlan({
      programDay: { type: "Upper", lifting: [{ name: "Bench", sets: 3, reps: 5 }], cardio: { type: "Row", miles: 2, effort: "Zone 2" } },
      decision: { call: "push" },
    });
    expect(out.focus).toBe("LIFT + CARDIO");
    expect(out.hasCardio).toBe(true);
  });
});

describe("buildQuickLogStatus", () => {
  it("reports workout completion, check-in completeness, and macro progress", () => {
    const items = buildQuickLogStatus({
      nutrition: { water: 64, protein: 100, calories: 1800 },
      goals: { water: 128, protein: 200, calories: 3600 },
      doneExercises: 2,
      totalExercises: 4,
      body: { sleep: "7", energy: "8", soreness: "" },
    });
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey.workout.value).toBe("2/4");
    expect(byKey.checkin.value).toBe("2/3");
    expect(byKey.water.value).toBe("50%");
    expect(byKey.protein.value).toBe("50%");
    expect(byKey.calories.value).toBe("50%");
  });

  it("marks a fully complete workout as good and handles a rest day", () => {
    const items = buildQuickLogStatus({ nutrition: {}, goals: {}, doneExercises: 3, totalExercises: 3 });
    const workout = items.find((i) => i.key === "workout");
    expect(workout.value).toBe("3/3");
    expect(workout.tone).toBe("good");

    const rest = buildQuickLogStatus({ nutrition: {}, goals: {}, totalExercises: 0 });
    expect(rest.find((i) => i.key === "workout").value).toBe("—");
  });

  it("never divides by a zero or missing goal", () => {
    const items = buildQuickLogStatus({ nutrition: { protein: 50 }, goals: { protein: 0 } });
    expect(items.find((i) => i.key === "protein").value).toBe("0%");
  });
});

describe("buildNextAction", () => {
  it("prompts the check-in on a rest day", () => {
    const out = buildNextAction({ isRest: true });
    expect(out.status).toBe("rest");
    expect(out.label).toBe("Log your check-in");
    expect(out.target).toBe("checkin");
  });

  it("treats an empty day (no lifts, no cardio) as a check-in prompt", () => {
    const out = buildNextAction({ totalExercises: 0, hasCardio: false });
    expect(out.status).toBe("rest");
    expect(out.target).toBe("checkin");
  });

  it("says Start logging when a lifting session has not begun", () => {
    const out = buildNextAction({ totalExercises: 4, doneExercises: 0 });
    expect(out.status).toBe("start");
    expect(out.label).toBe("Start logging");
    expect(out.detail).toContain("4 exercises");
    expect(out.target).toBe("log");
  });

  it("says Continue logging mid-session with a progress detail", () => {
    const out = buildNextAction({ totalExercises: 4, doneExercises: 2 });
    expect(out.status).toBe("continue");
    expect(out.label).toBe("Continue logging");
    expect(out.detail).toContain("2 of 4");
  });

  it("routes to cardio once lifts are done but cardio is unlogged", () => {
    const out = buildNextAction({ totalExercises: 3, doneExercises: 3, hasCardio: true, cardioLogged: false });
    expect(out.status).toBe("cardio");
    expect(out.label).toBe("Log your cardio");
    expect(out.target).toBe("log");
  });

  it("says Start logging on a cardio-only day before any effort is logged", () => {
    const out = buildNextAction({ totalExercises: 0, hasCardio: true, cardioLogged: false });
    expect(out.status).toBe("cardio");
    expect(out.label).toBe("Start logging");
  });

  it("finishes the session once all training is logged", () => {
    const out = buildNextAction({ totalExercises: 3, doneExercises: 3, hasCardio: true, cardioLogged: true });
    expect(out.status).toBe("done");
    expect(out.label).toBe("Finish session");
    expect(out.tone).toBe("good");
    expect(out.target).toBe("checkin");
  });

  it("finishes a lift-only day when every exercise is complete", () => {
    const out = buildNextAction({ totalExercises: 2, doneExercises: 2, hasCardio: false });
    expect(out.status).toBe("done");
  });

  it("defaults to a check-in prompt with no arguments", () => {
    const out = buildNextAction();
    expect(out.status).toBe("rest");
  });
});
