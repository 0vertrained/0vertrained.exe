import { describe, expect, it } from "vitest";
import { miToKm } from "../units";
import { buildProgram } from "./builder";
import { IMPORTED_EFFECTIVE_FROM, normalizeProgramPayload, weekFromV1 } from "./normalize";
import { getPreset } from "./presets";
import type { ProgramPayloadV2, ProgramWeek } from "./types";

/** v19's DEFAULT_PROGRAM shape (abridged lifts, same day structure). */
function v1Default() {
  return {
    Monday: {
      type: "Upper A — Push + Triceps", code: "UPPER A",
      lifting: [
        { name: "Barbell Bench Press", sets: 4, reps: 6, notes: "Anchor compound." },
        { name: "Pec Deck / Cable Fly", sets: 3, reps: 12, notes: "Chest isolation." },
        { name: "Rope Tricep Pushdown", sets: 3, reps: 15, notes: "" },
      ],
      cardio: null,
    },
    Tuesday: { type: "Lower A — Squat Pattern", code: "LOWER A", lifting: [{ name: "Back Squat", sets: 4, reps: 6 }, { name: "Pendulum Squat / V-Squat", sets: 3, reps: 12 }], cardio: null },
    Wednesday: { type: "Full Rest", code: "REST", lifting: [], cardio: null },
    Thursday: {
      type: "Cardio A — Intervals + Core", code: "CARDIO A",
      lifting: [{ name: "Hanging Leg Raises", sets: 3, reps: 12 }, { name: "Plank", sets: 3, reps: 45, notes: "45 seconds." }],
      cardio: { type: "Intervals", miles: 5, effort: "High", notes: "4×4 min." },
    },
    Friday: { type: "Upper B — Pull + Biceps", code: "UPPER B", lifting: [{ name: "Weighted Pull-Ups", sets: 4, reps: 8 }], cardio: null },
    Saturday: { type: "Lower B — Hinge Pattern", code: "LOWER B", lifting: [{ name: "Conventional Deadlift", sets: 4, reps: 5 }], cardio: null },
    Sunday: { type: "Cardio B — Long Zone 2", code: "CARDIO B", lifting: [], cardio: { type: "Long Run", miles: 5.5, effort: "Zone 2", notes: "Conversational." } },
  };
}

function mustWeek(raw: unknown): ProgramWeek {
  const week = weekFromV1(raw);
  if (!week) throw new Error("not a week");
  return week;
}

describe("v1 → v2", () => {
  const payload = normalizeProgramPayload(v1Default()) as ProgramPayloadV2;
  const week = payload.revisions[0]?.week as ProgramWeek;

  it("becomes one imported revision effective from 1970-01-01, with the raw week kept", () => {
    expect(payload.v).toBe(2);
    expect(payload.revisions).toHaveLength(1);
    expect(payload.revisions[0]).toMatchObject({ effectiveFrom: IMPORTED_EFFECTIVE_FROM, source: "imported" });
    expect(payload.revisions[0]?.builderInput).toBeUndefined();
    expect(payload.legacy).toEqual(v1Default());
  });

  it("maps type/code to title/code and flags rest days", () => {
    expect(week.Monday).toMatchObject({ title: "Upper A — Push + Triceps", code: "UPPER A", rest: false, cardio: null });
    expect(week.Wednesday).toEqual({ title: "Full Rest", code: "REST", rest: true, lifting: [], cardio: null });
    expect(week.Sunday.rest).toBe(false);
  });

  it("gives lifts slug ids, library ids, string reps and catalog tracking modes", () => {
    expect(week.Monday.lifting).toEqual([
      { id: "barbell-bench-press", name: "Barbell Bench Press", libraryId: "barbell-bench-press", sets: 4, reps: "6", trackingMode: "loaded_reps", notes: "Anchor compound." },
      { id: "pec-deck-cable-fly", name: "Pec Deck / Cable Fly", libraryId: "pec-deck", sets: 3, reps: "12", trackingMode: "loaded_reps", notes: "Chest isolation." },
      { id: "rope-tricep-pushdown", name: "Rope Tricep Pushdown", libraryId: "triceps-pushdown", sets: 3, reps: "15", trackingMode: "loaded_reps" },
    ]);
    expect(week.Thursday.lifting.map((l) => [l.id, l.trackingMode])).toEqual([["hanging-leg-raises", "bodyweight_reps"], ["plank", "timed_hold"]]);
    expect(week.Friday.lifting[0]).toMatchObject({ libraryId: "weighted-pull-up", trackingMode: "loaded_reps" });
  });

  it("converts miles to km", () => {
    expect(week.Thursday.cardio).toEqual({ kind: "Intervals", km: miToKm(5), effort: "High", notes: "4×4 min." });
    expect(week.Sunday.cardio?.km).toBeCloseTo(8.851, 3);
  });

  it("is stable: normalizing the result again changes nothing", () => {
    expect(normalizeProgramPayload(payload)).toEqual(payload);
  });
});

describe("v1 day details", () => {
  it("flattens AM/PM sessions: lifting in order, first cardio, the day's title", () => {
    const week = mustWeek({
      Monday: {
        type: "Chest Heavy + Arms Pump", code: "AM/PM", lifting: [], cardio: null,
        sessions: [
          { id: "am", label: "AM", title: "Morning — Chest", lifting: [{ name: "Incline DB Press", sets: 4, reps: 8 }], cardio: null },
          { id: "pm", label: "PM", title: "Evening — Arms", lifting: [{ name: "EZ-Bar Curl", sets: 3, reps: 12, pairNext: true }, { name: "Rope Pushdown", sets: 3, reps: 12 }], cardio: { type: "Zone 2 Run", miles: 3.1 } },
          { id: "late", title: "Walk", lifting: [], cardio: { type: "Walk", miles: 1 } },
        ],
      },
      Tuesday: { sessions: [{ title: "Threshold Run", lifting: [], cardio: { type: "Threshold", miles: 4 } }, { type: "Upper", lifting: [{ name: "Pec Deck", sets: 3, reps: 15 }] }, { lifting: [] }, "junk"] },
    });
    expect(week.Monday.title).toBe("Chest Heavy + Arms Pump");
    expect(week.Monday.lifting.map((l) => l.id)).toEqual(["incline-db-press", "ez-bar-curl", "rope-pushdown"]);
    expect(week.Monday.lifting[1]).not.toHaveProperty("pairNext");
    expect(week.Monday.cardio).toEqual({ kind: "Zone 2 Run", km: miToKm(3.1) });
    expect(week.Tuesday.title).toBe("Threshold Run + Upper");
    expect(week.Tuesday.cardio?.kind).toBe("Threshold");
  });

  it("drops the race-build marker", () => {
    const payload = normalizeProgramPayload({ __raceBuild: "raceBuild50k", ...v1Default() });
    expect(Object.keys(payload?.revisions[0]?.week ?? {})).toHaveLength(7);
    expect(payload?.legacy?.__raceBuild).toBe("raceBuild50k");
  });

  it("suffixes duplicate ids within a day", () => {
    const week = mustWeek({ Monday: { type: "Arms", lifting: [{ name: "Cable Curl", sets: 2, reps: 15 }, { name: "Cable Curl", sets: 2, reps: 12 }, { name: "cable curl!", sets: 1, reps: 20 }, { name: "???", sets: 1, reps: 5 }] } });
    expect(week.Monday.lifting.map((l) => l.id)).toEqual(["cable-curl", "cable-curl-2", "cable-curl-3", "lift"]);
  });

  it("reads loose numbers, skips nameless lifts and keeps text reps", () => {
    const week = mustWeek({ Monday: { type: "Mixed", lifting: [{ name: "Squat", sets: "3", reps: "8-10" }, { name: "  ", sets: 3 }, null, { name: "Leg Press", sets: "x", reps: 0 }, { name: "Dips", sets: 2.6, reps: " 12 " }] } });
    expect(week.Monday.lifting.map((l) => [l.name, l.sets, l.reps])).toEqual([["Squat", 3, "8-10"], ["Leg Press", 0, ""], ["Dips", 3, "12"]]);
  });

  it("turns carry targets from yards into metres", () => {
    const week = mustWeek({ Friday: { type: "Power", lifting: [{ name: "Farmer Carry", sets: 2, reps: 40 }, { name: "Yoke Walk", sets: 2, reps: 20 }] } });
    expect(week.Friday.lifting.map((l) => [l.trackingMode, l.reps])).toEqual([["carry", "37"], ["carry", "18"]]);
  });

  it("keeps unknown movements with a guessed tracking mode and no library id", () => {
    const week = mustWeek({ Monday: { type: "Odd", lifting: [{ name: "Box Jump", sets: 3, reps: 5 }] } });
    expect(week.Monday.lifting[0]).toEqual({ id: "box-jump", name: "Box Jump", sets: 3, reps: "5", trackingMode: "bodyweight_reps" });
  });

  it("decides rest from content, or a rest title on a day without lifting", () => {
    const week = mustWeek({
      Monday: { type: "Rest + optional walk", lifting: [], cardio: { type: "Walk", miles: 1 } },
      Tuesday: { type: "Rest-Pause Arms", lifting: [{ name: "Cable Curl", sets: 3, reps: 12 }] },
      Wednesday: { type: "Interest Run", lifting: [], cardio: { type: "Run", miles: 0, effort: " " } },
      Thursday: { lifting: [], cardio: null },
      Friday: { lifting: [{ name: "Plank", sets: 3, reps: 30 }] },
      Saturday: "junk",
    });
    expect(week.Monday).toMatchObject({ rest: true, cardio: { kind: "Walk" } });
    expect(week.Tuesday.rest).toBe(false);
    expect(week.Wednesday).toMatchObject({ rest: false, cardio: { kind: "Run" } });
    expect(week.Wednesday.cardio).not.toHaveProperty("km");
    expect(week.Thursday).toEqual({ title: "Rest", rest: true, lifting: [], cardio: null });
    expect(week.Friday).toMatchObject({ title: "Training", rest: false });
    expect(week.Saturday.rest).toBe(true);
    expect(week.Sunday.rest).toBe(true);
  });

  it("names cardio with no type 'Cardio'", () => {
    expect(mustWeek({ Monday: { lifting: [], cardio: { miles: 2 } } }).Monday.cardio?.kind).toBe("Cardio");
  });
});

describe("v2 coercion", () => {
  const generated = buildProgram({ goal: "hybrid", daysPerWeek: 4, equipment: "full_gym", experience: "intermediate" });
  const preset = getPreset("running")?.week as ProgramWeek;

  it("round-trips what v20 writes", () => {
    const payload: ProgramPayloadV2 = {
      v: 2,
      revisions: [
        { effectiveFrom: "2026-01-05", source: "preset:running", week: preset },
        { effectiveFrom: "2026-03-02", source: "generator", builderInput: { goal: "hybrid", daysPerWeek: 4, equipment: "full_gym", experience: "intermediate", seed: 2 }, week: generated },
      ],
    };
    expect(normalizeProgramPayload(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  });

  it("sorts revisions, lets a later duplicate date win and drops broken ones", () => {
    const payload = normalizeProgramPayload({
      v: 2,
      revisions: [
        { effectiveFrom: "2026-05-01", source: "custom", week: preset },
        { effectiveFrom: "2026-02-01", source: "generator", week: generated },
        { effectiveFrom: "2026-05-01", source: "preset:running", week: preset },
        { effectiveFrom: "2026-06-01", week: "nope" },
        { effectiveFrom: "2026-07-01", week: {} },
        "junk",
      ],
    });
    expect(payload?.revisions.map((r) => [r.effectiveFrom, r.source])).toEqual([["2026-02-01", "generator"], ["2026-05-01", "preset:running"]]);
  });

  it("uses the fallback date for revisions without a valid one", () => {
    const raw = { v: 2, revisions: [{ effectiveFrom: "2026-02-30", week: preset }] };
    expect(normalizeProgramPayload(raw)?.revisions[0]?.effectiveFrom).toBe("1970-01-01");
    expect(normalizeProgramPayload(raw, { fallbackEffectiveFrom: "2026-03-01" })?.revisions[0]).toMatchObject({ effectiveFrom: "2026-03-01", source: "custom" });
    expect(normalizeProgramPayload(raw, { fallbackEffectiveFrom: "soon" })?.revisions[0]?.effectiveFrom).toBe("1970-01-01");
  });

  it("drops an invalid builder input and keeps legacy", () => {
    const payload = normalizeProgramPayload({ v: 2, legacy: { Monday: {} }, revisions: [{ effectiveFrom: "2026-02-02", source: "generator", builderInput: { goal: "fat_loss" }, week: generated }] });
    expect(payload?.revisions[0]?.builderInput).toBeUndefined();
    expect(payload?.legacy).toEqual({ Monday: {} });
  });

  it("repairs days: missing days rest, bad modes re-derived, duplicate ids suffixed, stored rest honoured", () => {
    const payload = normalizeProgramPayload({
      v: 2,
      revisions: [{
        effectiveFrom: "2026-02-02",
        week: {
          Monday: { title: "Lift", rest: false, lifting: [{ id: "a", name: "Plank", sets: 3, reps: "45", trackingMode: "nope" }, { id: "a", name: "Push-Up", sets: 3, reps: 10, trackingMode: "loaded_reps", libraryId: "push-up" }, { name: "Cable Curl", sets: 2, reps: "12" }], cardio: null },
          Tuesday: { title: "Walk day", rest: true, lifting: [], cardio: { kind: "Walk", km: "3", minutes: 30 } },
          Wednesday: { title: "Run", rest: false, lifting: [], cardio: { kind: "Run", km: 5 } },
        },
      }],
    });
    const week = payload?.revisions[0]?.week as ProgramWeek;
    expect(week.Monday.lifting).toEqual([
      { id: "a", name: "Plank", sets: 3, reps: "45", trackingMode: "timed_hold" },
      { id: "a-2", name: "Push-Up", libraryId: "push-up", sets: 3, reps: "10", trackingMode: "loaded_reps" },
      { id: "cable-curl", name: "Cable Curl", sets: 2, reps: "12", trackingMode: "loaded_reps" },
    ]);
    expect(week.Tuesday).toMatchObject({ rest: true, cardio: { kind: "Walk", km: 3, minutes: 30 } });
    expect(week.Wednesday.rest).toBe(false);
    expect(week.Sunday).toEqual({ title: "Rest", rest: true, lifting: [], cardio: null });
  });
});

describe("junk", () => {
  it.each([
    ["null", null],
    ["a string", "hybrid"],
    ["an array", [{ Monday: {} }]],
    ["an empty object", {}],
    ["an object without weekdays", { foo: { lifting: [] } }],
    ["v2 without revisions", { v: 2 }],
    ["v2 with empty revisions", { v: 2, revisions: [] }],
    ["v2 with only broken revisions", { v: 2, revisions: [{ effectiveFrom: "2026-01-01" }] }],
  ])("%s → null", (_, raw) => {
    expect(normalizeProgramPayload(raw)).toBeNull();
  });

  it("weekFromV1 rejects non-weeks", () => {
    expect(weekFromV1(null)).toBeNull();
    expect(weekFromV1({ Monday: "rest" })).toBeNull();
  });
});
