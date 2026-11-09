import { describe, expect, it } from "vitest";
import { DEFAULT_PROGRAM, PROGRAM_PRESETS } from "../constants";
import { applyRaceBuild, describeBuildWeek, isRunCardio, resolveRaceBuildConfig, RACE_BUILD_50K } from "../raceBuild";
import { getProgramSessions } from "../programSessions";
import { buildPeriodizationPlan } from "../periodizationPlanner";
import { buildCoachEvidencePacket } from "../coachEvidence";
import { seedSupersetPrefsFromProgram } from "../liftLogPrefs";

// Generated race plans through the existing resolver: the plan spec
// rides in `__raceBuild` as an object; the 50K registry string is untouched
// (see raceBuild.test.js).

const SPEC = {
  kind: "runPlan",
  raceName: "10K race",
  distance: "10k",
  raceDate: "2027-01-16",
  startDate: "2026-10-26",
  runsPerWeek: 4,
  longRunDay: "Saturday",
  qualityDay: "Tuesday",
  crossTraining: "vest_walk",
  startLongRunMin: 35,
  benchmark: null,
  benchmarkTest: "2026-11-26",
};

const withPlan = (program) => ({ ...program, __raceBuild: SPEC });
const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === "object" && deepFreeze(v)); return Object.freeze(o); };

describe("resolveRaceBuildConfig", () => {
  it("keeps the registry path and adds generated specs", () => {
    expect(resolveRaceBuildConfig("raceBuild50k")).toBe(RACE_BUILD_50K);
    expect(resolveRaceBuildConfig(SPEC).generated).toBe(true);
    expect(resolveRaceBuildConfig(SPEC)).toBe(resolveRaceBuildConfig({ ...SPEC })); // cached by content
    expect(resolveRaceBuildConfig({ kind: "something-else" })).toBeNull();
    expect(resolveRaceBuildConfig(undefined)).toBeNull();
  });
});

describe("before the plan starts", () => {
  const program = withPlan(DEFAULT_PROGRAM);
  it("leaves the program alone (same reference)", () => {
    expect(applyRaceBuild(program, "2026-10-22")).toBe(program);
  });
  it("describes itself as pending", () => {
    expect(describeBuildWeek(program, "2026-10-22")).toMatchObject({ pending: true, startsOn: "2026-10-26", totalWeeks: 12, daysToRace: 86, raceName: "10K race" });
  });
});

describe("week 1 over the default Upper/Lower program", () => {
  const program = deepFreeze(withPlan(JSON.parse(JSON.stringify(DEFAULT_PROGRAM))));
  const live = applyRaceBuild(program, "2026-10-28"); // Wednesday of week 1

  it("adds runs beside lifting without touching the lifts", () => {
    expect(live.Monday.lifting).toBe(program.Monday.lifting);
    expect(live.Monday.type).toBe(program.Monday.type);
    expect(live.Monday.cardio).toMatchObject({ type: "Easy Run", minutes: 25, planRole: "easy" });
    expect(live.Tuesday.cardio.type).toBe("Easy Run + Strides");
  });

  it("replaces the program's own runs and owns running all week", () => {
    // Thursday's 5-mile intervals become the plan's 25-min easy run.
    expect(live.Thursday.cardio).toMatchObject({ type: "Easy Run", minutes: 25 });
    expect(live.Thursday.lifting).toBe(program.Thursday.lifting); // core stays
    // Sunday's long run is gone; with nothing left the day reads as Rest.
    expect(live.Sunday).toMatchObject({ type: "Rest", code: "REST", cardio: null });
  });

  it("names a training-free day after its session", () => {
    expect(live.Wednesday).toMatchObject({ type: "Vest Walk", code: "WALK" });
    expect(live.Wednesday.cardio.minutes).toBe(30);
  });

  it("puts the long run on Saturday next to Lower B (lifting untouched)", () => {
    expect(live.Saturday.cardio).toMatchObject({ type: "Long Run", minutes: 35 });
    expect(live.Saturday.lifting.length).toBe(program.Saturday.lifting.length);
  });

  it("describes the week", () => {
    expect(describeBuildWeek(program, "2026-10-28")).toMatchObject({ label: "Week 1 — Base", weekIndex: 0, totalWeeks: 12, phase: "base", daysToRace: 80, totalRunMinutes: 110, generated: true });
  });

  it("is idempotent and keeps the marker", () => {
    expect(live.__raceBuild).toBe(SPEC);
    expect(applyRaceBuild(live, "2026-10-28")).toEqual(live);
  });
});

describe("single-session days keep one cardio slot", () => {
  // The 50K preset: Sunday is a B2B walk, Wednesday is Pull with no cardio.
  const program = { ...PROGRAM_PRESETS.raceEdition50k.program, __raceBuild: { ...SPEC, longRunDay: "Sunday", qualityDay: "Wednesday", crossTraining: "none" } };
  const live = applyRaceBuild(program, "2026-10-28");

  it("lets the plan's run take the slot without splitting the day", () => {
    expect(live.Sunday.sessions).toBeUndefined();
    expect(live.Sunday.cardio).toMatchObject({ type: "Long Run", planRole: "long" });
  });

  it("keeps walks on days the plan doesn't run", () => {
    const off = applyRaceBuild({ ...PROGRAM_PRESETS.raceEdition50k.program, __raceBuild: SPEC }, "2026-10-28");
    expect(off.Sunday.cardio.type).toBe("B2B Walk");
  });

  it("replaces the 50K marker's own ladder entirely", () => {
    expect(live.Tuesday.cardio.planRole).toBeDefined(); // generated, not the 50K's Tuesday
  });
});

describe("AM/PM days (The Double Edition)", () => {
  const program = withPlan(PROGRAM_PRESETS.doubleEdition.program);
  const live = applyRaceBuild(program, "2026-10-26");

  it("swaps a session's own run for the plan's, keeping its lifting and slot", () => {
    const pm = getProgramSessions(live.Monday).find((s) => s.id === "pm");
    expect(pm.lifting.length).toBeGreaterThan(0);
    expect(pm.cardio).toMatchObject({ type: "Easy Run", planRole: "easy" });
    const am = getProgramSessions(live.Monday).find((s) => s.id === "am");
    expect(am.cardio.type).toBe("Incline Walk"); // walks are not the plan's business
  });

  it("adds a RUN session first when no session ran", () => {
    const sat = getProgramSessions(live.Saturday);
    expect(sat[0]).toMatchObject({ id: "run", label: "RUN", timeOfDay: "morning" });
    expect(sat[0].cardio.planRole).toBe("long");
    expect(sat).toHaveLength(3);
  });

  it("drops run-only sessions on non-plan days", () => {
    const sun = getProgramSessions(live.Sunday);
    expect(sun.some((s) => isRunCardio(s.cardio))).toBe(false);
    expect(sun.map((s) => s.cardio?.type)).toEqual(["Long Walk"]);
  });

  it("is idempotent on session days too", () => {
    expect(applyRaceBuild(live, "2026-10-26")).toEqual(live);
  });
});

describe("benchmark and race weeks", () => {
  const program = withPlan(DEFAULT_PROGRAM);

  it("back-logs Thanksgiving as the 5K test", () => {
    const live = applyRaceBuild(program, "2026-11-26");
    expect(live.Thursday.cardio.type).toBe("5K Benchmark");
    expect(describeBuildWeek(program, "2026-11-26")).toMatchObject({ benchmark: true, label: "Week 5 — Build · 5K test" });
  });

  it("renders race week: rest Friday, race Saturday", () => {
    const live = applyRaceBuild(program, "2027-01-14");
    expect(live.Friday).toMatchObject({ code: "REST", lifting: [], cardio: null });
    expect(live.Saturday).toMatchObject({ type: "RACE DAY — 10K", code: "RACE", lifting: [] });
    expect(live.Saturday.cardio.planRole).toBe("race");
  });

  it("goes quiet after race week", () => {
    expect(applyRaceBuild(program, "2027-01-18")).toBe(program);
    expect(describeBuildWeek(program, "2027-01-18")).toBeNull();
  });

  it("survives a JSON round trip of the saved program", () => {
    const saved = JSON.parse(JSON.stringify(program));
    expect(applyRaceBuild(saved, "2026-12-08")).toEqual(applyRaceBuild(program, "2026-12-08"));
  });
});

describe("isRunCardio", () => {
  it.each([
    ["Easy Run", true], ["Long Run/Walk", true], ["Intervals", true], ["Tempo Intervals", true],
    ["Zone 2 Bike/Run", true], ["Long Zone 2", true], ["Shakeout", true], ["5K Benchmark", true],
    ["Incline Walk", false], ["B2B Walk", false], ["Bike / Elliptical", false], ["Vest Walk", false], ["Recovery Walk", false],
  ])("%s → %s", (type, expected) => {
    expect(isRunCardio({ type })).toBe(expected);
  });
  it("is false for nothing", () => {
    expect(isRunCardio(null)).toBe(false);
  });
});

describe("whole-program iteration sites tolerate the object marker", () => {
  const program = withPlan(DEFAULT_PROGRAM);
  it("periodization planner", () => {
    const plan = buildPeriodizationPlan({ program, todayKey: "2026-10-28", entries: {} });
    expect(plan.programAnalysis.liftingDays).toBe(5);
  });
  it("coach evidence packet", () => {
    expect(() => buildCoachEvidencePacket({ question: "how is my bench?", data: {}, settings: {}, program, todayKey: "2026-10-28", todayName: "Wednesday" })).not.toThrow();
  });
  it("superset seeding", () => {
    expect(() => seedSupersetPrefsFromProgram(program)).not.toThrow();
  });
});
