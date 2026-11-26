// src/__tests__/weekMoves.test.js
// Two days of a week can swap their training for that week only; the
// program stays the template, and every reader of the week sees the swap.
import { describe, expect, it } from "vitest";
import { DAYS } from "../constants";
import { applyRaceBuild } from "../raceBuild";
import { applyWeekMoves, movedFrom, resetWeek, swapDays, weekMovesFor, weekStartOf, weekdayOf } from "../weekMoves";
import { liftingSessionsFor } from "../watch/watchPlan";
import { tomorrowSummary } from "../tomorrowLine";

const day = (type, lifting = [], cardio = null) => ({ type, lifting, cardio });
const program = {
  ...Object.fromEntries(DAYS.map((name) => [name, day("Rest")])),
  Monday: day("Upper A", [{ name: "Bench Press", sets: 3, reps: 8 }]),
  Thursday: day("Cardio A", [], { type: "Intervals", miles: 5 }),
  Friday: day("Upper B", [{ name: "Row", sets: 3, reps: 10 }]),
};
// Thursday, Nov 26, 2026 sits in the week of Monday, Nov 23.
const THU = "2026-11-26";

describe("week dates", () => {
  it("know their Monday and weekday", () => {
    expect([weekStartOf(THU), weekStartOf("2026-11-29"), weekStartOf("2026-11-30")]).toEqual(["2026-11-23", "2026-11-23", "2026-11-30"]);
    expect(weekdayOf(THU)).toBe("Thursday");
  });
});

describe("swapDays", () => {
  it("swaps two days for that week only, leaving the template alone", () => {
    const moved = swapDays(program, THU, "Thursday", "Friday");
    expect(moved.__weekMoves).toEqual({ "2026-11-23": { Thursday: "Friday", Friday: "Thursday" } });
    expect(moved.Thursday).toBe(program.Thursday);
    const week = applyWeekMoves(moved, THU);
    expect([week.Thursday.type, week.Friday.type]).toEqual(["Upper B", "Cardio A"]);
    expect(applyWeekMoves(moved, "2026-12-03")).toBe(moved);
    expect(movedFrom(moved, THU)).toBe("Friday");
    expect(movedFrom(moved, "2026-11-25")).toBeNull();
  });

  it("builds on earlier swaps, and swapping back undoes one", () => {
    const once = swapDays(program, THU, "Monday", "Wednesday");
    const twice = swapDays(once, THU, "Wednesday", "Thursday");
    expect(weekMovesFor(twice, THU)).toEqual({ Monday: "Wednesday", Wednesday: "Thursday", Thursday: "Monday" });
    const week = applyWeekMoves(twice, THU);
    expect([week.Monday.type, week.Wednesday.type, week.Thursday.type]).toEqual(["Rest", "Cardio A", "Upper A"]);
    const back = swapDays(swapDays(twice, THU, "Wednesday", "Thursday"), THU, "Monday", "Wednesday");
    expect(back.__weekMoves).toBeUndefined();
  });

  it("puts a week back as planned, and lets moves older than eight weeks go", () => {
    expect(resetWeek(swapDays(program, THU, "Thursday", "Friday"), THU).__weekMoves).toBeUndefined();
    const old = { ...program, __weekMoves: { "2026-09-21": { Monday: "Tuesday", Tuesday: "Monday" }, "2026-10-05": { Monday: "Friday", Friday: "Monday" } } };
    expect(Object.keys(swapDays(old, THU, "Thursday", "Friday").__weekMoves)).toEqual(["2026-10-05", "2026-11-23"]);
  });

  it("ignores a day that isn't one", () => {
    expect(swapDays(program, THU, "Thursday", "Thursday")).toBe(program);
    expect(swapDays(program, THU, "Thursday", "Someday")).toBe(program);
  });
});

describe("the week everyone reads", () => {
  const moved = swapDays(program, THU, "Thursday", "Friday");

  it("comes through the week resolver, so the watch and tomorrow see the swap", () => {
    expect(applyRaceBuild(moved, THU).Thursday.type).toBe("Upper B");
    expect(applyRaceBuild(program, THU)).toBe(program);
    expect(liftingSessionsFor(moved, THU).sessions.flatMap((session) => session.lifting).map((lift) => lift.name)).toEqual(["Row"]);
    expect(tomorrowSummary(moved, THU)).toBe("Tomorrow: Intervals, 5 mi");
  });
});
