import { describe, expect, it } from "vitest";
import { lbToKg, miToKm, ydToM } from "../units";
import { normalizeDay, isV2Payload, parseAmount, payloadBytes } from "./normalize";
import { emptyDay, type DayV2 } from "./schema";

/** A realistic v19 day: defaultDay() plus a logged session and check-in. */
function v1Day() {
  return {
    workout: {
      completed: false,
      exercises: {
        "Barbell Bench Press": {
          sets: [
            { weight: "185", reps: "6", rir: "2", done: true, completedAt: "2026-07-01T17:01:00.000Z", quality: "clean" },
            { weight: "185", reps: "5", rir: "1", done: true, completedAt: "2026-07-01T17:04:00.000Z", type: "drop", segments: [{ weight: "185", reps: "5" }, { weight: "135", reps: "6" }] },
            { weight: "", reps: "", rir: "", done: false },
          ],
          progressionDecision: { status: "accepted", targetWeight: 185 },
          nextPrescription: { weight: 190 },
          warmupSets: [{ weight: 95, reps: 5, done: true }],
        },
        "Plank": { sets: [{ weight: "", reps: "", duration: "60", rir: "", done: true }] },
        "Farmer Carry": { sets: [{ weight: "70", reps: "", distance: "40", duration: "", rir: "", done: true }] },
        "Assisted Pull-Up": { sets: [{ weight: "", assistance: "40", reps: "8", rir: "", done: true, pain: true }] },
        "Seated Cable Row": { sets: [], skipped: "equipment", performedName: "Chest-Supported Row", substitutionReason: "busy" },
        "Leg Ext. Machine": { sets: [{ weight: "90", reps: "12", done: true }], skipped: "boredom" },
      },
      cardio: { miles: "3.1", time: "27:30", pace: "8:52", notes: "easy" },
      cardioSessions: { pm: { miles: "2", time: "", pace: "" } },
      sessionState: { am: { status: "complete", completedAt: "2026-07-01T18:00:00.000Z" } },
      notes: "felt good",
    },
    nutrition: { calories: "2400", protein: "180", carbs: "", fats: "", water: "", meals: [], plannedMeals: { lunch: "bowl" } },
    activity: { steps: "9000" },
    body: {
      weight: "182.4", waist: "", sleep: "7.5", sleepQuality: "6", restingHeartRate: "52", hrv: "",
      energy: "9", soreness: "8", stress: "", motivation: "7", illnessOrInjury: false, progressPhotos: ["front"],
    },
    supplements: { creatine: true },
    intelligence: { acceptedTrainingSuggestion: null, physiqueOS: { mode: "full" } },
  };
}

describe("v1 → v2", () => {
  const day = normalizeDay(v1Day());
  const bench = day.workout.exercises["Barbell Bench Press"]!;

  it("marks the result as v2", () => {
    expect(day.v).toBe(2);
    expect(isV2Payload(day)).toBe(true);
    expect(isV2Payload(v1Day())).toBe(false);
  });

  it("parses string numbers and converts pounds to kilograms", () => {
    expect(bench.sets[0]).toMatchObject({ id: "s1", weightKg: lbToKg(185), reps: 6, done: true, completedAt: "2026-07-01T17:01:00.000Z" });
    expect(bench.sets[2]).toMatchObject({ id: "s3", weightKg: null, reps: null, done: false });
  });

  it("maps holds, carries and assistance to canonical units", () => {
    expect(day.workout.exercises.Plank!.sets[0]).toMatchObject({ seconds: 60, weightKg: null, done: true });
    expect(day.workout.exercises["Farmer Carry"]!.sets[0]).toMatchObject({ weightKg: lbToKg(70), distanceM: ydToM(40) });
    expect(day.workout.exercises["Assisted Pull-Up"]!.sets[0]).toMatchObject({ assistanceKg: lbToKg(40), reps: 8, pain: true });
  });

  it("keeps exercise names with dots as keys (the v1 dot-path setter lost them)", () => {
    expect(day.workout.exercises["Leg Ext. Machine"]!.name).toBe("Leg Ext. Machine");
  });

  it("keeps skip reasons and substitutions", () => {
    const row = day.workout.exercises["Seated Cable Row"]!;
    expect(row.skipped).toBe("equipment");
    expect(row.performedName).toBe("Chest-Supported Row");
  });

  it("moves the check-in to its own record", () => {
    expect(day.checkin).toEqual({ sleepQuality: 6, energy: 9, soreness: 8 });
  });

  it("turns both v1 cardio shapes into a list", () => {
    expect(day.workout.cardio).toEqual([
      { id: "cardio", kind: "cardio", minutes: 27.5, km: miToKm(3.1), source: "manual", notes: "easy", legacy: { pace: "8:52" } },
      { id: "pm", kind: "cardio", minutes: null, km: miToKm(2), source: "manual", legacy: { pace: "" } },
    ]);
  });

  it("loses nothing: every unmodelled v1 field is kept under legacy", () => {
    const raw = v1Day();
    expect(day.legacy).toEqual({
      nutrition: raw.nutrition,
      activity: raw.activity,
      supplements: raw.supplements,
      intelligence: raw.intelligence,
      body: { weight: "182.4", waist: "", sleep: "7.5", restingHeartRate: "52", hrv: "", motivation: "7", progressPhotos: ["front"] },
    });
    expect(day.workout.legacy).toEqual({ completed: false, sessionState: raw.workout.sessionState, cardio: { pace: "8:52" } });
    expect(day.workout.notes).toBe("felt good");
    expect(bench.legacy).toEqual({
      progressionDecision: { status: "accepted", targetWeight: 185 },
      nextPrescription: { weight: 190 },
      warmupSets: [{ weight: 95, reps: 5, done: true }],
    });
    expect(bench.sets[0]!.legacy).toEqual({ rir: "2", quality: "clean" });
    expect(bench.sets[1]!.legacy).toEqual({ rir: "1", type: "drop", segments: raw.workout.exercises["Barbell Bench Press"].sets[1]!.segments });
    expect(day.workout.exercises["Seated Cable Row"]!.legacy).toEqual({ substitutionReason: "busy" });
    // An unknown skip reason is not dropped silently.
    expect(day.workout.exercises["Leg Ext. Machine"]!.skipped).toBeUndefined();
    expect(day.workout.exercises["Leg Ext. Machine"]!.legacy).toEqual({ skipped: "boredom" });
  });

  it("resolves library ids when a resolver is given", () => {
    const resolved = normalizeDay(v1Day(), { resolveLibraryId: (n) => (n === "Plank" ? "plank" : undefined) });
    expect(resolved.workout.exercises.Plank!.libraryId).toBe("plank");
    expect(resolved.workout.exercises["Farmer Carry"]!.libraryId).toBeUndefined();
  });

  it("reads illness from either boolean or string", () => {
    expect(normalizeDay({ body: { illnessOrInjury: true } }).checkin.illness).toBe(true);
    expect(normalizeDay({ body: { illnessOrInjury: "true" } }).checkin.illness).toBe(true);
    expect(normalizeDay({ body: { illnessOrInjury: false } }).checkin.illness).toBeUndefined();
  });

  it("keeps out-of-range check-in values out of the check-in but never drops them", () => {
    const day = normalizeDay({ body: { energy: "0", soreness: "11", stress: "-2", sleepQuality: "x", motivation: "" } });
    expect(day.checkin).toEqual({});
    expect(day.legacy).toEqual({ body: { energy: "0", soreness: "11", stress: "-2", sleepQuality: "x", motivation: "" } });
  });

  it("drops an empty v1 cardio block", () => {
    expect(normalizeDay({ workout: { cardio: { miles: "", time: "", pace: "", notes: "" } } }).workout.cardio).toEqual([]);
  });

  it("treats non-objects as an empty day", () => {
    for (const junk of [null, undefined, 42, "x", []]) expect(normalizeDay(junk)).toEqual(emptyDay());
  });

  it("tolerates malformed nested values", () => {
    const day2 = normalizeDay({ workout: { exercises: { Squat: "nope", Row: { sets: [null, 7] } } }, body: "x" });
    expect(day2.workout.exercises.Squat!.sets).toEqual([]);
    expect(day2.workout.exercises.Row!.sets).toEqual([
      { id: "s1", weightKg: null, reps: null, done: false },
      { id: "s2", weightKg: null, reps: null, done: false },
    ]);
  });
});

describe("v2 coercion", () => {
  it("is idempotent for a normalized day", () => {
    const once = normalizeDay(v1Day());
    expect(normalizeDay(JSON.parse(JSON.stringify(once)))).toEqual(JSON.parse(JSON.stringify(once)));
  });

  it("coerces untrusted v2 input from the network", () => {
    const day = normalizeDay({
      v: 2,
      checkin: { energy: 12, soreness: 5, illness: "yes", note: "x".repeat(400) },
      workout: {
        exercises: {
          "ex-1": { sets: [{ weightKg: "100", reps: 5, done: "true", pain: 1, seconds: "abc", trial: true }], trackingMode: "flying", skipped: "nap" },
        },
        cardio: [{ minutes: "30", km: -1, source: "watch" }],
      },
      quest: { tier: "MAX" },
      legacy: "nope",
      futureField: { keep: true },
    } as unknown);
    expect(day.checkin).toEqual({ soreness: 5, note: "x".repeat(280) });
    const ex = day.workout.exercises["ex-1"]!;
    expect(ex).toMatchObject({ name: "ex-1" });
    expect(ex.trackingMode).toBeUndefined();
    expect(ex.skipped).toBeUndefined();
    expect(ex.sets[0]).toEqual({ id: "s1", weightKg: 100, reps: 5, done: false, seconds: null, trial: true });
    expect(day.workout.cardio[0]).toEqual({ id: "c1", kind: "cardio", minutes: 30, km: null, source: "manual" });
    expect(day.quest).toBeUndefined();
    expect(day.legacy).toBeUndefined();
    expect((day as DayV2 & { futureField?: unknown }).futureField).toEqual({ keep: true });
  });

  it("keeps a valid quest snapshot and workout timestamps", () => {
    const quest = { rulesVersion: 1, tier: "REDUCED", reason: "r", issuedAt: "t", engineIssued: true, planned: { exercises: [], plannedSets: 0, cardioMinutes: null } };
    const day = normalizeDay({ v: 2, checkin: {}, workout: { startedAt: "a", exercises: {}, cardio: [] }, quest });
    expect(day.quest).toEqual(quest);
    expect(day.workout.startedAt).toBe("a");
  });

  it("fills missing v2 structure", () => {
    expect(normalizeDay({ v: 2 })).toEqual(emptyDay());
  });
});

describe("helpers", () => {
  it("parseAmount treats blanks, junk and negatives as not entered", () => {
    expect(parseAmount("185.5")).toBe(185.5);
    expect(parseAmount(0)).toBe(0);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("  ")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount(true)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });

  it("measures payload size in bytes", () => {
    expect(payloadBytes({ a: "é" })).toBe(JSON.stringify({ a: "é" }).length + 1);
  });
});
