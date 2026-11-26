// src/__tests__/morningPlan.test.js
// The morning reminder says what the plan has that day: the session's name,
// its first lifts and its run, or a rest day. Each weekday is scheduled for
// its next morning, and today only until its time has come.
import { describe, expect, it } from "vitest";
import { morningText, nextMornings, parseTime, planDays, timeLabel } from "../reminders/morningPlan";

const program = {
  Monday: {
    type: "Upper A",
    lifting: [
      { name: "Bench Press", sets: 4, reps: 6 },
      { name: "Barbell Row", sets: 4, reps: 8 },
      { name: "Incline DB Press", sets: 3, reps: 10 },
      { name: "Lateral Raise", sets: 3, reps: 15 },
      { name: "Triceps Pushdown", sets: 3, reps: 12 },
    ],
    cardio: { type: "Easy run", minutes: 30 },
  },
  Tuesday: { type: "Run", lifting: [], cardio: { type: "Tempo run", miles: 5 } },
  Wednesday: { type: "Rest", lifting: [], cardio: null },
  Thursday: { type: "Lower A", lifting: [{ name: "Back Squat", sets: 4, reps: 5 }, { name: "Romanian Deadlift", sets: 3, reps: 8 }] },
  Friday: { type: "Rest", lifting: [], cardio: null },
  Saturday: { type: "Long run", lifting: [], cardio: { type: "Long run", miles: 10 } },
  Sunday: { type: "Rest", lifting: [], cardio: null },
};

describe("morningText", () => {
  it("names the session, its first three lifts and its run", () => {
    // 2026-11-30 is a Monday.
    expect(morningText(program, "2026-11-30")).toEqual({
      title: "Today: Upper A",
      body: "Bench Press, Barbell Row, Incline DB Press and 2 more · Easy run, 30 min",
    });
  });

  it("lists every lift when there are three or fewer", () => {
    expect(morningText(program, "2026-12-03").body).toBe("Back Squat, Romanian Deadlift");
  });

  it("gives a run day its run", () => {
    expect(morningText(program, "2026-12-01")).toEqual({ title: "Today: Run", body: "Tempo run, 5 mi" });
  });

  it("says when nothing is planned", () => {
    expect(morningText(program, "2026-12-02")).toEqual({ title: "Rest day", body: "Nothing is planned today." });
  });
});

describe("planDays", () => {
  it("covers today and the next seven days", () => {
    const days = planDays(program, { todayKey: "2026-11-30" });
    expect(days.map((day) => day.date)).toEqual([
      "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06", "2026-12-07",
    ]);
    expect(days[7].title).toBe("Today: Upper A");
  });
});

describe("nextMornings", () => {
  const days = planDays(program, { todayKey: "2026-11-30" });

  it("schedules today while its time is still ahead", () => {
    const mornings = nextMornings(days, { time: "06:30", now: new Date(2026, 10, 30, 5, 0) });
    expect(mornings).toHaveLength(7);
    // iOS counts Sunday as 1, so Monday is 2.
    expect(mornings[0]).toMatchObject({ weekday: 2, date: "2026-11-30", title: "Today: Upper A" });
  });

  it("moves today's weekday to next week once the time has passed", () => {
    const mornings = nextMornings(days, { time: "06:30", now: new Date(2026, 10, 30, 9, 0) });
    expect(mornings).toHaveLength(7);
    expect(mornings[0].date).toBe("2026-12-01");
    expect(mornings.find((morning) => morning.weekday === 2).date).toBe("2026-12-07");
  });

  it("drops days that have gone by", () => {
    const mornings = nextMornings(days, { time: "06:30", now: new Date(2026, 11, 3, 12, 0) });
    expect(mornings.map((morning) => morning.date)).toEqual(["2026-12-04", "2026-12-05", "2026-12-06", "2026-12-07"]);
  });
});

describe("times", () => {
  it("reads a time and falls back to 6:30", () => {
    expect(parseTime("05:45")).toEqual({ hour: 5, minute: 45 });
    expect(parseTime("25:00")).toEqual({ hour: 6, minute: 30 });
    expect(parseTime(undefined)).toEqual({ hour: 6, minute: 30 });
  });

  it("writes it the way the switch says it", () => {
    expect(timeLabel("06:30")).toBe("6:30 am");
    expect(timeLabel("12:15")).toBe("12:15 pm");
    expect(timeLabel("00:00")).toBe("12:00 am");
  });
});
