import { describe, expect, it } from "vitest";
import { calcWeeklyReview } from "../recovery";

function day(offset, data) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return [key, data];
}

const baseDay = {
  workout: { exercises: { Squat: { sets: [{ weight: "225", reps: "5", done: true }] } }, cardio: { miles: "3" } },
  nutrition: { calories: "3200", protein: "205", water: "130" },
  body: { sleep: "7.3", weight: "184" },
};

describe("weekly review intelligence", () => {
  it("returns coach notes and next actions", () => {
    const data = Object.fromEntries([0,1,2,3,4,5].map(i => day(i, baseDay)));
    const review = calcWeeklyReview(data, { workouts: 5, miles: 15, protein: 200, water: 128 });

    expect(review.coachNote).toMatch(/consistency/i);
    expect(review.highlights.length).toBeGreaterThan(0);
    expect(review.nextActions.length).toBeGreaterThan(0);
  });

  it("calls out recovery/fueling gaps when targets miss", () => {
    const weakDay = {
      workout: { exercises: {}, cardio: { miles: "1" } },
      nutrition: { calories: "1800", protein: "90", water: "40" },
      body: { sleep: "5.8" },
    };
    const data = Object.fromEntries([0,1,2].map(i => day(i, weakDay)));
    const review = calcWeeklyReview(data, { workouts: 5, miles: 15, protein: 200, water: 128 });

    expect(review.nextActions.join(" ")).toMatch(/protein|sleep|water|recovery/i);
    expect(review.watchouts.length).toBeGreaterThan(0);
  });
});
