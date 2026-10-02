import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { emptyDay, type DayMap, type DayV2 } from "../day/schema";
import { didTrain, loadGuard } from "./loadGuard";

const TODAY = "2026-10-10";

function liftDay(sets: number): DayV2 {
  const day = emptyDay();
  day.workout.exercises.squat = {
    name: "Back Squat",
    sets: Array.from({ length: sets }, (_, i) => ({ id: `s${i + 1}`, weightKg: 100, reps: 5, done: true })),
  };
  return day;
}

function cardioDay(minutes: number): DayV2 {
  const day = emptyDay();
  day.workout.cardio.push({ id: "c1", kind: "run", minutes, km: null, source: "manual" });
  return day;
}

function daysBefore(entries: DayV2[]): DayMap {
  // entries[0] is yesterday, entries[1] the day before, …
  return Object.fromEntries(entries.map((d, i) => [addDays(TODAY, -(i + 1)), d]));
}

const plan = { plannedWeeklySets: 40, plannedWeeklyCardioMinutes: 90 };

describe("didTrain", () => {
  it("needs a performed set or real cardio", () => {
    expect(didTrain(undefined)).toBe(false);
    expect(didTrain(emptyDay())).toBe(false);
    expect(didTrain(liftDay(1))).toBe(true);
    expect(didTrain(cardioDay(20))).toBe(true);
    const planned = liftDay(2);
    planned.workout.exercises.squat!.sets.forEach((s) => { s.done = false; });
    expect(didTrain(planned)).toBe(false);
    const holdOnly = emptyDay();
    holdOnly.workout.exercises.plank = { name: "Plank", sets: [{ id: "s1", weightKg: null, reps: null, seconds: 45, done: true }] };
    expect(didTrain(holdOnly)).toBe(true);
    const distanceOnly = emptyDay();
    distanceOnly.workout.cardio.push({ id: "c", kind: "run", minutes: null, km: 5, source: "manual" });
    expect(didTrain(distanceOnly)).toBe(true);
  });
});

describe("loadGuard", () => {
  it("leaves a normal week alone", () => {
    const r = loadGuard({ days: daysBefore([liftDay(10), emptyDay(), liftDay(10), cardioDay(30)]), todayKey: TODAY, ...plan });
    expect(r.cap).toBeNull();
    expect(r).toMatchObject({ consecutiveTrainingDays: 1, setsLast7: 20, cardioMinutesLast7: 30 });
  });

  it("caps today after six training days in a row", () => {
    const six = Array.from({ length: 6 }, () => liftDay(3));
    const r = loadGuard({ days: daysBefore(six), todayKey: TODAY, ...plan });
    expect(r.consecutiveTrainingDays).toBe(6);
    expect(r.cap).toEqual({ tier: "REDUCED", reason: "6 training days in a row" });
    expect(loadGuard({ days: daysBefore(six.slice(0, 5)), todayKey: TODAY, ...plan }).cap).toBeNull();
  });

  it("caps today when the last 7 days ran past 150% of the planned sets", () => {
    const r = loadGuard({ days: daysBefore([liftDay(31), emptyDay(), liftDay(30)]), todayKey: TODAY, ...plan });
    expect(r.setsLast7).toBe(61);
    expect(r.cap).toEqual({ tier: "REDUCED", reason: "Last 7 days ran 153% of your plan" });
    expect(loadGuard({ days: daysBefore([liftDay(30), emptyDay(), liftDay(30)]), todayKey: TODAY, ...plan }).cap).toBeNull();
  });

  it("caps on cardio volume too, and ignores metrics the plan doesn't include", () => {
    const r = loadGuard({ days: daysBefore([cardioDay(100), emptyDay(), cardioDay(50)]), todayKey: TODAY, ...plan });
    expect(r.cap?.reason).toBe("Last 7 days ran 167% of your plan");
    const noCardioPlan = loadGuard({ days: daysBefore([cardioDay(500)]), todayKey: TODAY, plannedWeeklySets: 40, plannedWeeklyCardioMinutes: 0 });
    expect(noCardioPlan.cap).toBeNull();
  });

  it("handles partially filled logs and cardio-only plans", () => {
    const carry = emptyDay();
    carry.workout.exercises.carry = { name: "Farmer Carry", sets: [{ id: "s1", weightKg: 30, reps: null, distanceM: 40, done: true }] };
    carry.workout.cardio.push({ id: "c", kind: "walk", minutes: null, km: 2, source: "manual" });
    const r = loadGuard({ days: daysBefore([carry, cardioDay(200)]), todayKey: TODAY, plannedWeeklySets: 0, plannedWeeklyCardioMinutes: 100 });
    expect(r).toMatchObject({ setsLast7: 1, cardioMinutesLast7: 200, consecutiveTrainingDays: 2 });
    expect(r.cap?.reason).toBe("Last 7 days ran 200% of your plan");
  });

  it("does not count today or anything older than a week toward volume", () => {
    const days = daysBefore([emptyDay(), emptyDay(), emptyDay(), emptyDay(), emptyDay(), emptyDay(), emptyDay(), liftDay(100)]);
    days[TODAY] = liftDay(100);
    expect(loadGuard({ days, todayKey: TODAY, ...plan }).setsLast7).toBe(0);
  });
});
