import { describe, expect, it } from "vitest";
import { buildAthleteTimeline, filterTimelineEvents, groupTimelineByDate, summarizeTimeline } from "../athleteTimeline";

const entries = {
  "2026-06-26": {
    workout: { exercises: { Squat: { sets: [{ weight: "225", reps: "5", done: true }] } }, cardio: { miles: "3" }, notes: "Felt strong." },
    nutrition: { calories: "3200", protein: "190", carbs: "340", fats: "90", water: "120" },
    body: { weight: "184", sleep: "7.2", energy: "8", soreness: "2" },
    intelligence: { acceptedTrainingSuggestion: { mode: "reduce_volume", title: "Pull back today's session" } },
  },
  "2026-06-27": {
    workout: { exercises: {}, cardio: { miles: "0" }, notes: "" },
    nutrition: { calories: "2100", protein: "110", water: "64" },
    body: { sleep: "5.5", energy: "5", soreness: "4" },
    intelligence: { lastNutritionQuickAdd: { label: "Whey + banana" } },
  },
};

describe("athleteTimeline", () => {
  it("builds reverse-chronological events", () => {
    const events = buildAthleteTimeline(entries);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].date).toBe("2026-06-27");
  });

  it("includes training, nutrition, recovery, notes, and intelligence", () => {
    const types = new Set(buildAthleteTimeline(entries).map(e => e.type));
    expect(types.has("training")).toBe(true);
    expect(types.has("nutrition")).toBe(true);
    expect(types.has("recovery")).toBe(true);
    expect(types.has("note")).toBe(true);
    expect(types.has("intelligence")).toBe(true);
  });

  it("summarizes recent training", () => {
    const summary = summarizeTimeline(buildAthleteTimeline(entries));
    expect(summary.recentTrainingDays).toBe(1);
    expect(summary.recentMiles).toBe(3);
    expect(summary.recentVolume).toBe(1125);
  });


  it("filters events by type", () => {
    const events = buildAthleteTimeline(entries);
    const nutrition = filterTimelineEvents(events, "nutrition");

    expect(nutrition.length).toBeGreaterThan(0);
    expect(nutrition.every(e => e.type === "nutrition")).toBe(true);
    expect(filterTimelineEvents(events, "all")).toEqual(events);
  });

  it("groups filtered events by date", () => {
    const events = buildAthleteTimeline(entries);
    const grouped = groupTimelineByDate(events);

    expect(grouped[0].date).toBe("2026-06-27");
    expect(grouped[0].events.every(e => e.date === grouped[0].date)).toBe(true);
    expect(grouped.some(day => day.date === "2026-06-26")).toBe(true);
  });

  it("handles empty input safely", () => {
    expect(buildAthleteTimeline({})).toEqual([]);
    expect(summarizeTimeline([]).total).toBe(0);
  });
});
