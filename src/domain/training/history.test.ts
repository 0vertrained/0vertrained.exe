import { describe, expect, it } from "vitest";
import { normalizeDay } from "../day/normalize";
import type { DayMap, ExerciseLog } from "../day/schema";
import { exerciseHistory, isSubstituted, normalizeName, performedMovement, performedName, sameMovement } from "./history";

const S = (weight: number, reps: number) => ({ weight: String(weight), reps: String(reps), done: true });
const v1 = (exercises: Record<string, unknown>) => normalizeDay({ workout: { exercises } });

describe("normalizeName", () => {
  it("ignores case and extra whitespace", () => {
    expect(normalizeName("  Seated   Cable  ROW ")).toBe("seated cable row");
  });
});

describe("sameMovement", () => {
  const row: ExerciseLog = { name: "Seated Cable Row", libraryId: "seated-cable-row", sets: [] };

  it("matches by library id when both sides have one", () => {
    expect(sameMovement(row, { name: "Cable Row (seated)", libraryId: "seated-cable-row" })).toBe(true);
    expect(sameMovement(row, { name: "Seated Cable Row", libraryId: "other" })).toBe(false);
  });

  it("falls back to case/whitespace-insensitive names", () => {
    expect(sameMovement(row, { name: "seated  cable row" })).toBe(true);
    expect(sameMovement({ name: "Bench", sets: [] }, { name: "Bench", libraryId: "bench" })).toBe(true);
    expect(sameMovement(row, { name: "Chest-Supported Row" })).toBe(false);
  });

  it("is substitution-aware: a swap is history for the movement performed", () => {
    const swapped: ExerciseLog = { ...row, performedName: "Chest-Supported Row" };
    expect(isSubstituted(swapped)).toBe(true);
    expect(performedName(swapped)).toBe("Chest-Supported Row");
    expect(performedMovement(swapped)).toEqual({ name: "Chest-Supported Row" });
    expect(sameMovement(swapped, { name: "Chest-Supported Row" })).toBe(true);
    // The planned lift's library id must not claim the swapped day.
    expect(sameMovement(swapped, { name: "Seated Cable Row", libraryId: "seated-cable-row" })).toBe(false);
    expect(sameMovement(swapped, { name: "Seated Cable Row" })).toBe(false);
  });

  it("ignores a blank or same-name performedName", () => {
    const blank: ExerciseLog = { ...row, performedName: "  " };
    const same: ExerciseLog = { ...row, performedName: "seated cable row" };
    expect(isSubstituted(blank)).toBe(false);
    expect(isSubstituted(same)).toBe(false);
    expect(performedName(same)).toBe("Seated Cable Row");
    expect(performedMovement(same)).toEqual({ name: "Seated Cable Row", libraryId: "seated-cable-row" });
    expect(performedMovement({ name: "Curl", sets: [] })).toEqual({ name: "Curl" });
  });
});

describe("exerciseHistory", () => {
  const days: DayMap = {
    "2026-07-13": v1({ "Barbell Bench Press": { performedName: "Machine Chest Press", sets: [S(160, 10)] } }),
    "2026-07-06": v1({ "Barbell Bench Press": { sets: [S(185, 8)] } }),
    "2026-07-20": v1({ "Barbell Bench Press": { sets: [S(190, 8)] } }),
    "2026-07-08": { ...v1({ "Bench": { sets: [S(135, 10)] }, "barbell bench press": { sets: [S(185, 6)] } }) },
  };

  it("returns exposures oldest first, matching names case-insensitively", () => {
    const history = exerciseHistory(days, { name: "Barbell Bench Press" });
    expect(history.map((e) => [e.dateKey, e.exerciseId])).toEqual([
      ["2026-07-06", "Barbell Bench Press"],
      ["2026-07-08", "barbell bench press"],
      ["2026-07-20", "Barbell Bench Press"],
    ]);
  });

  it("keeps substituted movements' history separate from the planned exercise (legacy pin)", () => {
    expect(exerciseHistory(days, { name: "Barbell Bench Press" }, { beforeKey: "2026-07-20" }).map((e) => e.dateKey))
      .toEqual(["2026-07-06", "2026-07-08"]);
    expect(exerciseHistory(days, { name: "Machine Chest Press" }).map((e) => e.dateKey)).toEqual(["2026-07-13"]);
  });

  it("bounds by calendar keys: fromKey inclusive, beforeKey exclusive", () => {
    expect(exerciseHistory(days, { name: "Barbell Bench Press" }, { fromKey: "2026-07-08", beforeKey: "2026-07-20" }).map((e) => e.dateKey))
      .toEqual(["2026-07-08"]);
  });

  it("carries the day's quest tier", () => {
    const base = v1({ Squat: { sets: [S(225, 5)] } });
    const reduced = {
      ...base,
      quest: { rulesVersion: 1, tier: "REDUCED" as const, reason: "", issuedAt: "", engineIssued: true, planned: { exercises: [], plannedSets: 0, cardioMinutes: null } },
    };
    const history = exerciseHistory({ "2026-07-01": base, "2026-07-02": reduced }, { name: "Squat" });
    expect(history[0]).not.toHaveProperty("tier");
    expect(history[1]!.tier).toBe("REDUCED");
  });

  it("tolerates days without a workout", () => {
    const broken = { "2026-07-01": {} } as unknown as DayMap;
    expect(exerciseHistory(broken, { name: "Squat" })).toEqual([]);
  });
});
