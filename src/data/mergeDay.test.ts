// mergeDay: nothing logged on either device is lost, and where both changed
// the same thing the rule is predictable.
import { describe, expect, it } from "vitest";
import { emptyDay, type CardioLog, type CheckIn, type DayV2, type ExerciseLog, type Legacy, type QuestSnapshot, type SetLog, type WorkoutLog } from "../domain/day/schema";
import { mergeDay } from "./mergeDay";

const T0 = "2026-10-05T10:00:00.000Z";
const T1 = "2026-10-05T10:05:00.000Z";
const T2 = "2026-10-05T10:10:00.000Z";

const set = (id: string, over: Partial<SetLog> = {}): SetLog => ({ id, weightKg: 60, reps: 5, done: true, ...over });
const exercise = (name: string, sets: SetLog[], over: Partial<ExerciseLog> = {}): ExerciseLog => ({ name, sets, ...over });

interface DaySpec {
  checkin?: CheckIn;
  exercises?: Record<string, ExerciseLog>;
  cardio?: CardioLog[];
  workout?: Partial<Omit<WorkoutLog, "exercises" | "cardio">>;
  quest?: QuestSnapshot;
  legacy?: Legacy;
}

function day(spec: DaySpec = {}): DayV2 {
  const d = emptyDay();
  if (spec.checkin) d.checkin = spec.checkin;
  d.workout = { ...d.workout, ...spec.workout, exercises: spec.exercises ?? {}, cardio: spec.cardio ?? [] };
  if (spec.quest) d.quest = spec.quest;
  if (spec.legacy) d.legacy = spec.legacy;
  return d;
}

const quest = (over: Partial<QuestSnapshot> = {}): QuestSnapshot => ({
  rulesVersion: 1,
  tier: "FULL",
  reason: "Full quest",
  issuedAt: T0,
  engineIssued: true,
  planned: { exercises: [], plannedSets: 0, cardioMinutes: null },
  ...over,
});

const freeze = (value: unknown): string => JSON.stringify(value);

describe("mergeDay", () => {
  it("unions exercises by id: base order first, then ours' new ones, then theirs'", () => {
    const base = day({ exercises: { squat: exercise("Squat", [set("s1")]) } });
    const ours = day({ exercises: { squat: exercise("Squat", [set("s1")]), bench: exercise("Bench", [set("s1")]) } });
    const theirs = day({ exercises: { row: exercise("Row", [set("s1")]), squat: exercise("Squat", [set("s1")]) } });
    const merged = mergeDay(base, ours, theirs);
    expect(Object.keys(merged.workout.exercises)).toEqual(["squat", "bench", "row"]);
    expect(merged.workout.exercises.bench?.name).toBe("Bench");
    expect(merged.workout.exercises.row?.name).toBe("Row");
  });

  it("unions sets by id, keeping base order and appending new ones from ours then theirs", () => {
    const base = day({ exercises: { squat: exercise("Squat", [set("s1"), set("s2")]) } });
    const ours = day({ exercises: { squat: exercise("Squat", [set("s1"), set("s2"), set("s3")]) } });
    const theirs = day({ exercises: { squat: exercise("Squat", [set("s2"), set("s1"), set("s4")]) } });
    const merged = mergeDay(base, ours, theirs);
    expect(merged.workout.exercises.squat?.sets.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("lets the newer completedAt win a conflicting set", () => {
    const base = day({ exercises: { squat: exercise("Squat", [set("s1", { done: false })]) } });
    const ours = day({ exercises: { squat: exercise("Squat", [set("s1", { reps: 5, completedAt: T1 })]) } });
    const theirs = day({ exercises: { squat: exercise("Squat", [set("s1", { reps: 6, completedAt: T2 })]) } });
    expect(mergeDay(base, ours, theirs).workout.exercises.squat?.sets[0]).toMatchObject({ reps: 6, completedAt: T2 });
    expect(mergeDay(base, theirs, ours).workout.exercises.squat?.sets[0]).toMatchObject({ reps: 6, completedAt: T2 });
  });

  it("makes a set without completedAt lose to one with it, and gives a tie to ours", () => {
    const base = day({ exercises: { squat: exercise("Squat", [set("s1", { done: false })]) } });
    const unstamped = day({ exercises: { squat: exercise("Squat", [set("s1", { reps: 3, done: false })]) } });
    const stamped = day({ exercises: { squat: exercise("Squat", [set("s1", { reps: 5, completedAt: T1 })]) } });
    expect(mergeDay(base, unstamped, stamped).workout.exercises.squat?.sets[0]?.reps).toBe(5);
    expect(mergeDay(base, stamped, unstamped).workout.exercises.squat?.sets[0]?.reps).toBe(5);
    const ours = day({ exercises: { squat: exercise("Squat", [set("s1", { reps: 7, completedAt: T1 })]) } });
    const theirs = day({ exercises: { squat: exercise("Squat", [set("s1", { reps: 8, completedAt: T1 })]) } });
    expect(mergeDay(base, ours, theirs).workout.exercises.squat?.sets[0]?.reps).toBe(7);
  });

  it("keeps a set or exercise that only one side still has (deletions never propagate)", () => {
    const base = day({ exercises: { squat: exercise("Squat", [set("s1"), set("s2")]), bench: exercise("Bench", [set("s1")]) } });
    const ours = day({ exercises: { squat: exercise("Squat", [set("s1")]) } });
    const theirs = day({ exercises: { squat: exercise("Squat", [set("s1"), set("s2")]), bench: exercise("Bench", [set("s1")]) } });
    const merged = mergeDay(base, ours, theirs);
    expect(Object.keys(merged.workout.exercises)).toEqual(["squat", "bench"]);
    expect(merged.workout.exercises.squat?.sets.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("takes skipped and performedName from the side that changed them; ours on a double change", () => {
    const squat = (over: Partial<ExerciseLog>) => day({ exercises: { squat: exercise("Squat", [set("s1")], over) } });
    const pick = (base: DayV2 | undefined, ours: DayV2, theirs: DayV2) => mergeDay(base, ours, theirs).workout.exercises.squat;

    expect(pick(squat({}), squat({ skipped: "time" }), squat({}))?.skipped).toBe("time");
    expect(pick(squat({}), squat({}), squat({ skipped: "pain" }))?.skipped).toBe("pain");
    expect(pick(squat({}), squat({ skipped: "time" }), squat({ skipped: "pain" }))?.skipped).toBe("time");
    // Ours cleared it while theirs left it alone: the clear stands.
    expect(pick(squat({ skipped: "time" }), squat({}), squat({ skipped: "time" }))?.skipped).toBeUndefined();

    expect(pick(squat({}), squat({ performedName: "Front Squat" }), squat({}))?.performedName).toBe("Front Squat");
    expect(pick(squat({}), squat({}), squat({ performedName: "Hack Squat" }))?.performedName).toBe("Hack Squat");
    expect(pick(squat({}), squat({ performedName: "Front Squat" }), squat({ performedName: "Hack Squat" }))?.performedName).toBe("Front Squat");
  });

  it("merges check-in fields: a defined value beats undefined, a lone change wins, ours wins a double change", () => {
    const base = day({ checkin: { sleepQuality: 5, soreness: 4 } });
    const ours = day({ checkin: { sleepQuality: 5, soreness: 6, energy: 7, note: "tired" } });
    const theirs = day({ checkin: { sleepQuality: 8, soreness: 2, stress: 3, illness: true } });
    expect(mergeDay(base, ours, theirs).checkin).toEqual({ sleepQuality: 8, soreness: 6, energy: 7, stress: 3, illness: true, note: "tired" });
    expect(mergeDay(base, day({ checkin: {} }), day({ checkin: {} })).checkin).toEqual({});
  });

  it("unions cardio by id with the newer completion winning a conflict", () => {
    const cardio = (id: string, over: Partial<CardioLog> = {}): CardioLog => ({ id, kind: "Run", minutes: 30, km: 5, source: "manual", ...over });
    const base = day({ cardio: [cardio("c1")] });
    const ours = day({ cardio: [cardio("c1", { minutes: 31, completedAt: T1 }), cardio("c2", { kind: "Walk" })] });
    const theirs = day({ cardio: [cardio("c1", { minutes: 35, completedAt: T2 }), cardio("c3", { kind: "Bike" })] });
    const merged = mergeDay(base, ours, theirs);
    expect(merged.workout.cardio.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(merged.workout.cardio[0]).toMatchObject({ minutes: 35, completedAt: T2 });
  });

  it("keeps the earliest issued quest and takes claimedAt, recoveryDone and trial.passed from the truthy side", () => {
    const ours = day({ quest: quest({ issuedAt: T1, tier: "REDUCED", recoveryDone: true, trial: { targetRank: "C", exerciseId: "squat", spec: "100 kg x 5" } }) });
    const theirs = day({ quest: quest({ issuedAt: T0, tier: "FULL", claimedAt: T2, trial: { targetRank: "C", exerciseId: "squat", spec: "100 kg x 5", passed: true } }) });
    const merged = mergeDay(undefined, ours, theirs).quest;
    expect(merged).toMatchObject({ issuedAt: T0, tier: "FULL", claimedAt: T2, recoveryDone: true });
    expect(merged?.trial?.passed).toBe(true);
    // The same the other way round: ours was issued first.
    const flipped = mergeDay(undefined, theirs, ours).quest;
    expect(flipped).toMatchObject({ issuedAt: T0, tier: "FULL", claimedAt: T2, recoveryDone: true });
  });

  it("keeps the quest that exists when only one side has one, and none when neither does", () => {
    const q = quest({ claimedAt: T1 });
    expect(mergeDay(undefined, day({ quest: q }), day()).quest).toEqual(q);
    expect(mergeDay(undefined, day(), day({ quest: q })).quest).toEqual(q);
    expect(mergeDay(undefined, day(), day()).quest).toBeUndefined();
  });

  it("does not mark a trial passed or a quest claimed when neither side did", () => {
    const ours = day({ quest: quest({ trial: { targetRank: "C", exerciseId: "squat", spec: "x" } }) });
    const theirs = day({ quest: quest({ issuedAt: T1, trial: { targetRank: "C", exerciseId: "squat", spec: "x" } }) });
    const merged = mergeDay(undefined, ours, theirs).quest;
    expect(merged?.trial).toEqual({ targetRank: "C", exerciseId: "squat", spec: "x" });
    expect("claimedAt" in (merged ?? {})).toBe(false);
    expect("recoveryDone" in (merged ?? {})).toBe(false);
  });

  it("preserves legacy at every level, the winner's keys on top", () => {
    const ours = day({
      legacy: { nutrition: "ours", a: 1 },
      workout: { legacy: { pace: "ours" } },
      exercises: { squat: exercise("Squat", [set("s1", { completedAt: T1, legacy: { rir: 2 } })], { legacy: { tempo: "ours" } }) },
    });
    const theirs = day({
      legacy: { nutrition: "theirs", b: 2 },
      workout: { legacy: { pace: "theirs", gear: "theirs" } },
      exercises: { squat: exercise("Squat", [set("s1", { completedAt: T2, legacy: { rir: 1, rpe: 8 } })], { legacy: { tempo: "theirs", bar: "theirs" } }) },
    });
    const merged = mergeDay(undefined, ours, theirs);
    expect(merged.legacy).toEqual({ nutrition: "ours", a: 1, b: 2 });
    expect(merged.workout.legacy).toEqual({ pace: "ours", gear: "theirs" });
    expect(merged.workout.exercises.squat?.legacy).toEqual({ tempo: "ours", bar: "theirs" });
    // The set was won by theirs (newer), so theirs' legacy keys sit on top.
    expect(merged.workout.exercises.squat?.sets[0]?.legacy).toEqual({ rir: 1, rpe: 8 });
    expect("legacy" in mergeDay(undefined, day(), day())).toBe(false);
  });

  it("takes the earliest start, the latest completion and the changed notes for the workout", () => {
    const base = day({ workout: { notes: "plan" } });
    const ours = day({ workout: { startedAt: T1, completedAt: T1, notes: "plan" } });
    const theirs = day({ workout: { startedAt: T0, completedAt: T2, notes: "went well" } });
    expect(mergeDay(base, ours, theirs).workout).toMatchObject({ startedAt: T0, completedAt: T2, notes: "went well" });
  });

  it("is a union with ours winning conflicts when there is no base", () => {
    const ours = day({ checkin: { energy: 6 }, exercises: { squat: exercise("Squat", [set("s1", { reps: 5 })], { skipped: "time" }) } });
    const theirs = day({ checkin: { energy: 9, stress: 2 }, exercises: { squat: exercise("Squat", [set("s1", { reps: 8 })], { skipped: "pain" }) } });
    const merged = mergeDay(undefined, ours, theirs);
    expect(merged.checkin).toEqual({ energy: 6, stress: 2 });
    expect(merged.workout.exercises.squat).toMatchObject({ skipped: "time" });
    expect(merged.workout.exercises.squat?.sets[0]?.reps).toBe(5);
  });

  it("returns a v2 day and does not change its inputs", () => {
    const base = day({ exercises: { squat: exercise("Squat", [set("s1")]) }, legacy: { a: 1 } });
    const ours = day({ checkin: { energy: 7 }, exercises: { squat: exercise("Squat", [set("s1", { completedAt: T1 })]) }, quest: quest() });
    const theirs = day({ exercises: { squat: exercise("Squat", [set("s1"), set("s2")]) }, legacy: { b: 2 } });
    const snapshots = [freeze(base), freeze(ours), freeze(theirs)];
    const merged = mergeDay(base, ours, theirs);
    expect(merged.v).toBe(2);
    expect(merged).not.toBe(ours);
    expect([freeze(base), freeze(ours), freeze(theirs)]).toEqual(snapshots);
  });
});
