import { describe, expect, it } from "vitest";
import { WEEKDAYS } from "../dates";
import { toDisplayDistance } from "../units";
import { getExercise } from "./library";
import { PRESETS, getPreset } from "./presets";
import { trainingDaysPerWeek } from "./revisions";
import { validateWeek } from "./validate";

const lifts = (id: string) => {
  const week = getPreset(id)?.week;
  return week ? WEEKDAYS.flatMap((d) => week[d].lifting) : [];
};

describe("presets", () => {
  it("keeps the five general presets and drops the personal / AM-PM ones", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["beginner", "calisthenics", "bodybuilding", "powerlifting", "running"]);
    for (const id of ["hybrid", "highIntensityHybrid", "ramiHybridCut", "doubleEdition", "raceEdition50k"]) expect(getPreset(id)).toBeUndefined();
  });

  it("keeps v19's names, descriptions and tags", () => {
    expect(getPreset("calisthenics")).toMatchObject({
      name: "Calisthenics — Absolute Beginner",
      description: "No equipment needed. Build strength from zero using only your bodyweight. 3 days per week, short sessions, full rest between.",
      tags: ["Beginner", "Bodyweight", "No Equipment"],
    });
    expect(getPreset("running")?.name).toBe("Running Focus");
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))("%s validates on library movements", (_, preset) => {
    expect(validateWeek(preset.week, { requireLibraryIds: true }).errors).toEqual([]);
    for (const d of WEEKDAYS) {
      for (const lift of preset.week[d].lifting) {
        const entry = getExercise(lift.libraryId ?? "");
        expect(lift).toMatchObject({ id: entry?.id, name: entry?.name, trackingMode: entry?.trackingMode });
      }
    }
  });

  it("schedules v19's training days", () => {
    expect(PRESETS.map((p) => [p.id, trainingDaysPerWeek(p.week)])).toEqual([
      ["beginner", 4], ["calisthenics", 4], ["bodybuilding", 5], ["powerlifting", 4], ["running", 5],
    ]);
    expect(getPreset("running")?.week.Thursday).toMatchObject({ title: "Rest / Cross Train", rest: true });
  });

  it("calisthenics needs no equipment", () => {
    expect(new Set(lifts("calisthenics").map((l) => getExercise(l.libraryId ?? "")?.equipment))).toEqual(new Set(["bodyweight"]));
  });

  it("tracks holds by time with their seconds as the target", () => {
    const holds = lifts("calisthenics").filter((l) => l.trackingMode === "timed_hold");
    expect(holds.map((l) => `${l.libraryId}:${l.reps}`)).toEqual(["wall-sit:30", "superman-hold:10", "plank:20", "hollow-body-hold:15"]);
    expect(lifts("running").find((l) => l.libraryId === "plank")?.reps).toBe("60");
  });

  it("converts cardio to km that still read as v19's miles in imperial", () => {
    const miles = (id: string) => {
      const week = getPreset(id)?.week;
      return week ? WEEKDAYS.flatMap((d) => (week[d].cardio?.km ? [toDisplayDistance(week[d].cardio.km, "imperial")] : [])) : [];
    };
    expect(miles("running")).toEqual([4, 4, 8]);
    expect(miles("beginner")).toEqual([1.5, 1.5, 1.5, 2]);
    expect(miles("calisthenics")).toEqual([1, 1, 1.5, 1]);
  });

  it("keeps per-lift coaching notes", () => {
    expect(lifts("calisthenics").every((l) => l.notes)).toBe(true);
    expect(lifts("calisthenics")[0]?.notes).toBe("Hands on a counter or bench — easier than floor.");
  });

  it("contains no personal references or fixed dates", () => {
    const text = JSON.stringify(PRESETS);
    expect(text).not.toMatch(/rami/i);
    expect(text).not.toMatch(/\b20\d\d\b|\b\d{1,2}\/\d{1,2}\b/);
    expect(text).not.toMatch(/\bmiles?\b|\d\s*mi\b/);
  });
});
