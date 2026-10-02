import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { normalizeDay } from "../day/normalize";
import type { DayMap, DayV2, ExerciseLog, SetLog } from "../day/schema";
import { guessMeta } from "../exercise";
import { lbToKg, toDisplayWeight } from "../units";
import { e1rm } from "./liftMath";
import { DEFAULT_RECORD_THRESHOLDS, detectRecords, e1rmSeries, liftTrend, type DetectRecordsInput } from "./records";

const S = (weight: number | string, reps: number | string, extra: Record<string, unknown> = {}) =>
  ({ done: true, weight: String(weight), reps: String(reps), ...extra });
const day = (exercises: Record<string, unknown>): DayV2 => normalizeDay({ workout: { exercises } });
const bench = (...sets: unknown[]) => day({ "Bench Press": { sets } });
const lb = (kg: number) => toDisplayWeight(kg, "imperial");

/** A v2 day with metric sets, keyed by exercise id. */
function v2(exercises: Record<string, Omit<Partial<ExerciseLog>, "sets"> & { sets: Partial<SetLog>[] }>): DayV2 {
  const out: Record<string, ExerciseLog> = {};
  for (const [id, e] of Object.entries(exercises)) {
    out[id] = { name: id, ...e, sets: e.sets.map((s, i) => ({ id: `s${i + 1}`, weightKg: null, reps: null, done: true, ...s })) };
  }
  return { v: 2, checkin: {}, workout: { exercises: out, cardio: [] } };
}

describe("e1rmSeries", () => {
  it("takes the best straight set per day and excludes technique and unbanked sets (legacy pin)", () => {
    const days: DayMap = {
      "2026-06-01": bench(S(185, 8), S(205, 3, { type: "straight" }), S(225, 12, { type: "drop" }), S(245, 5, { done: false })),
    };
    const series = e1rmSeries(days, { name: "Bench Press" }, { todayKey: "2026-06-30", windowDays: 180 });
    expect(series).toHaveLength(1);
    expect(lb(series[0]!.e1rmKg)).toBeCloseTo(234.3, 1); // 185×8 beats 205×3; the drop set is out
  });

  it("lets a cascade day contribute nothing (V12 law, re-pinned)", () => {
    const days: DayMap = {
      "2026-07-10": bench(S(185, 8)),
      "2026-07-12": bench(S(225, 6, { type: "drop", segments: [{ weight: "170", reps: "8" }] })),
    };
    expect(e1rmSeries(days, { name: "Bench Press" }, { todayKey: "2026-07-20", windowDays: 30 }).map((p) => p.dateKey)).toEqual(["2026-07-10"]);
  });

  it("never uses pain sets", () => {
    const days: DayMap = { "2026-07-10": bench(S(185, 8), S(225, 5, { pain: true })) };
    expect(lb(e1rmSeries(days, { name: "Bench Press" }, { todayKey: "2026-07-20", windowDays: 30 })[0]!.e1rmKg)).toBeCloseTo(234.3, 1);
  });

  it("windows by calendar days, not by the number of logged days (v19 bug)", () => {
    const today = "2026-07-20";
    const days: DayMap = {
      [addDays(today, -200)]: bench(S(135, 5)),
      [addDays(today, -30)]: bench(S(150, 5)),
      [addDays(today, -29)]: bench(S(155, 5)),
      [today]: bench(S(160, 5)),
      [addDays(today, 3)]: bench(S(300, 5)),
    };
    // v19 sliced the last N entry keys, so on a sparse log the "30-day" window reached back 200 days
    // (and forward past today).
    const series = e1rmSeries(days, { name: "Bench Press" }, { todayKey: today, windowDays: 30 });
    expect(series.map((p) => p.dateKey)).toEqual([addDays(today, -29), today]);
  });

  it("follows the performed movement and only reads loaded logs", () => {
    const days: DayMap = {
      "2026-07-10": day({ "Bench Press": { performedName: "Machine Chest Press", sets: [S(200, 10)] } }),
      "2026-07-11": day({ "Bench Press": { sets: [S(185, 5)] }, "bench press ": { sets: [S(195, 5)] } }),
      "2026-07-12": normalizeDay({ v: 2, checkin: {}, workout: { cardio: [], exercises: { b: { name: "Bench Press", trackingMode: "bodyweight_reps", sets: [{ id: "s1", weightKg: 50, reps: 5, done: true }] } } } }),
    };
    const series = e1rmSeries(days, { name: "Bench Press" }, { todayKey: "2026-07-20", windowDays: 30 });
    expect(series.map((p) => [p.dateKey, Math.round(lb(p.e1rmKg))])).toEqual([["2026-07-11", 228]]);
  });
});

describe("liftTrend", () => {
  /** One session every 3 days from May 1, best set `w` × 8; today is the last session. */
  function fixture(weights: number[]) {
    const days: DayMap = {};
    weights.forEach((w, i) => (days[addDays("2026-05-01", i * 3)] = bench(S(w, 8))));
    return { days, todayKey: addDays("2026-05-01", (weights.length - 1) * 3) };
  }
  const trend = (weights: number[]) => {
    const { days, todayKey } = fixture(weights);
    return liftTrend(days, { name: "Bench Press" }, { todayKey });
  };

  it("is building below the minimum history", () => {
    expect(trend([185, 185, 185])).toMatchObject({ status: "building", deltaKg: null, deltaPct: null });
    expect(trend([185, 185, 185]).currentKg).toBeCloseTo(e1rm(lbToKg(185), 8)!, 10);
    expect(liftTrend({}, { name: "Bench Press" }, { todayKey: "2026-05-01" })).toMatchObject({ status: "building", currentKg: null });
  });

  it("classifies progressing / stalled / regressing", () => {
    expect(trend([185, 185, 190, 190, 195, 195, 200, 205]).status).toBe("progressing");
    expect(trend([200, 200, 200, 200, 200, 200, 200, 200])).toMatchObject({ status: "stalled", deltaKg: 0, deltaPct: 0 });
    expect(trend([200, 200, 200, 190, 185, 185, 185, 185]).status).toBe("regressing");
  });

  it("computes the verdict and the delta over the SAME window, so they never disagree (v19 bug)", () => {
    // v19: the verdict compared the last 4 vs the prior 4 SESSIONS (here reaching back two months to the
    // 150s), while the delta covered 30 calendar days, so "↑ progressing" sat next to a flat or negative delta.
    const today = "2026-07-20";
    const days: DayMap = {
      [addDays(today, -63)]: bench(S(150, 8)),
      [addDays(today, -56)]: bench(S(150, 8)),
      [addDays(today, -49)]: bench(S(150, 8)),
      [addDays(today, -28)]: bench(S(205, 8)),
      [addDays(today, -21)]: bench(S(205, 8)),
      [addDays(today, -7)]: bench(S(200, 8)),
      [today]: bench(S(200, 8)),
    };
    const t = liftTrend(days, { name: "Bench Press" }, { todayKey: today, windowDays: 30 });
    expect(t.series).toHaveLength(4);
    expect(t.status).toBe("regressing");
    expect(t.deltaKg!).toBeLessThan(0);

    for (const weights of [[100, 120, 90, 95, 100, 130, 80, 85], [200, 150, 210, 205, 195, 198, 202, 199], [100, 101, 99, 100, 102, 98, 100, 101]]) {
      const r = trend(weights);
      if (r.status === "progressing") expect(r.deltaKg!).toBeGreaterThan(0);
      if (r.status === "regressing") expect(r.deltaKg!).toBeLessThan(0);
    }
  });
});

describe("detectRecords", () => {
  const meta = (log: ExerciseLog) => guessMeta(log.performedName ?? log.name);
  const base: DayMap = {
    "2026-07-06": bench(S(180, 8), S(180, 8)),
    "2026-07-13": bench(S(185, 8), S(185, 8)),
  };
  const detect = (today: DayV2, history: DayMap = base, extra: Partial<DetectRecordsInput> = {}) =>
    detectRecords({ dateKey: "2026-07-20", day: today, history, metaFor: meta, units: "imperial", ...extra });

  it("finds a genuine e1RM record against ALL prior history (legacy pin)", () => {
    const [r] = detect(bench(S(205, 8)));
    expect(r).toMatchObject({ exerciseId: "Bench Press", name: "Bench Press", kind: "e1rm", priorExposures: 2, baseline: false, isRecord: true, fromExtraWork: false });
    expect(r!.previous).toBeCloseTo(e1rm(lbToKg(185), 8)!, 10);
    expect(r!.current).toBeCloseTo(e1rm(lbToKg(205), 8)!, 10);
    expect(r!.label).toBe("e1RM 259.7 lb (was 234.3 lb)");
  });

  it("does not count a drop-set 'record': straight sets only, both sides (legacy pin)", () => {
    const records = detect(bench(S(205, 8, { type: "drop", segments: [{ weight: "155", reps: "10" }] })));
    expect(records).toEqual([]);
    const history = { ...base, "2026-07-14": bench(S(300, 8, { type: "drop" })) };
    expect(detect(bench(S(205, 8)), history)[0]!.isRecord).toBe(true);
  });

  it("makes a first-ever performance a baseline, never a record", () => {
    const [r] = detect(bench(S(205, 8)), {});
    expect(r).toMatchObject({ baseline: true, isRecord: false, previous: null, priorExposures: 0 });
    expect(r!.label).toBe("e1RM 259.7 lb · baseline");
  });

  it("requires BOTH the ratio and the kg delta for e1RM", () => {
    const history = { "2026-07-13": v2({ curl: { sets: [{ weightKg: 20, reps: 1 }] } }), "2026-07-14": v2({ squat: { sets: [{ weightKg: 100, reps: 1 }] } }) };
    const at = (id: string, kg: number) => detectRecords({ dateKey: "2026-07-20", day: v2({ [id]: { sets: [{ weightKg: kg, reps: 1 }] } }), history, metaFor: () => guessMeta("Curl"), units: "metric" })[0]!;
    expect(at("squat", 100.6).isRecord).toBe(false); // +0.6 kg but only +0.6%
    expect(at("squat", 101).isRecord).toBe(true); // exactly +1% and +1 kg
    expect(at("curl", 20.3).isRecord).toBe(false); // +1.5% but only +0.3 kg
    expect(at("curl", 20.5).isRecord).toBe(true);
    const loose = detectRecords({ dateKey: "2026-07-20", day: v2({ curl: { sets: [{ weightKg: 20.3, reps: 1 }] } }), history, metaFor: () => guessMeta("Curl"), units: "metric", thresholds: { minKgDelta: 0.25 } });
    expect(loose[0]!.isRecord).toBe(true);
    expect(DEFAULT_RECORD_THRESHOLDS).toEqual({ minRatio: 1.01, minKgDelta: 0.5, minRepDelta: 1, minSecondsDelta: 5 });
  });

  it("never uses pain sets on either side", () => {
    expect(detect(bench(S(185, 8), S(225, 8, { pain: true })))[0]!.isRecord).toBe(false);
    const history = { ...base, "2026-07-14": bench(S(300, 8, { pain: true })) };
    expect(detect(bench(S(205, 8)), history)[0]!.isRecord).toBe(true);
    expect(detect(bench(S(205, 8, { pain: true })))).toEqual([]);
  });

  it("is substitution-aware (v19 compared a swap against the planned lift's history)", () => {
    const history: DayMap = { "2026-07-13": day({ "Seated Cable Row": { sets: [S(200, 10)] } }) };
    const today = day({ "Seated Cable Row": { performedName: "Chest-Supported Row", sets: [S(120, 10)] } });
    expect(detect(today, history)[0]).toMatchObject({ exerciseId: "Seated Cable Row", name: "Chest-Supported Row", baseline: true, isRecord: false });
    const later = detect(day({ "Seated Cable Row": { sets: [S(205, 10)] } }), { ...history, "2026-07-15": today });
    expect(later[0]!.isRecord).toBe(true);
    expect(later[0]!.priorExposures).toBe(1);
  });

  it("says when the record came from extra work, preferring planned sets on a tie", () => {
    const extra = v2({ "Bench Press": { sets: [{ weightKg: lbToKg(185), reps: 8 }, { weightKg: lbToKg(205), reps: 8, extra: true }] } });
    expect(detect(extra)[0]).toMatchObject({ isRecord: true, fromExtraWork: true });
    const tie = v2({ "Bench Press": { sets: [{ weightKg: 100, reps: 5, extra: true }, { weightKg: 100, reps: 5 }] } });
    expect(detect(tie)[0]!.fromExtraWork).toBe(false);
  });

  it("ignores history on or after the record day", () => {
    const history = { ...base, "2026-07-20": bench(S(300, 8)), "2026-07-25": bench(S(300, 8)) };
    expect(detect(bench(S(205, 8)), history)[0]!.isRecord).toBe(true);
  });

  it("compares bodyweight reps at the same added load", () => {
    const history: DayMap = { "2026-07-13": day({ "Pull-Ups": { sets: [S("", 12), S(25, 6)] } }) };
    const at = (...sets: unknown[]) => detect(day({ "Pull-Ups": { sets } }), history)[0]!;
    expect(at(S("", 14))).toMatchObject({ kind: "reps", previous: 12, current: 14, isRecord: true, loadKg: 0, label: "BW × 14 (was 12)" });
    const loaded = at(S("", 12), S(25, 8));
    expect(loaded).toMatchObject({ previous: 6, current: 8, isRecord: true, label: "+25 lb × 8 (was 6)" });
    expect(at(S(25, 8), S("", 12))).toMatchObject({ previous: 6, current: 8 });
    expect(at(S("", 12))).toMatchObject({ previous: 12, current: 12, isRecord: false });
    expect(at(S(45, 5), S(45, 3))).toMatchObject({ previous: null, current: 5, isRecord: false, baseline: false });
    expect(lb(at(S(45, 5)).loadKg!)).toBe(45);
  });

  it("uses best seconds for holds, with a 5 s minimum gain", () => {
    const hold = (secs: number) => ({ weight: "", duration: String(secs), done: true });
    const history: DayMap = { "2026-07-13": day({ Plank: { sets: [hold(60), hold(55)] } }) };
    expect(detect(day({ Plank: { sets: [hold(64)] } }), history)[0]).toMatchObject({ kind: "hold", previous: 60, current: 64, isRecord: false });
    expect(detect(day({ Plank: { sets: [hold(65)] } }), history)[0]).toMatchObject({ isRecord: true, label: "65 s (was 60 s)" });
  });

  it("has no candidate for skipped, assisted, carry or unperformed work", () => {
    const today = day({
      Squat: { skipped: "time", sets: [] },
      "Assisted Pull-Up": { sets: [{ assistance: "40", reps: "8", done: true }] },
      "Farmer Carry": { sets: [{ weight: "70", distance: "40", done: true }] },
      Curl: { sets: [{ weight: "30", reps: "", done: true }] },
    });
    expect(detect(today)).toEqual([]);
  });

  it("only compares against history logged in the same tracking mode", () => {
    const history: DayMap = { "2026-07-13": normalizeDay({ v: 2, checkin: {}, workout: { cardio: [], exercises: { d: { name: "Dips", trackingMode: "loaded_reps", sets: [{ id: "s1", weightKg: 100, reps: 10, done: true }] } } } }) };
    const [r] = detect(day({ Dips: { sets: [S("", 12)] } }), history);
    expect(r).toMatchObject({ kind: "reps", baseline: true, priorExposures: 0 });
  });
});
