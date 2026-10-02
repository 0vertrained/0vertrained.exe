// buildProgress runs on every render of every tab, so two years of history
// must fold in a frame. Median of 5 runs over 730 days: warn above 16 ms
// (a frame), fail above 100 ms. The fail bound is loose on purpose: it is
// there to catch a quadratic regression (the first version took 635 ms),
// not to flake under coverage instrumentation on a shared CI runner.
import { describe, expect, it } from "vitest";
import { metaFor, threeDayProgram } from "../../test/gameFixtures";
import { scenario, weeksBefore } from "../../test/gameScenario";
import { buildProgress } from "./progress";

const WARN_MS = 16;
const FAIL_MS = 100;

describe("buildProgress performance", () => {
  it("folds 730 days in under 100 ms (median of 5)", () => {
    const todayKey = "2026-10-12";
    const s = scenario({ program: threeDayProgram(), startedOn: weeksBefore(todayKey, 105), todayKey, weeklyStepKg: 0.5, illnessOn: ["2026-05-01"], missedOn: ["2026-06-03", "2026-08-12"] });
    expect(Object.keys(s.days).length).toBeGreaterThanOrEqual(700);
    const input = { days: s.days, settings: s.settings, program: s.program, todayKey, metaFor };
    buildProgress(input); // warm up
    const times: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const t0 = performance.now();
      const p = buildProgress(input);
      times.push(performance.now() - t0);
      expect(p.keptDays).toBeGreaterThan(600);
    }
    const median = times.sort((a, b) => a - b)[2] as number;
    if (median > WARN_MS) console.warn(`buildProgress: ${median.toFixed(1)} ms median over 730 days (warn above ${WARN_MS} ms)`);
    expect(median).toBeLessThan(FAIL_MS);
  });
});
