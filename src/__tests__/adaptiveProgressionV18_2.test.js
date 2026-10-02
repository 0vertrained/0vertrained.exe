import { describe, expect, it } from "vitest";
import {
  buildExercisePrescription,
  buildProgressionDecision,
  buildStrengthRetentionAlert,
  getExerciseSessions,
  parseRepRange,
} from "../progressionEngine";
import { buildDeloadRecommendation } from "../fatigueManagement";
import { buildSessionArbitration, buildSessionVolumeProjection } from "../trainingArbitration";
import { getRankedSubstitutions } from "../exerciseSubstitutions";

const exercise = { name: "Incline Dumbbell Press", sets: 3, reps: "8–10", weightIncrement: 5 };

function liftEntry(name, sets, body = {}) {
  return {
    body,
    workout: {
      exercises: {
        [name]: { sets: sets.map((set) => ({ done: true, quality: "clean", rir: "2", ...set })) },
      },
    },
  };
}

function session(weight, reps, extra = {}) {
  return reps.map((value) => ({ weight: String(weight), reps: String(value), ...extra }));
}

describe("V18.2 adaptive progression", () => {
  it("parses single and ranged prescriptions", () => {
    expect(parseRepRange("6–10")).toEqual({ min: 6, max: 10 });
    expect(parseRepRange(8)).toEqual({ min: 8, max: 8 });
  });

  it("adds load only after every set reaches the upper target cleanly", () => {
    const data = { "2026-07-13": liftEntry(exercise.name, session(75, [10, 10, 10])) };
    const out = buildExercisePrescription({ data, exercise, todayKey: "2026-07-20" });
    expect(out.kind).toBe("add_load");
    expect(out.targetWeight).toBe(80);
    expect(out.targetReps).toEqual([8, 8, 8]);
  });

  it("holds load and adds one rep to the weakest set", () => {
    const data = { "2026-07-13": liftEntry(exercise.name, session(75, [10, 9, 8])) };
    const out = buildExercisePrescription({ data, exercise, todayKey: "2026-07-20" });
    expect(out.kind).toBe("add_reps");
    expect(out.targetWeight).toBe(75);
    expect(out.targetReps).toEqual([10, 10, 8]);
  });

  it("does not add load when upper-range work was a grind", () => {
    const data = { "2026-07-13": liftEntry(exercise.name, session(75, [10, 10, 10], { rir: "0", quality: "grind" })) };
    const out = buildExercisePrescription({ data, exercise, todayKey: "2026-07-20" });
    expect(out.kind).toBe("hold_for_quality");
    expect(out.targetWeight).toBe(75);
  });

  it("reduces load after pain or form breakdown", () => {
    const data = { "2026-07-13": liftEntry(exercise.name, session(75, [8, 8, 8], { pain: true })) };
    const out = buildExercisePrescription({ data, exercise, todayKey: "2026-07-20" });
    expect(out.kind).toBe("reduce_load");
    expect(out.targetWeight).toBe(70);
    expect(out.caution).toMatch(/Stop the movement/i);
  });

  it("requires three non-improving exposures before calling a stall", () => {
    const two = {
      "2026-07-06": liftEntry(exercise.name, session(75, [8, 8, 8])),
      "2026-07-13": liftEntry(exercise.name, session(75, [8, 8, 8])),
    };
    expect(buildExercisePrescription({ data: two, exercise, todayKey: "2026-07-20" }).kind).not.toBe("reset");

    const three = {
      ...two,
      "2026-06-29": liftEntry(exercise.name, session(75, [8, 8, 8])),
    };
    expect(buildExercisePrescription({ data: three, exercise, todayKey: "2026-07-20" }).kind).toBe("reset");
  });

  it("does not mistake one poor day after prior progress for a stall", () => {
    const data = {
      "2026-06-29": liftEntry(exercise.name, session(75, [8, 8, 8])),
      "2026-07-06": liftEntry(exercise.name, session(75, [10, 9, 9])),
      "2026-07-13": liftEntry(exercise.name, session(75, [8, 8, 8])),
    };
    expect(buildExercisePrescription({ data, exercise, todayKey: "2026-07-20" }).kind).not.toBe("reset");
  });

  it("keeps substituted movement history separate from the planned exercise", () => {
    const data = {
      "2026-07-13": {
        workout: {
          exercises: {
            "Barbell Bench Press": {
              performedName: "Machine Chest Press",
              sets: session(160, [10, 10, 10]).map((set) => ({ ...set, done: true })),
            },
          },
        },
      },
    };
    expect(getExerciseSessions(data, "Barbell Bench Press", "2026-07-20", { exercise: { name: "Barbell Bench Press", sets: 3, reps: 10 } })).toHaveLength(0);
    expect(getExerciseSessions(data, "Machine Chest Press", "2026-07-20", { exercise: { name: "Machine Chest Press", sets: 3, reps: 10 } })).toHaveLength(1);
  });

  it("records accepted versus overridden targets", () => {
    const prescription = { kind: "add_load", sourceDate: "2026-07-13", targetWeight: 80, targetReps: [8, 8, 8] };
    expect(buildProgressionDecision(prescription, { weight: "80" }).status).toBe("accepted");
    expect(buildProgressionDecision(prescription, { weight: "75" }).status).toBe("overridden");
  });
});

describe("V18.2 fatigue and load arbitration", () => {
  it("does not deload from one isolated bad metric", () => {
    const data = {
      "2026-07-19": { body: { sleep: "4" }, workout: { exercises: {} } },
    };
    expect(buildDeloadRecommendation({ data, todayKey: "2026-07-20" }).status).toBe("none");
  });

  it("recommends a deload only when several fatigue signals agree", () => {
    const data = {};
    for (let day = 14; day <= 20; day += 1) {
      const key = `2026-07-${day}`;
      data[key] = liftEntry("Bench Press", session(185, [5, 5, 5], { rir: "0", quality: "grind" }), {
        sleep: "5.5",
        soreness: "8",
        motivation: "3",
        restingHeartRate: "72",
        hrv: "30",
      });
    }
    for (let day = 20; day <= 30; day += 1) {
      const key = `2026-06-${day}`;
      data[key] = { body: { restingHeartRate: "58", hrv: "55" }, workout: { exercises: {} } };
    }
    const out = buildDeloadRecommendation({ data, todayKey: "2026-07-20" });
    expect(out.status).toBe("deload");
    expect(out.prescription.volumeReductionPct).toBe(35);
  });

  it("pauses optimization when a safety flag is active", () => {
    const out = buildDeloadRecommendation({ data: {}, todayKey: "2026-07-20", safetyFlag: true });
    expect(out.status).toBe("safety");
    expect(out.prescription).toBeNull();
  });

  it("does not stack a missed AM session into PM", () => {
    const programDay = {
      sessions: [
        { id: "am", label: "AM", lifting: [{ name: "Bench", sets: 3, reps: 8 }] },
        { id: "pm", label: "PM", lifting: [{ name: "Lateral Raise", sets: 4, reps: 12 }] },
      ],
    };
    const out = buildSessionArbitration({ programDay, workoutData: { exercises: {} }, sessionId: "pm" });
    expect(out.status).toBe("do_not_stack");
  });

  it("protects hard PM cardio after high-effort AM lower-body work", () => {
    const programDay = {
      sessions: [
        { id: "am", label: "AM", lifting: [{ name: "Back Squat", sets: 3, reps: 5 }] },
        { id: "pm", label: "PM", lifting: [], cardio: { type: "Intervals", effort: "High" } },
      ],
    };
    const workoutData = {
      exercises: {
        "Back Squat": { sets: session(315, [5, 5, 5], { rir: "0", quality: "grind" }).map((set) => ({ ...set, done: true })) },
      },
    };
    const out = buildSessionArbitration({ programDay, workoutData, sessionId: "pm" });
    expect(out.status).toBe("reduce");
    expect(out.guidance).toMatch(/Zone 2/i);
  });

  it("projects remaining hard sets into the weekly muscle ledger", () => {
    const data = { "2026-07-20": liftEntry("Lateral Raise", session(20, [12, 12])) };
    const projection = buildSessionVolumeProjection({
      data,
      todayKey: "2026-07-20",
      lifting: [{ name: "Lateral Raise", sets: 4, reps: 12 }],
      workoutData: data["2026-07-20"].workout,
    });
    const sideDelts = projection.rows.find((row) => row.key === "side_delt");
    expect(sideDelts.current).toBe(2);
    expect(sideDelts.projected).toBe(4);
  });
});

describe("V18.2 substitution ranking and strength retention", () => {
  it("re-ranks substitutions for joint-friendly needs", () => {
    const out = getRankedSubstitutions("Overhead Press", { reason: "joint" });
    expect(out.reason).toBe("joint");
    expect(out.subs[0].tags).toContain("joint-friendly");
  });

  it("requires multiple declining lifts for a retention alert", () => {
    const data = {};
    const names = ["Bench Press", "Barbell Row", "Back Squat"];
    for (const name of names) {
      data["2026-06-20"] ||= { workout: { exercises: {} } };
      data["2026-06-20"].workout.exercises[name] = { sets: session(200, [8]).map((set) => ({ ...set, done: true })) };
      data["2026-07-15"] ||= { workout: { exercises: {} } };
      data["2026-07-15"].workout.exercises[name] = { sets: session(180, [8]).map((set) => ({ ...set, done: true })) };
    }
    const out = buildStrengthRetentionAlert({ data, todayKey: "2026-07-20", exerciseNames: names });
    expect(["watch", "action"]).toContain(out.status);
    expect(out.declines.length).toBe(3);
  });
});
