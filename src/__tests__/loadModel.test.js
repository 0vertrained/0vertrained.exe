import { describe, expect, it } from "vitest";
import { computeSessionLoad, buildDailyLoads, computeRollingLoads } from "../loadModel";

const lift = (sets) => ({ workout: { exercises: { Squat: { sets } } } });
const doneSet = (weight, reps) => ({ weight, reps, done: true });

describe("computeSessionLoad (sRPE)", () => {
  it("returns zero load for a rest day / missing data", () => {
    expect(computeSessionLoad(null).load).toBe(0);
    expect(computeSessionLoad({}).load).toBe(0);
    expect(computeSessionLoad({ workout: {} }).hasWorkout).toBe(false);
  });

  it("uses a logged session RPE when present", () => {
    const out = computeSessionLoad({ workout: { rpe: 8, exercises: { Squat: { sets: [doneSet(225, 5), doneSet(225, 5)] } } } });
    expect(out.rpeEstimated).toBe(false);
    expect(out.sessionRpe).toBe(8);
    // 2 done sets * 3 min = 6 min duration, RPE 8 -> 48 AU
    expect(out.load).toBe(48);
    expect(out.volume).toBe(2250);
  });

  it("estimates RPE when none is logged", () => {
    const out = computeSessionLoad(lift([doneSet(135, 5)]));
    expect(out.rpeEstimated).toBe(true);
    expect(out.load).toBeGreaterThan(0);
  });

  it("gives endurance work fair weight via duration (a long run > a short lift)", () => {
    const run = computeSessionLoad({ workout: { cardio: { miles: 10, pace: "8:00" } } });
    const shortLift = computeSessionLoad(lift([doneSet(135, 5)]));
    expect(run.cardioMin).toBeGreaterThan(60);
    expect(run.load).toBeGreaterThan(shortLift.load);
  });

  it("sums AM/PM cardio sessions when present", () => {
    const out = computeSessionLoad({
      workout: {
        cardio: { miles: 99, pace: "6:00" },
        cardioSessions: {
          am: { miles: 3, pace: "10:00" },
          pm: { miles: 2, pace: "9:00" },
        },
      },
    });
    expect(out.cardioMiles).toBe(5);
    expect(out.cardioSessionCount).toBe(2);
    expect(out.cardioMin).toBe(48);
  });

  it("counts only completed sets toward volume/duration", () => {
    const out = computeSessionLoad({ workout: { exercises: { Squat: { sets: [doneSet(200, 5), { weight: 200, reps: 5, done: false }] } } } });
    expect(out.volume).toBe(1000);
    expect(out.liftingMin).toBe(3);
  });
});

describe("buildDailyLoads (dense calendar series)", () => {
  it("returns one entry per calendar day, most-recent-first, zero-filling rest days", () => {
    const data = {
      "2026-06-28": { workout: { exercises: { Squat: { sets: [doneSet(225, 5)] } } } },
      "2026-06-22": { workout: { cardio: { miles: 5, pace: "9:00" } } },
    };
    const series = buildDailyLoads(data, 28, "2026-06-28");
    expect(series.length).toBe(28);
    expect(series[0].date).toBe("2026-06-28");
    expect(series[0].load).toBeGreaterThan(0);
    // A day with no entry is present as load 0 (a rest day), not skipped.
    const restDay = series.find((d) => d.date === "2026-06-25");
    expect(restDay).toBeTruthy();
    expect(restDay.load).toBe(0);
  });
});

describe("computeRollingLoads (EWMA-ACWR + monotony)", () => {
  const steady = (load, n = 28) => Array.from({ length: n }, () => ({ load }));

  it("reports insufficient data without enough sessions", () => {
    const sparse = [...Array(3).fill({ load: 120 }), ...Array(25).fill({ load: 0 })];
    expect(computeRollingLoads(sparse).zone).toBe("insufficient_data");
  });

  it("reports insufficient data with too short a history", () => {
    expect(computeRollingLoads(steady(120, 10)).zone).toBe("insufficient_data");
  });

  it("rates a steady load as optimal (ratio ~1)", () => {
    const out = computeRollingLoads(steady(120));
    expect(out.zone).toBe("optimal");
    expect(out.ratio).toBeGreaterThan(0.9);
    expect(out.ratio).toBeLessThan(1.1);
    expect(out.model).toBe("ewma");
  });

  it("EWMA lifts the acute:chronic ratio after a recent spike", () => {
    const spike = [{ load: 600 }, { load: 550 }, ...Array(26).fill({ load: 120 })];
    const out = computeRollingLoads(spike);
    expect(out.ratio).toBeGreaterThan(1.1);
  });

  it("computes monotony (zero when load is flat, positive when it varies)", () => {
    expect(computeRollingLoads(steady(120)).monotony).toBe(0);
    const varied = [
      { load: 300 }, { load: 0 }, { load: 250 }, { load: 0 }, { load: 400 }, { load: 0 }, { load: 200 },
      ...Array(21).fill({ load: 150 }),
    ];
    const out = computeRollingLoads(varied);
    expect(out.monotony).toBeGreaterThan(0);
    expect(out.strain).toBeGreaterThan(0);
  });
});
