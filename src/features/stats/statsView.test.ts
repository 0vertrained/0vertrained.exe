import { describe, expect, it } from "vitest";
import { metaFor } from "../../app/useGame";
import { seed } from "../../data/demo/seed";
import { emptyDay, type DayMap, type DayV2, type ExerciseLog } from "../../domain/day/schema";
import { ACHIEVEMENTS, RANK_ORDER, XP } from "../../domain/game/config";
import { buildProgress } from "../../domain/game/progress";
import type { DayResult, Progress, StatValue, TrialSpec } from "../../domain/game/types";
import type { RecordCandidate } from "../../domain/training/records";
import { attachLine } from "./RankTrialSheet";
import { explainText, recordRows, requirementRows, seriesKeys, shortDate, statDelta, statSeries, titleTiles, trialAttachDay, trialPrescription } from "./statsView";

const TODAY = "2026-10-02";

const demo = seed(TODAY);
const progress = buildProgress({ days: demo.days, program: demo.program, settings: demo.settings, todayKey: TODAY, historyComplete: true, units: "metric", metaFor });

const stat = (over: Partial<StatValue>): StatValue => ({ value: 40, previous: 40, delta: 0, trend: "steady", ...over });

function withRequirements(p: Progress, patch: Partial<Progress["nextRank"]>, met: Partial<Record<string, boolean>>): Progress {
  const requirements = p.nextRank.requirements.map((r) => (met[r.key] === undefined ? r : { ...r, met: met[r.key] as boolean, current: met[r.key] ? r.target + 3 : r.target - 3 }));
  return { ...p, nextRank: { ...p.nextRank, requirements, ...patch } };
}

describe("requirementRows", () => {
  it("words each requirement with the athlete's number, 'met' when reached, and the trial's state", () => {
    const rows = requirementRows(progress);
    expect(rows.map((r) => [r.label, r.state, r.sublabel ?? "", r.locked])).toEqual([
      ["Level 12 (you: 15, met)", "done", "", false],
      ["4 qualifying weeks (10, met)", "done", "", false],
      ["STR or END 25 (42, met)", "done", "", false],
      ["Rank Trial", "not-started", "available", false],
    ]);
  });

  it("shows unmet rows as not started and locks the trial until the rest is met", () => {
    const rows = requirementRows(withRequirements(progress, { trialAvailable: false }, { level: false, weeks: false }));
    expect(rows[0]).toMatchObject({ label: "Level 12 (you: 9)", state: "not-started" });
    expect(rows[1]).toMatchObject({ label: "4 qualifying weeks (1)", state: "not-started" });
    expect(rows[3]).toMatchObject({ label: "Rank Trial", sublabel: "locked", state: "not-started", locked: true });
  });

  it("marks a passed trial done", () => {
    const rows = requirementRows(withRequirements(progress, { trialAvailable: false }, { trial: true }));
    expect(rows[3]).toMatchObject({ sublabel: "passed", state: "done", locked: false });
  });

  it("is empty at the top rank", () => {
    expect(requirementRows({ ...progress, nextRank: { rank: null, title: null, requirements: [], trialAvailable: false } })).toEqual([]);
  });
});

describe("statDelta", () => {
  it("words up, steady and down over 4 weeks, with a true minus sign", () => {
    expect(statDelta(stat({ delta: 4, trend: "up" }))).toEqual({ kind: "up", text: "+4 in 4 weeks" });
    expect(statDelta(stat({ delta: 2, trend: "steady" }))).toEqual({ kind: "steady", text: "steady" });
    expect(statDelta(stat({ delta: -2, trend: "down" }))).toEqual({ kind: "down", text: "−2 in 4 weeks" });
    expect(statDelta(stat({ previous: null, delta: null, trend: "none" }))).toEqual({ kind: "steady", text: "steady" });
  });

  it("reads calibrating for a VIT still calibrating", () => {
    expect(statDelta({ ...stat({ delta: 9, trend: "up" }), calibrating: true })).toEqual({ kind: "steady", text: "calibrating" });
  });
});

describe("statSeries", () => {
  it("gives four weekly points per stat ending on today's value", () => {
    const series = statSeries({ days: demo.days, todayKey: TODAY, results: progress.days, settings: demo.settings, metaFor });
    expect(seriesKeys(TODAY)).toEqual(["2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02"]);
    for (const key of ["str", "end", "vit"] as const) {
      expect(series[key]).toHaveLength(4);
      expect(series[key][3]).toBe(progress.stats[key].value);
    }
    expect(series.str[0]).toBeLessThanOrEqual(series.str[3] as number);
  });
});

describe("recordRows", () => {
  const candidate = (over: Partial<RecordCandidate>): RecordCandidate => ({
    exerciseId: "x", name: "Bench Press", kind: "e1rm", previous: 98, current: 100.2, priorExposures: 4, fromExtraWork: false, baseline: false, isRecord: true, label: "", ...over,
  });
  const result = (dateKey: string, records: RecordCandidate[]): DayResult => ({ ...(progress.today as DayResult), dateKey, records, recordXp: [] });
  const log = (name: string, trackingMode: ExerciseLog["trackingMode"], sets: ExerciseLog["sets"]): ExerciseLog => ({ name, trackingMode, sets });
  const day = (exercises: Record<string, ExerciseLog>): DayV2 => ({ ...emptyDay(), workout: { exercises, cardio: [] } });

  it("keeps one row per movement, the latest record, newest first, in the three formats", () => {
    const days: DayMap = {
      "2026-09-20": day({ b: log("Bench Press", "loaded_reps", [{ id: "s1", weightKg: 80, reps: 8, done: true }]) }),
      "2026-09-28": day({ p: log("Push-Up", "bodyweight_reps", [{ id: "s1", weightKg: null, reps: 12, done: true }]) }),
      "2026-09-30": day({ pl: log("Plank", "timed_hold", [{ id: "s1", weightKg: null, reps: null, seconds: 65, done: true }]) }),
      "2026-10-01": day({ b: log("Bench Press", "loaded_reps", [{ id: "s1", weightKg: 82.5, reps: 8, done: true }]) }),
    };
    const p: Progress = {
      ...progress,
      days: {
        "2026-09-20": result("2026-09-20", [candidate({ exerciseId: "b", current: 98 })]),
        "2026-09-28": result("2026-09-28", [candidate({ exerciseId: "p", name: "Push-Up", kind: "reps", previous: 10, current: 12, loadKg: 0 })]),
        "2026-09-30": result("2026-09-30", [candidate({ exerciseId: "pl", name: "Plank", kind: "hold", previous: 60, current: 65 })]),
        "2026-10-01": result("2026-10-01", [candidate({ exerciseId: "b", current: 100.2 }), candidate({ exerciseId: "x", name: "Row", fromExtraWork: true }), candidate({ exerciseId: "y", name: "Curl", isRecord: false })]),
      },
    };
    const rows = recordRows(p, days, "imperial", TODAY);
    expect(rows.map((r) => [r.name, r.valueText, r.dateText, r.kind])).toEqual([
      ["Bench Press", "est. max 220.9 lb", "Thu 1 Oct", "e1rm"],
      ["Plank", "best 65 s", "Wed 30 Sep", "hold"],
      ["Push-Up", "best 12 reps at BW", "Mon 28 Sep", "reps"],
    ]);
    expect(rows[0]?.series).toEqual([101.3, 104.5]);
    expect(rows[1]?.series).toEqual([65]);
    expect(rows[2]?.series).toEqual([12]);
  });

  it("names the added load of a weighted rep record and formats metric loads", () => {
    const p: Progress = { ...progress, days: { "2026-10-01": result("2026-10-01", [candidate({ name: "Pull-Up", kind: "reps", previous: 6, current: 8, loadKg: 10 }), candidate({ exerciseId: "d", name: "Deadlift", current: 180 })]) } };
    const rows = recordRows(p, {}, "metric", TODAY);
    expect(rows.map((r) => r.valueText)).toEqual(["best 8 reps at +10 kg", "est. max 180 kg"]);
    expect(rows[0]?.series).toEqual([]);
  });

  it("reads the demo's records: five movements, Back Squat newest", () => {
    const rows = recordRows(progress, demo.days, "metric", TODAY);
    expect(rows).toHaveLength(5);
    expect(rows[0]?.name).toBe("Back Squat");
    expect(rows[0]?.series.length).toBeGreaterThan(4);
    expect(rows.find((r) => r.name === "Push-Up")?.valueText).toBe("best 12 reps at BW");
  });
});

describe("titleTiles", () => {
  it("lists every achievement and every rank above E, unlocked up to the current rank, and marks the featured one", () => {
    const tiles = titleTiles(progress, "Initiate");
    expect(tiles).toHaveLength(ACHIEVEMENTS.length + RANK_ORDER.length - 1);
    expect(tiles).toHaveLength(progress.titles.total);
    expect(tiles.filter((t) => t.unlocked)).toHaveLength(progress.titles.unlocked.length);
    expect(tiles.filter((t) => t.featured).map((t) => t.title)).toEqual(["Initiate"]);
    expect(tiles.find((t) => t.id === "rank-d")).toMatchObject({ title: "Initiate", unlocked: true, requirement: "Reach rank D" });
    expect(tiles.find((t) => t.id === "rank-c")).toMatchObject({ title: "Contender", unlocked: false, requirement: "Reach rank C" });
    expect(tiles.find((t) => t.id === "first_quest")).toMatchObject({ title: "First Quest", unlocked: true, requirement: "Clear your first training quest." });
    expect(titleTiles(progress, null).some((t) => t.featured)).toBe(false);
  });
});

describe("explainText", () => {
  it("explains STR from the config's groups and marks, with the group scores as inputs", () => {
    const e = explainText("str", progress);
    expect(e.name).toBe("STR");
    expect(e.formula).toContain("average of 4 groups");
    expect(e.formula).toContain("squat 2.5×, hinge 3×, push 1.75×, pull 1.75×");
    expect(e.formula).toContain("90 days");
    expect(e.inputs.map((i) => i.label)).toEqual(["Squat", "Hinge", "Push", "Pull", "Groups measured"]);
    expect(e.inputs[4]?.value).toBe("4 of 4");
    expect(explainText("str", { ...progress, stats: { ...progress.stats, str: { ...progress.stats.str, groups: { ...progress.stats.str.groups, hinge: null } } } }).inputs[1]?.value).toBe("not measured");
  });

  it("explains END with the weights, the full marks and the minutes", () => {
    const e = explainText("end", progress);
    expect(e.formula).toBe("END is 60% your average weekly cardio minutes over the last 4 weeks against 450, plus 40% your longest session of the last 90 days against 180 minutes.");
    expect(e.inputs).toEqual([
      { label: "Weekly minutes (4-week average)", value: `${Math.round(progress.stats.end.weeklyMinutes)} min` },
      { label: "Longest session", value: `${Math.round(progress.stats.end.longestMinutes)} min` },
    ]);
  });

  it("explains VIT with the rates as percentages and names calibration only while calibrating", () => {
    const e = explainText("vit", progress);
    expect(e.formula).toBe("VIT is 40% your check-in rate over the last 28 days, 35% your sleep answers and 25% the rest days you honoured.");
    expect(e.inputs.map((i) => i.label)).toEqual(["Check-in rate", "Sleep answers", "Rest days honoured"]);
    expect(e.inputs.every((i) => /^\d+%$/.test(i.value))).toBe(true);
    const calibrating = explainText("vit", { ...progress, stats: { ...progress.stats, vit: { ...progress.stats.vit, calibrating: true } } });
    expect(calibrating.formula).toMatch(/calibrates over the first 7 days\.$/);
  });

  it("never says e1RM and never exclaims", () => {
    for (const key of ["str", "end", "vit"] as const) {
      const e = explainText(key, progress);
      expect(`${e.formula} ${e.inputs.map((i) => `${i.label} ${i.value}`).join(" ")}`).not.toMatch(/e1RM|1RM|!/);
    }
  });
});

describe("rank trial helpers", () => {
  const trial = progress.trial as TrialSpec;

  it("strips the safety line from the prescription and attaches to the next planned day with the movement", () => {
    expect(trial.exerciseName).toBe("Back Squat");
    expect(trialPrescription(trial)).toBe("5 reps at 80% of your best: 55 kg Back Squat");
    const key = trialAttachDay(demo.program, trial, "2026-10-03");
    expect(key).not.toBeNull();
    expect(key as string > "2026-10-02").toBe(true);
    expect(attachLine(trial, key)).toBe(`Attaches to ${shortDate(key as string)}, your next full day with Back Squat.`);
  });

  it("falls back to the next full day for a cardio trial, with no program, or when nothing is planned", () => {
    const cardio: TrialSpec = { ...trial, kind: "cardio", exerciseId: null, exerciseName: null, loadKg: null, reps: null, minutes: 20, spec: "20 minutes of continuous cardio, any kind, no pauses. Stop if anything hurts." };
    expect(trialAttachDay(demo.program, cardio, TODAY)).toBeNull();
    expect(trialAttachDay(null, trial, TODAY)).toBeNull();
    expect(trialAttachDay(demo.program, { ...trial, exerciseId: "nope", exerciseName: "Nope" }, TODAY)).toBeNull();
    expect(attachLine(cardio, null)).toBe("Attaches to your next full day.");
    expect(trialPrescription(cardio)).toBe("20 minutes of continuous cardio, any kind, no pauses");
  });

  it("formats dates short and local", () => {
    expect(shortDate("2026-10-02")).toBe("Fri 2 Oct");
    expect(shortDate("2026-09-30")).toBe("Wed 30 Sep");
    expect(XP.rankTrial).toBe(300);
  });
});
