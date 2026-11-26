// src/__tests__/addedExercises.test.js
// An exercise added to a day joins that day's plan, in the session it was
// added to, without changing the program; its sets count like any others.
import { describe, expect, it } from "vitest";
import { addToDay, addedFor, defaultsFor, exerciseChoices, removeFromDay, withAdded } from "../addedExercises";
import { computeSessionLoad } from "../loadModel";
import { getProgramSessions } from "../programSessions";

const legacyDay = { type: "Upper A", lifting: [{ name: "Bench Press", sets: 4, reps: 6 }] };
const sessionDay = {
  type: "Double",
  sessions: [
    { id: "am", label: "AM", title: "Run", cardio: { type: "Easy run", minutes: 30 } },
    { id: "pm", label: "PM", title: "Upper", lifting: [{ name: "Bench Press", sets: 4, reps: 6 }] },
  ],
};

describe("withAdded", () => {
  it("adds to the end of a day's lifting, marked as added", () => {
    const day = withAdded(legacyDay, { added: [{ name: "Cable Fly", sets: 3, reps: 12, session: "main" }] });
    expect(day.lifting.map((exercise) => exercise.name)).toEqual(["Bench Press", "Cable Fly"]);
    expect(day.lifting[1]).toEqual({ name: "Cable Fly", sets: 3, reps: 12, added: true });
    expect(legacyDay.lifting).toHaveLength(1);
  });

  it("puts it in the session it was added to, else the first lifting session", () => {
    const into = withAdded(sessionDay, { added: [{ name: "Plank", sets: 3, reps: 30, session: "am" }, { name: "Cable Fly", sets: 3, reps: 12, session: "gone" }] });
    const sessions = getProgramSessions(into);
    expect(sessions[0].lifting.map((exercise) => exercise.name)).toEqual(["Plank"]);
    expect(sessions[1].lifting.map((exercise) => exercise.name)).toEqual(["Bench Press", "Cable Fly"]);
    expect(sessionDay.sessions[1].lifting).toHaveLength(1);
  });

  it("gives a rest day lifting", () => {
    const day = withAdded({ type: "Rest", lifting: [], cardio: null }, { added: [{ name: "Push-up", sets: 3, reps: 15 }] });
    expect(getProgramSessions(day)[0].lifting.map((exercise) => exercise.name)).toEqual(["Push-up"]);
  });

  it("leaves out one the plan already has, and leaves the day alone with none added", () => {
    expect(withAdded(legacyDay, { added: [{ name: "Bench Press", sets: 3, reps: 10 }] }).lifting).toHaveLength(1);
    expect(withAdded(legacyDay, {})).toBe(legacyDay);
  });
});

describe("addToDay and removeFromDay", () => {
  it("adds once, and removes by name", () => {
    const workout = { added: addToDay({}, { name: " Cable Fly ", sets: 3, reps: 12, session: "pm" }) };
    expect(workout.added).toEqual([{ name: "Cable Fly", sets: 3, reps: 12, session: "pm" }]);
    expect(addToDay(workout, { name: "Cable Fly", sets: 5, reps: 5 })).toHaveLength(1);
    expect(removeFromDay(workout, "Cable Fly")).toEqual([]);
    expect(addedFor({ added: "nope" })).toEqual([]);
  });
});

describe("its sets count", () => {
  it("in the day's load", () => {
    const entry = {
      workout: {
        added: [{ name: "Cable Fly", sets: 2, reps: 12, session: "main" }],
        exercises: { "Cable Fly": { sets: [{ weight: "30", reps: "12", done: true }, { weight: "30", reps: "12", done: true }] } },
      },
    };
    const load = computeSessionLoad(entry);
    expect(load.volume).toBe(720);
    expect(load.exerciseCount).toBe(1);
  });
});

describe("choosing an exercise", () => {
  const allData = {
    "2026-11-20": { workout: { exercises: { "Cable Fly": { sets: [{ weight: "30", reps: "12", done: true }, { weight: "30", reps: "15", done: true }] } } } },
    "2026-11-24": { workout: { exercises: { "Hammer Curl": { sets: [{ weight: "35", reps: "10", done: true }] } } } },
  };

  it("offers what was logged lately, newest first, until something is typed", () => {
    expect(exerciseChoices({ allData, todayKey: "2026-11-26" })).toEqual(["Hammer Curl", "Cable Fly"]);
    expect(exerciseChoices({ allData, todayKey: "2026-11-26", exclude: ["hammer curl"] })).toEqual(["Cable Fly"]);
  });

  it("searches the library too, names that start with it first", () => {
    const found = exerciseChoices({ query: "squat", allData, todayKey: "2026-11-26" });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((name) => /squat/i.test(name))).toBe(true);
  });

  it("fills sets and reps from last time, else the library, else 3 × 10", () => {
    expect(defaultsFor("Cable Fly", { allData, todayKey: "2026-11-26" })).toEqual({ sets: 2, reps: 15 });
    expect(defaultsFor("Goblet Squat", { allData, todayKey: "2026-11-26" })).toEqual({ sets: 3, reps: 10 });
    expect(defaultsFor("Bodyweight Squat", { allData, todayKey: "2026-11-26" })).toEqual({ sets: 3, reps: 15, trackingMode: "bodyweight_reps" });
    expect(defaultsFor("Sled Push", { allData, todayKey: "2026-11-26" })).toEqual({ sets: 3, reps: 10 });
  });
});
