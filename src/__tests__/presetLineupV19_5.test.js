// src/__tests__/presetLineupV19_5.test.js
// The preset lineup. Switch preset lists five plans, one per kind of
// athlete. Each is pinned for what its copy promises and for how the app reads
// it: every set loggable as written, unique exercise names per day (logs are
// keyed by name), rep targets the progression engine reads the way the notes
// do, runs a race plan can take over without leaving a hard-day label behind,
// the cardio timer's pre-fill, recovery spacing around the hard days, and the
// volume the description claims (counted the way the app's own audit counts).
// The Program Builder's bodyweight plans get the same "banks without a weight"
// check, which they failed before.
import { describe, expect, it } from "vitest";
import { DAYS, DEFAULT_PROGRAM, PROGRAM_PRESETS, PRESET_LINEUP, presetProgram } from "../constants";
import { getProgramSessions, flattenProgramLifting } from "../programSessions";
import { TRACKING_MODES, resolveTrackingMode, validateSet } from "../workoutLogging";
import { applyRaceBuild, isRunCardio } from "../raceBuild";
import { suggestPlanFromNotes, suggestPlanFromSteps } from "../cardioSession";
import { resolveOnboardingProgramPreset } from "../onboardingSetup";
import { buildProgramPlan } from "../programBuilder";
import { EXERCISES } from "../programExerciseLibrary";
import { buildNutritionRecommendation } from "../nutritionCoach";
import { suggestWorkoutAdjustments } from "../adaptiveTraining";
import { mapExerciseToMuscles } from "../muscleVolume";

const MODES = new Set(Object.values(TRACKING_MODES));
const REBUILT = ["hybrid", "bodybuilding", "calisthenics", "running"];

const sessionsOf = (program) => DAYS.flatMap((day) => getProgramSessions(program[day] || {}).map((s) => ({ ...s, day })));
const exercisesOf = (program) => sessionsOf(program).flatMap((s) => s.lifting.map((ex) => ({ ...ex, day: s.day })));
const runsOf = (program) => sessionsOf(program).filter((s) => isRunCardio(s.cardio));
const sum = (xs) => xs.reduce((n, x) => n + x, 0);
const weeklySets = (program) => sum(exercisesOf(program).map((ex) => ex.sets));
const weeklyRunMiles = (program) => sum(runsOf(program).map((s) => s.cardio.miles));
const liftDays = (program) => DAYS.filter((day) => flattenProgramLifting(program[day] || {}).length > 0);
const restDays = (program) => DAYS.filter((day) => getProgramSessions(program[day] || {}).length === 0);
const dayBefore = (day) => DAYS[(DAYS.indexOf(day) + 6) % 7];
// A quality run is an interval or tempo session, by its own type.
const isQualityRun = (s) => isRunCardio(s.cardio) && /interval|tempo|threshold/i.test(s.cardio.type);
const isLongRun = (s) => isRunCardio(s.cardio) && /long/i.test(s.cardio.type);
const LOWER_BODY = /squat|deadlift|\brdl\b|lunge|leg press|leg curl|leg extension|hip thrust|split squat|calf|step-up|nordic|box jump|jump squat|pistol/i;
// A set exactly as it's logged with no weight: reps, or seconds for a hold.
const UNWEIGHTED = { reps: "8", duration: "30", done: true };
const banksWithoutWeight = (ex) => validateSet(UNWEIGHTED, ex).valid;
// The two readers that classify a planned day from its text.
const fuelDemand = (day) => buildNutritionRecommendation({ todayProgram: day }).targets.demand.level;
const SWAP_HARD_RUN = "Swap intervals/tempo for Zone 2";
const pullBackChanges = (day) => suggestWorkoutAdjustments({ recommendation: { readiness: "pull_back" }, todayProgram: day }).changes.map((c) => c.label);
// At normal readiness with a high load ratio, a day read as a run day gets "Protect the run load".
const highLoadTitle = (day) => suggestWorkoutAdjustments({ recommendation: { readiness: "normal", reasons: [{ source: "load", value: 1.4 }] }, todayProgram: day }).title;
// What the cardio timer pre-fills (CardioSession.jsx): structured steps first, then the notes.
const timerPlan = (cardio) => suggestPlanFromSteps(cardio?.steps) || suggestPlanFromNotes(cardio?.notes);

const SPEC = {
  kind: "runPlan", raceName: "Chilly Willy 10K", distance: "10k", raceDate: "2027-01-16", startDate: "2026-10-26",
  runsPerWeek: 4, longRunDay: "Saturday", qualityDay: "Tuesday", crossTraining: "vest_walk", startLongRunMin: 35,
  benchmark: null, benchmarkTest: "2026-11-26",
};
// Every race-plan shape the panel offers around a Saturday long run.
const SPECS = [3, 4, 5].flatMap((runsPerWeek) => ["Monday", "Tuesday", "Wednesday", "Thursday"].map((qualityDay) => ({ ...SPEC, runsPerWeek, qualityDay })));
// One date in each of the plan's twelve weeks (its Mondays).
const PLAN_WEEKS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date("2026-10-26T12:00:00");
  d.setDate(d.getDate() + i * 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
});

describe("Switch preset lineup", () => {
  it("lists one plan per kind of athlete, in order", () => {
    expect(PRESET_LINEUP).toEqual(["hybrid", "bodybuilding", "calisthenics", "running", "doubleEdition"]);
    expect(PRESET_LINEUP.map((id) => PROGRAM_PRESETS[id].name)).toEqual(["Hybrid Athlete", "Bodybuilding", "Calisthenics", "Runner", "The Double Edition"]);
  });

  it("every listed preset carries its own program and copy", () => {
    for (const id of PRESET_LINEUP) {
      const p = PROGRAM_PRESETS[id];
      expect(p.id, id).toBe(id);
      expect(p.desc.length, id).toBeGreaterThan(40);
      expect(p.tags.length, id).toBeGreaterThan(1);
      expect(p.program && typeof p.program, id).toBe("object");
      expect(presetProgram(id), id).toBe(p.program);
    }
    expect(presetProgram("hybrid")).not.toBe(DEFAULT_PROGRAM);
    expect(presetProgram("no-such-preset")).toBe(DEFAULT_PROGRAM);
  });

  it("presets left out stay defined for anyone on them and for onboarding's legacy path", () => {
    for (const id of ["highIntensityHybrid", "ramiHybridCut", "raceEdition50k", "powerlifting", "beginner"]) {
      expect(PROGRAM_PRESETS[id], id).toBeTruthy();
      expect(PRESET_LINEUP).not.toContain(id);
    }
    expect(resolveOnboardingProgramPreset("strength")).toBe("powerlifting");
    expect(resolveOnboardingProgramPreset("muscle")).toBe("bodybuilding");
    expect(resolveOnboardingProgramPreset("endurance")).toBe("running");
  });
});

describe.each(PRESET_LINEUP)("%s · loggable as written", (id) => {
  const program = PROGRAM_PRESETS[id].program;

  it("covers all seven days with a type and a code", () => {
    for (const day of DAYS) {
      expect(program[day], day).toBeTruthy();
      expect(typeof program[day].type).toBe("string");
      expect(typeof program[day].code).toBe("string");
    }
  });

  it("every exercise has numeric sets/reps, a known tracking mode, and well-formed supersets", () => {
    for (const s of sessionsOf(program)) {
      s.lifting.forEach((ex, i) => {
        const where = `${s.day} ${ex.name}`;
        expect(ex.name.trim().length, where).toBeGreaterThan(0);
        expect(Number.isInteger(ex.sets) && ex.sets >= 1 && ex.sets <= 6, where).toBe(true);
        expect(typeof ex.reps === "number" && ex.reps > 0, where).toBe(true);
        if ("trackingMode" in ex) expect(MODES.has(ex.trackingMode), where).toBe(true);
        expect(MODES.has(resolveTrackingMode(ex)), where).toBe(true);
        if (ex.pairNext) {
          const partner = s.lifting[i + 1];
          expect(partner, `${where} pairs with nothing`).toBeTruthy();
          expect(partner.pairNext, `${where} chains a superset`).toBeFalsy();
        }
      });
    }
  });

  it("names are unique within a day (a day's logs are keyed by exercise name)", () => {
    for (const day of DAYS) {
      const names = flattenProgramLifting(program[day]).map((ex) => ex.name.toLowerCase());
      expect(new Set(names).size, day).toBe(names.length);
    }
  });

  it("every cardio block has a type, miles and an effort", () => {
    for (const s of sessionsOf(program)) {
      if (!s.cardio) continue;
      expect(s.cardio.type.trim().length, s.day).toBeGreaterThan(0);
      expect(s.cardio.miles, s.day).toBeGreaterThan(0);
      expect(typeof s.cardio.effort, s.day).toBe("string");
    }
  });

  it("a race plan takes over every run", () => {
    for (const week of PLAN_WEEKS) {
      const resolved = applyRaceBuild({ ...program, __raceBuild: SPEC }, week);
      const leftover = runsOf(resolved).filter((s) => !s.cardio.planRole);
      expect(leftover.map((s) => `${week} ${s.day} ${s.cardio.type}`)).toEqual([]);
    }
  });
});

describe.each(REBUILT)("%s · reads the way the app reads it", (id) => {
  const program = PROGRAM_PRESETS[id].program;

  it("every exercise and every cardio block says how to do it", () => {
    for (const ex of exercisesOf(program)) expect(ex.notes?.length, `${ex.day} ${ex.name}`).toBeGreaterThan(15);
    for (const s of sessionsOf(program)) if (s.cardio) expect(s.cardio.notes?.length, s.day).toBeGreaterThan(30);
  });

  it("a swap the notes suggest isn't a movement planned elsewhere in the week", () => {
    // History follows the performed name, so swapping into a movement that has
    // its own slot (pull-ups → lat pulldown with a Lat Pulldown on Friday) would
    // carry one slot's loads into the other's targets.
    const SWAPS = ["lat pulldown", "leg press", "conventional deadlift", "goblet squat", "smith machine squat", "smith squat"];
    const planned = new Set(exercisesOf(program).map((ex) => ex.name.toLowerCase()));
    for (const ex of exercisesOf(program)) {
      for (const swap of SWAPS.filter((name) => ex.notes.toLowerCase().includes(name))) {
        expect(planned.has(swap), `${ex.day} ${ex.name} suggests "${swap}"`).toBe(false);
      }
    }
  });

  it("a rep range in the notes tops out at the planned reps (the engine adds load once every set reaches them)", () => {
    for (const ex of exercisesOf(program)) {
      const range = ex.notes.match(/^(?:Per side, )?(\d+)–(\d+)/);
      if (range) expect(Number(range[2]), `${ex.day} ${ex.name}: "${ex.notes.slice(0, 30)}…"`).toBe(ex.reps);
    }
  });

  it("holds are prescribed in seconds, and everything prescribed in seconds logs as a hold", () => {
    for (const ex of exercisesOf(program)) {
      const timed = resolveTrackingMode(ex) === TRACKING_MODES.TIMED_HOLD;
      expect(/^seconds/i.test(ex.notes), `${ex.day} ${ex.name}`).toBe(timed);
    }
  });

  it("fuel and readiness advice read quality and long runs as hard, everything else as not", () => {
    for (const day of DAYS) {
      const d = program[day];
      const s = sessionsOf({ [day]: d })[0];
      const level = fuelDemand(d);
      if (!s) { expect(level, day).toBe("rest"); continue; }
      const hard = Boolean(s.cardio) && (isQualityRun(s) || isLongRun(s));
      expect(level === "high", `${day} ${d.type}: ${level}`).toBe(hard);
      expect(pullBackChanges(d).includes(SWAP_HARD_RUN), `${day} ${d.type}`).toBe(Boolean(s.cardio) && isQualityRun(s));
    }
  });

  it("lifting days are named for the lifting: no run words for a race plan to leave behind", () => {
    for (const day of DAYS) {
      const d = program[day];
      if (flattenProgramLifting(d).length) expect(`${d.type} ${d.code}`, day).not.toMatch(/interval|tempo|threshold|quality|\bruns?\b|strides/i);
    }
  });

  it("under every race-plan shape, fuel and readiness advice only see the runs the plan placed", () => {
    for (const spec of SPECS) {
      for (const week of PLAN_WEEKS) {
        const resolved = applyRaceBuild({ ...program, __raceBuild: spec }, week);
        for (const day of DAYS) {
          const d = resolved[day];
          const where = `${spec.runsPerWeek} runs, quality ${spec.qualityDay}, ${week} ${day} "${d.type}"`;
          const role = d.cardio?.planRole;
          const hardPlaced = ["quality", "benchmark", "race"].includes(role);
          if (fuelDemand(d) === "high") expect(hardPlaced || role === "long" || (d.cardio?.miles || 0) >= 6, where).toBe(true);
          if (pullBackChanges(d).includes(SWAP_HARD_RUN)) expect(hardPlaced, where).toBe(true);
          // adaptiveTraining reads any cardio as a run day; what must never happen is run advice on a day with none.
          if (highLoadTitle(d) === "Protect the run load") expect(Boolean(d.cardio), where).toBe(true);
        }
      }
    }
  });

  it("the cardio timer pre-fills quality sessions with their real warm-up and main set, and leaves easy runs alone", () => {
    for (const s of sessionsOf(program)) {
      if (!s.cardio) continue;
      const plan = timerPlan(s.cardio);
      if (!isQualityRun(s)) { expect(plan, `${s.day} ${s.cardio.type}`).toBeNull(); continue; }
      const warmup = Number(s.cardio.notes.match(/^Warm up (\d+) min/)[1]) * 60;
      expect(plan, `${s.day} ${s.cardio.type}`).toMatchObject({ warmup });
      const main = s.cardio.notes.match(/(\d+) × (\d+) min hard w\/ (\d+) min/);
      if (main) expect(plan).toMatchObject({ rounds: Number(main[1]), work: Number(main[2]) * 60, rest: Number(main[3]) * 60 });
      else expect(plan).toMatchObject({ rounds: 1, work: Number(s.cardio.notes.match(/then (\d+) min at tempo/)[1]) * 60, rest: 0 });
    }
  });
});

describe("bodyweight movements bank without a weight in every listed plan", () => {
  // Names the logger can't read as bodyweight on their own need a declared mode.
  const BODYWEIGHT_MOVES = /hanging|dead bug|back extension|push-up|pull-up|chin-up|\bdips?\b|inverted row|pistol|nordic|box jump|jump squat|plank|hollow|l-sit|wall sit|dead hang|handstand|glute bridge/i;
  it.each([...PRESET_LINEUP.map((id) => [id, PROGRAM_PRESETS[id].program]), ["DEFAULT_PROGRAM", DEFAULT_PROGRAM]])("%s", (_id, program) => {
    const moves = exercisesOf(program).filter((ex) => BODYWEIGHT_MOVES.test(ex.name));
    expect(moves.length).toBeGreaterThan(0);
    for (const ex of moves) expect(banksWithoutWeight(ex), `${ex.day} ${ex.name}`).toBe(true);
  });
});

describe("Hybrid Athlete", () => {
  const program = PROGRAM_PRESETS.hybrid.program;

  it("is the plan its name describes: four strength days, three runs, one rest day", () => {
    expect(liftDays(program)).toHaveLength(4);
    expect(runsOf(program)).toHaveLength(3);
    expect(restDays(program)).toEqual(["Sunday"]);
    expect(weeklyRunMiles(program)).toBeGreaterThanOrEqual(12);
    expect(weeklyRunMiles(program)).toBeLessThanOrEqual(20);
    // The old copy promised PPL and a Hyrox day the program never had.
    expect(`${PROGRAM_PRESETS.hybrid.name} ${PROGRAM_PRESETS.hybrid.desc}`).not.toMatch(/PPL|Hyrox|Push\/Pull\/Legs/);
  });

  it("one quality run, one long run, the rest easy", () => {
    const runs = runsOf(program);
    expect(runs.filter(isQualityRun)).toHaveLength(1);
    const longest = Math.max(...runs.map((s) => s.cardio.miles));
    expect(runs.find((s) => s.cardio.miles === longest).cardio.type).toMatch(/long/i);
  });

  it("no lower-body lifting the day before the quality run or the long run", () => {
    const keyRuns = runsOf(program).filter((s) => isQualityRun(s) || isLongRun(s));
    expect(keyRuns).toHaveLength(2);
    for (const s of keyRuns) {
      const before = flattenProgramLifting(program[dayBefore(s.day)]);
      expect(before.filter((ex) => LOWER_BODY.test(ex.name)), `${dayBefore(s.day)} before ${s.day}`).toEqual([]);
    }
  });
});

describe("Bodybuilding", () => {
  const program = PROGRAM_PRESETS.bodybuilding.program;
  // Counted the way the app's volume audit counts (muscleVolume.js).
  const primarySets = (muscle) => sum(exercisesOf(program).filter((ex) => mapExerciseToMuscles(ex.name)?.primary.includes(muscle)).map((ex) => ex.sets));
  const daysTrained = (muscle) => new Set(exercisesOf(program).filter((ex) => {
    const m = mapExerciseToMuscles(ex.name);
    return m && (m.primary.includes(muscle) || m.secondary.includes(muscle));
  }).map((ex) => ex.day)).size;

  it("five lifting days, two rest days, no running", () => {
    expect(liftDays(program)).toHaveLength(5);
    expect(restDays(program)).toHaveLength(2);
    expect(runsOf(program)).toHaveLength(0);
  });

  it("the volume audit can place every exercise", () => {
    for (const ex of exercisesOf(program)) expect(mapExerciseToMuscles(ex.name), `${ex.day} ${ex.name}`).toBeTruthy();
  });

  it("every major muscle group trains on two days a week", () => {
    for (const muscle of ["chest", "back", "front_delt", "side_delt", "rear_delt", "biceps", "triceps", "quads", "hamstrings", "glutes", "calves"]) {
      expect(daysTrained(muscle), muscle).toBeGreaterThanOrEqual(2);
    }
  });

  it("chest, back, quads and hamstrings land in the 12–18 weekly sets the copy promises", () => {
    for (const muscle of ["chest", "back", "quads", "hamstrings"]) {
      expect(primarySets(muscle), muscle).toBeGreaterThanOrEqual(12);
      expect(primarySets(muscle), muscle).toBeLessThanOrEqual(18);
    }
    expect(weeklySets(program)).toBeGreaterThanOrEqual(95);
    expect(weeklySets(program)).toBeLessThanOrEqual(125);
    for (const s of sessionsOf(program)) expect(sum(s.lifting.map((ex) => ex.sets)), s.day).toBeLessThanOrEqual(24);
  });
});

describe("Calisthenics", () => {
  const program = PROGRAM_PRESETS.calisthenics.program;
  const exercises = exercisesOf(program);
  const ladderOf = (ex) => ex.notes.match(/Ladder: ([^.]*)/)?.[1] || null;

  it("every set banks without a weight (the old preset demanded one for 8 of 15)", () => {
    for (const ex of exercises) {
      expect(resolveTrackingMode(ex), `${ex.day} ${ex.name}`).not.toBe(TRACKING_MODES.LOADED_REPS);
      expect(banksWithoutWeight(ex), `${ex.day} ${ex.name}`).toBe(true);
    }
  });

  it("added load still logs, as + lb on a bodyweight movement", () => {
    const pistol = exercises.find((ex) => ex.name === "Pistol Squat");
    expect(validateSet({ reps: "5", weight: "20", done: true }, pistol).valid).toBe(true);
  });

  it("needs no gym: a bar, dip bars or chairs, and the floor", () => {
    for (const ex of exercises) {
      expect(ex.name, ex.day).not.toMatch(/barbell|dumbbell|\bDB\b|cable|machine|kettlebell|smith|leg press|trap bar|ez-bar/i);
    }
  });

  it("every exercise carries a ladder, and every step logs the way its slot does", () => {
    for (const ex of exercises) {
      expect(ex.notes, `${ex.day} ${ex.name}`).toMatch(/ladder/i);
      const ladder = ladderOf(ex);
      if (!ladder) continue;
      if (resolveTrackingMode(ex) === TRACKING_MODES.TIMED_HOLD) {
        expect(ladder, `${ex.name}: a rep step in a hold slot`).not.toMatch(/push-up|pull-up|rocks|kick-up|\bwalk\b|\breps?\b/i);
      } else {
        expect(ladder, `${ex.name}: a hold step in a rep slot`).not.toMatch(/\bhold\b|\bhangs?\b/i);
      }
    }
  });

  it("four strength days of moderate length", () => {
    expect(liftDays(program)).toHaveLength(4);
    for (const s of sessionsOf(program)) expect(sum(s.lifting.map((ex) => ex.sets)), s.day).toBeLessThanOrEqual(20);
  });
});

describe("Runner", () => {
  const program = PROGRAM_PRESETS.running.program;

  it("five runs, two strength sessions, two rest days", () => {
    expect(runsOf(program)).toHaveLength(5);
    expect(liftDays(program)).toHaveLength(2);
    expect(restDays(program)).toHaveLength(2);
    expect(weeklyRunMiles(program)).toBeGreaterThanOrEqual(20);
    expect(weeklyRunMiles(program)).toBeLessThanOrEqual(28);
  });

  it("hard days hard, easy days easy: strength only rides on the quality-run days", () => {
    const hardDays = runsOf(program).filter(isQualityRun).map((s) => s.day);
    expect(hardDays).toHaveLength(2);
    expect(liftDays(program)).toEqual(hardDays);
  });

  it("the long run is the longest, with a rest day before it", () => {
    const runs = runsOf(program);
    const long = runs.find(isLongRun);
    expect(long.cardio.miles).toBe(Math.max(...runs.map((s) => s.cardio.miles)));
    expect(restDays(program)).toContain(dayBefore(long.day));
  });

  it("a race plan keeps both strength sessions exactly", () => {
    const resolved = applyRaceBuild({ ...program, __raceBuild: SPEC }, "2026-11-11");
    expect(resolved).not.toBe(program);
    for (const day of liftDays(program)) {
      expect(flattenProgramLifting(resolved[day]), day).toEqual(flattenProgramLifting(program[day]));
    }
  });
});

describe("The Double Edition · the aggressive slot", () => {
  const preset = PROGRAM_PRESETS.doubleEdition;

  it("is two-a-day bodybuilding and real running at once", () => {
    expect(preset.tags).toEqual(expect.arrayContaining(["Advanced", "Running"]));
    expect(weeklySets(preset.program)).toBeGreaterThanOrEqual(150);
    const runs = runsOf(preset.program);
    expect(runs.length).toBeGreaterThanOrEqual(4);
    expect(runs.some((s) => /quality|interval|tempo/i.test(s.cardio.type))).toBe(true);
    expect(Math.max(...runs.map((s) => s.cardio.miles))).toBeGreaterThanOrEqual(8);
    expect(weeklyRunMiles(preset.program)).toBeGreaterThanOrEqual(15);
  });
});

describe("Program Builder · bodyweight plans", () => {
  const LIBRARY = new Map(EXERCISES.map((e) => [e.name, e]));
  const plans = (equipment) => ["basic_fitness", "bodybuilding", "strength", "endurance", "hybrid", "fat_loss"].flatMap((goal) =>
    [3, 5].flatMap((trainingDaysPerWeek) => ["beginner", "advanced"].map((experience) =>
      buildProgramPlan({ goal, trainingDaysPerWeek, equipment, experience }).program)));

  it("every exercise in a bodyweight plan banks without a weight", () => {
    for (const program of plans("bodyweight")) {
      for (const ex of exercisesOf(program)) expect(banksWithoutWeight(ex), `${ex.day} ${ex.name}`).toBe(true);
    }
  });

  it("only the library's bodyweight movements get a declared mode; loaded lifts are untouched", () => {
    for (const program of plans("full_gym")) {
      for (const ex of exercisesOf(program)) {
        if (!("trackingMode" in ex)) continue;
        expect(ex.trackingMode, ex.name).toBe(TRACKING_MODES.BODYWEIGHT_REPS);
        expect(LIBRARY.get(ex.name)?.equipment, ex.name).toBe("bodyweight");
      }
    }
  });

  it("holds keep the library's seconds instead of the goal's rep band", () => {
    let holds = 0;
    for (const program of [...plans("bodyweight"), ...plans("full_gym")]) {
      for (const ex of exercisesOf(program)) {
        if (resolveTrackingMode(ex) !== TRACKING_MODES.TIMED_HOLD) continue;
        holds += 1;
        expect(ex.reps, `${ex.day} ${ex.name}`).toBe(LIBRARY.get(ex.name).defaultReps);
      }
    }
    expect(holds).toBeGreaterThan(0);
  });
});
