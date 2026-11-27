import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { exampleHistory } from "./replay-example.mjs";

const dir = mkdtempSync(join(tmpdir(), "ovt-replay-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const baseline = "b39cdcbf41dc03a1647dd39e345088b15c5169aa";
function run(input, through) {
  const args = ["scripts/replay-algorithms.mjs", "--json"];
  if (input !== undefined) {
    const file = join(dir, "backup.json");
    writeFileSync(file, JSON.stringify(input));
    args.push("--input", file);
  }
  if (through) args.push("--through", through);
  return JSON.parse(execFileSync(process.execPath, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

test("replays all five production algorithms against the pinned revision", () => {
  const report = run();
  assert.equal(report.baseline, baseline);
  assert.equal(report.days, 42);
  const byDay = Object.fromEntries(report.daily.map(day => [day.date, day]));
  assert.deepEqual(byDay["2026-09-22"].recovery, { old: "recover", current: "train" });
  assert.deepEqual(byDay["2026-09-29"].recovery, { old: "recover", current: "recover" });
  assert.deepEqual(byDay["2026-09-30"].recovery, { old: "recover", current: "train" });
  assert.equal(report.daily.filter(d => d.recovery).length, 4);
  assert.equal(byDay["2026-09-21"].trainingLoad.current.minutes, 90);
  assert.equal(byDay["2026-09-23"].trainingLoad.current.minutes, 40);
  assert.equal(byDay["2026-09-25"].trainingLoad.current.minutes, 60);
  assert.equal(report.daily.filter(d => d.energy.old.kcal != null).length, 28);
  assert.equal(report.daily.filter(d => d.energy.current.kcal != null).length, 11);
  assert.deepEqual(report.weekly.map(d => d.current.outcome), ["unknown", "favorable", "unknown", "pending"]);
  assert.equal(report.weekly.filter(d => d.old?.followed && d.old.outcome === "favorable").length, 3);
  assert.equal(report.strength.pairedSets, 15);
  assert.equal(report.strength.methods.old.loadMaeLb, 19.67);
  assert.equal(report.strength.methods.current.loadMaeLb, 1);
  assert.equal(report.strength.methods.repeat.loadMaeLb, 2.67);
});

test("a historical cutoff gives the same result after removing every later row and import", () => {
  const fixture = exampleHistory();
  const through = "2026-10-01";
  const trim = map => Object.fromEntries(Object.entries(map).filter(([date]) => date <= through));
  const pruned = { entries: trim(fixture.entries), wearables: Object.fromEntries(
    Object.entries(fixture.wearables).map(([source, dates]) => [source, trim(dates)])) };
  const report = run(fixture, through);
  assert.deepEqual(report, run(pruned, through));
  const last = report.weekly.at(-1);
  assert.equal(last.current.outcome, "pending");
  assert.equal(last.current.followed, false);
  assert.deepEqual(report.workouts.map(d => d.date).filter(date => date > through), []);
});

test("both versions see weekly intent only after it was recorded", () => {
  const { entries } = exampleHistory();
  entries["2026-09-13"].intelligence.weeklyCoachReviewResponse.recordedOn = "2026-10-18";
  assert.equal(run(entries, "2026-10-17").weekly.some(day => day.date === "2026-09-13"), false);
  assert.equal(run(entries, "2026-10-18").weekly.some(day => day.date === "2026-09-13"), true);
});

test("an ordinary backup can distinguish unavailable captures and partial food history", () => {
  const { entries } = exampleHistory();
  for (const entry of Object.values(entries)) {
    delete entry.nutrition.foodLogConfirmation;
    delete entry.intelligence;
  }
  entries["2026-09-07"].intelligence = { todayDecisionResponse: { recoveryContext: {
    version: 1, asOf: "2026-09-07", unavailableReason: "load_context_omitted",
  } } };
  const report = run(entries);
  assert.ok(report.daily.every(day => day.recovery === null && day.energy.current.kcal === null));
  assert.equal(report.daily[0].recoveryStatus, "load_context_omitted");
  assert.equal(report.daily[1].recoveryStatus, "missing_capture");
  assert.ok(report.daily.some(day => day.energy.old.kcal > 0));
});

test("later food confirmations do not enter earlier calculations", () => {
  const { entries } = exampleHistory();
  for (const day of Object.values(entries)) {
    const stamp = day.nutrition.foodLogConfirmation;
    if (stamp) stamp.confirmedOn = "2026-10-18";
  }
  const report = run(entries);
  assert.ok(report.daily.slice(0, -1).every(day => day.energy.current.kcal === null));
  assert.ok(report.daily.at(-1).energy.current.kcal > 0);
});

test("empty exports, import-only days and invalid dates have explicit behavior", () => {
  const empty = run({});
  assert.equal(empty.days, 0);
  assert.equal(empty.strength.methods.current.loadMaeLb, null);
  const imported = run({ entries: {}, wearables: { stravaByDate: { "2026-10-10": [
    { stravaId: "sample", kind: "run", minutes: 35, miles: 4 },
  ] } } });
  assert.equal(imported.days, 1);
  assert.equal(imported.daily[0].trainingLoad.current.minutes, 35);
  assert.throws(() => run({}, "2026-02-31"), /valid YYYY-MM-DD/);
  assert.throws(() => run({ entries: [], wearables: {} }), /daily entry objects/);
});
