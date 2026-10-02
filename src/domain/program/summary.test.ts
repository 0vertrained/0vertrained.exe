import { describe, expect, it } from "vitest";
import { miToKm } from "../units";
import { weekFromV1 } from "./normalize";
import { getPreset } from "./presets";
import { summarizeDay, summarizeWeek } from "./summary";
import { restDay, type ProgramDay, type ProgramWeek } from "./types";

const bench = { id: "barbell-bench-press", name: "Barbell Bench Press", libraryId: "barbell-bench-press", sets: 4, reps: "6", trackingMode: "loaded_reps" } as const;

/** v19's DEFAULT_PROGRAM day structure: Mon/Tue/Fri/Sat lift, Thu lift + intervals, Sun long run, Wed rest. */
const v1Default = {
  Monday: { type: "Upper A", lifting: [{ name: "Barbell Bench Press", sets: 4, reps: 6 }], cardio: null },
  Tuesday: { type: "Lower A", lifting: [{ name: "Back Squat", sets: 4, reps: 6 }], cardio: null },
  Wednesday: { type: "Full Rest", code: "REST", lifting: [], cardio: null },
  Thursday: { type: "Cardio A — Intervals + Core", lifting: [{ name: "Plank", sets: 3, reps: 45 }], cardio: { type: "Intervals", miles: 5, effort: "High" } },
  Friday: { type: "Upper B", lifting: [{ name: "Barbell Row", sets: 4, reps: 6 }], cardio: null },
  Saturday: { type: "Lower B", lifting: [{ name: "Conventional Deadlift", sets: 4, reps: 5 }], cardio: null },
  Sunday: { type: "Cardio B — Long Zone 2", lifting: [], cardio: { type: "Long Run", miles: 5.5, effort: "Zone 2" } },
};

describe("summarizeDay (ported)", () => {
  it("adds a short run to a lifting day's label", () => {
    const day: ProgramDay = { title: "Upper A — Push + Triceps", rest: false, lifting: [bench], cardio: { kind: "Short Run", km: miToKm(1.5), effort: "Zone 2", notes: "Easy shakeout" } };
    expect(summarizeDay(day, "imperial")).toEqual({
      label: "Upper A — Push + Triceps + Short Run · 1.5 mi · Zone 2",
      rest: false, liftCount: 1, sets: 4, cardioLabel: "Short Run · 1.5 mi · Zone 2",
    });
    expect(summarizeDay(day).cardioLabel).toBe("Short Run · 2.4 km · Zone 2");
  });

  it("summarizes a cardio-only day without hiding it as rest", () => {
    const day: ProgramDay = { title: "", rest: false, lifting: [], cardio: { kind: "Easy Run", km: miToKm(2), effort: "Easy" } };
    expect(summarizeDay(day, "imperial").label).toBe("Easy Run · 2 mi · Easy");
  });

  it("doesn't repeat the cardio when the title already names it", () => {
    const day: ProgramDay = { title: "Long Run", rest: false, lifting: [], cardio: { kind: "Long Run", km: 13 } };
    expect(summarizeDay(day).label).toBe("Long Run");
  });

  it("falls back to counts, minutes and 'Cardio'", () => {
    expect(summarizeDay({ title: " ", rest: false, lifting: [bench, bench], cardio: { kind: "Bike", minutes: 40 } }).label).toBe("2 lifts + Bike · 40 min");
    expect(summarizeDay({ title: "", rest: false, lifting: [bench], cardio: null }).label).toBe("1 lift");
    expect(summarizeDay({ title: "", rest: false, lifting: [], cardio: { kind: " " } }).label).toBe("Cardio");
    expect(summarizeDay({ title: "", rest: true, lifting: [], cardio: null }).label).toBe("Rest / mobility");
    expect(summarizeDay(null)).toEqual({ label: "Rest / mobility", rest: true, liftCount: 0, sets: 0, cardioLabel: null });
  });
});

describe("summarizeWeek (ported from the More hub)", () => {
  it("counts lifting, cardio and rest days for the default program", () => {
    const s = summarizeWeek(weekFromV1(v1Default));
    expect(s).toMatchObject({ liftingDays: 5, cardioDays: 2, restDays: 1, trainingDays: 6, hasProgram: true, line: "5 lifting · 2 cardio · 1 rest" });
    expect(s.days.map((d) => d.weekday)).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    expect(s.plannedSets).toBe(19);
    expect(s.cardioKm).toBe(16.9);
    expect(s.cardioMinutes).toBe(Math.round(miToKm(5) * 6) + Math.round(miToKm(5.5) * 6));
  });

  it("returns a neutral summary for no program", () => {
    for (const week of [null, undefined, weekFromV1({ Monday: { lifting: [], cardio: null }, Tuesday: { type: "Rest" } })]) {
      const s = summarizeWeek(week);
      expect(s).toMatchObject({ liftingDays: 0, cardioDays: 0, restDays: 7, trainingDays: 0, hasProgram: false, line: "No program yet — generate one to get started" });
    }
  });

  it("doesn't count a rest day's optional walk as planned training", () => {
    const week = { ...(getPreset("bodybuilding")?.week as ProgramWeek), Sunday: { ...restDay(), cardio: { kind: "Easy Walk", km: 3 } } };
    const s = summarizeWeek(week);
    expect(s).toMatchObject({ restDays: 2, cardioDays: 0, cardioKm: 0, cardioMinutes: 0 });
    expect(s.days[6]).toMatchObject({ rest: true, label: "Rest + Easy Walk · 3 km" });
  });

  it("totals a preset week", () => {
    const s = summarizeWeek(getPreset("running")?.week, "imperial");
    expect(s).toMatchObject({ trainingDays: 5, liftingDays: 2, cardioDays: 3, plannedSets: 30, cardioKm: 25.7 });
    expect(s.days[5]?.label).toBe("Long Run");
  });
});
