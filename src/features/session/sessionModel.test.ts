import { describe, expect, it } from "vitest";
import { seed } from "../../data/demo/seed";
import { emptyDay, type PlannedExercise } from "../../domain/day/schema";
import { metaFor as libraryMeta } from "../../domain/program/library";
import { plannedDay } from "../../domain/program/revisions";
import { addExtraSet, finishSession, flagPain, judgeTrialOnDay, logSet, nextExerciseIndex, sessionView, skipExercise, startSession, swapExercise, unlogSet } from "./sessionModel";

const TODAY = "2026-10-07";
const metaFor = (log: { libraryId?: string; performedName?: string; name: string }) => libraryMeta(log.libraryId ?? log.performedName ?? log.name);

function demo() {
  const s = seed(TODAY);
  const day = s.days[TODAY];
  if (!day?.quest) throw new Error("demo has no quest today");
  const planned = plannedDay(s.program, TODAY);
  const first = day.quest.planned.exercises[0] as PlannedExercise;
  return { s, day, quest: day.quest, planned, first, view: (d = day, currentIndex: number | null = null) => sessionView({ day: d, quest: day.quest!, planned, days: s.days, todayKey: TODAY, units: "metric", metaFor, currentIndex }) };
}

describe("sessionView", () => {
  it("reads the reduced quest: scaled sets, a target from history, and the first set up", () => {
    const { view } = demo();
    const v = view();
    expect(v.title).toBe("Full Body C");
    expect(v.exercises.map((e) => [e.name, e.plannedSets])).toEqual([["Goblet Squat", 2], ["Push-Up", 2], ["One-Arm DB Row", 2], ["Romanian Deadlift", 2], ["Crunch", 2]]);
    expect(v.currentIndex).toBe(0);
    expect(v.current?.currentSetIndex).toBe(0);
    expect(v.current?.dots.map((d) => d.state)).toEqual(["current", "planned"]);
    expect(v.primary).toEqual({ key: "set", label: "Complete set 1 of 2" });
    expect(v.target?.line).toMatch(/^Target .* · Last 20×10\/10\/10$/);
    expect(v.initial.weightKg).toBe(20);
    expect(v.initial.reps).toBe(10);
    expect(v.started).toBe(false);
  });

  it("banks sets, moves the current dot, adds extra sets and finishes", () => {
    const { day, quest, first, view } = demo();
    let d = startSession(day, quest, "2026-10-07T17:00:00.000Z");
    expect(d.workout.startedAt).toBe("2026-10-07T17:00:00.000Z");
    d = logSet(d, first, 0, { weightKg: 22, reps: 10 }, "2026-10-07T17:02:00.000Z");
    let v = view(d);
    expect(v.current?.dots.map((x) => x.state)).toEqual(["done", "current"]);
    expect(v.primary.label).toBe("Complete set 2 of 2");
    expect(d.workout.exercises["goblet-squat"]?.sets[0]).toMatchObject({ id: "s1", weightKg: 22, reps: 10, done: true, completedAt: "2026-10-07T17:02:00.000Z" });
    d = logSet(d, first, 1, { weightKg: 22, reps: 10 }, "2026-10-07T17:04:00.000Z");
    v = view(d, 0);
    expect(v.current?.handled).toBe(true);
    expect(v.primary).toEqual({ key: "next", label: "Next exercise" });
    expect(nextExerciseIndex(v, 0)).toBe(1);
    d = addExtraSet(d, first);
    v = view(d, 0);
    expect(v.current?.dots.map((x) => x.state)).toEqual(["done", "done", "extra"]);
    expect(v.primary).toEqual({ key: "extra", label: "Log extra set" });
    d = unlogSet(d, first, 1);
    expect(view(d, 0).current?.dots[1]?.state).toBe("current");
    d = finishSession(d, "2026-10-07T17:40:00.000Z");
    expect(d.workout.completedAt).toBe("2026-10-07T17:40:00.000Z");
  });

  it("editing a past day keeps a banked set's original timestamp", () => {
    const { day, first } = demo();
    let d = logSet(day, first, 0, { weightKg: 22, reps: 10 }, "2026-10-07T17:02:00.000Z");
    d = logSet(d, first, 0, { weightKg: 24, reps: 9 }, "2026-10-12T09:00:00.000Z", { keepCompletedAt: true });
    expect(d.workout.exercises["goblet-squat"]?.sets[0]).toMatchObject({ weightKg: 24, reps: 9, completedAt: "2026-10-07T17:02:00.000Z" });
    d = logSet(d, first, 1, { weightKg: 24, reps: 9 }, "2026-10-12T09:01:00.000Z", { keepCompletedAt: true });
    expect(d.workout.exercises["goblet-squat"]?.sets[1]?.completedAt).toBe("2026-10-12T09:01:00.000Z");
  });

  it("pain on a banked set marks it; pain on the set in hand ends the exercise for pain", () => {
    const { day, first, view } = demo();
    let d = logSet(day, first, 0, { weightKg: 22, reps: 10 }, "2026-10-07T17:02:00.000Z");
    d = flagPain(d, first, 0);
    expect(d.workout.exercises["goblet-squat"]?.sets[0]?.pain).toBe(true);
    expect(d.workout.exercises["goblet-squat"]?.skipped).toBeUndefined();
    d = flagPain(d, first, 1);
    expect(d.workout.exercises["goblet-squat"]?.skipped).toBe("pain");
    const v = view(d, 0);
    expect(v.current?.pain).toBe(true);
    expect(v.current?.handled).toBe(true);
  });

  it("skips and swaps keep the planned slot", () => {
    const { day, first, view } = demo();
    let d = skipExercise(day, first, "equipment");
    expect(view(d, 0).current?.skipped).toBe("equipment");
    expect(view(d, 0).current?.currentSetIndex).toBe(-1);
    d = swapExercise(day, first, "Back Squat");
    const v = view(d, 0);
    expect(v.current?.swapped).toBe(true);
    expect(v.current?.performedName).toBe("Back Squat");
    expect(v.target?.line).toMatch(/Last 5[0-9.]+×8\/8\/8$/);
    d = swapExercise(d, first, "Goblet Squat");
    expect(view(d, 0).current?.swapped).toBe(false);
  });

  it("the trial set is highlighted and judged after it is banked", () => {
    const { s, planned, first } = demo();
    const quest = { ...s.days[TODAY]!.quest!, trial: { targetRank: "C", exerciseId: first.id, spec: "5 reps at 80%" } };
    const trial = { targetRank: "C" as const, kind: "loaded" as const, exerciseId: first.id, exerciseName: first.name, loadKg: 20, reps: 5, minutes: null, spec: "5 reps at 80%" };
    const base = { ...emptyDay(), checkin: s.days[TODAY]!.checkin, quest };
    let v = sessionView({ day: base, quest, planned, days: s.days, todayKey: TODAY, units: "metric", metaFor, trial });
    expect(v.current?.isTrial).toBe(true);
    expect(v.current?.dots[0]).toEqual({ state: "trial", done: false });
    expect(v.initial).toMatchObject({ weightKg: 20, reps: 5 });
    let d = logSet(base, first, 0, { weightKg: 20, reps: 5 }, "2026-10-07T17:02:00.000Z", { trial: true });
    d = judgeTrialOnDay(d, trial);
    expect(d.quest?.trial?.passed).toBe(true);
    v = sessionView({ day: d, quest, planned, days: s.days, todayKey: TODAY, units: "metric", metaFor, trial });
    expect(v.current?.dots[0]).toEqual({ state: "trial", done: true });
    const failed = judgeTrialOnDay(logSet(base, first, 0, { weightKg: 20, reps: 3 }, "2026-10-07T17:02:00.000Z", { trial: true }), trial);
    expect(failed.quest?.trial?.passed).toBe(false);
  });
});
