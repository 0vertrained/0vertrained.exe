import { describe, expect, it } from "vitest";
import { buildWearableLoadRows, summarizeWearableLoadSource } from "../wearableWorkoutLoad";

const doneSet = (weight, reps) => ({ weight, reps, done: true });

describe("wearable workout load bridge", () => {
  it("keeps manual logs canonical and does not double-count wearable workouts", () => {
    const rows = buildWearableLoadRows({
      asOf: "2026-07-07",
      maxDays: 1,
      entries: {
        "2026-07-07": { workout: { exercises: { Bench: { sets: [doneSet(200, 5)] } } } },
      },
      whoopData: {
        "2026-07-07": { workout: [{ id: "w1", start: "2026-07-07T12:00:00Z", score: { strain: 14 } }] },
      },
    });

    expect(rows[0].source).toBe("manual+wearable-context");
    expect(rows[0].load).toBe(18); // one completed set × 3 min × estimated lifting RPE 6
    expect(rows[0].notes[0]).toMatch(/not double-counted/i);
  });

  it("fills missing manual days from Whoop workout strain", () => {
    const rows = buildWearableLoadRows({
      asOf: "2026-07-07",
      maxDays: 1,
      entries: {},
      whoopData: {
        "2026-07-07": { workout: [{ id: "w1", start: "2026-07-07T12:00:00Z", score: { strain: 12 } }] },
      },
    });

    expect(rows[0].source).toBe("whoop");
    expect(rows[0].load).toBeGreaterThan(0);
    expect(rows[0].hasWorkout).toBe(true);
  });

  it("summarizes wearable-filled days", () => {
    const summary = summarizeWearableLoadSource([
      { source: "whoop" },
      { source: "manual+wearable-context" },
      { source: "none" },
    ]);
    expect(summary.filledDays).toBe(1);
    expect(summary.contextDays).toBe(1);
  });
});

describe("activity-level reconciliation", () => {
  const date = "2026-07-07";
  const start = hour => date + "T" + hour + ":00:00Z";
  const run = (id, hour) => ({ stravaId: id, startTime: start(hour), kind: "run", miles: 5, minutes: 45 });
  const whoopRun = (id, hour) => ({ id, sport_name: "running", start: start(hour), score: { zone_durations: { zone_two_milli: 45 * 60000 } } });
  const day = (workout, strava, whoop = []) => buildWearableLoadRows({
    asOf: date, maxDays: 1, entries: { [date]: { workout } },
    stravaByDate: { [date]: strava }, whoopData: { [date]: { workout: whoop } },
  })[0];

  it("counts a duplicate Strava/Whoop run once plus an evening run, independent of input order", () => {
    const morning = run("am", "08"), evening = run("pm", "18");
    for (const records of [[morning, evening, morning], [evening, morning]]) {
      const result = day({}, records, [whoopRun("wearable-am", "08")]);
      expect(result).toMatchObject({ load: 450, source: "strava", durationMin: 90 });
    }
  });

  it("recognizes a confirmed activity by ID after a manual correction, adding only the distinct run", () => {
    const workout = { rpe: 6, cardio: { miles: 4.8, time: "42:00", activityRefs: [
      { source: "strava", id: "am", kind: "run", startTime: start("08"), minutes: 45 },
    ] } };
    const result = day(workout, [run("pm", "18"), run("am", "08")], [whoopRun("am-on-whoop", "08")]);
    expect(result).toMatchObject({ load: 42 * 6 + 225, durationMin: 87, source: "manual+strava" });
    expect(JSON.stringify(result)).not.toContain("am-on-whoop");
  });

  it("recognizes old summed cardio imports without identifiers", () => {
    const result = day({ rpe: 6, cardio: { miles: 10, time: "90:00" } },
      [run("am", "08"), run("pm", "18")], [whoopRun("same again", "18")]);
    expect(result).toMatchObject({ load: 540, source: "manual+wearable-context", durationMin: 90 });
  });

  it("keeps separate sessions across providers and accepts a distance-free imported ride", () => {
    const ride = { stravaId: "bike", startTime: start("08"), kind: "ride", miles: 0, minutes: 40 };
    const result = day({}, [ride], [whoopRun("pm", "18")]);
    expect(result).toMatchObject({ source: "strava+whoop", load: 380, durationMin: 85 });
  });

  it("counts a confirmed fill only once after the athlete logs the scheduled session", () => {
    const imported = [run("am", "08"), run("pm", "18")];
    const refs = imported.map(a => ({ source: "strava", id: a.stravaId, kind: "run", startTime: a.startTime, minutes: a.minutes, miles: a.miles }));
    const workout = {
      rpe: 6, cardio: { time: "90:00", miles: 10, activityRefs: refs },
      cardioSessions: { morning: { type: "Run", time: "45:00", miles: 5, startTime: start("08") } },
    };
    expect(day(workout, imported)).toMatchObject({ load: 540, durationMin: 90, source: "manual+wearable-context" });
    workout.cardio = { time: "45:00", miles: 5, activityRefs: refs.slice(0, 1) };
    expect(day(workout, imported.slice(0, 1))).toMatchObject({ load: 270, durationMin: 45 });
    workout.cardioSessions.morning.type = "Indoor ride";
    workout.cardioSessions.morning.startTime = start("06");
    expect(day(workout, imported.slice(0, 1))).toMatchObject({ load: 540, durationMin: 90 });
  });
});
