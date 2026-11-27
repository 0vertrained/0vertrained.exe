import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);
function replay(entries, through) {
  const dir = mkdtempSync(join(tmpdir(), "ovt-strength-test-"));
  try {
    const file = join(dir, "example.json");
    writeFileSync(file, JSON.stringify(entries));
    const args = ["scripts/replay-algorithms.mjs", "--input", file, "--json"];
    if (through) args.push("--through", through);
    return JSON.parse(execFileSync(process.execPath, args, {cwd: root, env: {...process.env, TZ: "UTC"}}));
  } finally {
    rmSync(dir, {force: true, recursive: true});
  }
}

function exercise(name, weight, reps, effort, set = {}) {
  return {sets: [{done: true, weight, reps, ...set,
    progressionTarget: {plan: {name, sets: 1, reps: "6–8", rir: effort}},
  }]};
}

test("paired effort outcomes use the athlete's RIR range, pain and form flags", () => {
  const scenarios = [
    ["Barbell Bench", "1–2", {rir: 4}],
    ["Barbell Row", "2+", {rir: 4}],
    ["DB Press", 2, {rir: 2, quality: "form_break"}],
    ["Cable Row", 2, {rir: 2, pain: true}],
    ["Front Squat", 2, {rir: ""}],
  ];
  const days = {};
  for (const [date, reps] of [["2026-09-01", 7], ["2026-09-08", 8]]) {
    days[date] = {workout: {exercises: Object.fromEntries(scenarios.map(([name, effort, set]) =>
      [name, exercise(name, 100, reps, effort, reps === 7 ? {rir: 2} : set)]))}};
  }
  const {strength} = replay(days);
  assert.equal(strength.loggedSets, 10);
  assert.equal(strength.pairedSets, 5);
  for (const scorer of Object.values(strength.methods)) {
    assert.equal(scorer.attempted, 5);
    assert.equal(scorer.repsMet, 5);
    assert.equal(scorer.effortMeasured, 4);
    assert.equal(scorer.effortMet, 1);
  }
});

test("backfilled sets stay out of earlier predictions, fallback plans and truncated observations", () => {
  const days = {};
  const name = "Barbell Bench Press";
  const row = (day, set) => { days[day] = {workout: {exercises: {[name]: {sets: [set]}}}}; };
  row("2026-09-01", {done: true, weight: 100, reps: 6}); // Legacy set without a capture time or plan.
  row("2026-09-02", exercise(name, 175, 50, 2, {completedAt: "2026-09-05T10:00:00Z"}).sets[0]);
  row("2026-09-03", {done: true, weight: 105, reps: 7, completedAt: "2026-09-03T10:00:00Z"});
  const truncated = replay(days, "2026-09-03");
  assert.equal(truncated.strength.loggedSets, 2);
  assert.equal(truncated.workouts[0].planSource, null);
  const third = truncated.workouts.at(-1);
  assert.equal(third.planSource, "prior session");
  assert.equal(third.repeat[0].weight, 100);
  const full = replay(days, "2026-09-06");
  assert.equal(full.strength.loggedSets, 3);
  assert.deepEqual(full.workouts.at(-1), third);
  const late = full.workouts.find(w => w.date === "2026-09-02");
  assert.equal(late.planSource, "prior session");
  assert.equal(late.actual[0].weight, 175);
});

test("both daily load estimates show only the lifting and import data present by that day's end", () => {
  const date = "2026-09-01", later = "2026-09-03T10:00:00Z";
  const day = {workout: {
    rpe: 6, completed: true, completedAt: later,
    exercises: {
      Bench: {sets: [{done: true, weight: 100, reps: 6}, {done: true, weight: 105, reps: 5, completedAt: later}]},
      Squat: {sets: [{done: true, weight: 200, reps: 6, completedAt: later}]},
    },
    watchWorkouts: [{seconds: 4200, endedAt: later}],
    cardio: {miles: 6, time: "50:00", activityRefs: [{source: "apple", importedAt: later}]},
  }};
  const report = replay({entries: {[date]: day}, wearables: {
    stravaByDate: {[date]: [{kind: "run", minutes: 45, miles: 5, importedAt: later}]},
    whoopData: {[date]: {workout: [{score: {strain: 18}, created_at: later}]}},
    ouraData: {[date]: {activity: {data: [{active_calories: 500, updated_at: later}]}}},
  }});
  for (const row of Object.values(report.daily[0].trainingLoad)) {
    assert.deepEqual(row, {load: 18, minutes: 3, source: "manual"});
  }
});
