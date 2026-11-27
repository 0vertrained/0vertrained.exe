import { describe, expect, it } from "vitest";
import { DEFAULT_PROGRAM, PROGRAM_PRESETS } from "../constants";
import { applyRaceBuild, describeBuildWeek, isRunCardio, resolveBuildWeek, resolveRaceBuildConfig, RACE_BUILD_50K } from "../raceBuild";
import { getProgramSessions } from "../programSessions";
import { startRoadTrailHybrid } from "../plans/roadTrailHybrid";
import { swapDays, WEEK_DAYS } from "../weekMoves";
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

describe("a midweek generated race-plan start", () => {
  const program = { ...DEFAULT_PROGRAM, __raceBuild: { ...SPEC, startDate: "2026-10-30" } };

  it("shows the exact pending start while resolving the whole calendar week", () => {
    const dates = ["2026-10-26", "2026-10-29"];
    for (const dateKey of dates) {
      expect(describeBuildWeek(program, dateKey)).toMatchObject({ pending: true, startsOn: "2026-10-30" });
      const week = applyRaceBuild(program, dateKey);
      for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday"]) expect(week[day]).toBe(program[day]);
      expect(week.Saturday.cardio).toMatchObject({ planRole: "long", minutes: 35 });
    }
    expect(applyRaceBuild(program, "2026-10-25")).toBe(program);
    expect(describeBuildWeek(program, "2026-10-30")).toMatchObject({ weekIndex: 0, totalRunMinutes: 35 });
    expect(describeBuildWeek(program, "2026-11-02").weekIndex).toBe(1);
  });

  it("preserves a hybrid workout before the independent race-plan start", () => {
    const hybrid = startRoadTrailHybrid(PROGRAM_PRESETS.roadTrailHybrid.program, "2026-10-28");
    const both = { ...hybrid, __raceBuild: program.__raceBuild };
    const live = applyRaceBuild(both, "2026-10-29");
    const base = applyRaceBuild(hybrid, "2026-10-29");
    expect(live.Wednesday).toEqual(base.Wednesday);
    expect(live.Thursday).toEqual(base.Thursday);
    expect(getProgramSessions(live.Friday).flatMap(s => s.lifting)).toEqual(getProgramSessions(base.Friday).flatMap(s => s.lifting));
    expect(live.Saturday.cardio.planRole).toBe("long");
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

describe("generated race calendar beside Road & Trail Hybrid", () => {
  const base = startRoadTrailHybrid(PROGRAM_PRESETS.roadTrailHybrid.program, "2026-11-23");
  const withRace = (raceDate, runsPerWeek = 4) => ({ ...base, __raceBuild: { ...SPEC, startDate: "2026-10-19", raceDate, runsPerWeek } });
  const lifts = (day) => getProgramSessions(day).filter(s => s.lifting.length)
    .map(({ id, timeOfDay, lifting }) => ({ id, timeOfDay, lifting }));
  const runs = (day) => getProgramSessions(day).map(s => s.cardio).filter(isRunCardio);

  it("retains Friday’s upper-body session when the running calendar rests before Saturday’s race", () => {
    const date = "2026-11-27";
    const program = withRace("2026-11-28");
    const friday = applyRaceBuild(program, date).Friday;
    const [upper] = lifts(friday);
    expect(upper).toMatchObject({ id: "am", timeOfDay: "morning" });
    expect(lifts(friday)).toEqual(lifts(applyRaceBuild(base, date).Friday));
    expect(runs(friday)).toHaveLength(0);
    expect(applyRaceBuild(swapDays(program, date, "Monday", "Friday"), date).Monday).toEqual(friday);
  });

  it("adds a Friday race to the PM slot alongside the scheduled AM lifting", () => {
    const friday = applyRaceBuild(withRace("2026-11-27"), "2026-11-27").Friday;
    expect(getProgramSessions(friday).map(s => [s.id, s.lifting.length > 0, s.cardio?.planRole]))
      .toEqual([["am", true, undefined], ["pm", false, "race"]]);
  });

  it("permits race-only training before the hybrid starts and resumes its own workouts after the race", () => {
    const program = startRoadTrailHybrid(withRace("2026-11-27"), "2026-11-30");
    const friday = applyRaceBuild(program, "2026-11-27").Friday;
    expect(lifts(friday)).toHaveLength(0);
    expect(runs(friday)).toMatchObject([{ planRole: "race" }]);
    const following = applyRaceBuild(program, "2026-11-30").Monday;
    expect(lifts(following)).toHaveLength(1);
    expect(runs(following)).toMatchObject([{ type: "Easy road run" }]);
  });

  it("keeps both hybrid Friday sessions while the separate race plan is upcoming", () => {
    const program = { ...base, __raceBuild: { ...SPEC, startDate: "2026-11-30" } };
    const date = "2026-11-27";
    expect(applyRaceBuild(program, date).Friday).toEqual(applyRaceBuild(base, date).Friday);
  });

  it.each([[3, "2027-01-14"], [4, "2027-01-16"], [5, "2027-01-17"]])(
    "keeps the hybrid lifting and follows the %i-run calendar through all eight weeks",
    (runsPerWeek, raceDate) => {
      const program = withRace(raceDate, runsPerWeek);
      const config = resolveRaceBuildConfig(program.__raceBuild);
      for (const monday of ["2026-11-23", "2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28", "2027-01-04", "2027-01-11"]) {
        const live = applyRaceBuild(program, monday);
        const expectedBase = applyRaceBuild(base, monday);
        const { days } = resolveBuildWeek(config, monday).week;
        for (const day of WEEK_DAYS) {
          const patch = days[day];
          const run = patch.run || patch.day?.cardio;
          expect(lifts(live[day]), monday + " " + day).toEqual(lifts(expectedBase[day]));
          expect(runs(live[day]), monday + " " + day).toEqual(run ? [run] : []);
        }
      }
    },
  );
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
