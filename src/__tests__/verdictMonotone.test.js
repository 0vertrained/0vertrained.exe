import { describe, expect, it } from "vitest";
import { buildRecoveryVerdict } from "../recovery/verdictResolver";
import { getTrainingRecommendation } from "../oura/insights";
import { readCheckin, checkinSeverity } from "../checkinMorning";

// The resolver's doctrine: limiters only make the call more cautious. Checked here the way the
// dashboard runs it (recommendation, then resolver), by adding each reason to a morning and
// confirming the call never gets easier.

const ORDER = ["push", "train", "capped", "easy", "recover"];
const NEUTRAL = { sleepQuality: 6, soreness: 5, stress: 5, energy: 6 };
const ROUGH = { sleepQuality: 3, soreness: 8, stress: 5, energy: 6 };

function call({ score, debt = 0, zone = "optimal", illness = false, body = NEUTRAL }) {
  const sleepDebt = { debtHours: debt };
  const recommendation = getTrainingRecommendation({ recovery: { score }, readiness: null, quality: null, loadZone: zone, sleepDebt });
  const checkin = readCheckin(body);
  return buildRecoveryVerdict({
    recommendation,
    recovery: { score },
    sleepDebt,
    alerts: illness ? [{ type: "illness_warning", severity: "warning" }] : [],
    trainingLoad: { rolling: { zone } },
    confidence: null,
    checkin: { severity: checkinSeverity(checkin), flags: checkin.flags },
  }).call;
}

describe("the recovery verdict only ever gets more cautious", () => {
  it("keeps sleep debt's cap on a push day when the check-in is rough too", () => {
    expect(call({ score: 88, debt: 2.5 })).toBe("capped");
    expect(call({ score: 88, debt: 2.5, body: ROUGH })).toBe("capped");
  });

  it("keeps sleep debt's cap on a push day when load is overreaching", () => {
    expect(call({ score: 88, debt: 2.5, zone: "overreaching" })).toBe("capped");
  });

  it("never eases when a reason is added", () => {
    const taps = { sleepQuality: [3, 6, 9], soreness: [2, 5, 8], stress: [2, 5, 8], energy: [3, 6, 9] };
    const scores = [0, 20, 39, 40, 54, 55, 69, 70, 84, 85, 86, 100];
    const failures = [];
    for (const score of scores) for (const debt of [0, 1, 2, 3, 5]) for (const zone of ["undertraining", "optimal", "overreaching", "high_risk"]) for (const illness of [false, true])
      for (const s of taps.sleepQuality) for (const so of taps.soreness) for (const st of taps.stress) for (const e of taps.energy) for (const ill of [false, true]) {
        const morning = { score, debt, zone, illness, body: { sleepQuality: s, soreness: so, stress: st, energy: e, illnessOrInjury: ill } };
        const withAll = ORDER.indexOf(call(morning));
        const withoutOne = [{ ...morning, body: NEUTRAL }, { ...morning, debt: 0 }, { ...morning, zone: "optimal" }, { ...morning, illness: false }];
        if (withoutOne.some((m) => ORDER.indexOf(call(m)) > withAll)) failures.push(morning);
      }
    expect(failures.slice(0, 3)).toEqual([]);
  });
});
