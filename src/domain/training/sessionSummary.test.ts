import { describe, expect, it } from "vitest";
import { normalizeDay } from "../day/normalize";
import type { DayMap, DayV2, ExerciseLog, PlannedExercise, SetLog } from "../day/schema";
import { guessMeta } from "../exercise";
import { lbToKg } from "../units";
import { summarizeSession, tonnageKg } from "./sessionSummary";

const S = (weight: number | string, reps: number | string, extra: Record<string, unknown> = {}) =>
  ({ done: true, weight: String(weight), reps: String(reps), ...extra });
const day = (exercises: Record<string, unknown>): DayV2 => normalizeDay({ workout: { exercises } });
const metaFor = (log: ExerciseLog) => guessMeta(log.performedName ?? log.name);
const summarize = (today: DayV2, history: DayMap, dayName?: string, dateKey = "2026-07-20") =>
  summarizeSession({ dateKey, day: today, history, metaFor, units: "imperial", ...(dayName ? { dayName } : {}) });

// Mondays: 07-06 and 07-13 share 07-20's weekday — the tonnage comparison basis.
const base: DayMap = {
  "2026-07-06": day({ Bench: { sets: [S(180, 8), S(180, 8)] } }),
  "2026-07-13": day({ Bench: { sets: [S(185, 8), S(185, 8)] } }),
};

describe("headline priority and honest math (Box Score pins)", () => {
  it("a genuine e1RM record wins the headline", () => {
    const b = summarize(day({ Bench: { sets: [S(205, 8)] } }), base, "Push");
    expect(b.headline).toBe("Record: Bench.");
    expect(b.records.filter((r) => r.isRecord)).toHaveLength(1);
    const two = summarize(day({ Bench: { sets: [S(205, 8)] }, Row: { sets: [S(200, 8)] } }), { ...base, "2026-07-14": day({ Row: { sets: [S(150, 8)] } }) });
    expect(two.headline).toBe("2 records today.");
  });

  it("a drop-set 'record' is not a record", () => {
    const b = summarize(day({ Bench: { sets: [S(205, 8, { type: "drop", segments: [{ weight: "155", reps: "10" }] })] } }), base, "Push");
    expect(b.records).toHaveLength(0);
    expect(b.headline).not.toMatch(/^Record/);
  });

  it("compares tonnage with the last SAME-weekday session and reports the delta", () => {
    const history = { ...base, "2026-07-15": day({ Row: { sets: [S(225, 10)] } }) }; // a Wednesday: never the basis
    const b = summarize(day({ Bench: { sets: [S(185, 8), S(185, 8), S(185, 8)] } }), history, "Push");
    expect(b.tonnageKg).toBeCloseTo(lbToKg(185) * 8 * 3, 6);
    expect(b.tonnageCompare).toEqual({ priorDateKey: "2026-07-13", priorTonnageKg: expect.closeTo(lbToKg(185) * 16, 6), deltaPct: 50 });
    expect(b.headline).toBe("Biggest Push in a while — up 50%.");
    expect(b.method).toBe("vs your last Push session · e1RM from straight, pain-free sets");
  });

  it("first same-day session on record: no fake deltas, the baseline headline", () => {
    const b = summarize(day({ Bench: { sets: [S(185, 8)] } }), {}, "Push");
    expect(b.tonnageCompare).toBeNull();
    expect(b.records[0]).toMatchObject({ baseline: true, isRecord: false });
    expect(b.headline).toBe("First Push on record — the baseline is set.");
    expect(summarize(day({ Bench: { sets: [S(185, 8)] } }), {}).headline).toBe("First session on record — the baseline is set.");
    expect(b.method).toBe("e1RM from straight, pain-free sets");
  });

  it("strength arrows name the lift moving up when no record was set", () => {
    const history = { "2026-06-01": day({ Bench: { sets: [S(225, 8)] } }), ...base };
    const b = summarize(day({ Bench: { sets: [S(195, 8)] } }), history);
    expect(b.records[0]!.isRecord).toBe(false);
    expect(b.arrows).toEqual([{ exerciseId: "Bench", name: "Bench", e1rmKg: expect.any(Number), dir: "up" }]);
    expect(b.headline).toBe("Strength moving — Bench ↗.");
    expect(summarize(day({ Bench: { sets: [S(185, 8), S(185, 8)] } }), history).arrows[0]!.dir).toBe("flat");
    expect(summarize(day({ Bench: { sets: [S(135, 8)] } }), history).arrows[0]!.dir).toBe("down");
  });

  it("falls back to 'Session banked.' and says so when nothing was banked", () => {
    expect(summarize(day({ Bench: { sets: [S(185, 8), S(185, 8)] } }), base).headline).toBe("Session banked.");
    const nothing = summarize(day({ Bench: { sets: [{ weight: "185", reps: "8", done: false }] } }), base);
    expect(nothing.headline).toBe("Nothing banked yet.");
    expect(nothing.durationMinutes).toBeNull();
  });

  it("names skips honestly", () => {
    const b = summarize(day({ Bench: { sets: [S(185, 8)] }, "Cable Fly": { skipped: "equipment", sets: [] } }), base);
    expect(b.skips).toEqual([{ exerciseId: "Cable Fly", name: "Cable Fly", reason: "equipment" }]);
  });
});

describe("work counted", () => {
  const set = (values: Partial<SetLog>, i: number): SetLog => ({ id: `s${i + 1}`, weightKg: null, reps: null, done: true, ...values });
  const planned = (id: string, sets: number, trackingMode: PlannedExercise["trackingMode"] = "loaded_reps"): PlannedExercise => ({ id, name: id, sets, reps: "8", trackingMode });
  const v2Day = (exercises: Record<string, Partial<SetLog>[]>, plan?: PlannedExercise[]): DayV2 => ({
    v: 2,
    checkin: {},
    workout: { cardio: [], exercises: Object.fromEntries(Object.entries(exercises).map(([id, sets]) => [id, { name: id, sets: sets.map(set) }])) },
    ...(plan ? { quest: { rulesVersion: 1, tier: "FULL" as const, reason: "", issuedAt: "", engineIssued: true, planned: { exercises: plan, plannedSets: plan.reduce((n, p) => n + p.sets, 0), cardioMinutes: null } } } : {}),
  });

  it("counts planned sets against the quest; extra and unplanned work is counted apart", () => {
    const today = v2Day(
      {
        squat: [{ weightKg: 100, reps: 5 }, { weightKg: 100, reps: 5 }, { weightKg: 100, reps: 5, extra: true }],
        "Push-Ups": [{ reps: 20 }],
        curl: [{ weightKg: 15, reps: 10 }],
        row: [{ weightKg: 60, reps: null }],
      },
      [planned("squat", 3), planned("Push-Ups", 2, "bodyweight_reps"), planned("row", 1)],
    );
    const b = summarizeSession({ dateKey: "2026-07-20", day: today, history: {}, metaFor, units: "metric" });
    expect(b).toMatchObject({ setsDone: 3, extraSetsDone: 2, plannedSets: 6 });
    // Tonnage: banked, valid, non-extra loaded sets only (not bodyweight, not the invalid row).
    expect(b.tonnageKg).toBe(100 * 5 * 2 + 15 * 10);
    expect(tonnageKg(today, metaFor)).toBe(b.tonnageKg);
  });

  it("counts every non-extra performed set without a quest", () => {
    const b = summarizeSession({ dateKey: "2026-07-20", day: v2Day({ squat: [{ weightKg: 100, reps: 5 }, { weightKg: 100, reps: 5, extra: true }] }), history: {}, metaFor, units: "metric" });
    expect(b).toMatchObject({ setsDone: 1, extraSetsDone: 1, plannedSets: null });
  });

  it("includes pain sets in tonnage (performed work) but never in records", () => {
    const b = summarizeSession({ dateKey: "2026-07-20", day: v2Day({ squat: [{ weightKg: 100, reps: 5, pain: true }] }), history: {}, metaFor, units: "metric" });
    expect(b.tonnageKg).toBe(500);
    expect(b.records).toEqual([]);
  });

  it("times the session from the first to the last banked set", () => {
    const today = v2Day({
      squat: [{ weightKg: 100, reps: 5, completedAt: "2026-07-20T17:02:00Z" }, { weightKg: 100, reps: 5, completedAt: "2026-07-20T17:50:30Z" }],
      curl: [{ weightKg: 15, reps: 10, completedAt: "2026-07-20T17:20:00Z" }, { weightKg: 15, reps: 10, done: false, completedAt: "2026-07-20T19:00:00Z" }, { weightKg: 15, reps: 10, completedAt: "junk" }],
    });
    expect(summarizeSession({ dateKey: "2026-07-20", day: today, history: {}, metaFor, units: "metric" }).durationMinutes).toBe(49);
    const single = v2Day({ squat: [{ weightKg: 100, reps: 5, completedAt: "2026-07-20T17:02:00Z" }] });
    expect(summarizeSession({ dateKey: "2026-07-20", day: single, history: {}, metaFor, units: "metric" }).durationMinutes).toBeNull();
  });
});
