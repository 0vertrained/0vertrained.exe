import { describe, expect, it } from "vitest";
import { buildWeeklyCoachReview } from "../weeklyCoachReview";

const endKey = "2026-07-20";

function key(offset) {
  const date = new Date(`${endKey}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function day({ weight = 190, waist = 38, calories = 2400, protein = 205, steps = 9500, sleep = 7.5, workout = true } = {}) {
  return {
    workout: { exercises: workout ? { "Incline Press": { sets: [{ weight: "80", reps: "8", rir: "2", done: true, quality: "clean" }] } } : {}, cardio: { miles: "0" } },
    nutrition: { calories: String(calories), protein: String(protein), water: "128" },
    activity: { steps: String(steps) },
    body: { weight: String(weight), waist: String(waist), sleep: String(sleep), energy: "7", soreness: "3" },
    intelligence: {},
  };
}

function twoWeeks({ previousWeight = 191, currentWeight = 190, previousWaist = 38.5, currentWaist = 38, current = {}, previous = {} } = {}) {
  const data = {};
  for (let i = -13; i <= -7; i += 1) data[key(i)] = day({ weight: previousWeight, waist: previousWaist, ...previous });
  for (let i = -6; i <= 0; i += 1) data[key(i)] = day({ weight: currentWeight, waist: currentWaist, ...current });
  for (const [date, entry] of Object.entries(data)) {
    entry.nutrition.foodLogConfirmation = { calories: Number(entry.nutrition.calories), confirmedOn: date };
  }
  return data;
}

const goals = { calories: 2400, protein: 200, steps: 9000, workouts: 5, miles: 15, water: 128 };
const calibrated = { authority: "calibrated", confidenceAdjustment: 0, falsePositiveGuard: { minStallDays: 14, minRecoverySignals: 3, requireSecondWeek: true }, summary: "Calibrated." };

 describe("V18.3 weekly coaching review", () => {
  it("continues an effective fat-loss week without adding another lever", () => {
    const result = buildWeeklyCoachReview({ data: twoWeeks(), goals, settings: { coachingPhase: { phase: "fat_loss" } }, weekEndKey: endKey, calibrationProfile: calibrated });
    expect(result.recommendation.kind).toBe("continue");
    expect(result.trend.weightDelta).toBeLessThan(0);
    expect(result.adherence.protein).toBeGreaterThanOrEqual(80);
    expect(result.observationMode).toBe(false);
  });

  it("prioritizes adherence instead of lowering calories when execution is inconsistent", () => {
    const result = buildWeeklyCoachReview({
      data: twoWeeks({ currentWeight: 190, previousWeight: 190, currentWaist: 38, previousWaist: 38, current: { calories: 3000, protein: 130 } }),
      goals,
      settings: { coachingPhase: { phase: "fat_loss" } },
      weekEndKey: endKey,
      calibrationProfile: calibrated,
    });
    expect(result.recommendation.kind).toBe("adherence");
    expect(result.recommendation.changes.caloriesDelta).toBe(0);
    expect(result.recommendation.summary.toLowerCase()).toContain("not been tested");
  });

  it("uses one small calorie lever for a true adherent stall", () => {
    const result = buildWeeklyCoachReview({
      data: twoWeeks({ currentWeight: 190, previousWeight: 190, currentWaist: 38, previousWaist: 38 }),
      goals,
      settings: { coachingPhase: { phase: "fat_loss" } },
      weekEndKey: endKey,
      calibrationProfile: calibrated,
    });
    expect(["calories", "activity"]).toContain(result.recommendation.kind);
    expect(result.recommendation.changes.caloriesDelta ?? result.recommendation.changes.stepsDelta).not.toBe(0);
  });

  it("asks for complete food logs before judging adherence or suggesting a cut", () => {
    const data = twoWeeks({ currentWeight: 190, previousWeight: 190, currentWaist: 38, previousWaist: 38 });
    for (let i = -6; i <= 0; i++) {
      if (i < -3) delete data[key(i)].nutrition.foodLogConfirmation;
      else data[key(i)].nutrition.foodLogConfirmation.confirmedOn = key(1);
    }
    const result = buildWeeklyCoachReview({ data, goals, weekEndKey: endKey, settings: { coachingPhase: { phase: "fat_loss" } } });
    expect(result.currentWindow.nutritionDays).toBe(0);
    expect(result.recommendation.kind).toBe("collect_food");
    expect(result.watchouts.join(" ")).not.toMatch(/calorie adherence|protein adherence/i);
  });

  it("uses completed calendar weeks before the review when counting dieting history", () => {
    const data = twoWeeks({ currentWeight: 185, previousWeight: 191 });
    const wearableTrends = { notes: [{ metric: "hrv", trend: "falling", note: "HRV low" },
      { metric: "sleep", trend: "falling", note: "Sleep low" }, { metric: "rhr", trend: "rising", note: "RHR high" }] };
    const kind = () => buildWeeklyCoachReview({ data, goals, weekEndKey: endKey, wearableTrends,
      settings: { coachingPhase: { phase: "fat_loss" } } }).recommendation.kind;
    for (let i = -41; i < -13; i++) data[key(i)] = day({ calories: 700 });
    for (let i = 1; i <= 42; i++) {
      data[key(i)] = day();
      data[key(i)].nutrition.foodLogConfirmation = { calories: 2400, confirmedOn: key(i) };
    }
    expect(kind()).toBe("recovery");
    for (let i = -41; i < -13; i++) {
      data[key(i)].nutrition.calories = "2400";
      data[key(i)].nutrition.foodLogConfirmation = { calories: 2400, confirmedOn: key(i) };
    }
    expect(kind()).toBe("diet_break");
  });

  it("holds restriction when recovery signals converge", () => {
    const wearableTrends = {
      hasEnoughData: true,
      notes: [
        { metric: "hrv", trend: "falling", note: "HRV is below baseline." },
        { metric: "rhr", trend: "rising", note: "Resting heart rate is elevated." },
        { metric: "sleep", trend: "falling", note: "Sleep duration is declining." },
      ],
    };
    const result = buildWeeklyCoachReview({
      data: twoWeeks({ current: { sleep: 6.1 } }),
      goals,
      settings: { coachingPhase: { phase: "fat_loss" } },
      weekEndKey: endKey,
      wearableTrends,
      calibrationProfile: calibrated,
    });
    expect(["recovery", "diet_break"]).toContain(result.recommendation.kind);
    expect(result.recommendation.summary.toLowerCase()).toMatch(/do not reduce calories|hold restriction/);
  });
});
