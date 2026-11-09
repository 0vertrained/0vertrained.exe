// src/__tests__/bodyweightSupportV19_5.test.js
// What the app does with bodyweight work once a plan is built on it.
//   · Progression: a bodyweight movement steps back to bodyweight, never below
//     it. With nothing added, the old loaded floor prescribed "+5 lb" after a
//     pain flag or a stall; now it says to use an easier variation.
//   · Coach evidence passes the program's own exercise (and its tracking mode)
//     when reading history, so a bodyweight set logged without a weight isn't
//     dropped as a loaded set missing its weight.
//   · The volume audit places the lineup's exercises on the right muscle:
//     Reverse Pec Deck and Incline DB Curl were counted as chest.
import { describe, expect, it } from "vitest";
import { buildExercisePrescription, formatPrescription } from "../progressionEngine";
import { buildCoachEvidencePacket } from "../coachEvidence";
import { mapExerciseToMuscles } from "../muscleVolume";

const TODAY = "2026-07-20";
const pullUp = { name: "Pull-Up", sets: 3, reps: 6 };
const invertedRow = { name: "Inverted Row", sets: 3, reps: 10, trackingMode: "bodyweight_reps" };

function entry(name, sets) {
  return { workout: { exercises: { [name]: { sets: sets.map((set) => ({ done: true, quality: "clean", rir: "2", weight: "", ...set })) } } } };
}
const reps = (...values) => values.map((value) => ({ reps: String(value) }));
const prescribe = (exercise, data) => buildExercisePrescription({ data, exercise, todayKey: TODAY });

describe("bodyweight progression", () => {
  it("a pain flag at bodyweight asks for an easier variation, not +5 lb", () => {
    const out = prescribe(pullUp, { "2026-07-13": entry("Pull-Up", [{ reps: "6", pain: true }, ...reps(6, 6)]) });
    expect(out.kind).toBe("reduce_load");
    expect(out.targetWeight).toBe(0);
    expect(out.rationale).toMatch(/easier variation/);
    expect(out.caution).toMatch(/Stop the movement/);
    expect(formatPrescription(out)).toBe("Bodyweight · 6 / 6 / 6");
  });

  it("a stall at bodyweight steps back to an easier variation", () => {
    const data = {
      "2026-07-08": entry("Pull-Up", reps(5, 5, 5)),
      "2026-07-10": entry("Pull-Up", reps(5, 5, 5)),
      "2026-07-13": entry("Pull-Up", reps(5, 5, 5)),
    };
    const out = prescribe(pullUp, data);
    expect(out.kind).toBe("reset");
    expect(out.targetWeight).toBe(0);
    expect(out.rationale).toMatch(/at bodyweight.*easier variation/);
  });

  it("moving up a ladder step (fewer reps at the same bodyweight) isn't read as a stall", () => {
    const data = {
      "2026-07-08": entry("Pull-Up", reps(6, 6, 6)), // full pull-ups, target hit
      "2026-07-10": entry("Pull-Up", reps(3, 3, 3)), // next step up
      "2026-07-13": entry("Pull-Up", reps(4, 3, 3)), // already improving on it
    };
    const out = prescribe(pullUp, data);
    expect(out.kind).toBe("repeat_floor");
    expect(out.targetWeight).toBe(0);
  });

  it("hitting the target at bodyweight offers load or a harder variation", () => {
    const out = prescribe(pullUp, { "2026-07-13": entry("Pull-Up", reps(6, 6, 6)) });
    expect(out.kind).toBe("add_load");
    expect(out.targetWeight).toBe(5);
    expect(out.rationale).toMatch(/harder variation/);
    expect(formatPrescription(out)).toBe("+5 lb · 6 / 6 / 6");
  });

  it("short of the target at bodyweight repeats at bodyweight", () => {
    const out = prescribe(invertedRow, { "2026-07-13": entry("Inverted Row", reps(9, 8, 8)) });
    expect(out.kind).toBe("repeat_floor");
    expect(out.rationale).toBe("Repeat at bodyweight until every set reaches at least 10 clean reps.");
    expect(formatPrescription(out)).toMatch(/^Bodyweight · /);
  });

  it("with load added, a pain flag steps back to bodyweight rather than holding +5 lb", () => {
    const out = prescribe(pullUp, { "2026-07-13": entry("Pull-Up", [{ reps: "6", weight: "5", pain: true }, { reps: "6", weight: "5" }, { reps: "6", weight: "5" }]) });
    expect(out.kind).toBe("reduce_load");
    expect(out.targetWeight).toBe(0);
    expect(out.rationale).toMatch(/Reduce load/);
  });

  it("loaded lifts keep their floor of one load step", () => {
    const row = { name: "Barbell Row", sets: 3, reps: 8 };
    const sore = prescribe(row, { "2026-07-13": entry("Barbell Row", [{ reps: "8", weight: "100", pain: true }, { reps: "8", weight: "100" }, { reps: "8", weight: "100" }]) });
    expect(sore.targetWeight).toBe(95);
    expect(formatPrescription(sore)).toBe("95 lb · 8 / 8 / 8");
    const raise = { name: "Cable Lateral Raise", sets: 3, reps: 15 };
    const light = prescribe(raise, { "2026-07-13": entry("Cable Lateral Raise", [{ reps: "15", weight: "5", pain: true }, { reps: "15", weight: "5" }, { reps: "15", weight: "5" }]) });
    expect(light.targetWeight).toBe(5);
  });
});

describe("Coach evidence reads bodyweight history through the program", () => {
  const data = { "2026-07-13": entry("Inverted Row", reps(10, 9, 8)) };
  const ask = (program) => buildCoachEvidencePacket({ question: "How is my inverted row progressing?", data, settings: {}, program, todayKey: TODAY, todayName: "Monday" })
    .evidence.find((item) => item.type === "exercise_history");

  it("a set logged without a weight counts when the program says the movement is bodyweight", () => {
    const history = ask({ Monday: { type: "Upper A", lifting: [invertedRow] } });
    expect(history?.data.exerciseName).toBe("Inverted Row");
    expect(history.data.sessions).toHaveLength(1);
    expect(history.data.sessions[0].label).toBe("BW×10/9/8"); // not "0×10/9/8", which reads as a 0-lb load
  });

  it("AM/PM programs are read too", () => {
    const history = ask({ Monday: { type: "AM/PM", lifting: [], sessions: [{ id: "am", label: "AM", lifting: [], cardio: null }, { id: "pm", label: "PM", lifting: [invertedRow], cardio: null }] } });
    expect(history?.data.sessions).toHaveLength(1);
  });

  it("read by name alone (no declared mode), the same sets look like loaded sets missing a weight", () => {
    expect(ask({ Monday: { type: "Upper A", lifting: [{ name: "Inverted Row", sets: 3, reps: 10 }] } })).toBeUndefined();
  });
});

describe("volume audit placement", () => {
  const primary = (name) => mapExerciseToMuscles(name)?.primary;

  it("names with a chest keyword that train something else", () => {
    expect(primary("Reverse Pec Deck")).toEqual(["rear_delt"]);
    expect(primary("Rear Delt Cable Fly")).toEqual(["rear_delt"]);
    expect(primary("Cable Rear Fly")).toEqual(["rear_delt"]);
    expect(primary("Incline DB Curl")).toEqual(["biceps"]);
    expect(primary("Incline Dumbbell Curl")).toEqual(["biceps"]);
    expect(primary("Pike Push-Up")).toEqual(["front_delt"]);
    expect(primary("Wall Handstand Hold")).toEqual(["front_delt"]);
  });

  it("movements the audit couldn't place before", () => {
    expect(primary("Cable Y-Raise")).toEqual(["side_delt"]);
    for (const name of ["Hollow Body Hold", "L-Sit Hold", "Dead Bug"]) expect(primary(name), name).toEqual(["abs"]);
    expect(primary("Wall-Sit")).not.toEqual(["abs"]); // "l-sit" only as its own word
  });

  it("the rules around them are unchanged", () => {
    expect(primary("Incline DB Press")).toEqual(["chest"]);
    expect(primary("Pec Deck")).toEqual(["chest"]);
    expect(primary("Cable Fly")).toEqual(["chest"]);
    expect(primary("Push-Up")).toEqual(["chest"]);
    expect(primary("Lying Leg Curl")).toEqual(["hamstrings"]);
    expect(primary("Hammer Curl")).toEqual(["biceps"]);
    expect(primary("Face Pull")).toEqual(["rear_delt"]);
    expect(primary("Seated DB Shoulder Press")).toEqual(["front_delt"]);
  });
});
