import { describe, expect, it } from "vitest";
import { DAYS, DEFAULT_PROGRAM } from "../constants";
import {
  assignRunDays,
  COMFORTABLE_WEEKS,
  generateRunPlan,
  normalizeRunPlanSpec,
  planProgramWarnings,
  suggestQualityDay,
  summarizeRunPlan,
  validateRunPlanSpec,
} from "../runPlanGenerator";

// V19.3 · The generator's rules are tuned so the hand-written 12-week 10K
// plan (start Mon 2026-10-26, race Sat 2027-01-16, 5K test on Thanksgiving)
// is reproduced exactly — that plan is the acceptance test. Everything else
// is held to invariants across a grid of inputs.

const RAMI_10K = {
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

const minutesOf = (patch) => patch?.run?.minutes ?? patch?.cross?.minutes ?? patch?.day?.cardio?.minutes ?? null;
const isOff = (patch) => Boolean(patch?.clearRuns) && !patch.run && !patch.cross;

describe("Rami's 12-week 10K plan", () => {
  const plan = generateRunPlan(RAMI_10K);

  it("runs Mon 26 Oct → race week of 11 Jan, 12 weeks", () => {
    expect(plan).not.toBeNull();
    expect(plan.totalWeeks).toBe(12);
    expect(plan.weeks).toHaveLength(12);
    expect(plan.startDate).toBe("2026-10-26");
  });

  it("matches the doc's weekly running minutes", () => {
    expect(plan.weeks.map((w) => w.totalRunMinutes)).toEqual([110, 125, 140, 115, 155, 167, 183, 148, 198, 207, 224, 86]);
  });

  // [Mon, Tue, Wed (vest walk), Thu, Sat] minutes per week, from the doc.
  const DOC = [
    [25, 25, 30, 25, 35],
    [25, 30, 35, 30, 40],
    [30, 30, 40, 35, 45],
    [25, 25, 30, 25, 40],
    [30, 25, null, 50, 50],
    [35, 42, 40, 35, 55],
    [35, 48, 45, 40, 60],
    [30, 38, 30, 30, 50],
    [40, 53, 45, 40, 65],
    [45, 47, 45, 45, 70],
    [45, 54, 45, 45, 80],
  ];
  it.each(DOC.map((row, i) => [i + 1, row]))("week %i matches day by day", (weekNo, row) => {
    const days = plan.weeks[weekNo - 1].days;
    expect([minutesOf(days.Monday), minutesOf(days.Tuesday), minutesOf(days.Wednesday), minutesOf(days.Thursday), minutesOf(days.Saturday)]).toEqual(row);
    expect(isOff(days.Friday)).toBe(true);
    expect(isOff(days.Sunday)).toBe(true);
  });

  it("uses the doc's sessions on the quality day", () => {
    const tue = (w) => plan.weeks[w - 1].days.Tuesday.run;
    expect(tue(1).type).toBe("Easy Run + Strides");
    expect(tue(1).notes).toMatch(/^25 min easy \+ 4 strides/);
    expect(tue(2).notes).toMatch(/^30 min easy \+ 6 strides/);
    expect(tue(6).notes).toMatch(/3 × 6 min comfortably hard \(2 min easy jog between\)/);
    expect(tue(7).notes).toMatch(/3 × 8 min comfortably hard/);
    expect(tue(8).notes).toMatch(/2 × 8 min comfortably hard/);
    expect(tue(9).notes).toMatch(/5 × 5 min at 10K pace/);
    expect(tue(10).notes).toMatch(/2 × 12 min comfortably hard \(3 min easy jog between\)/);
    expect(tue(11).notes).toMatch(/3 × 10 min at 10K pace/);
    expect(tue(12).type).toBe("Sharpener Run");
    expect(tue(12).notes).toMatch(/3 × 4 min at 10K pace.*Light legs or none/);
  });

  it("puts the 5K test on Thanksgiving with a rest day before it", () => {
    const w5 = plan.weeks[4];
    expect(plan.benchmarkDate).toBe("2026-11-26");
    expect(w5.label).toBe("Week 5 — Build · 5K test");
    expect(w5.days.Thursday.run.type).toBe("5K Benchmark");
    expect(w5.days.Wednesday).toMatchObject({ clearRuns: true, rest: true });
    expect(w5.days.Tuesday.run.notes).toMatch(/^25 min easy \+ 4 strides/);
  });

  it("labels lighter weeks and the long-run details", () => {
    expect(plan.weeks[3].label).toBe("Week 4 — Base (lighter)");
    expect(plan.weeks[7].label).toBe("Week 8 — Build (lighter)");
    expect(plan.weeks[0].days.Saturday.run.notes).toMatch(/run\/walk is fine/);
    expect(plan.weeks[9].days.Saturday.run.notes).toMatch(/no walk breaks/);
    expect(plan.weeks[10].days.Saturday.run.notes).toMatch(/last 10 min at 10K effort/);
  });

  it("ends with race week: rest Friday, race Saturday, nothing Sunday", () => {
    const race = plan.weeks[11];
    expect(race.phase).toBe("race");
    expect(race.days.Monday.run.minutes).toBe(30);
    expect(race.days.Wednesday.clearRuns).toBe(true);
    expect(race.days.Thursday.run.notes).toMatch(/^20 min easy \+ 4 strides/);
    expect(race.days.Friday.day).toMatchObject({ code: "REST", lifting: [], cardio: null });
    expect(race.days.Saturday.day.code).toBe("RACE");
    expect(race.days.Saturday.day.type).toBe("RACE DAY — 10K");
    expect(race.days.Sunday.clearRuns).toBe(true);
  });

  it("prescribes by effort until there's a benchmark", () => {
    expect(plan.zones).toBeNull();
    expect(plan.weeks[5].days.Tuesday.run.targetPace).toBeNull();
    expect(plan.weeks[5].days.Tuesday.run.notes).toMatch(/a few words at a time/);
  });

  it("switches to pace targets once the 5K time is in", () => {
    const withPaces = generateRunPlan({ ...RAMI_10K, benchmark: { distance: "5k", seconds: 27 * 60, date: "2026-11-26" } });
    const tue = withPaces.weeks[5].days.Tuesday.run;
    expect(tue.targetPace).toMatch(/^\d{1,2}:\d{2}\/mi$/);
    expect(tue.notes).toMatch(/Threshold ≈ \d{1,2}:\d{2}\/mi/);
    expect(withPaces.weeks[0].days.Monday.run.targetPace).toMatch(/^\d{1,2}:\d{2}–\d{1,2}:\d{2}\/mi$/);
    // Same structure and minutes either way.
    expect(withPaces.weeks.map((w) => w.totalRunMinutes).slice(0, 4)).toEqual([110, 125, 140, 115]);
  });

  it("carries steps the session runner can play", () => {
    const steps = plan.weeks[5].days.Tuesday.run.steps;
    expect(steps[0]).toEqual({ kind: "warmup", minutes: 10, intensity: "easy" });
    expect(steps[1]).toEqual({ kind: "repeat", reps: 3, work: { minutes: 6, intensity: "threshold" }, recovery: { minutes: 2, intensity: "jog" } });
    expect(steps[2]).toEqual({ kind: "cooldown", minutes: 10, intensity: "easy" });
  });

  it("estimates miles on every run so existing surfaces keep working", () => {
    for (const week of plan.weeks) {
      for (const patch of Object.values(week.days)) {
        const run = patch.run || patch.cross || patch.day?.cardio;
        if (run) expect(run.miles).toBeGreaterThan(0);
      }
    }
  });

  it("summarizes for previews", () => {
    const rows = summarizeRunPlan(plan);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ n: 1, longMinutes: 35, totalRunMinutes: 110 });
    expect(rows[11].quality).toBe("RACE — 10K");
  });
});

describe("spec normalization + validation", () => {
  it("snaps the start to its Monday and fills defaults", () => {
    const spec = normalizeRunPlanSpec({ raceDate: "2027-01-16", startDate: "2026-10-28" });
    expect(spec.startDate).toBe("2026-10-26");
    expect(spec).toMatchObject({ distance: "10k", runsPerWeek: 4, longRunDay: "Saturday", qualityDay: "Tuesday", crossTraining: "none", benchmarkTest: "auto" });
  });

  it("never lets the quality day equal the long-run day", () => {
    expect(normalizeRunPlanSpec({ longRunDay: "Tuesday", qualityDay: "Tuesday" }).qualityDay).not.toBe("Tuesday");
  });

  it("rejects plans that are too short, too long or backwards", () => {
    expect(validateRunPlanSpec({ startDate: "2026-10-26" }).errors).toContain("Pick a race date.");
    expect(validateRunPlanSpec({ startDate: "2026-10-26", raceDate: "2026-10-01" }).valid).toBe(false);
    expect(validateRunPlanSpec({ startDate: "2026-10-26", raceDate: "2026-11-21" }).errors[0]).toMatch(/only 4 weeks out/);
    expect(validateRunPlanSpec({ startDate: "2026-10-26", raceDate: "2027-06-01" }).errors[0]).toMatch(/within 20 weeks/);
    expect(generateRunPlan({ startDate: "2026-10-26", raceDate: "2026-11-21" })).toBeNull();
  });

  it("warns when the quality day touches the long run", () => {
    const { warnings } = validateRunPlanSpec({ ...RAMI_10K, qualityDay: "Friday" });
    expect(warnings.join(" ")).toMatch(/next to your long run/);
  });
});

describe("assignRunDays", () => {
  it("lays out the doc's week", () => {
    expect(assignRunDays(RAMI_10K)).toEqual({ long: "Saturday", quality: "Tuesday", easyA: "Monday", easyB: "Thursday", easyC: null, cross: "Wednesday" });
  });
  it("keeps the days around a Sunday long run clear", () => {
    const roles = assignRunDays({ longRunDay: "Sunday", qualityDay: "Wednesday", runsPerWeek: 4, crossTraining: "walk" });
    expect(roles).toMatchObject({ long: "Sunday", quality: "Wednesday", easyA: "Tuesday", easyB: "Friday", cross: "Thursday" });
  });
  it("adds a short fifth run the day before the long run", () => {
    expect(assignRunDays({ ...RAMI_10K, runsPerWeek: 5 }).easyC).toBe("Friday");
  });
  it("drops the Monday run at 3 per week", () => {
    expect(assignRunDays({ ...RAMI_10K, runsPerWeek: 3 })).toMatchObject({ easyA: null, quality: "Tuesday", easyB: "Thursday", long: "Saturday" });
  });
});

describe("leg-day awareness", () => {
  const legsOn = (day) => {
    const program = Object.fromEntries(DAYS.map((d) => [d, { type: "Rest", code: "REST", lifting: [], cardio: null }]));
    program[day] = { type: "Legs", code: "LEGS", lifting: [{ name: "Back Squat", sets: 4, reps: 6 }, { name: "Romanian Deadlift", sets: 3, reps: 8 }], cardio: null };
    return program;
  };

  it("suggests the heaviest leg day for the quality run", () => {
    expect(suggestQualityDay(legsOn("Wednesday"), "Saturday")).toBe("Wednesday");
  });
  it("never suggests a day touching the long run", () => {
    expect(suggestQualityDay(legsOn("Friday"), "Saturday")).toBe("Tuesday");
  });
  it("flags leg work next to the long run, never edits it", () => {
    const warnings = planProgramWarnings(DEFAULT_PROGRAM, { ...RAMI_10K });
    expect(warnings.join(" ")).toMatch(/Saturday has heavy leg work on your long-run day/);
    expect(DEFAULT_PROGRAM.Saturday.lifting.length).toBeGreaterThan(0);
  });
});

describe("invariants across plans", () => {
  const grid = [];
  for (const distance of ["5k", "10k", "half"]) {
    for (const raceDate of ["2026-12-05", "2027-01-16", "2027-03-06"]) {       // 6, 12 and 19 weeks out
      for (const runsPerWeek of [3, 4, 5]) {
        for (const longRunDay of ["Saturday", "Sunday"]) {
          grid.push({ distance, raceDate, runsPerWeek, longRunDay, startDate: "2026-10-26", crossTraining: runsPerWeek === 4 ? "vest_walk" : "none", benchmark: distance === "half" ? { distance: "5k", seconds: 1620 } : null });
        }
      }
    }
  }

  it.each(grid.map((s) => [`${s.distance} · ${s.raceDate} · ${s.runsPerWeek}/wk · ${s.longRunDay}`, s]))("%s", (_name, spec) => {
    const plan = generateRunPlan(spec);
    expect(plan).not.toBeNull();
    const caps = { "5k": 70, "10k": 90, "half": 120 };
    const raceDay = DAYS[(new Date(`${spec.raceDate}T12:00:00`).getDay() + 6) % 7];
    const roles = assignRunDays(spec);
    const dayBeforeLong = DAYS[(DAYS.indexOf(spec.longRunDay) + 6) % 7];

    // Shape: every week patches all seven days; the last week races.
    for (const week of plan.weeks) expect(Object.keys(week.days).sort()).toEqual([...DAYS].sort());
    expect(plan.weeks.at(-1).phase).toBe("race");
    expect(plan.weeks.at(-1).days[raceDay].day.code).toBe("RACE");

    // Growth is checked against the last full week AND the last full non-test
    // week (a test week's total can be skewed either way by the test and the
    // rest day before it); a week passes if it's within either allowance.
    // Compressed plans (shorter than COMFORTABLE_WEEKS, which the app warns
    // about) may step up to 35% a week.
    const compressed = plan.totalWeeks < COMFORTABLE_WEEKS[spec.distance];
    expect(plan.warnings.some((w) => /compressed/.test(w))).toBe(compressed);
    let lastFull = null;
    let lastFullNonTest = null;
    plan.weeks.slice(0, -1).forEach((week, w) => {
      const refs = [lastFull, lastFullNonTest].filter(Boolean);
      const baseline = refs.length ? Math.max(...refs.map((r) => r.total)) : null;
      const runs = Object.values(week.days).map((p) => p.run).filter(Boolean);
      // Caps.
      const long = runs.find((r) => r.planRole === "long");
      if (long) expect(long.minutes).toBeLessThanOrEqual(caps[spec.distance]);
      for (const r of runs.filter((x) => x.planRole === "easy")) expect(r.minutes).toBeLessThanOrEqual(60);
      // Nothing hard the day before the long run.
      expect(["quality", "benchmark"]).not.toContain(week.days[dayBeforeLong].run?.planRole);
      if (week.cutback) {
        // Lighter weeks really are lighter.
        expect(week.totalRunMinutes).toBeLessThan(baseline);
        return;
      }
      // Safe growth vs that baseline: ≤ 25% for the next week, ≤ 12% a week
      // compounded across longer gaps; a test week may run up to 50% (one
      // effort, not a volume jump).
      if (refs.length) {
        const step = compressed ? 1.35 : 1.25;
        const ceiling = Math.max(...refs.map((r) => r.total * (week.benchmark ? 1.5 : Math.max(step, 1.12 ** (w - r.index)))));
        expect(week.totalRunMinutes).toBeLessThanOrEqual(Math.ceil(ceiling));
      }
      lastFull = { total: week.totalRunMinutes, index: w };
      if (!week.benchmark) lastFullNonTest = lastFull;
    });
    // The quality role lands on the quality day in a normal week.
    const normal = plan.weeks.find((w) => !w.cutback && !w.benchmark && w.phase === "build");
    if (normal) expect(normal.days[roles.quality].run.planRole).toBe("quality");
  });

  it("is deterministic and survives a JSON round trip", () => {
    const a = generateRunPlan(RAMI_10K);
    const b = generateRunPlan(JSON.parse(JSON.stringify(RAMI_10K)));
    expect(b).toEqual(a);
  });

  it("schedules exactly one 5K test by default and none when switched off", () => {
    const count = (plan) => plan.weeks.flatMap((w) => Object.values(w.days)).filter((p) => p.run?.planRole === "benchmark").length;
    expect(count(generateRunPlan({ ...RAMI_10K, benchmarkTest: "auto" }))).toBe(1);
    expect(count(generateRunPlan({ ...RAMI_10K, benchmarkTest: "none" }))).toBe(0);
  });
});
