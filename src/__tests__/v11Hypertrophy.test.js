import { describe, it, expect, beforeEach } from "vitest";
import { mapExerciseToMuscles, buildWeeklyMuscleVolume, classifyVolume, buildBalanceRatios, buildVolumeReport, weekStartKey, MUSCLE_LANDMARKS } from "../muscleVolume";
import { computeAdaptiveTDEE, buildEnergyTargets, buildDriftCheck, readGoalRate, writeGoalRate } from "../adaptiveTDEE";

// muscleVolume
describe("mapExerciseToMuscles", () => {
  it("maps common lifts to the right primary muscles", () => {
    expect(mapExerciseToMuscles("Incline Bench Press").primary).toContain("chest");
    expect(mapExerciseToMuscles("Barbell Row").primary).toContain("back");
    expect(mapExerciseToMuscles("Romanian Deadlift").primary).toContain("hamstrings");
    expect(mapExerciseToMuscles("Hack Squat").primary).toContain("quads");
    expect(mapExerciseToMuscles("Lateral Raise").primary).toContain("side_delt");
  });

  it("resolves leg curl to hamstrings, not biceps (rule ordering)", () => {
    expect(mapExerciseToMuscles("Lying Leg Curl").primary).toContain("hamstrings");
  });

  it("returns null for unmapped movements", () => {
    expect(mapExerciseToMuscles("Zercher Yoke Carry")).toBeNull();
    expect(mapExerciseToMuscles("")).toBeNull();
  });
});

const liftDay = (exercises) => ({
  workout: {
    exercises: Object.fromEntries(
      Object.entries(exercises).map(([name, n]) => [
        name,
        { sets: Array(n).fill(null).map(() => ({ weight: "100", reps: "8", done: true })) },
      ])
    ),
  },
});

describe("buildWeeklyMuscleVolume", () => {
  it("counts completed sets by calendar week with 0.5 secondary weighting", () => {
    // Mon Jun 22 2026 + Wed Jun 24 = same week
    const data = {
      "2026-06-22": liftDay({ "Bench Press": 4 }),          // chest 4 · tri/front_delt 2
      "2026-06-24": liftDay({ "Barbell Row": 3, "Curl": 2 }), // back 3 · biceps 1.5+2
    };
    const weeks = buildWeeklyMuscleVolume(data);
    expect(weeks.length).toBe(1);
    const m = weeks[0].muscles;
    expect(m.chest).toBe(4);
    expect(m.triceps).toBe(2);
    expect(m.back).toBe(3);
    expect(m.biceps).toBe(3.5);
  });

  it("ignores incomplete sets and surfaces unmapped sets", () => {
    const data = {
      "2026-06-22": {
        workout: { exercises: {
          "Bench Press": { sets: [{ done: true }, { done: false }] },
          "Yoke Carry": { sets: [{ done: true }, { done: true }] },
        } },
      },
    };
    const [wk] = buildWeeklyMuscleVolume(data);
    expect(wk.muscles.chest).toBe(1);
    expect(wk.unmappedSets).toBe(2);
    expect(wk.unmappedNames).toContain("Yoke Carry");
  });

  it("splits weeks on Monday", () => {
    expect(weekStartKey("2026-06-28")).toBe("2026-06-22"); // Sunday → prior Monday
    expect(weekStartKey("2026-06-29")).toBe("2026-06-29"); // Monday → itself
  });
});

describe("classifyVolume + ratios", () => {
  it("classifies against the landmark bands", () => {
    expect(classifyVolume("chest", 5).status).toBe("below_mev");
    expect(classifyVolume("chest", 10).status).toBe("productive");
    expect(classifyVolume("chest", 16).status).toBe("optimal");
    expect(classifyVolume("chest", 21).status).toBe("high");
    expect(classifyVolume("chest", 25).status).toBe("above_mrv");
  });

  it("flags a pressing-heavy week on the rear-delt ratio", () => {
    const ratios = buildBalanceRatios({ chest: 16, front_delt: 6, side_delt: 8, triceps: 8, back: 14, rear_delt: 2, biceps: 10, quads: 12, hamstrings: 10, glutes: 4 });
    const rear = ratios.find(r => r.key === "press_rear");
    expect(rear.ok).toBe(false);
  });
});

describe("buildVolumeReport", () => {
  it("reports not-ready without a real lifting week", () => {
    const r = buildVolumeReport({ "2026-06-22": liftDay({ "Curl": 2 }) });
    expect(r.ready).toBe(false);
  });

  it("builds rows sorted by volume with deltas vs prior week", () => {
    const data = {
      "2026-06-15": liftDay({ "Bench Press": 6, "Barbell Row": 6 }),
      "2026-06-22": liftDay({ "Bench Press": 8, "Barbell Row": 6 }),
    };
    const r = buildVolumeReport(data);
    expect(r.ready).toBe(true);
    const chest = r.rows.find(x => x.key === "chest");
    expect(chest.sets).toBe(8);
    expect(chest.label).toBe("Chest");
    expect(chest.delta).toBe(2);
    expect(r.rows[0].sets).toBeGreaterThanOrEqual(r.rows[r.rows.length - 1].sets);
    expect(Object.keys(MUSCLE_LANDMARKS).length).toBe(r.rows.length);
  });
});

// adaptiveTDEE
function energyFixture({ days = 28, kcal = 3000, dailyLoss = 0 }) {
  // Start June 1 2026, weight drifts linearly; constant intake.
  const data = {};
  for (let i = 0; i < days; i++) {
    const d = new Date("2026-06-01T12:00:00");
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    data[key] = {
      body: { weight: String(185 - dailyLoss * i) },
      nutrition: { calories: String(kcal) },
    };
  }
  return data;
}

describe("computeAdaptiveTDEE", () => {
  it("recovers maintenance on a flat trend", () => {
    const r = computeAdaptiveTDEE(energyFixture({ kcal: 3000, dailyLoss: 0 }));
    expect(r.ready).toBe(true);
    expect(Math.abs(r.tdee - 3000)).toBeLessThan(60);
    expect(r.confidence).toBe("high");
  });

  it("recovers a higher TDEE on a steady cut", () => {
    // Losing ~1 lb/wk on 2500 kcal → TDEE ≈ 3000
    const r = computeAdaptiveTDEE(energyFixture({ kcal: 2500, dailyLoss: 1 / 7 }));
    expect(r.ready).toBe(true);
    expect(r.tdee).toBeGreaterThan(2800);
    expect(r.tdee).toBeLessThan(3150);
  });

  it("refuses on insufficient weigh-ins or calorie days", () => {
    expect(computeAdaptiveTDEE({}).ready).toBe(false);
    const sparse = energyFixture({ days: 28 });
    // strip most calorie logs
    Object.keys(sparse).forEach((k, i) => { if (i % 4 !== 0) delete sparse[k].nutrition; });
    expect(computeAdaptiveTDEE(sparse).ready).toBe(false);
  });

  it("excludes obviously partial calorie days", () => {
    const data = energyFixture({ kcal: 3000 });
    const firstKey = Object.keys(data).sort()[3];
    data[firstKey].nutrition.calories = "200"; // partial log — must not drag the average
    const r = computeAdaptiveTDEE(data);
    expect(Math.abs(r.tdee - 3000)).toBeLessThan(60);
  });
});

describe("targets + drift + goal persistence", () => {
  beforeEach(() => { try { localStorage.clear(); } catch {} });

  it("computes targets from TDEE, rate, and trend weight", () => {
    const t = buildEnergyTargets(3300, -0.5, 184.2);
    expect(t.calories).toBe(3050);
    expect(t.protein).toBe(184);
  });

  it("stays quiet inside the drift dead band, flags beyond it", () => {
    expect(buildDriftCheck(-0.5, -0.6).onTrack).toBe(true);
    const d = buildDriftCheck(-0.5, 0.2); // gaining while trying to cut
    expect(d.onTrack).toBe(false);
    expect(d.adjustKcal).toBeLessThan(0);
    const u = buildDriftCheck(0.25, -0.4); // losing while trying to bulk
    expect(u.onTrack).toBe(false);
    expect(u.adjustKcal).toBeGreaterThan(0);
  });

  it("round-trips the goal rate", () => {
    expect(readGoalRate()).toBeNull();
    writeGoalRate(-0.5);
    expect(readGoalRate()).toBe(-0.5);
  });
});
