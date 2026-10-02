import { describe, expect, it } from "vitest";
import { getPreset } from "./presets";
import { restDay, type PlannedLift, type ProgramWeek } from "./types";
import { validateWeek } from "./validate";

const squat: PlannedLift = { id: "back-squat", name: "Back Squat", libraryId: "back-squat", sets: 3, reps: "5", trackingMode: "loaded_reps" };

function weekWith(monday: unknown): Record<string, unknown> {
  const week: Record<string, unknown> = {};
  for (const d of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) week[d] = restDay();
  week.Monday = monday;
  return week;
}

const training = (lifting: unknown[], extra: Record<string, unknown> = {}) => ({ title: "Lift", rest: false, lifting, cardio: null, ...extra });
const errorsFor = (monday: unknown, options = {}) => validateWeek(weekWith(monday), options).errors;

describe("validateWeek", () => {
  it("accepts a well-formed week", () => {
    expect(validateWeek(weekWith(training([squat])))).toEqual({ valid: true, errors: [] });
    expect(validateWeek(getPreset("beginner")?.week, { requireLibraryIds: true, equipment: "full_gym" }).valid).toBe(true);
  });

  it("rejects missing programs and days (ported)", () => {
    expect(validateWeek(null)).toEqual({ valid: false, errors: ["Program is missing or not an object."] });
    expect(validateWeek([]).valid).toBe(false);
    const result = validateWeek({ Monday: { title: "x", rest: false, lifting: "nope", cardio: null } });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Monday: lifting must be a list.");
    expect(result.errors).toContain("Tuesday: missing day.");
  });

  it("checks titles, the rest flag and cardio", () => {
    expect(errorsFor({ ...training([squat]), title: " " })).toEqual(["Monday: missing title."]);
    expect(errorsFor({ ...training([squat]), rest: "no" })).toEqual(["Monday: rest must be true or false."]);
    expect(errorsFor(training([squat], { cardio: "run" }))).toEqual(["Monday: cardio must be null or an object."]);
    expect(errorsFor(training([], { cardio: { km: 5 } }))).toEqual(["Monday: cardio is missing its kind."]);
  });

  it("keeps rest days free of lifting and training days non-empty", () => {
    expect(errorsFor({ ...restDay(), lifting: [squat] })).toEqual(["Monday: a rest day can't have lifting."]);
    expect(errorsFor(training([]))).toEqual(["Monday: a training day has nothing planned."]);
    expect(errorsFor({ ...restDay(), cardio: { kind: "Easy Walk", km: 2 } })).toEqual([]);
  });

  it("checks every lift", () => {
    expect(errorsFor(training(["squat"]))).toEqual(["Monday: a lift is not an object."]);
    expect(errorsFor(training([{ ...squat, name: "" }]))).toEqual(["Monday: a lift is missing a name."]);
    expect(errorsFor(training([{ ...squat, id: "" }]))).toEqual(["Monday: Back Squat is missing an id."]);
    expect(errorsFor(training([squat, squat]))).toEqual(['Monday: duplicate lift id "back-squat".']);
    expect(errorsFor(training([{ ...squat, sets: 0 }]))).toEqual(["Monday: Back Squat needs a whole number of sets."]);
    expect(errorsFor(training([{ ...squat, sets: 2.5 }]))).toEqual(["Monday: Back Squat needs a whole number of sets."]);
    expect(errorsFor(training([{ ...squat, reps: "" }]))).toEqual(["Monday: Back Squat has no reps target."]);
    expect(errorsFor(training([{ ...squat, trackingMode: "reps" }]))).toEqual(["Monday: Back Squat has no tracking mode."]);
  });

  it("checks library ids and equipment on request", () => {
    const custom = { ...squat, id: "zercher", name: "Zercher Squat", libraryId: undefined };
    expect(errorsFor(training([custom]))).toEqual([]);
    expect(errorsFor(training([custom]), { requireLibraryIds: true })).toEqual(["Monday: Zercher Squat is not a library movement."]);
    expect(errorsFor(training([{ ...squat, libraryId: "nope" }]))).toEqual(["Monday: Back Squat has an unknown library id."]);
    expect(errorsFor(training([{ ...squat, libraryId: 7 }]))).toEqual(["Monday: Back Squat has an unknown library id."]);
    expect(errorsFor(training([squat]), { equipment: "dumbbells" })).toEqual(["Monday: Back Squat needs barbell equipment."]);
    expect(errorsFor(training([squat]), { equipment: "full_gym" })).toEqual([]);
  });

  it("validates a typed week too", () => {
    const week: ProgramWeek = weekWith(training([squat])) as unknown as ProgramWeek;
    expect(validateWeek(week).valid).toBe(true);
  });
});
