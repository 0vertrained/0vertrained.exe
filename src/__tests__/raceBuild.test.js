import { describe, expect, it } from "vitest";
import { PROGRAM_PRESETS } from "../constants";
import {
  RACE_BUILD_50K,
  applyRaceBuild,
  describeBuildWeek,
  mondayKeyOf,
  resolveBuildWeek,
} from "../raceBuild";

// V19.2 · Resolver correctness around the real 8/28 race calendar.
// Race Friday 2026-08-28 → race week is Mon 2026-08-24 … Sun 2026-08-30.

const program = PROGRAM_PRESETS.raceEdition50k.program;

describe("mondayKeyOf", () => {
  it("anchors any weekday to its Monday", () => {
    expect(mondayKeyOf("2026-07-22")).toBe("2026-07-20"); // Wed → Mon
    expect(mondayKeyOf("2026-07-20")).toBe("2026-07-20"); // Mon → itself
    expect(mondayKeyOf("2026-07-26")).toBe("2026-07-20"); // Sun stays in its week
    expect(mondayKeyOf("2026-08-28")).toBe("2026-08-24"); // race Friday
    expect(mondayKeyOf("not-a-date")).toBeNull();
  });
});

describe("resolveBuildWeek", () => {
  const cases = [
    ["2026-07-22", 0, "build"],   // today: week 1
    ["2026-07-26", 0, "build"],   // Sunday still week 1
    ["2026-07-27", 1, "build"],
    ["2026-08-10", 3, "peak"],    // peak week Monday
    ["2026-08-16", 3, "peak"],    // peak week Sunday
    ["2026-08-17", 4, "taper"],
    ["2026-08-24", 5, "race"],
    ["2026-08-28", 5, "race"],    // race day itself
    ["2026-08-30", 5, "race"],    // Sunday after the race, still race week
  ];
  it.each(cases)("%s → week index %i (%s)", (dateKey, index, phase) => {
    const resolved = resolveBuildWeek(RACE_BUILD_50K, dateKey);
    expect(resolved.index).toBe(index);
    expect(resolved.phase).toBe(phase);
  });

  it("clamps dates before the ladder to week 0", () => {
    expect(resolveBuildWeek(RACE_BUILD_50K, "2026-06-01").index).toBe(0);
  });

  it("resolves to complete after race week ends", () => {
    expect(resolveBuildWeek(RACE_BUILD_50K, "2026-08-31").phase).toBe("complete");
  });
});

describe("applyRaceBuild", () => {
  it("swaps the Saturday prescription by build week", () => {
    expect(applyRaceBuild(program, "2026-07-22").Saturday.cardio.miles).toBe(6.2);
    expect(applyRaceBuild(program, "2026-08-01").Saturday.cardio.miles).toBe(10);
    expect(applyRaceBuild(program, "2026-08-12").Saturday.cardio.miles).toBe(18); // peak
    expect(applyRaceBuild(program, "2026-08-19").Saturday.cardio.type).toMatch(/taper/i);
  });

  it("advances Tuesday and Sunday alongside the long session", () => {
    const w3 = applyRaceBuild(program, "2026-08-05");
    expect(w3.Tuesday.cardio.miles).toBe(5.5);
    expect(w3.Sunday.cardio.miles).toBe(4);
  });

  it("renders race week: Friday becomes RACE DAY, Wednesday and Saturday rest", () => {
    const raceWeek = applyRaceBuild(program, "2026-08-25");
    expect(raceWeek.Friday.code).toBe("RACE");
    expect(raceWeek.Friday.lifting).toEqual([]);
    expect(raceWeek.Friday.cardio.miles).toBeCloseTo(31.1);
    expect(raceWeek.Wednesday.code).toBe("REST");
    expect(raceWeek.Wednesday.lifting).toEqual([]);
    expect(raceWeek.Saturday.code).toBe("REST");
    expect(raceWeek.Saturday.cardio).toBeNull();
  });

  it("leaves untouched days alone", () => {
    const w2 = applyRaceBuild(program, "2026-07-29");
    expect(w2.Monday).toEqual(program.Monday);
    expect(w2.Wednesday).toEqual(program.Wednesday); // Pull day untouched outside race week
    expect(w2.Friday.lifting.length).toBeGreaterThan(0);
  });

  it("is idempotent — resolving twice yields the same prescriptions", () => {
    const once = applyRaceBuild(program, "2026-08-12");
    const twice = applyRaceBuild(once, "2026-08-12");
    expect(twice.Saturday.cardio).toEqual(once.Saturday.cardio);
    expect(twice.Tuesday.cardio).toEqual(once.Tuesday.cardio);
  });

  it("returns the same reference when there is nothing to do", () => {
    const noMarker = { Monday: program.Monday };
    expect(applyRaceBuild(noMarker, "2026-07-22")).toBe(noMarker);
    const unknown = { ...program, __raceBuild: "not-registered" };
    expect(applyRaceBuild(unknown, "2026-07-22")).toBe(unknown);
    expect(applyRaceBuild(program, "2026-09-15")).toBe(program); // race complete
  });

  it("never mutates the source template", () => {
    const before = JSON.stringify(program);
    applyRaceBuild(program, "2026-08-25");
    expect(JSON.stringify(program)).toBe(before);
  });
});

describe("describeBuildWeek", () => {
  it("describes the active week with a race countdown", () => {
    const d = describeBuildWeek(program, "2026-08-12");
    expect(d.label).toMatch(/Peak/);
    expect(d.weekIndex).toBe(3);
    expect(d.totalWeeks).toBe(6);
    expect(d.daysToRace).toBe(16);
  });

  it("returns null without an active build", () => {
    expect(describeBuildWeek({ Monday: program.Monday }, "2026-08-12")).toBeNull();
    expect(describeBuildWeek(program, "2026-09-15")).toBeNull();
  });
});
